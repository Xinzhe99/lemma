/**
 * 编辑区：把 @scholarforge/editor 接入工作区文件系统。
 * \cite 补全数据 = 文献库条目 + 项目 .bib 条目；挂载行级跳转桥。
 */

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, LatexEditor } from '@scholarforge/editor';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { bibEntries } from '../projectDoc';
import { setJumpHandler, stashPendingJump, takePendingJump } from '../editorJump';

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

export function EditorArea() {
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const updateFile = useWorkspaceStore((s) => s.updateFile);
  const papers = useLibraryStore((s) => s.papers);

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
      <LatexEditor
        key={activeTab}
        value={content}
        onChange={(v) => updateFile(activeTab, v)}
        getCitations={() => citations}
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
