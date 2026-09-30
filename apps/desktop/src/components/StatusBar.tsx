/**
 * 状态栏（编辑区底部一行，sf-statusbar）：
 * 左 = 当前文件名 + dirty 圆点；右 = 字数 · 行数 · 光标行列 · 保存状态（● 未保存 / ✓ 已保存 + 相对时间）。
 * 字数与相对时间为导出的纯函数（countWords / relativeTime），便于单测与跨组件复用。
 */

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore, type Language } from '../state/settingsStore';

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
  },
  en: {
    words: 'Words',
    lines: 'Lines',
    cursor: 'Ln',
    saved: 'Saved',
    unsaved: 'Unsaved',
    noFile: 'No file',
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
      <span className="sf-statusbar-spacer" />
      <span className="sf-statusbar-item">
        {L.words} {words}
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
