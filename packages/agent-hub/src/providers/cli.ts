/**
 * 本地 CLI agent 适配器（Codex CLI / Claude Code / ZCode / Gemini CLI / aider…）。
 *
 * 协议假设（宽容解析，尽量兼容各家 JSONL 流）：
 * - `codex exec --json`：每行一个 JSON 事件，如
 *   {"type":"item.completed","item":{"type":"agent_message","text":"…"}}、
 *   {"type":"turn.completed","usage":{…}}
 * - `claude -p --output-format stream-json`：每行一个 JSON 事件，如
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"…"} | {"type":"tool_use",…}]}}、
 *   {"type":"result","result":"…"}、{"type":"system","subtype":"init"}
 * - 其他 CLI 只要 stdout 按行输出含 text/delta/content 字段的 JSON，即可被提取。
 *
 * 真实进程 spawn 由宿主注入 ProcessRunner（Electron/Tauri 侧桥接），本包不做 child_process。
 */
import { createId } from '@lemma/shared';
import type { ChatEvent, ChatProvider, ChatRequest, ChatUsage } from './types';

/** 进程运行器抽象：真实实现由宿主注入（node-pty / child_process / 平台桥） */
export interface ProcessRunner {
  spawn(
    cmd: string,
    args: string[],
    opts: { cwd: string },
  ): {
    /** 写入子进程 stdin */
    write(s: string): void;
    /** stdout（或合并流）输出；进程退出时迭代结束 */
    output: AsyncIterable<string>;
    kill(): void;
  };
}

export interface CliProviderOptions {
  id: string;
  label: string;
  /** 可执行文件名或路径，如 codex / claude / zcode */
  command: string;
  /** 固定参数，如 ['exec','--json'] 或 ['-p','--output-format','stream-json'] */
  args?: string[];
  /** 工作目录（通常 = 项目根） */
  cwd: string;
  outputMode: 'jsonl' | 'text';
  runner: ProcessRunner;
}

/** 把会话消息 + 工具清单序列化为喂给 CLI 的 prompt 文本 */
export function buildPrompt(req: ChatRequest): string {
  const lines: string[] = [];
  for (const m of req.messages) {
    if (m.role === 'tool') {
      lines.push(`[tool ${m.toolCallId ?? ''}] ${m.content}`);
    } else {
      lines.push(`[${m.role}] ${m.content}`);
    }
  }
  if (req.tools?.length) {
    lines.push('');
    lines.push('可用工具：');
    for (const t of req.tools) {
      lines.push(`- ${t.name}（${t.permission}）：${t.description} 参数 Schema：${JSON.stringify(t.parameters)}`);
    }
  }
  return lines.join('\n');
}

/** 从一行 JSONL 宽容提取事件：文本字段、工具调用字段、usage 各自独立识别 */
export function extractJsonlEvents(obj: unknown): ChatEvent[] {
  if (typeof obj !== 'object' || obj === null) return [];
  const o = obj as Record<string, any>;
  const events: ChatEvent[] = [];

  if (o.type === 'error' || o.is_error === true) {
    events.push({ type: 'error', message: o.message ?? o.error?.message ?? JSON.stringify(o).slice(0, 300) });
    return events;
  }

  // ---- 工具调用：tool_call / toolCall / tool_use / claude content 数组里的 tool_use ----
  const toolCandidates: unknown[] = [];
  if (o.tool_call) toolCandidates.push(o.tool_call);
  if (o.toolCall) toolCandidates.push(o.toolCall);
  if (o.tool_use) toolCandidates.push(o.tool_use);
  if (o.type === 'tool_call') toolCandidates.push(o);
  if (o.type === 'item.completed' && o.item?.type === 'tool_call') toolCandidates.push(o.item);
  const contentArr = o.message?.content ?? o.content;
  if (Array.isArray(contentArr)) {
    for (const item of contentArr) {
      if (item && typeof item === 'object' && (item as any).type === 'tool_use') toolCandidates.push(item);
    }
  }
  for (const c of toolCandidates) {
    const call = mapToolCall(c);
    if (call) events.push({ type: 'tool-call', call });
  }

  // ---- 文本：delta / text / content(字符串) / claude content 数组 text 项 / result / codex item.text ----
  const textCandidates: unknown[] = [];
  if (typeof o.delta === 'string') textCandidates.push(o.delta);
  else if (o.delta && typeof o.delta === 'object') {
    if (typeof o.delta.text === 'string') textCandidates.push(o.delta.text);
    if (typeof o.delta.content === 'string') textCandidates.push(o.delta.content);
  }
  if (typeof o.text === 'string') textCandidates.push(o.text);
  if (typeof o.content === 'string') textCandidates.push(o.content);
  if (typeof o.item?.text === 'string') textCandidates.push(o.item.text);
  if (typeof o.message?.content === 'string') textCandidates.push(o.message.content);
  if (typeof o.result === 'string') textCandidates.push(o.result);
  if (Array.isArray(contentArr)) {
    for (const item of contentArr) {
      if (item && typeof item === 'object' && (item as any).type === 'text' && typeof (item as any).text === 'string') {
        textCandidates.push((item as any).text);
      }
    }
  }
  const text = textCandidates.find((t) => typeof t === 'string' && t.length > 0);
  if (typeof text === 'string') events.push({ type: 'text-delta', delta: text });

  return events;
}

/** 宽容提取 usage（codex turn.completed / openai 风格字段名都认） */
export function extractUsage(obj: unknown): ChatUsage | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const o = obj as Record<string, any>;
  const u = o.usage ?? o.item?.usage ?? o.message?.usage;
  if (!u || typeof u !== 'object') return undefined;
  const input = u.input_tokens ?? u.prompt_tokens;
  const output = u.output_tokens ?? u.completion_tokens;
  const usage: ChatUsage = {
    inputTokens: typeof input === 'number' ? input : undefined,
    outputTokens: typeof output === 'number' ? output : undefined,
  };
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return undefined;
  return usage;
}

function mapToolCall(c: unknown): { id: string; tool: string; args: Record<string, unknown> } | null {
  if (typeof c !== 'object' || c === null) return null;
  const t = c as Record<string, any>;
  const tool = t.name ?? t.tool ?? t.function?.name;
  if (typeof tool !== 'string' || !tool) return null;
  const rawArgs = t.arguments ?? t.input ?? t.function?.arguments ?? t.args;
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
    } catch {
      args = { _raw: rawArgs };
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs as Record<string, unknown>;
  }
  return { id: typeof t.id === 'string' && t.id ? t.id : `call_${createId().slice(0, 8)}`, tool, args };
}

export class CliProvider implements ChatProvider {
  readonly id: string;
  readonly label: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly outputMode: 'jsonl' | 'text';
  private readonly runner: ProcessRunner;

  constructor(opts: CliProviderOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.command = opts.command;
    this.args = opts.args ?? [];
    this.cwd = opts.cwd;
    this.outputMode = opts.outputMode;
    this.runner = opts.runner;
  }

  async *complete(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const proc = this.runner.spawn(this.command, this.args, { cwd: this.cwd });
    if (req.signal?.aborted) {
      proc.kill();
      yield { type: 'done' };
      return;
    }
    const onAbort = () => proc.kill();
    req.signal?.addEventListener('abort', onAbort, { once: true });

    proc.write(buildPrompt(req));
    proc.write('\n');

    let buffer = '';
    let usage: ChatUsage | undefined;
    try {
      for await (const chunk of proc.output) {
        if (req.signal?.aborted) break;
        if (this.outputMode === 'text') {
          if (chunk) yield { type: 'text-delta', delta: chunk };
          continue;
        }
        buffer += chunk;
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          for (const ev of this.handleJsonlLine(line)) {
            if (ev.type === 'usage') usage = ev.usage;
            else yield ev;
          }
          idx = buffer.indexOf('\n');
        }
      }
      // 冲刷最后一行（进程退出时常无尾部换行）
      if (this.outputMode === 'jsonl' && buffer.trim()) {
        for (const ev of this.handleJsonlLine(buffer)) {
          if (ev.type === 'usage') usage = ev.usage;
          else yield ev;
        }
      }
      yield { type: 'done', usage };
    } catch (e) {
      yield {
        type: 'error',
        message: `CLI 进程（${this.command}）执行失败：${e instanceof Error ? e.message : String(e)}`,
      };
    } finally {
      req.signal?.removeEventListener('abort', onAbort);
      if (req.signal?.aborted) proc.kill();
    }
  }

  private handleJsonlLine(line: string): (ChatEvent | { type: 'usage'; usage: ChatUsage })[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return []; // 非 JSON 噪音行直接跳过
    }
    const out: (ChatEvent | { type: 'usage'; usage: ChatUsage })[] = extractJsonlEvents(obj);
    const u = extractUsage(obj);
    if (u) out.push({ type: 'usage', usage: u });
    return out;
  }
}

/** 测试 / UI 开发用的脚本化 ProcessRunner：按脚本产出输出，可断言写入与终止 */
export class MockProcessRunner implements ProcessRunner {
  public readonly spawnCalls: { cmd: string; args: string[]; cwd: string }[] = [];
  public readonly written: string[] = [];
  public killed = false;
  private readonly script: string | ((prompt: string) => string | string[] | Promise<string | string[]>);
  private readonly delayMs: number;
  private readonly chunkSize: number;

  constructor(
    script: string | ((prompt: string) => string | string[] | Promise<string | string[]>) = '',
    opts: { delayMs?: number; chunkSize?: number } = {},
  ) {
    this.script = script;
    this.delayMs = opts.delayMs ?? 0;
    this.chunkSize = opts.chunkSize ?? 0; // 0 = 按行输出；>0 = 任意切块（测试半行缓冲）
  }

  spawn(cmd: string, args: string[], opts: { cwd: string }) {
    this.spawnCalls.push({ cmd, args, cwd: opts.cwd });
    let promptWaiter: (() => void) | null = null;
    let promptArrived = false;
    const handle = {
      write: (s: string) => {
        this.written.push(s);
        if (!promptArrived) {
          promptArrived = true;
          promptWaiter?.();
        }
      },
      output: this.runScript(() => promptArrived, () => new Promise<void>((r) => (promptWaiter = r))),
      kill: () => {
        this.killed = true;
      },
    };
    return handle;
  }

  private async *runScript(
    arrived: () => boolean,
    waitForArrival: () => Promise<void>,
  ): AsyncGenerator<string> {
    if (!arrived()) await waitForArrival(); // 等 CLI 写入 prompt 后再出脚本（脚本可依赖 prompt）
    let text: string;
    if (typeof this.script === 'string') {
      text = this.script;
    } else {
      const res = await this.script(this.written.join(''));
      text = Array.isArray(res) ? res.join('\n') : res;
    }
    const pieces =
      this.chunkSize > 0
        ? text.match(new RegExp(`[\\s\\S]{1,${this.chunkSize}}`, 'g')) ?? []
        : text.split('\n').map((l, i, arr) => (i < arr.length - 1 ? l + '\n' : l)).filter((l) => l.length > 0);
    for (const piece of pieces) {
      if (this.killed) return;
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      yield piece;
    }
  }
}

/**
 * 回显 Provider（无需任何后端，UI 开发 / 演示用）：
 * 把最后一条用户消息按小块延时流式回显。
 */
export class EchoProvider implements ChatProvider {
  readonly id: string;
  readonly label: string;
  private readonly delayMs: number;
  private readonly chunkSize: number;

  constructor(opts: { id?: string; label?: string; delayMs?: number; chunkSize?: number } = {}) {
    this.id = opts.id ?? 'echo';
    this.label = opts.label ?? '回显（演示）';
    this.delayMs = opts.delayMs ?? 25;
    this.chunkSize = opts.chunkSize ?? 16;
  }

  async *complete(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content ?? '（没有用户输入可回显）';
    for (let i = 0; i < text.length; i += this.chunkSize) {
      if (req.signal?.aborted) break;
      yield { type: 'text-delta', delta: text.slice(i, i + this.chunkSize) };
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    }
    yield { type: 'done' };
  }
}
