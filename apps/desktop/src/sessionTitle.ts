/**
 * 会话标题 AI 自动总结（Codex 式）：
 *  - 首条用户消息仍立即用前缀做临时标题（store.sendMessage 现状，保留为 AI 不可用时的回退）；
 *  - 第一轮真实 provider 回复完成后，aiActions.sendChatMessageInner fire-and-forget 调用
 *    generateSessionTitle 用 cheap 档模型生成标题；成功且用户未手动改名时覆盖。
 *  - 失败 / 超时 / 演示模式一律返回 null，调用方静默忽略，绝不打扰用户。
 *
 * 依赖注入说明：resolveProviderRouted 位于 aiActions（会与宿主相互引用），此处用
 * 动态 import 在调用时取得，避免静态循环依赖（与 AgentPanel 的既有做法一致）。
 */

import { runAgentTurn } from './agentTools';

/** 标题生成的 system 提示（直接输出标题本身，不要引号和句号） */
export const SESSION_TITLE_SYSTEM =
  '根据这段学术写作对话生成一个不超过 12 个字的会话标题，直接输出标题本身，不要引号和句号';

/** 送入模型的首条用户消息 / AI 回复截断上限（标题任务无需长上下文，控制成本） */
const USER_SNIPPET_MAX = 300;
const REPLY_SNIPPET_MAX = 600;
/** 超时（ms）：标题是锦上添花，宁可放弃也不让请求悬挂 */
const TITLE_TIMEOUT_MS = 15000;
/** 标题字数上限 */
export const SESSION_TITLE_MAX = 12;

/** 组装标题生成的 user prompt（纯函数）：首条用户消息 + 第一轮 AI 回复（各自截断） */
export function buildSessionTitlePrompt(firstUserMessage: string, assistantReply: string): string {
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
  return [
    '【对话记录】',
    `用户：${clip(firstUserMessage.trim(), USER_SNIPPET_MAX)}`,
    `AI：${clip(assistantReply.trim(), REPLY_SNIPPET_MAX)}`,
    '',
    '请生成会话标题（不超过 12 个字），直接输出标题本身。',
  ].join('\n');
}

/**
 * 清洗模型输出的标题（纯函数）：取首个非空行、去中英引号、去「标题：」前缀、
 * 去尾部句号/分号等收尾符、按 Unicode 码点截断到 12 字。清完为空返回 ''。
 */
export function sanitizeSessionTitle(raw: string): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  let line = firstLine
    // 去中英引号与包裹符（成对或单侧都剥）
    .replace(/[“”„‟‘’「」『』《》"'`*]/g, '')
    // 去列表符号与「标题：/Title:」前缀（模型常见的越界输出）
    .replace(/^\s*(?:[-•·–]+\s*)?(?:标题|Title)\s*[:：]\s*/u, '')
    .trim();
  if (!line) return '';
  // 去尾部句号/顿号/分号/叹问号/省略号与空白
  line = line.replace(/[\s。．、；;！!？?…]+$/u, '');
  // Unicode 码点截断到 12 字（中文按 1 字计）
  const chars = Array.from(line);
  return (chars.length > SESSION_TITLE_MAX ? chars.slice(0, SESSION_TITLE_MAX) : chars).join('');
}

/**
 * 生成会话标题：cheap 档模型（resolveProviderRouted('simple')）单轮纯文本调用，
 * 15s 超时。演示模式 / 失败 / 超时 / 清洗后为空 → null（调用方静默忽略）。
 */
export async function generateSessionTitle(
  firstUserMessage: string,
  assistantReply: string,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { resolveProviderRouted } = await import('./aiActions');
    const choice = resolveProviderRouted('simple'); // 标题是 simple 任务 → cheap 档优先
    if (!choice.real) return null; // 演示模式不触发（回退标题保持首条消息前缀）
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('session title timeout')), TITLE_TIMEOUT_MS);
    });
    const raw = await Promise.race([
      runAgentTurn({
        provider: choice.provider,
        model: choice.model,
        system: SESSION_TITLE_SYSTEM,
        history: [],
        user: buildSessionTitlePrompt(firstUserMessage, assistantReply),
        tools: [],
        maxToolRounds: 0,
      }),
      timeout,
    ]);
    return sanitizeSessionTitle(String(raw)) || null;
  } catch {
    return null; // 失败/超时完全静默：临时标题（首条消息前缀）继续可用
  } finally {
    if (timer) clearTimeout(timer);
  }
}
