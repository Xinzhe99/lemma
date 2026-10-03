/**
 * Context Pack：每次 Agent Run 前组装并注入的上下文（设计 5.4）。
 * build 负责归一化输入，render 产出 prompt-ready 中文 markdown。
 */
import type { ContextPack, GlossaryTerm, RetrievedChunk, StyleProfile } from '@lemma/shared';

/** 相关文献块可携带 citekey（TextChunk 只有 paperId，渲染时缺省回退到 paperId） */
export interface CitedChunk extends RetrievedChunk {
  citekey?: string;
}

export interface BuildContextPackInput {
  outline?: string;
  glossary?: GlossaryTerm[];
  style?: StyleProfile;
  relatedChunks?: RetrievedChunk[];
  venueRequirements?: string;
  projectMemory?: string[];
  budgetUsd?: number;
}

export function buildContextPack(input: BuildContextPackInput): ContextPack {
  return {
    outline: input.outline,
    glossary: input.glossary ?? [],
    style: input.style,
    relatedChunks: input.relatedChunks ?? [],
    venueRequirements: input.venueRequirements,
    projectMemory: input.projectMemory ?? [],
    budgetUsd: input.budgetUsd,
  };
}

const SNIPPET_MAX = 280;

function oneLine(text: string, max = SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function renderGlossary(glossary: GlossaryTerm[]): string {
  if (glossary.length === 0) return '（暂无锁定术语）\n';
  const rows = glossary.map((g) => `| ${g.term} | ${g.abbr ?? '—'} | ${g.translation ?? '—'} |`);
  return ['| 术语 | 缩写 | 锁定译名 |', '| --- | --- | --- |', ...rows].join('\n') + '\n';
}

function renderStyle(style?: StyleProfile): string {
  if (!style) return '（未提供风格档案）\n';
  const lines = [
    `- 平均句长：${style.sentenceLenMean.toFixed(1)} 词`,
    `- 句长 P90：${style.sentenceLenP90.toFixed(1)} 词`,
    `- 被动语态比例：${(style.passiveRatio * 100).toFixed(1)}%`,
    `- hedging 密度：${style.hedgingDensity.toFixed(1)} 次/千词`,
  ];
  for (const n of style.notes) lines.push(`- ${n}`);
  return lines.join('\n') + '\n';
}

function renderRelatedChunks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '（未检索到相关文献片段）\n';
  return (
    chunks
      .map((c) => {
        const key = (c as CitedChunk).citekey ?? c.paperId;
        // 引用标记与 integrity.extractCitations 的 [citekey p.page] 格式保持一致
        const page = c.page !== undefined ? ` p.${c.page}` : '';
        const heading = c.heading ? ` ${c.heading}` : '';
        return `- [${key}${page}]${heading} ${oneLine(c.text)}`;
      })
      .join('\n') + '\n'
  );
}

/** 渲染为 prompt-ready markdown，固定六段结构 */
export function renderContextPackMd(pack: ContextPack): string {
  const parts: string[] = ['# Context Pack', ''];

  parts.push('## 稿件结构', pack.outline?.trim() ? pack.outline.trim() : '（未提供大纲）', '');

  parts.push('## 术语表', renderGlossary(pack.glossary).trimEnd(), '');

  parts.push('## 作者风格约束', renderStyle(pack.style).trimEnd(), '');

  parts.push('## 相关文献', renderRelatedChunks(pack.relatedChunks).trimEnd(), '');

  parts.push('## 期刊要求', pack.venueRequirements?.trim() ? pack.venueRequirements.trim() : '（未提供）', '');

  const memory = pack.projectMemory.length > 0 ? pack.projectMemory.map((m) => `- ${m}`).join('\n') : '（暂无）';
  parts.push('## 项目记忆', memory, '');

  if (pack.budgetUsd !== undefined) {
    parts.push(`（本次预算上限：$${pack.budgetUsd.toFixed(2)}）`, '');
  }

  return parts.join('\n').replace(/\n{3,}$/g, '\n');
}
