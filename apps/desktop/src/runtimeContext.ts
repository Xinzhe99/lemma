/**
 * 运行时上下文（v7.5.0，对齐 agent-foundation RuntimeContextCapability）：
 * 每次请求注入有界的「现在几点 / 会话进行到哪 / 上下文还剩多少」投影，
 * 让模型知道当前日期（论文日期敏感）与本轮上下文规模，避免过期假设。
 */

export interface RuntimeContextInput {
  /** 测试可注入的当前时间 */
  now?: Date;
  /** 发送历史条数（不含本轮 user 消息） */
  historyMessages?: number;
  /** 发送历史总字符（含压缩摘要） */
  historyChars?: number;
  /** 会话 token 预算（0 = 不限）；提供时输出用量 */
  sessionBudgetTokens?: number;
  /** 已用 token 估算（会话全部消息） */
  sessionUsedTokens?: number;
}

/** 字符折半的 token 估算（与 agentUsage 同口径） */
function estTokens(chars: number): number {
  return Math.ceil(chars / 2);
}

export function buildRuntimeContextBlock(input: RuntimeContextInput = {}): string {
  const now = input.now ?? new Date();
  const lines: string[] = [];

  const date = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  lines.push(`- 当前时间：${date}（星期${weekdays[now.getDay()]}）${time}（引用年份/日期时以此为准）`);

  if (input.historyMessages !== undefined) {
    const chars = input.historyChars ?? 0;
    lines.push(
      `- 会话上下文：已带 ${input.historyMessages} 条历史消息（约 ${estTokens(chars)} token）；更早内容已压缩为摘要时，摘要中也保留了关键约定`,
    );
  }
  const budget = input.sessionBudgetTokens ?? 0;
  const used = input.sessionUsedTokens ?? 0;
  if (budget > 0) {
    lines.push(`- 会话预算：已用约 ${used} / ${budget} token${used >= budget * 0.8 ? '（接近上限，请收敛长篇输出）' : ''}`);
  }
  if (lines.length === 0) return '';
  return `\n\n## 运行时上下文\n${lines.join('\n')}`;
}
