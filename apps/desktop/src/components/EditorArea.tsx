/**
 * 编辑区：把 @scholarforge/editor 接入工作区文件系统。
 * \cite 补全数据 = 文献库条目 + 项目 .bib 条目；挂载行级跳转桥；
 * 「选中即问」：选中文本后浮动 AI 操作条（润色/解释/翻译/找文献，设计 3.2）。
 */

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, LatexEditor } from '@scholarforge/editor';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { useUiStore } from '../state/uiStore';
import { bibEntries } from '../projectDoc';
import { setJumpHandler, stashPendingJump, takePendingJump } from '../editorJump';
import { polishSelection, quickAsk } from '../aiActions';

const TEXT_EXT = /\.(tex|bib|md|txt|sty|cls|bst)$/i;

function scrollToLine(view: EditorView, line: number): void {
  const clamped = Math.min(Math.max(1, line), view.state.doc.lines);
  const pos = view.state.doc.line(clamped).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
}

/** 选区跟踪扩展：把当前选中文本同步到 uiStore（空选区 → ''） */
const selectionTracker = EditorView.updateListener.of((update) => {
  if (!update.selectionSet) return;
  const sel = update.state.selection.main;
  const text = sel.empty ? '' : update.state.doc.sliceString(sel.from, sel.to);
  const store = useUiStore.getState();
  if (store.selectionText !== text) store.setSelectionText(text.length > 8000 ? '' : text);
});

export function EditorArea() {
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const updateFile = useWorkspaceStore((s) => s.updateFile);
  const papers = useLibraryStore((s) => s.papers);
  const selectionText = useUiStore((s) => s.selectionText);
  const setSelectionText = useUiStore((s) => s.setSelectionText);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const viewRef = useRef<EditorView | null>(null);

  // 行级跳转桥：同文件直接滚动定位；跨文件先 openFile + 暂存，待新编辑器就绪后消费
  useEffect(() => {
    setJumpHandler((target) => {
      if (target.file !== activeTabRef.current) {
        stashPendingJump(target);
        openFile(target.file);
      } else {
        const view = viewRef.current;
        if (view) scrollToLine(view, target.line);
      }
    });
    return () => setJumpHandler(null);
  }, [openFile]);

  const citations = useMemo(() => {
    const seen = new Set<string>();
    const push = (c: { citekey: string; title: string; year?: number }) =>
      c.citekey && !seen.has(c.citekey) ? (seen.add(c.citekey), c) : null;
    return [
      ...papers
        .map((p) => push({ citekey: p.citekey, title: p.title, year: p.year }))
        .filter((c): c is { citekey: string; title: string; year?: number } => c !== null),
      ...bibEntries(files)
        .map((b) => push({ citekey: b.citekey, title: b.title, year: b.year }))
        .filter((c): c is { citekey: string; title: string; year?: number } => c !== null),
    ];
  }, [papers, files]);

  if (!activeTab) {
    return (
      <div className="sf-editor-placeholder">
        <p className="placeholder">打开左侧文件开始编辑</p>
      </div>
    );
  }

  if (!TEXT_EXT.test(activeTab)) {
    return (
      <div className="sf-editor-placeholder">
        <div className="sf-editor-file">{activeTab}</div>
        <p className="placeholder">该文件类型暂不支持文本编辑</p>
      </div>
    );
  }

  const content = files[activeTab] ?? '';

  return (
    <div className="sf-editor-host">
      {selectionText && activeTab.endsWith('.tex') && (
        <div className="sf-selbar">
          <span className="sf-selbar-label">已选 {selectionText.length} 字</span>
          <button className="sf-btn" onClick={() => void polishSelection(selectionText)}>
            润色
          </button>
          <button className="sf-btn" onClick={() => quickAsk('explain', selectionText)}>
            解释
          </button>
          <button className="sf-btn" onClick={() => quickAsk('translate', selectionText)}>
            翻译
          </button>
          <button className="sf-btn" onClick={() => quickAsk('find', selectionText)}>
            找文献
          </button>
          <button className="sf-link-btn" onClick={() => setSelectionText('')} title="清除选区标记">
            ×
          </button>
        </div>
      )}
      <LatexEditor
        key={activeTab}
        value={content}
        onChange={(v) => updateFile(activeTab, v)}
        getCitations={() => citations}
        extraExtensions={[selectionTracker]}
        onEditorReady={(view) => {
          viewRef.current = view;
          if (view) {
            const target = takePendingJump(activeTab);
            if (target) scrollToLine(view, target.line);
          }
        }}
      />
    </div>
  );
}
