/**
 * 引用悬停文献卡（v1.6.0 ①）：光标落在 \cite/\citep/\citet/\autoref 的 citekey 内
 * → 浮层显示文献卡（标题 / 首作者等 / 年份 / 阅读状态），带「打开 PDF」回调
 * （宿主注入：库里有附件时打开阅读器）。
 *
 * 数据注入：editor 包不依赖应用 store——宿主给 getPaper(citekey)（返回 undefined
 * 表示库里无此键，浮层显示「未入库」提示，帮助发现悬空引用）；onOpenPdf 由
 * 宿主接 libraryStore.openPdf。
 */

import { hoverTooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** 文献卡数据（宿主从文献库投影；字段刻意精简） */
export interface CitationCard {
  title: string;
  /** 首作者 family 名（宿主已截断） */
  firstAuthor?: string;
  year?: string;
  readStatus?: 'to-read' | 'reading' | 'done';
  /** 库内是否关联 PDF 附件 */
  hasPdf?: boolean;
}

export type PaperLookup = (citekey: string) => CitationCard | undefined;

/** \cite 系命令的参数区匹配：命令名 + {keys}；返回光标所在 key 与整段范围
 *  （v7.9.6 补齐 parencite/textcite/autocite/citetext/citeyearpar 等——与 outline.ts
 *  的 CITE_COMMANDS 对齐；支持两段可选参数 \citep[see][p.3]{key}） */
const CITE_CMD_RE = /\\(?:cite[pt]?|citealp|citeauthor|citeyear(?:par)?|parencite|textcite|autocite|autoref|cref|Cref)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^{}]*)\}/g;

/** 找 pos 所在的 cite 命令参数中的某个 key（逗号分隔，容忍空格） */
export function citeKeyAt(text: string, pos: number): { key: string; from: number; to: number } | null {
  CITE_CMD_RE.lastIndex = 0;
  for (const m of text.matchAll(CITE_CMD_RE)) {
    const start = m.index ?? 0;
    const whole = m[0];
    if (pos < start || pos > start + whole.length) continue;
    const brace = whole.lastIndexOf('{');
    if (brace < 0) continue;
    const base = start + brace + 1; // 首个键字符的偏移
    let offset = base;
    for (const raw of (m[1] ?? '').split(',')) {
      const key = raw.trim();
      const keyStart = offset + raw.indexOf(key);
      const keyEnd = keyStart + key.length;
      if (key.length > 0 && pos >= keyStart && pos <= keyEnd) {
        return { key, from: keyStart, to: keyEnd };
      }
      offset += raw.length + 1; // 逗号
    }
    return null;
  }
  return null;
}

function cardDom(key: string, card: CitationCard | undefined, onOpenPdf: ((citekey: string) => void) | undefined): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'sf-cite-hover';
  dom.style.maxWidth = '360px';
  dom.style.padding = '6px 10px';
  dom.style.fontSize = '12.5px';
  dom.style.lineHeight = '1.55';
  dom.style.background = 'var(--bg-0, #ffffff)';
  dom.style.border = '1px solid var(--border, #e9e9ec)';
  dom.style.borderRadius = '6px';
  dom.style.color = 'var(--fg-0, #1a1a1a)';

  const head = document.createElement('div');
  const code = document.createElement('code');
  code.textContent = key;
  code.style.fontFamily = 'ui-monospace, Consolas, monospace';
  code.style.fontSize = '11px';
  code.style.color = 'var(--fg-2, #a0a0aa)';
  head.append(code);
  dom.append(head);

  if (!card) {
    const miss = document.createElement('div');
    miss.textContent = '⚠ 文献库中未找到此引用键';
    miss.style.color = 'var(--err, #d9534f)';
    dom.append(miss);
    return dom;
  }

  const title = document.createElement('div');
  title.textContent = card.title;
  title.style.fontWeight = '600';
  dom.append(title);

  const meta = document.createElement('div');
  const parts: string[] = [];
  if (card.firstAuthor) parts.push(card.firstAuthor);
  if (card.year) parts.push(card.year);
  if (card.readStatus) parts.push(card.readStatus === 'done' ? '✓ 已读' : card.readStatus === 'reading' ? '◐ 在读' : '○ 待读');
  meta.textContent = parts.join(' · ');
  meta.style.color = 'var(--fg-1, #70707a)';
  meta.style.fontSize = '11.5px';
  dom.append(meta);

  if (card.hasPdf && onOpenPdf) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '打开 PDF ↗';
    btn.style.marginTop = '4px';
    btn.style.padding = '2px 10px';
    btn.style.border = '1px solid var(--border, #e9e9ec)';
    btn.style.borderRadius = '10px';
    btn.style.background = 'var(--bg-2, #fff)';
    btn.style.color = 'var(--accent-dim, #0b815f)';
    btn.style.fontSize = '11.5px';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => onOpenPdf(key));
    dom.append(btn);
  }
  return dom;
}

/**
 * 引用悬停扩展：光标在 \cite{...} 的键内 → 文献卡浮层。
 * getPaper 返回 undefined 显示「未入库」（悬空引用的即时发现通道）。
 */
export function citationHoverExtension(
  getPaper: PaperLookup,
  onOpenPdf?: (citekey: string) => void,
): Extension {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const hit = citeKeyAt(line.text, pos - line.from);
    if (!hit) return null;
    return {
      pos: line.from + hit.from,
      end: line.from + hit.to,
      above: true,
      create: () => ({ dom: cardDom(hit.key, getPaper(hit.key), onOpenPdf) }),
    };
  });
}
