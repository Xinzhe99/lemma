/**
 * CLI Agent 桥（v1.5.0 A）：把本地 CLI 编码代理（codex / claude / gemini 等）
 * 拉平为 agent-hub 的 ChatProvider 统一流式协议。
 *
 * 形态约束（诚实标注）：
 *  - 底层走 Tauri proc_run：**一次性阻塞调用**——输出完成后整段回放（切块伪流式），
 *    不支持中途停止（停止按钮只停止消费，进程继续到自然结束）、无工具回调协议；
 *  - 仅桌面形态可用（浏览器无进程桥）：isCliAgentAvailable() 检测 __TAURI__；
 *  - prompt 组装：system + 历史 + user 以「角色: 内容」段落拼接为单条提示词。
 */

import type { AgentMessage } from '@scholarforge/shared';
import type { ChatEvent, ChatProvider, ChatRequest } from '@scholarforge/agent-hub';
import { tauriProcRun } from './platform/tauri';
import type { CliAgentConfig } from './state/settingsStore';

/** 进程运行器（注入便于测试）：成功退出码 0 视为成功 */
export interface ProcRunner {
  run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** 默认运行器：Tauri proc_run（cwd 缺省 = 应用数据目录） */
export const tauriCliRunner: ProcRunner = {
  run: (cmd, args) => tauriProcRun(cmd, args),
};

/** 桌面形态（__TAURI__ 桥存在）才可运行 CLI */
export function isCliAgentAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const t = (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  return t != null;
}

/** CLI 调用超时（毫秒）：一次性进程调用，长任务给足裕量但必须可失败 */
export const CLI_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// 参数模板解析（纯函数）
// ---------------------------------------------------------------------------

/**
 * 解析参数模板为 argv：空白分隔、双引号/单引号成组，{prompt} 占位符替换为完整提示词
 * （占位符无论是否在引号内都作为单个 argv 元素传递，杜绝提示词注入 shell）。
 * 模板缺 {prompt} 返回 null（调用方回落提示词追加在 argv 末尾）。
 */
export function buildCliArgs(template: string, prompt: string): string[] | null {
  const args: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  let hasPlaceholder = false;
  const flush = (): void => {
    if (buf.length > 0) args.push(buf);
    buf = '';
  };
  for (let i = 0; i < template.length; i++) {
    const c = template[i] ?? '';
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      if (template.startsWith('{prompt}', i)) {
        flush();
        args.push(prompt);
        hasPlaceholder = true;
        i += '{prompt}'.length - 1;
        continue;
      }
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ' ' || c === '\t') {
      flush();
      continue;
    }
    if (template.startsWith('{prompt}', i)) {
      flush();
      args.push(prompt);
      hasPlaceholder = true;
      i += '{prompt}'.length - 1;
      continue;
    }
    buf += c;
  }
  flush();
  return hasPlaceholder ? args : null;
}

/** 把会话消息组装为单条 CLI 提示词（角色段落拼接；user 最后） */
export function buildCliPrompt(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') parts.push(`[系统设定]\n${m.content}`);
    else if (m.role === 'user') parts.push(`[用户]\n${m.content}`);
    else if (m.role === 'assistant' && m.content.trim()) parts.push(`[助手]\n${m.content}`);
    // role=tool 的回执不进 CLI 提示词（一次性调用没有工具循环）
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class CliAgentProvider implements ChatProvider {
  readonly id: string;
  readonly label: string;
  private readonly cfg: CliAgentConfig;
  private readonly runner: ProcRunner;

  constructor(cfg: CliAgentConfig, runner: ProcRunner = tauriCliRunner) {
    this.id = `cli:${cfg.command}`;
    this.label = `${cfg.label}（CLI）`;
    this.cfg = cfg;
    this.runner = runner;
  }

  async *complete(req: ChatRequest): AsyncGenerator<ChatEvent> {
    if (req.signal?.aborted) {
      yield { type: 'error', message: '已中止' };
      return;
    }
    const prompt = buildCliPrompt(req.messages);
    let argv = buildCliArgs(this.cfg.argsTemplate, prompt);
    if (argv === null) argv = [...this.cfg.argsTemplate.trim().split(/\s+/).filter(Boolean), prompt];

    let result: { code: number; stdout: string; stderr: string };
    try {
      result = await Promise.race([
        this.runner.run(this.cfg.command, argv),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`CLI 调用超时（${CLI_TIMEOUT_MS / 1000}s）`)), CLI_TIMEOUT_MS)),
        new Promise<never>((_, reject) => {
          req.signal?.addEventListener('abort', () => reject(new Error('已中止')), { once: true });
        }),
      ]);
    } catch (e) {
      yield { type: 'error', message: `CLI agent 调用失败：${e instanceof Error ? e.message : String(e)}` };
      return;
    }

    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim().slice(0, 400);
      yield { type: 'error', message: `CLI agent 退出码 ${result.code}${detail ? `：${detail}` : ''}` };
      return;
    }

    const text = result.stdout.replace(/\r\n/g, '\n').trim();
    if (!text) {
      yield { type: 'error', message: 'CLI agent 无输出（stderr 为空且 stdout 为空）' };
      return;
    }
    // 一次性回放切块（伪流式：约 120 字符/块，块间让出微任务，UI 有渐进感）
    const CHUNK = 120;
    for (let i = 0; i < text.length; i += CHUNK) {
      if (req.signal?.aborted) return;
      yield { type: 'text-delta', delta: text.slice(i, i + CHUNK) };
      await Promise.resolve();
    }
    yield { type: 'done', usage: { outputTokens: Math.ceil(text.length / 4) } };
  }
}
