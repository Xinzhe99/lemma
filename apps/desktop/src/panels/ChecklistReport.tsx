/**
 * WF-3 A2：W10 预提交自检的结构化报告视图。
 * 解析 W10 report 步骤输出的 markdown：
 *  - 总体结论三态（通过 / 未通过 / 需人工，宽容匹配「总体：可提交」等表述）；
 *  - 逐项条目（✅/❌/⚠️ 或 [通过]/[未通过]/[需人工判断] 前缀 + 内容 + 「→ 建议」修复行）；
 *  - 无法结构化时降级为原文展示。
 * 附「导出 .md」（Blob 下载）。解析为纯函数，单测见 checklistReport.test.ts。
 */

import { useMemo } from 'react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import './agent-extra.css';

export type ChecklistStatus = 'pass' | 'fail' | 'manual';

export interface ChecklistItem {
  status: ChecklistStatus;
  /** 条目内容（标记行去掉状态标记后的文本） */
  title: string;
  /** 其余续行（定位、证据等，不含建议行） */
  detail?: string;
  /** 「→ 建议」修复建议（去掉前缀后的文本） */
  suggestion?: string;
}

export interface ChecklistReportData {
  verdict: ChecklistStatus | null;
  /** 总体结论原文（宽容解析出的整段文本） */
  verdictText: string | null;
  items: ChecklistItem[];
  /** verdict 或 items 任一解析成功即视为结构化；否则降级原文展示 */
  structured: boolean;
}

/** 行首状态标记：emoji 或 [通过]/【未通过】 式前缀（允许列表符装饰） */
const ITEM_MARKERS: Array<{ re: RegExp; status: ChecklistStatus }> = [
  { re: /^[-*+> ]*(?:✅|✔️|✔|👍)/, status: 'pass' },
  { re: /^[-*+> ]*(?:❌|✖️|✖|👎|❗)/, status: 'fail' },
  { re: /^[-*+> ]*(?:⚠️|⚠|❓)/, status: 'manual' },
  { re: /^[-*+> ]*[\[【]\s*(?:通过|pass)\s*[\]】]/i, status: 'pass' },
  { re: /^[-*+> ]*[\[【]\s*(?:未通过|不通过|fail)\s*[\]】]/i, status: 'fail' },
  { re: /^[-*+> ]*[\[【]\s*(?:需人工判断|需人工|人工判断|人工|manual)\s*[\]】]/i, status: 'manual' },
];

/** 修复建议行：「→ 建议：xxx」/「-> xxx」/「建议：xxx」/「修复建议：xxx」 */
const SUGGESTION_ARROW_RE = /^[-*+> ]*(?:→|->|=>|➜)\s*(.*)$/;
const SUGGESTION_LABEL_RE = /^[-*+> ]*(?:修复建议|建议)[:：]\s*(.*)$/;

/** 总体结论行（行内式宽容匹配：「**总体结论**：可提交」/「Overall: pass」/「1. 总体：修复后可提交」） */
const VERDICT_INLINE_RE =
  /(?:总体结论|总体|结论|overall(?:\s+(?:conclusion|verdict|result))?|verdict)[^\n:：]{0,10}[:：]\s*([^\n]{1,120})/i;

function matchMarker(line: string): ChecklistStatus | null {
  for (const { re, status } of ITEM_MARKERS) {
    if (re.test(line)) return status;
  }
  return null;
}

/** 结论文本 → 三态；顺序敏感：fail / manual 的更具体表述须先于 pass 匹配 */
export function classifyVerdict(text: string): ChecklistStatus | null {
  const s = text.trim();
  if (!s) return null;
  if (/暂不可提交|不可提交|未通过|不通过|无法提交|fail|reject|do\s*not\s*submit/i.test(s)) return 'fail';
  if (/修复后可提交|需人工|人工判断|待修复|需修复|conditional|manual|needs?\s+human/i.test(s)) return 'manual';
  if (/可提交|通过|pass|ready|submit/i.test(s)) return 'pass';
  return null;
}

export function parseChecklistReport(md: string): ChecklistReportData {
  const lines = md.split('\n');

  // ---- 总体结论 ----
  let verdictText: string | null = null;
  const inline = VERDICT_INLINE_RE.exec(md);
  if (inline?.[1]) verdictText = inline[1].trim();

  // ---- 逐项条目：标记行开启新条目，续行归入 detail / suggestion ----
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const marker = matchMarker(line);
    if (marker !== null) {
      const title = line
        .replace(/^[-*+> ]+/, '')
        .replace(/^(?:✅|✔️|✔|👍|❌|✖️|✖|👎|❗|⚠️|⚠|❓)/, '')
        .replace(/^[\[【]\s*(?:通过|未通过|不通过|需人工判断|需人工|人工判断|人工|pass|fail|manual)\s*[\]】]\s*/i, '')
        .replace(/^[：:\-–—\s]+/, '')
        .trim();
      items.push({ status: marker, title: title || line.trim() });
      continue;
    }
    if (items.length === 0) continue; // 条目区之外的行不归入

    const last = items[items.length - 1]!;
    const arrow = SUGGESTION_ARROW_RE.exec(line);
    const label = arrow ? null : SUGGESTION_LABEL_RE.exec(line);
    if (arrow) {
      let text = arrow[1] ?? '';
      text = text.replace(/^建议[:：]?\s*/, '').trim();
      if (text) last.suggestion = last.suggestion ? `${last.suggestion}\n${text}` : text;
      continue;
    }
    if (label?.[1]) {
      const text = label[1].trim();
      last.suggestion = last.suggestion ? `${last.suggestion}\n${text}` : text;
      continue;
    }
    last.detail = last.detail ? `${last.detail}\n${line.trim()}` : line.trim();
  }

  const verdict = verdictText ? classifyVerdict(verdictText) : null;
  return {
    verdict,
    verdictText,
    items,
    structured: verdict !== null || items.length > 0,
  };
}

const STRINGS = {
  zh: {
    title: '预提交自检报告',
    verdictLabel: '总体结论',
    verdicts: { pass: '通过 · 可提交', fail: '未通过 · 暂不可提交', manual: '需人工判断' },
    itemStatus: { pass: '通过', fail: '未通过', manual: '需人工' },
    suggestion: '修复建议',
    raw: '原始报告（未能结构化解析，原文展示）',
    exportMd: '导出 .md',
    exportDone: '已导出 .md',
    itemsCount: (n: number) => `共 ${n} 项`,
    emptyItems: '未解析到逐项条目',
  },
  en: {
    title: 'Pre-submission Checklist Report',
    verdictLabel: 'Overall verdict',
    verdicts: { pass: 'Pass · ready to submit', fail: 'Fail · not submittable', manual: 'Needs human review' },
    itemStatus: { pass: 'pass', fail: 'fail', manual: 'manual' },
    suggestion: 'Fix suggestion',
    raw: 'Raw report (not structured; shown as-is)',
    exportMd: 'Export .md',
    exportDone: 'Exported .md',
    itemsCount: (n: number) => `${n} item(s)`,
    emptyItems: 'No checklist items parsed',
  },
} as const;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export interface ChecklistReportProps {
  /** W10 report 步骤输出的 markdown 原文 */
  output: string;
}

export function ChecklistReport({ output }: ChecklistReportProps) {
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language] as (typeof STRINGS)[Language];
  const data = useMemo(() => parseChecklistReport(output), [output]);

  const exportMd = () => {
    const blob = new Blob([output], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pre-submission-checklist-${stamp()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sf-checklist" data-structured={data.structured ? 'true' : 'false'}>
      <div className="sf-checklist-head">
        <strong>{t.title}</strong>
        <button className="sf-btn" onClick={exportMd}>
          {t.exportMd}
        </button>
      </div>

      {data.structured ? (
        <>
          {data.verdict && (
            <div className={`sf-checklist-verdict sf-checklist-verdict--${data.verdict}`}>
              <span className="sf-checklist-verdict-label">{t.verdictLabel}</span>
              <span className="sf-checklist-verdict-value">{t.verdicts[data.verdict]}</span>
              {data.verdictText && <span className="sf-checklist-verdict-raw">{data.verdictText}</span>}
            </div>
          )}
          <div className="sf-checklist-items">
            {data.items.length === 0 ? (
              <div className="sf-checklist-raw">
                <p className="sf-checklist-empty">{t.emptyItems}</p>
                <pre>{output}</pre>
              </div>
            ) : (
              data.items.map((item, i) => (
                <div key={i} className={`sf-checklist-item sf-checklist-item--${item.status}`}>
                  <div className="sf-checklist-item-title">
                    <span className="sf-checklist-item-badge" aria-label={t.itemStatus[item.status]}>
                      {item.status === 'pass' ? '✅' : item.status === 'fail' ? '❌' : '⚠️'}
                    </span>
                    <span>{item.title}</span>
                  </div>
                  {item.detail && <pre className="sf-checklist-item-detail">{item.detail}</pre>}
                  {item.suggestion && (
                    <p className="sf-checklist-item-suggestion">
                      → {t.suggestion}：{item.suggestion}
                    </p>
                  )}
                </div>
              ))
            )}
            <p className="sf-checklist-count">{t.itemsCount(data.items.length)}</p>
          </div>
        </>
      ) : (
        <div className="sf-checklist-raw">
          <p className="sf-checklist-empty">{t.raw}</p>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}
