/**
 * 消息完整性过滤与请求自愈（v7.5.0，对齐 agent-foundation
 * Message-integrity Filter + SelfHealingModel）：
 * - sanitizeAgentMessages：派发前清理消息序列——孤儿 tool 消息（无对应
 *   assistant tool_calls）、重复 tool 结果、结果不齐的悬空 tool_calls；
 *   任何一条都会让严格网关（OpenAI/DeepSeek）直接 400。
 * - isRepairableRequestError：判定错误是否「修一次历史大概率能救」。
 * runAgentTurn 在 400 类错误时用二者做一次性自愈重试（SelfHealing 语义）。
 */
import type { AgentMessage } from '@lemma/shared';

/** 永久性错误关键词——这些重发同样的请求只会再次失败 */
const PERMANENT_HINTS = ['401', '403', '404', '429', 'quota', 'unauthorized', 'forbidden', 'model_not_found'];

/** 请求体/协议类错误——修历史后重试有救 */
export function isRepairableRequestError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (PERMANENT_HINTS.some((k) => msg.includes(k))) return false;
  return (
    msg.includes('接口返回 400') ||
    msg.includes('invalid_request') ||
    msg.includes('invalid request') ||
    msg.includes('bad request') ||
    msg.includes('tool_calls') ||
    msg.includes('tool_call_id') ||
    msg.includes('tool message') ||
    msg.includes("with 'tool_calls' must be followed")
  );
}

/**
 * 清理消息序列（纯函数）：
 * 1. tool 消息必须出现在声明它的 assistant(tool_calls) 之后，否则丢弃（孤儿）；
 * 2. 同一 toolCallId 的重复 tool 结果只保留第一个；
 * 3. assistant 的 toolCalls 若结果不齐，剥离 toolCalls 只留文本（防悬空）。
 */
export function sanitizeAgentMessages(messages: AgentMessage[]): AgentMessage[] {
  // 第一遍：确定「合法且首次出现」的结果 id 集合
  const open = new Set<string>();
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) open.add(tc.id);
    } else if (m.role === 'tool' && m.toolCallId) {
      if (open.has(m.toolCallId) && !answered.has(m.toolCallId)) answered.add(m.toolCallId);
    }
  }
  // 第二遍：重建
  const out: AgentMessage[] = [];
  const used = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      if (!answered.has(m.toolCallId) || used.has(m.toolCallId)) continue;
      used.add(m.toolCallId);
      out.push(m);
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      if (m.toolCalls.every((tc) => answered.has(tc.id))) {
        out.push(m);
      } else {
        const { toolCalls: _t, ...rest } = m;
        out.push(rest);
      }
    } else {
      out.push(m);
    }
  }
  return out;
}
