/**
 * 项目文件树：由 files Record 按 "/" 嵌套渲染；文件夹可折叠（展开态存组件内 state）；
 * 悬停 ⋯ 菜单支持新建 / 重命名（prompt）/ 删除（confirm）。
 */

import { useEffect, useState } from 'react';
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useT } from '../i18n';
import { useWorkspaceStore } from '../state/workspaceStore';

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

function iconFor(name: string) {
  if (name.endsWith('.tex')) return FileCode;
  if (name.endsWith('.bib')) return BookMarked;
  if (name.endsWith('.md')) return FileText;
  if (IMAGE_EXT.test(name)) return FileImage;
  return File;
}

function buildTree(files: Record<string, string>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  for (const path of Object.keys(files).sort()) {
    const parts = path.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');
      let next = cur.children.find((c) => c.name === part && c.dir === !isLeaf);
      if (!next) {
        next = { name: part, path: childPath, dir: !isLeaf, children: [] };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    nodes.forEach((n) => sortNodes(n.children));
    return nodes;
  };
  return sortNodes(root.children);
}

export function FileTree() {
  const t = useT();
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const createFile = useWorkspaceStore((s) => s.createFile);
  const renameFile = useWorkspaceStore((s) => s.renameFile);
  const deleteFile = useWorkspaceStore((s) => s.deleteFile);

  const tree = buildTree(files);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  const toggleDir = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const promptNewFile = (dirHint: string) => {
    const name = window.prompt(t('tree.newFilePrompt'), dirHint ? `${dirHint}/` : '');
    const trimmed = name?.trim();
    if (!trimmed) return;
    createFile(trimmed, '');
  };

  const doRename = (node: TreeNode) => {
    if (node.dir) {
      const target = window.prompt(t('tree.renamePrompt'), node.path);
      const trimmed = target?.trim();
      if (!trimmed || trimmed === node.path) return;
      const prefix = `${node.path}/`;
      for (const p of Object.keys(files)) {
        if (p.startsWith(prefix)) renameFile(p, `${trimmed}/${p.slice(prefix.length)}`);
      }
    } else {
      const target = window.prompt(t('tree.renamePrompt'), node.path);
      const trimmed = target?.trim();
      if (!trimmed || trimmed === node.path) return;
      renameFile(node.path, trimmed);
    }
  };

  const doDelete = (node: TreeNode) => {
    if (!window.confirm(`${t('tree.deleteConfirm')} ${node.path}?`)) return;
    if (node.dir) {
      const prefix = `${node.path}/`;
      for (const p of Object.keys(files)) if (p.startsWith(prefix)) deleteFile(p);
    } else {
      deleteFile(node.path);
    }
  };

  const renderRow = (node: TreeNode, depth: number) => {
    const Icon = node.dir ? (collapsed.has(node.path) ? Folder : FolderOpen) : iconFor(node.name);
    const active = !node.dir && node.path === activeTab;
    const menuOpen = menuFor === node.path;
    return (
      <div key={`${node.dir ? 'd' : 'f'}:${node.path}`}>
        <div
          className={`sf-tree-row ${active ? 'active' : ''}`}
          data-path={node.path}
          data-dir={node.dir ? '1' : undefined}
          style={{ paddingLeft: depth * 14 + 6 }}
          onClick={() => (node.dir ? toggleDir(node.path) : openFile(node.path))}
        >
          {node.dir && (
            <span className="sf-tree-chevron">{collapsed.has(node.path) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</span>
          )}
          <span className="sf-tree-icon">
            <Icon size={14} />
          </span>
          <span className="sf-tree-name" title={node.path}>
            {node.name}
          </span>
          <button
            className="sf-tree-menu-btn"
            title={t('tree.newFile')}
            onClick={(e) => {
              e.stopPropagation();
              setMenuFor(menuOpen ? null : node.path);
            }}
          >
            <MoreHorizontal size={13} />
          </button>
          {menuOpen && (
            <div className="sf-tree-menu" onClick={(e) => e.stopPropagation()}>
              <button
                className="sf-menu-item"
                data-action="new"
                onClick={() => {
                  setMenuFor(null);
                  promptNewFile(node.dir ? node.path : node.path.split('/').slice(0, -1).join('/'));
                }}
              >
                <Plus size={13} /> {t('tree.newFile')}
              </button>
              <button
                className="sf-menu-item"
                data-action="rename"
                onClick={() => {
                  setMenuFor(null);
                  doRename(node);
                }}
              >
                <Pencil size={13} /> {t('tree.rename')}
              </button>
              <button
                className="sf-menu-item danger"
                data-action="delete"
                onClick={() => {
                  setMenuFor(null);
                  doDelete(node);
                }}
              >
                <Trash2 size={13} /> {t('tree.delete')}
              </button>
            </div>
          )}
        </div>
        {node.dir && !collapsed.has(node.path) && node.children.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="sf-tree">
      <div className="sf-tree-toolbar">
        <button className="sf-tree-new" title={t('tree.newFile')} onClick={() => promptNewFile('')}>
          <Plus size={13} />
          <span>{t('tree.newFile')}</span>
        </button>
      </div>
      {tree.length === 0 ? (
        <p className="placeholder">{t('editor.noOpen')}</p>
      ) : (
        tree.map((n) => renderRow(n, 0))
      )}
    </div>
  );
}
