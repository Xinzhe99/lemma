/**
 * 状态栏（编辑区底部一行，sf-statusbar）：
 * 左 = 当前文件名 + dirty 圆点；右 = 字数 · 今日目标进度（wordsToday/goal，达标 ✓）· 行数 ·
 * 光标行列 · 保存状态（● 未保存 / ✓ 已保存 + 相对时间）。
 * 字数与相对时间为导出的纯函数（countWords / relativeTime），便于单测与跨组件复用；
 * 目标进度 chip 数据来自 writingStats store（状态/state/writingStats）。
 */

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWritingStatsStore } from '../state/writingStats';
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
    syncPdf: '⇄ PDF',
    syncTitle: '跳转到光标行在 PDF 中的位置',
    syncDisabledTitle: '需要真实编译产出（真实编译后可用 PDF ↔ 源码同步）',
    syncNoPdf: '请先编译以生成 PDF 预览',
    syncNoHit: 'SyncTeX 未命中该文件',
    goalChipTitle: '今日写作字数/目标（命令面板可改目标）',
  },
  en: {
    words: 'Words',
    lines: 'Lines',
    cursor: 'Ln',
    saved: 'Saved',
    unsaved: 'Unsaved',
    noFile: 'No file',
    syncPdf: '⇄ PDF',
    syncTitle: 'Jump to where the cursor line appears in the PDF',
    syncDisabledTitle: 'Requires a real compile (PDF ↔ source sync unavailable)',
    syncNoPdf: 'Compile first to generate the PDF preview',
    syncNoHit: 'No SyncTeX match for this file',
    goalChipTitle: "Today's words / goal (adjust the goal from the command palette)",
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
  const words = useMemo(() => countWords(content), [content]);
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
  useWorkspaceStore((s) => s.compileStatus);
  const syncAvailable = hasSynctexIndex();

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
