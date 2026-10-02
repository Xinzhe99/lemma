/**
 * 下一代 diff 审批卡（代理C：diff 审批体验升级）。
 * 相比旧卡（agent-hub 的 DiffApprovalCard / AgentPanel 的 DiffView+两按钮）：
 * 1) 统一 / 并排 双视图切换；
 * 2) hunk 级部分采纳：每 hunk 头部 checkbox（默认勾选），底部「采纳选中（N/M）」
 *    把 applyHunks 重组后的完整文本与接受集回传（全选时传 'all' 优化路径）；
 * 3) 变更解释：explanation prop 存在则折叠展示；否则【为什么这样改？】按钮回调
 *    onRequestExplanation，由宿主异步生成后回填 prop（本组件不发起请求）；
 * 4) 审计信息行：label / via / file / 行数与增删统计。
 *
 * 自包含组件：不 import approval / aiActions / agentTools；颜色语义沿用编辑器
 * DiffView（增绿删红），但本地实现以支持 hunk 复选框与并排 grid。
 * 样式：styles.css 的 sf-approval-* 前缀（亮暗走主题变量）。
 * 文案 zh/en 内置（lang prop 覆盖，缺省跟随设置语言，便于测试）。
 */

import { useMemo, useState } from 'react';
import { applyHunks, splitHunks, toDiffLines, type Hunk } from '../hunks';
import { useSettingsStore, type Language } from '../state/settingsStore';
import type { EditProposal } from '../state/proposalStore';

export interface DiffApprovalCard2Props {
  proposal: EditProposal;
  /** 变更解释（宿主异步生成后回填；存在即折叠展示） */
  explanation?: string;
  /**
   * 采纳：after = applyHunks 按当前勾选重组的完整文本；
   * acceptedHunks = 接受的 hunk id 列表，全选时为 'all'（宿主可走免重算路径）。
   */
  onAccept(after: string, acceptedHunks: string[] | 'all'): void;
  /** 全部拒绝 */
  onReject(): void;
  /** 请求生成变更解释（宿主异步回填 explanation prop） */
  onRequestExplanation?: () => void;
  /** 语言覆盖（缺省跟随设置） */
  lang?: Language;
}

interface DiffCard2Dict {
  viewUnified: string;
  viewSplit: string;
  explainTitle: string;
  explainAsk: string;
  explainAsked: string;
  accept: (n: number, m: number) => string;
  hunkUnit: string;
  reject: string;
  linesStat: (before: number, after: number) => string;
  linesUnit: string;
  fold: (n: number) => string;
  chipTool: string;
  hunkCheck: (header: string) => string;
}

export const DIFF_CARD2_STRINGS: Record<Language, DiffCard2Dict> = {
  zh: {
    viewUnified: '统一',
    viewSplit: '并排',
    explainTitle: '变更解释',
    explainAsk: '为什么这样改？',
    explainAsked: '解释生成中…',
    accept: (n, m) => `采纳选中（${n}/${m} hunk）`,
    hunkUnit: 'hunk',
    reject: '全部拒绝',
    linesStat: (b, a) => `${b} 行 → ${a} 行`,
    linesUnit: '行',
    fold: (n) => `⋯ ${n} 行未改动 ⋯`,
    chipTool: '等待裁决',
    hunkCheck: (header) => `采纳此修改块（${header}）`,
  },
  en: {
    viewUnified: 'Unified',
    viewSplit: 'Split',
    explainTitle: 'Why this change',
    explainAsk: 'Why this change?',
    explainAsked: 'Generating explanation…',
    accept: (n, m) => `Accept selected (${n}/${m} hunks)`,
    hunkUnit: 'hunks',
    reject: 'Reject all',
    linesStat: (b, a) => `${b} → ${a} lines`,
    linesUnit: 'lines',
    fold: (n) => `⋯ ${n} unchanged lines ⋯`,
    chipTool: 'awaiting decision',
    hunkCheck: (header) => `Accept this hunk (${header})`,
  },
};

type ViewMode = 'unified' | 'split';

/** 展示行（文本仍携带行尾换行符，渲染时剥掉） */
interface Row {
  kind: 'ctx' | 'del' | 'add';
  oldNo?: number;
  newNo?: number;
  text: string;
}

/** 渲染段落：未变空隙 或 一个 hunk（del 行 + add 行） */
type Segment = { type: 'gap'; rows: Row[] } | { type: 'hunk'; hunk: Hunk; dels: Row[]; adds: Row[] };

/** 空隙两端保留的未变行数；更长空隙折叠为一行省略号 */
const GAP_CONTEXT = 2;

/**
 * 从 hunks + 原文重建完整渲染序列（空隙行号两侧同进；hunk 行 del 记旧行号、
 * add 记新行号）。段落顺序与 hunks 一致，纯插入 hunk 也自成一散段。
 */
function buildSegments(hunks: readonly Hunk[], before: string): Segment[] {
  const oldLines = toDiffLines(before);
  const segments: Segment[] = [];
  let cursor = 0;
  let offset = 0; // 新-旧行号偏移（按「全部接受」口径累计，供空隙行新行号）
  for (const h of hunks) {
    const gapEnd = h.beforeLines.length > 0 ? h.beforeStart - 1 : h.beforeStart;
    if (gapEnd > cursor) {
      const rows: Row[] = [];
      for (let i = cursor; i < gapEnd; i++) {
        rows.push({ kind: 'ctx', oldNo: i + 1, newNo: i + 1 + offset, text: oldLines[i] });
      }
      segments.push({ type: 'gap', rows });
    }
    segments.push({
      type: 'hunk',
      hunk: h,
      dels: h.beforeLines.map((text, i) => ({ kind: 'del' as const, oldNo: h.beforeStart + i, text })),
      adds: h.afterLines.map((text, i) => ({ kind: 'add' as const, newNo: h.afterStart + i, text })),
    });
    cursor = gapEnd + h.beforeLines.length;
    offset += h.afterLines.length - h.beforeLines.length;
  }
  if (cursor < oldLines.length) {
    const rows: Row[] = [];
    for (let i = cursor; i < oldLines.length; i++) {
      rows.push({ kind: 'ctx', oldNo: i + 1, newNo: i + 1 + offset, text: oldLines[i] });
    }
    segments.push({ type: 'gap', rows });
  }
  return segments;
}

const stripNl = (line: string) => line.replace(/\n$/, '');

/** hunk 头：checkbox + @@ 行号 + ±徽标（两视图共用） */
function HunkHeader({
  hunk,
  checked,
  onToggle,
  dict,
}: {
  hunk: Hunk;
  checked: boolean;
  onToggle: (id: string, next: boolean) => void;
  dict: DiffCard2Dict;
}) {
  return (
    <div className={`sf-approval-hunk-head${checked ? '' : ' is-off'}`} data-hunk-id={hunk.id}>
      <label className="sf-approval-hunk-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(hunk.id, e.target.checked)}
          aria-label={dict.hunkCheck(hunk.header)}
          data-hunk-id={hunk.id}
        />
        <span className="sf-approval-hunk-header">{hunk.header}</span>
      </label>
      <span className="sf-approval-badges">
        <span className="sf-approval-badge sf-approval-badge--add">+{hunk.afterLines.length}</span>
        <span className="sf-approval-badge sf-approval-badge--del">-{hunk.beforeLines.length}</span>
      </span>
    </div>
  );
}

/** 折叠长空隙：返回行片段与折叠标记 */
type GapPart = { head: Row[]; hidden: number; tail: Row[] };
function foldGap(rows: Row[]): GapPart {
  if (rows.length <= GAP_CONTEXT * 2 + 1) return { head: rows, hidden: 0, tail: [] };
  return { head: rows.slice(0, GAP_CONTEXT), hidden: rows.length - GAP_CONTEXT * 2, tail: rows.slice(-GAP_CONTEXT) };
}

export function DiffApprovalCard2(props: DiffApprovalCard2Props) {
  const { proposal, explanation, onAccept, onReject, onRequestExplanation, lang } = props;
  const settingsLang = useSettingsStore((s) => s.language);
  const dict = DIFF_CARD2_STRINGS[lang ?? settingsLang];

  const hunks = useMemo(() => splitHunks(proposal.before, proposal.after), [proposal.before, proposal.after]);
  const segments = useMemo(() => buildSegments(hunks, proposal.before), [hunks, proposal.before]);

  const [view, setView] = useState<ViewMode>('unified');
  // 未记录的 id 默认勾选：proposal 换新时旧勾选自然失效，无需 effect 同步
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [explainAsked, setExplainAsked] = useState(false);

  const isChecked = (id: string) => checkedMap[id] !== false;
  const toggleHunk = (id: string, next: boolean) => setCheckedMap((m) => ({ ...m, [id]: next }));
  const acceptedIds = hunks.filter((h) => isChecked(h.id)).map((h) => h.id);
  const allSelected = acceptedIds.length === hunks.length;

  const accept = () => {
    const merged = applyHunks(proposal.before, hunks, new Set(acceptedIds));
    onAccept(merged, allSelected ? 'all' : acceptedIds);
  };

  const askExplanation = () => {
    setExplainAsked(true);
    onRequestExplanation?.();
  };

  const beforeCount = toDiffLines(proposal.before).length;
  const afterCount = toDiffLines(proposal.after).length;
  const adds = hunks.reduce((n, h) => n + h.afterLines.length, 0);
  const dels = hunks.reduce((n, h) => n + h.beforeLines.length, 0);

  // 统一视图渲染序列：空隙折叠 + hunk 头 + 行（del 在前 add 在后，与 diff 惯例一致）
  const unifiedItems = useMemo(() => {
    type Item =
      | { type: 'gap'; rows: Row[] }
      | { type: 'fold'; hidden: number }
      | { type: 'hunk-head'; hunk: Hunk }
      | { type: 'row'; row: Row };
    const items: Item[] = [];
    for (const seg of segments) {
      if (seg.type === 'gap') {
        const gap = foldGap(seg.rows);
        items.push({ type: 'gap', rows: gap.head });
        if (gap.hidden > 0) {
          items.push({ type: 'fold', hidden: gap.hidden });
          items.push({ type: 'gap', rows: gap.tail });
        }
      } else {
        items.push({ type: 'hunk-head', hunk: seg.hunk });
        for (const row of [...seg.dels, ...seg.adds]) items.push({ type: 'row', row });
      }
    }
    return items;
  }, [segments]);

  // 并排视图：空隙折叠成对行；hunk 内 del/add 逐对拉链（多出的一侧留占位格）
  const splitSections = useMemo(() => {
    type Section =
      | { type: 'gap'; rows: Row[] }
      | { type: 'fold'; hidden: number }
      | { type: 'hunk'; hunk: Hunk; pairs: Array<{ left?: Row; right?: Row }> };
    const sections: Section[] = [];
    for (const seg of segments) {
      if (seg.type === 'gap') {
        const gap = foldGap(seg.rows);
        sections.push({ type: 'gap', rows: gap.head });
        if (gap.hidden > 0) {
          sections.push({ type: 'fold', hidden: gap.hidden });
          sections.push({ type: 'gap', rows: gap.tail });
        }
      } else {
        const width = Math.max(seg.dels.length, seg.adds.length, 1);
        const pairs: Array<{ left?: Row; right?: Row }> = [];
        for (let k = 0; k < width; k++) pairs.push({ left: seg.dels[k], right: seg.adds[k] });
        sections.push({ type: 'hunk', hunk: seg.hunk, pairs });
      }
    }
    return sections;
  }, [segments]);

  return (
    <div className="sf-approval-card sf-agent-approval" data-file={proposal.file} data-view={view}>
      {/* 标题与审计 */}
      <div className="sf-agent-run-head sf-approval-head">
        <strong>{proposal.label}</strong>
        <span className="sf-chip dim" title={proposal.via}>
          {proposal.via}
        </span>
        {proposal.token && <span className="sf-chip warn">{dict.chipTool}</span>}
      </div>
      <div className="sf-approval-audit">
        <span className="sf-approval-file" title={proposal.file}>
          {proposal.file}
        </span>
        <span className="sf-approval-linestat">{dict.linesStat(beforeCount, afterCount)}</span>
        <span className="sf-approval-badges">
          <span className="sf-approval-badge sf-approval-badge--add">+{adds}</span>
          <span className="sf-approval-badge sf-approval-badge--del">-{dels}</span>
          <span className="sf-approval-badge sf-approval-badge--dim">
            {hunks.length} {dict.hunkUnit}
          </span>
        </span>
      </div>

      {/* 变更解释：有则折叠展示；无则提供请求入口（宿主异步回填） */}
      {explanation ? (
        <details className="sf-approval-explain" open>
          <summary>{dict.explainTitle}</summary>
          <p className="sf-approval-explain-body">{explanation}</p>
        </details>
      ) : (
        onRequestExplanation && (
          <div className="sf-approval-explain-ask">
            <button
              type="button"
              className="sf-btn sf-approval-why"
              onClick={askExplanation}
              disabled={explainAsked}
            >
              {explainAsked ? dict.explainAsked : dict.explainAsk}
            </button>
          </div>
        )
      )}

      {/* 视图切换 */}
      <div className="sf-approval-toolbar" role="group" aria-label={dict.viewUnified + ' / ' + dict.viewSplit}>
        <button
          type="button"
          className="sf-approval-seg"
          data-view-btn="unified"
          aria-pressed={view === 'unified'}
          onClick={() => setView('unified')}
        >
          {dict.viewUnified}
        </button>
        <button
          type="button"
          className="sf-approval-seg"
          data-view-btn="split"
          aria-pressed={view === 'split'}
          onClick={() => setView('split')}
        >
          {dict.viewSplit}
        </button>
      </div>

      {/* diff 主体 */}
      {view === 'unified' ? (
        <div className="sf-approval-diff sf-approval-diff--unified">
          {unifiedItems.map((item, i) =>
            item.type === 'fold' ? (
              <div key={`f${i}`} className="sf-approval-fold" data-hidden={item.hidden}>
                {dict.fold(item.hidden)}
              </div>
            ) : item.type === 'hunk-head' ? (
              <HunkHeader key={item.hunk.id} hunk={item.hunk} checked={isChecked(item.hunk.id)} onToggle={toggleHunk} dict={dict} />
            ) : item.type === 'gap' ? (
              item.rows.map((row, k) => (
                <div key={`g${i}-${k}`} className="sf-approval-row" data-kind={row.kind}>
                  <span className="sf-approval-no">{row.oldNo ?? ''}</span>
                  <span className="sf-approval-no">{row.newNo ?? ''}</span>
                  <span className="sf-approval-text">
                    {row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '}
                    {stripNl(row.text)}
                  </span>
                </div>
              ))
            ) : (
              <div key={`r${i}`} className="sf-approval-row" data-kind={item.row.kind}>
                <span className="sf-approval-no">{item.row.oldNo ?? ''}</span>
                <span className="sf-approval-no">{item.row.newNo ?? ''}</span>
                <span className="sf-approval-text">
                  {item.row.kind === 'add' ? '+ ' : item.row.kind === 'del' ? '- ' : '  '}
                  {stripNl(item.row.text)}
                </span>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="sf-approval-diff sf-approval-diff--split">
          {splitSections.map((sec, i) =>
            sec.type === 'fold' ? (
              <div key={`f${i}`} className="sf-approval-fold" data-hidden={sec.hidden}>
                {dict.fold(sec.hidden)}
              </div>
            ) : sec.type === 'gap' ? (
              sec.rows.map((row, k) => (
                <div key={`g${i}-${k}`} className="sf-approval-pair" data-kind="ctx">
                  <span className="sf-approval-no">{row.oldNo ?? ''}</span>
                  <span className="sf-approval-cell" data-kind="ctx">
                    {stripNl(row.text)}
                  </span>
                  <span className="sf-approval-no">{row.newNo ?? ''}</span>
                  <span className="sf-approval-cell" data-kind="ctx">
                    {stripNl(row.text)}
                  </span>
                </div>
              ))
            ) : (
              <div key={`h${i}`} className="sf-approval-hunk" data-hunk-id={sec.hunk.id}>
                <HunkHeader hunk={sec.hunk} checked={isChecked(sec.hunk.id)} onToggle={toggleHunk} dict={dict} />
                <div className="sf-approval-pairs">
                  {sec.pairs.map((p, k) => (
                    <div key={k} className="sf-approval-pair" data-kind={p.left && p.right ? 'pair' : p.left ? 'del' : 'add'}>
                      <span className="sf-approval-no">{p.left?.oldNo ?? ''}</span>
                      <span className={`sf-approval-cell${p.left ? ' sf-approval-cell--del' : ' sf-approval-cell--pad'}`} data-kind={p.left ? 'del' : 'pad'}>
                        {p.left ? stripNl(p.left.text) : ''}
                      </span>
                      <span className="sf-approval-no">{p.right?.newNo ?? ''}</span>
                      <span className={`sf-approval-cell${p.right ? ' sf-approval-cell--add' : ' sf-approval-cell--pad'}`} data-kind={p.right ? 'add' : 'pad'}>
                        {p.right ? stripNl(p.right.text) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {/* 处置 */}
      <div className="sf-lib-dialog-actions sf-approval-actions">
        <button type="button" className="sf-btn sf-approval-reject" onClick={onReject}>
          {dict.reject}
        </button>
        <button
          type="button"
          className="sf-btn sf-btn--primary sf-approval-accept"
          onClick={accept}
          disabled={acceptedIds.length === 0}
          data-all={allSelected ? 'true' : 'false'}
        >
          {dict.accept(acceptedIds.length, hunks.length)}
        </button>
      </div>
    </div>
  );
}
