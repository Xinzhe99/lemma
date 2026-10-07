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
 * 3. assistant 的 toolCalls 若结果不齐，剥离 toolCalls 只留文本（防悬空），
 *    其已到达的部分结果一并丢弃——否则会留下没有声明者的孤儿 tool 消息。
 *
 * v7.8.0 修复：此前先扫一遍全部 assistant 的 tool_calls 建集合，工具结果即使
 * 排在声明者之前也会被当作「已应答」保留（顺序检查形同虚设）；且部分应答的
 * assistant 被剥离 toolCalls 后，它的那条结果仍留在序列里 → 修完还是孤儿，
 * SelfHealing 重试必然再吃一次同样的 400。
 */
export function sanitizeAgentMessages(messages: AgentMessage[]): AgentMessage[] {
  // 第一遍（顺序敏感）：记录每个 toolCallId 的声明者下标与首个结果下标
  const declaredAt = new Map<string, number>();
  const firstResultAt = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) if (!declaredAt.has(tc.id)) declaredAt.set(tc.id, i);
    } else if (m.role === 'tool' && m.toolCallId) {
      const decl = declaredAt.get(m.toolCallId);
      if (decl !== undefined && decl < i && !firstResultAt.has(m.toolCallId)) firstResultAt.set(m.toolCallId, i);
    }
  });
  // 结果齐全（每个 toolCall 都有紧随其后的结果）的块才保留 toolCalls
  const complete = new Set<string>();
  const incompleteBlocks = new Set<number>();
  messages.forEach((m, i) => {
    if (m.role !== 'assistant' || !m.toolCalls?.length) return;
    const allAnswered = m.toolCalls.every((tc) => {
      const at = firstResultAt.get(tc.id);
      return at !== undefined && at > i;
    });
    if (allAnswered) for (const tc of m.toolCalls) complete.add(tc.id);
    else incompleteBlocks.add(i);
  });
  // 第二遍：重建
  const out: AgentMessage[] = [];
  const used = new Set<string>();
  messages.forEach((m, i) => {
    if (m.role === 'tool' && m.toolCallId) {
      if (!complete.has(m.toolCallId) || used.has(m.toolCallId) || firstResultAt.get(m.toolCallId) !== i) return;
      used.add(m.toolCallId);
      out.push(m);
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      if (incompleteBlocks.has(i)) {
        const { toolCalls: _t, ...rest } = m;
        out.push(rest);
      } else {
        out.push(m);
      }
    } else {
      out.push(m);
    }
  });
  return out;
}
