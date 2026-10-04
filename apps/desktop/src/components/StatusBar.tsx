/**
 * 状态栏（编辑区底部一行，sf-statusbar）：
 * 左 = 当前文件名 + dirty 圆点；右 = 字数 · 今日目标进度（wordsToday/goal，达标 ✓）· 行数 ·
 * 页数预算 chip（最近编译页数 / 目标 venue 页数上限，超限 err 红）·
 * 光标行列 · 保存状态（● 未保存 / ✓ 已保存 + 相对时间）。
 * 字数与相对时间为导出的纯函数（countWords / relativeTime），便于单测与跨组件复用；
 * 目标进度 chip 数据来自 writingStats store（状态/state/writingStats）；
 * 页数解析为纯函数 parsePageCount/venuePageLimit（pageBudget.ts），venue 来自 submitStore。
 */

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { PomodoroTimer } from './PomodoroTimer';
import { useUpdateStore } from '../state/updateStore';
import { useUiStore } from '../state/uiStore';
import { useWritingStatsStore } from '../state/writingStats';
import { useSubmitStore } from '../state/submitStore';
import { venueById } from '../submission/venues';
import { parsePageCount, venuePageLimit } from '../pageBudget';
import { hasSynctexIndex, jumpSourceToPdf } from '../synctexBridge';

// ---------------------------------------------------------------------------
// 纯函数：混合字数统计（CJK 字符每字计 1，连续拉丁词计 1）
// ---------------------------------------------------------------------------

/** CJK 字符（汉字 + 假名 + 谚文），每个字符计 1 词 */
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
/** 拉丁词：字母/数字开头，可含内部撇号与连字符（don't / state-of-the-art 均计 1） */
const LATIN_WORD = /[A-Za-z0-9][A-Za-z0-9'\u2019-]*/g;

export function countWords(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) cjk++;
  }
  const latin = text.match(LATIN_WORD);
  return cjk + (latin ? latin.length : 0);
}

/**
 * LaTeX 感知字数（v1.5.1 D5）：剔除注释与命令骨架，只统计「读者可见」的文字——
 *  - 去 % 注释（保留 \% 转义）；
 *  - 结构/引用类命令（documentclass/usepackage/begin/end/item/label/ref/cite/
 *    include/input/graphics 等）连同参数整体移除；
 *  - 其余命令（	extbf{...} 等）去命令名保留参数文本；
 *  - 数学（$...$ / \[...\]）不计字。
 */
const TEX_NOISE_CMD =
  /\\(?:documentclass|usepackage|requirepackage|newcommand|renewcommand|providecommand|DeclareMathOperator|begin|end|item|label|ref|eqref|autoref|cref|cite[pt]?\*?|nocite|input|include|includegraphics|bibliography|bibliographystyle|graphicspath|setlength|setcounter|addtocounter|usebox|vspace|hspace|newpage|clearpage|footnotemark|thanks|hypersetup|title|author|date|maketitle|tableofcontents|listoffigures|listoftables|appendix)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g;

export function countTexWords(text: string): number {
  let out = text.replace(/(^|[^\\])%[^\n]*/g, (_m, pre: string) => pre);
  out = out.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$/g, ' ');
  out = out.replace(TEX_NOISE_CMD, ' ');
  out = out.replace(/\\[A-Za-z@]+\*?/g, ' ');
  out = out.replace(/[{}]/g, ' ');
  return countWords(out);
}

// ---------------------------------------------------------------------------
// 纯函数：相对时间（"3 秒前"）
// ---------------------------------------------------------------------------

export function relativeTime(ts: number, now: number = Date.now(), lang: Language = 'zh'): string {
  const sec = Math.floor(Math.max(0, now - ts) / 1000);
  if (sec < 5) return lang === 'en' ? 'just now' : '刚刚';
  const fmt = (n: number, zh: string, en: string) =>
    lang === 'en' ? `${n} ${en}${n === 1 ? '' : 's'} ago` : `${n} ${zh}前`;
  if (sec < 60) return fmt(sec, '秒', 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return fmt(min, '分钟', 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return fmt(hr, '小时', 'hour');
  const day = Math.floor(hr / 24);
  if (day < 30) return fmt(day, '天', 'day');
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const STRINGS = {
  zh: {
    words: '字数',
    lines: '行数',
    cursor: '行',
    saved: '已保存',
    unsaved: '未保存',
    noFile: '未打开文件',

    autoCompile: '自动编译',
    autoCompileOnTitle: '保存后自动编译已开启（点击关闭）',
    autoCompileOffTitle: '保存后自动编译已关闭（点击开启）',    syncPdf: '⇄ PDF',
    syncTitle: '跳转到光标行在 PDF 中的位置',
    syncDisabledTitle: '需要真实编译产出（真实编译后可用 PDF ↔ 源码同步）',
    syncNoPdf: '请先编译以生成 PDF 预览',
    syncNoHit: 'SyncTeX 未命中该文件',
    goalChipTitle: '今日写作字数/目标（命令面板可改目标）',
    pagesUnit: '页',
    pagesChipTitle: '最近一次编译页数 / 目标 venue 页数上限（超限变红）',
  },
  en: {
    words: 'Words',
    lines: 'Lines',
    cursor: 'Ln',
    saved: 'Saved',
    unsaved: 'Unsaved',
    noFile: 'No file',

    autoCompile: 'Auto compile',
    autoCompileOnTitle: 'Auto compile after save is ON (click to turn off)',
    autoCompileOffTitle: 'Auto compile after save is OFF (click to turn on)',    syncPdf: '⇄ PDF',
    syncTitle: 'Jump to where the cursor line appears in the PDF',
    syncDisabledTitle: 'Requires a real compile (PDF ↔ source sync unavailable)',
    syncNoPdf: 'Compile first to generate the PDF preview',
    syncNoHit: 'No SyncTeX match for this file',
    goalChipTitle: "Today's words / goal (adjust the goal from the command palette)",
    pagesUnit: 'pages',
    pagesChipTitle: 'Pages of the last compile / venue page limit (red when over)',
  },
} as const;

export interface StatusBarProps {
  /** 光标行列（由 EditorArea 的 CodeMirror 选区跟踪传入）；缺省为 1,1 */
  cursor?: { line: number; col: number };
}

export function StatusBar({ cursor = { line: 1, col: 1 } }: StatusBarProps) {
  const language = useSettingsStore((s) => s.language);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const files = useWorkspaceStore((s) => s.files);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const lastSavedAt = useWorkspaceStore((s) => s.lastSavedAt);
  const L = STRINGS[language];

  const content = activeTab !== null ? (files[activeTab] ?? '') : '';
  const words = useMemo(
    () => (activeTab && activeTab.toLowerCase().endsWith('.tex') ? countTexWords(content) : countWords(content)),
    [content, activeTab],
  );
  // 行数与 CodeMirror 一致：空文档计 1 行，行尾换行另起一行
  const lines = useMemo(() => (content === '' ? 1 : content.split('\n').length), [content]);

  // 相对时间随时间刷新（已保存时每 5s 重渲染一次）
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const id = setInterval(() => setTick((v) => v + 1), 5000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  const fileName = activeTab ? activeTab.split('/').pop()! : '';

  // 写作统计：字数旁的目标进度 chip（数据来自 writingStats store；挂载即校正跨天展示）
  const wordsToday = useWritingStatsStore((s) => s.wordsToday);
  const dailyGoal = useWritingStatsStore((s) => s.dailyGoal);
  const ensureToday = useWritingStatsStore((s) => s.ensureToday);
  useEffect(() => {
    ensureToday();
  }, [ensureToday]);

  // WS-2：SyncTeX 索引可用性为模块级单例（非响应式），索引仅在真实编译产出后变化；
  // 借 compileStatus 订阅在编译结束时重渲染，重读取 hasSynctexIndex()。
  const compileStatus = useWorkspaceStore((s) => s.compileStatus);
  const autoCompile = useSettingsStore((s) => s.autoCompile);
  const updatePhase = useUpdateStore((s) => s.phase);
  const updateVersion = useUpdateStore((s) => s.newVersion);
  const updateAutoInstalled = useUpdateStore((s) => s.autoInstalled);
  const applyUpdate = useUpdateStore((s) => s.applyAndRestart);
  const setAutoCompile = useSettingsStore((s) => s.setAutoCompile);
  const syncAvailable = hasSynctexIndex();

  // 页数预算：compileStatus 为 ok 且日志解析出页数时显示 chip；
  // submitStore 选了 venue 且 pageLimit 含整数 → 「N / M 页」，超限 err 红；无 venue 只显示「N 页」。
  const compileLog = useWorkspaceStore((s) => s.compileLog);
  const venueId = useSubmitStore((s) => s.venueId);
  const pages = compileStatus === 'ok' ? parsePageCount(compileLog.join('\n')) : null;
  const pageLimit = venuePageLimit(venueId ? venueById(venueId) : undefined);
  const pagesOver = pages !== null && pageLimit !== null && pages > pageLimit;

  // WS-2：源码 → PDF 同步（D11 修复：以编辑器光标行为基准，取该行就近命中的 PDF 位置）
  const handleSyncToPdf = (): void => {
    if (!activeTab) return;
    if (!useUiStore.getState().pdfView) {
      useWorkspaceStore.getState().appendCompileLog(`⚠ ${L.syncNoPdf}`);
      return;
    }
    if (!jumpSourceToPdf(activeTab, cursor.line)) {
      useWorkspaceStore.getState().appendCompileLog(`⚠ ${L.syncNoHit}：${activeTab}`);
    }
  };

  return (
    <div className="sf-statusbar" role="status">
      <span className="sf-statusbar-item" title={activeTab ?? ''}>
        {fileName || L.noFile}
        {dirty && (
          <span className="sf-statusbar-item warn" aria-label={L.unsaved}>
            ●
          </span>
        )}
      </span>
      <button
        type="button"
        className="sf-statusbar-item"
        disabled={!syncAvailable || activeTab === null}
        title={!syncAvailable ? L.syncDisabledTitle : L.syncTitle}
        onClick={handleSyncToPdf}
      >
        {L.syncPdf}
      </button>
      <button
        type="button"
        className={`sf-statusbar-item${autoCompile ? ' ok' : ''}`}
        title={autoCompile ? L.autoCompileOnTitle : L.autoCompileOffTitle}
        onClick={() => setAutoCompile(!autoCompile)}
      >
        {autoCompile ? `⟳ ${L.autoCompile}` : `⏸ ${L.autoCompile}`}
      </button>
      <PomodoroTimer />
      <span className="sf-statusbar-spacer" />
      <span className="sf-statusbar-item">
        {L.words} {words}
      </span>
      <span className="sf-statusbar-item sf-stats-goal-chip" title={L.goalChipTitle}>
        {dailyGoal > 0 && wordsToday >= dailyGoal ? `✓ ${wordsToday}` : `${wordsToday}/${dailyGoal}`}
      </span>
      <span className="sf-statusbar-item">
        {L.lines} {lines}
      </span>
      {pages !== null && (
        <span
          className={`sf-statusbar-item sf-page-chip${pageLimit === null ? '' : pagesOver ? ' err' : ' ok'}`}
          title={L.pagesChipTitle}
        >
          {pageLimit === null ? `${pages} ${L.pagesUnit}` : `${pages} / ${pageLimit} ${L.pagesUnit}`}
        </span>
      )}
      {updatePhase === 'downloaded' && (
        <button
          type="button"
          className="sf-statusbar-item"
          style={{ color: 'var(--accent-dim)', cursor: 'pointer' }}
          title={updateAutoInstalled ? 'v' + updateVersion + ' 已安装 — 点击重启完成' : 'v' + updateVersion + ' 已就绪 — 点击安装并重启'}
          onClick={() => void applyUpdate()}
        >
          ⟳ v{updateVersion}
        </button>
      )}
      <span className="sf-statusbar-item">
        {L.cursor} {cursor.line}, {cursor.col}
      </span>
      <span className={`sf-statusbar-item ${dirty ? 'warn' : 'ok'}`}>
        {dirty ? (
          <>● {L.unsaved}</>
        ) : (
          <>
            ✓ {L.saved}
            {lastSavedAt !== null && <> · {relativeTime(lastSavedAt, undefined, language)}</>}
          </>
        )}
      </span>
    </div>
  );
}
