/**
 * 大纲面板：跨全部 .tex 文件的章节树，点击跳转到对应文件与行。
 */

import { useMemo } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { outlineAcrossFiles, resolveEntry } from '../projectDoc';
import { jumpTo } from '../editorJump';

export function OutlinePanel() {
  const files = useWorkspaceStore((s) => s.files);
  const entry = resolveEntry(files);
  const items = useMemo(() => outlineAcrossFiles(files), [files]);

  if (items.length === 0) {
    return <p className="placeholder">未发现章节（\section / \subsection）</p>;
  }

  return (
    <ul className="sf-outline">
      {items.map(({ file, node }, i) => (
        <li
          key={`${file}:${node.line}:${i}`}
          className="sf-outline-item"
          style={{ paddingLeft: 8 + Math.max(0, node.level - 1) * 12 }}
          onClick={() => jumpTo({ file, line: node.line })}
          title={`${file}:${node.line}`}
        >
          <span className="sf-outline-title">{node.title}</span>
          {file !== entry && <span className="sf-outline-file">{file}</span>}
        </li>
      ))}
    </ul>
  );
}
