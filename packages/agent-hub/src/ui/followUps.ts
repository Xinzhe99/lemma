/**
 * 回复后上下文建议（v4.3.0 D）：根据最后一条 assistant 消息用过的工具，
 * 生成 2-3 条「下一步」chips——零额外 API 成本，纯本地推断。
 * 设计原则（v4.1.0）：建议只描述目标（「编译验证」），不规定步骤——AI 自主决定怎么做。
 */
import type { AgentMessage } from '@lemma/shared';

export interface FollowUpChip {
  label: string;
  text: string;
}

export function followUpSuggestions(messages: AgentMessage[]): FollowUpChip[] {
  if (messages.length === 0) return [];
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!last) return [];
  const tools = new Set((last.toolCalls ?? []).map((c) => c.tool));
  const out: FollowUpChip[] = [];

  if (tools.has('tex.edit') || tools.has('tex.create_file')) {
    out.push({
      label: '🔨 编译验证修改',
      text: '请编译当前项目，验证刚才的修改没有引入错误；如有错误请分析并修复。',
    });
    out.push({
      label: '🔍 检查改动的引用',
      text: '请检查刚才修改中引用的所有 citekey 是否在本地文献库与 .bib 中，报告并修复悬空引用。',
    });
  }
  if (tools.has('paper.read')) {
    out.push({
      label: '📝 总结论文方法',
      text: '请基于刚才读取的论文，总结其核心方法、实验结论与局限，并说明对我的稿件有何可借鉴之处。',
    });
  }
  if (tools.has('web.search_scholar')) {
    out.push({
      label: '📚 导入最相关文献',
      text: '请把刚才检索结果中最相关的 3 篇生成 BibTeX 并加入文献库（走审批），然后说明各自与我稿件的关系。',
    });
  }
  if (tools.has('library.search_fulltext') && !tools.has('paper.read')) {
    out.push({
      label: '📄 读最相关那篇',
      text: '请用 paper.read 读取刚才检索结果中最相关的一篇（有 PDF 读全文，无 PDF 读摘要），给出要点总结。',
    });
  }
  if (tools.has('tex.compile')) {
    out.push({
      label: '🛠 有错就修复',
      text: '如果刚才的编译有错误或警告，请逐个分析原因并修复，修完再编译一次确认。',
    });
  }
  if (out.length === 0) {
    out.push({ label: '▶️ 继续', text: '请继续完成刚才的任务。' });
    out.push({
      label: '✏️ 应用到稿件',
      text: '请把刚才的结论应用到稿件中（需要修改时走 diff 审批）。',
    });
  }
  return out.slice(0, 3);
}
