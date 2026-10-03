/**
 * 术语面板：从项目全文抽取术语表（缩写定义）+ 一致性检查（定义前使用/重复定义/冗余全称）。
 * 知识底座 4.7 的术语锁定能力在 UI 的落点。
 *
 * WF-2 增强：
 * - N4 术语行点击 → 在各 .tex 中定位首次定义行（"Full Term (ABBR)" 模式）并 jumpTo；
 * - N4 导出 glossary.tex（acronym 包 \newacronym 行）；
 * - N5 风格档案：analyzeStyle 展示句长均值/P90/被动比例/hedging。
 * 文案自包含 zh/en 双语；样式见 ./knowledge.css（不动全局 styles.css）。
 */

import { useMemo, useState } from 'react';
import { FileDown, Locate, Wand2 } from 'lucide-react';
import {
  analyzeStyle,
  checkConsistency,
  extractGlossary,
} from '@lemma/knowledge';
import type { GlossaryTerm, StyleProfile } from '@lemma/shared';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { combinedDoc, resolveEntry } from '../projectDoc';
import { jumpTo } from '../editorJump';
import './knowledge.css';

// ---------------------------------------------------------------------------
// 双语文案
// ---------------------------------------------------------------------------

interface Dict {
  summary: (terms: number, errors: number) => string;
  empty: string;
  translation: string;
  consistency: string;
  locate: string;
  notFound: string;
  exportTex: string;
  exported: (file: string, n: number) => string;
  exists: (file: string) => string;
  styleTitle: string;
  analyze: string;
  styleEmpty: string;
  meanLen: string;
  p90Len: string;
  passive: string;
  hedging: string;
  words: string;
  perThousand: string;
}

const DICT: Record<Language, Dict> = {
  zh: {
    summary: (terms, errors) => `术语 ${terms} 条 · 一致性问题 ${errors} 处`,
    empty: '未识别到缩写定义。在正文中使用「Full Capitalized Term (FCT)」形式书写即可自动收录。',
    translation: '译名：',
    consistency: '一致性检查',
    locate: '点击术语定位首次定义行',
    notFound: '未在 .tex 文件中定位到该术语的定义行',
    exportTex: '导出 glossary.tex',
    exported: (_file, n) => `已导出 ${n} 条 \\newacronym 到 glossary.tex`,
    exists: (file) => `${file} 已存在，未覆盖`,
    styleTitle: '风格档案',
    analyze: '分析当前稿件风格',
    styleEmpty: '点击按钮分析当前稿件的句长分布、被动语态与 hedging 语气。',
    meanLen: '句长均值',
    p90Len: '句长 P90',
    passive: '被动比例',
    hedging: 'Hedging 密度',
    words: '词',
    perThousand: '次/千词',
  },
  en: {
    summary: (terms, errors) => `${terms} terms · ${errors} consistency issues`,
    empty: 'No abbreviation definitions found. Write "Full Capitalized Term (FCT)" in the text to collect them.',
    translation: 'Translation: ',
    consistency: 'Consistency check',
    locate: 'Click a term to jump to its first definition',
    notFound: 'Definition line not found in .tex files',
    exportTex: 'Export glossary.tex',
    exported: (_file, n) => `Exported ${n} \\newacronym entries to glossary.tex`,
    exists: (file) => `${file} already exists, not overwritten`,
    styleTitle: 'Style profile',
    analyze: 'Analyze manuscript style',
    styleEmpty: 'Click to analyze sentence length, passive voice and hedging of the current manuscript.',
    meanLen: 'Mean sentence length',
    p90Len: 'Sentence length P90',
    passive: 'Passive ratio',
    hedging: 'Hedging density',
    words: 'words',
    perThousand: '/1k words',
  },
};

// ---------------------------------------------------------------------------
// 定义行定位（N4）
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 文档序的 .tex 文件列表：从入口沿 \input 深度优先，再补齐未引用的 .tex（字典序） */
function docOrderedTexFiles(files: Record<string, string>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (path: string): void => {
    const key = path.replace(/\.tex$/, '');
    if (seen.has(key)) return;
    const content = files[`${key}.tex`] ?? files[path];
    if (content === undefined) return;
    seen.add(key);
    order.push(`${key}.tex`);
    for (const m of content.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) visit(String(m[1]));
  };
  visit(resolveEntry(files));
  for (const f of Object.keys(files).filter((x) => x.endsWith('.tex')).sort()) visit(f);
  return order;
}

export interface DefinitionHit {
  file: string;
  /** 1-based 行号 */
  line: number;
}

/** 在各 .tex 中按 "Full Term (ABBR)" 原文模式定位首次定义行 */
export function findFirstDefinition(
  files: Record<string, string>,
  term: GlossaryTerm,
): DefinitionHit | null {
  if (!term.abbr) return null;
  const re = new RegExp(
    `${term.term.trim().split(/\s+/).map(escapeRegExp).join('\\s+')}\\s*\\(\\s*${escapeRegExp(term.abbr)}\\s*\\)`,
  );
  for (const file of docOrderedTexFiles(files)) {
    const lines = (files[file] ?? '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) return { file, line: i + 1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// glossary.tex 导出（N4）
// ---------------------------------------------------------------------------

function acronymLabel(term: GlossaryTerm): string {
  return (term.abbr ?? term.term)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderGlossaryTex(glossary: GlossaryTerm[], lang: Language): string {
  const header =
    lang === 'zh'
      ? `% glossary.tex —— Lemma 术语表导出（${glossary.length} 项）\n% 用法：导言区加入 \\usepackage{acronym}；正文用 \\ac{label} 引用缩写。\n`
      : `% glossary.tex -- exported by Lemma (${glossary.length} terms)\n% Usage: add \\usepackage{acronym} in the preamble; cite abbreviations with \\ac{label}.\n`;
  const rows = glossary
    .filter((g) => g.abbr)
    .map((g) => `\\newacronym{${acronymLabel(g)}}{${g.abbr}}{${g.term}}`);
  return `${header}${rows.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function GlossaryPanel() {
  const lang = useSettingsStore((s) => s.language);
  const t = DICT[lang];

  const files = useWorkspaceStore((s) => s.files);
  const doc = useMemo(() => combinedDoc(files), [files]);
  const glossary = useMemo(() => extractGlossary(doc), [doc]);
  const issues = useMemo(() => (doc.trim() ? checkConsistency(doc, glossary) : []), [doc, glossary]);

  const [status, setStatus] = useState('');
  const [style, setStyle] = useState<StyleProfile | null>(null);

  const jumpToDefinition = (term: GlossaryTerm) => {
    const hit = findFirstDefinition(files, term);
    if (!hit) {
      setStatus(t.notFound);
      return;
    }
    jumpTo({ file: hit.file, line: hit.line });
  };

  const exportTex = () => {
    if (glossary.length === 0) return;
    const ws = useWorkspaceStore.getState();
    const existed = 'glossary.tex' in ws.files;
    ws.createFile('glossary.tex', renderGlossaryTex(glossary, lang));
    setStatus(existed ? t.exists('glossary.tex') : t.exported('glossary.tex', glossary.length));
  };

  const runStyle = () => {
    setStyle(analyzeStyle(doc));
  };

  return (
    <div className="sf-knowledge sf-glossary">
      <div className="sf-knowledge-toolbar">
        <p className="sf-lib-count">{t.summary(glossary.length, issues.filter((i) => i.severity === 'error').length)}</p>
        <div className="sf-knowledge-toolbar-actions">
          <button
            type="button"
            className="sf-btn"
            disabled={glossary.length === 0}
            title={t.exportTex}
            onClick={exportTex}
          >
            <FileDown size={12} /> {t.exportTex}
          </button>
          <button
            type="button"
            className="sf-btn"
            disabled={doc.trim().length === 0}
            title={t.analyze}
            onClick={runStyle}
          >
            <Wand2 size={12} /> {t.analyze}
          </button>
        </div>
      </div>

      {status && (
        <p className="sf-notes-status" role="status">
          {status}
        </p>
      )}

      {glossary.length === 0 ? (
        <p className="placeholder">{t.empty}</p>
      ) : (
        <ul className="sf-glossary-list">
          {glossary.map((g) => (
            <li key={g.id}>
              <button type="button" className="sf-glossary-row" title={t.locate} onClick={() => jumpToDefinition(g)}>
                <div className="sf-glossary-main">
                  <span className="sf-glossary-term">{g.term}</span>
                  {g.abbr && <code className="sf-glossary-abbr">{g.abbr}</code>}
                  <Locate size={11} className="sf-glossary-locate" />
                </div>
                {g.translation && <span className="sf-glossary-trans">{t.translation}{g.translation}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {issues.length > 0 && (
        <div className="sf-glossary-issues">
          <div className="sf-knowledge-title">{t.consistency}</div>
          <ul>
            {issues.map((issue, i) => (
              <li
                key={i}
                className={`sf-glossary-issue ${issue.severity === 'error' ? 'sf-glossary-issue--error' : ''}`}
              >
                {issue.abbr && <span className="sf-chip dim">{issue.abbr}</span>} {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* N5 风格档案 */}
      <div className="sf-style">
        <div className="sf-knowledge-title">{t.styleTitle}</div>
        {style ? (
          <>
            <div className="sf-style-grid">
              <div className="sf-style-cell">
                <div className="sf-style-value">{style.sentenceLenMean.toFixed(1)}</div>
                <div className="sf-style-label">
                  {t.meanLen}（{t.words}）
                </div>
              </div>
              <div className="sf-style-cell">
                <div className="sf-style-value">{style.sentenceLenP90.toFixed(0)}</div>
                <div className="sf-style-label">
                  {t.p90Len}（{t.words}）
                </div>
              </div>
              <div className="sf-style-cell">
                <div className="sf-style-value">{(style.passiveRatio * 100).toFixed(0)}%</div>
                <div className="sf-style-label">{t.passive}</div>
              </div>
              <div className="sf-style-cell">
                <div className="sf-style-value">{style.hedgingDensity.toFixed(1)}</div>
                <div className="sf-style-label">
                  {t.hedging}（{t.perThousand}）
                </div>
              </div>
            </div>
            {style.notes.length > 0 && (
              <ul className="sf-style-notes">
                {style.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="placeholder">{t.styleEmpty}</p>
        )}
      </div>
    </div>
  );
}
