/**
 * 项目文件树（按项目分组）：
 * - 顶部为当前项目分组：项目名标题 + 「当前」chip + 该项目文件树（既有能力保留：
 *   嵌套渲染/折叠/新建/重命名/删除，经 uiStore.openTextDialog 的应用内对话框）；
 * - 下方列出其他已保存项目（projectsStore 记录）：折叠行 = 项目名 + 文件数，
 *   点击展开只读文件清单 + 「切换到此项目」（openProject + 本地目录磁盘同步合并）；
 *   当前项目行高亮 chip，不出现在「其他项目」列表。
 * 输入与确认均走应用内文本对话框（Tauri WKWebView 下原生对话框不可用）。
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
import { useUiStore, type TextDialogRequest } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { CURRENT_PROJECT_ID, useProjectsStore } from '../state/projectsStore';
import { openProjectWithDiskSync } from '../state/projectDisk';

/** 打开应用内文本对话框并等待用户输入/确认（取消返回 null） */
function askText(req: Omit<TextDialogRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useUiStore.getState().openTextDialog({ ...req, resolve });
  });
}

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
  const projectName = useWorkspaceStore((s) => s.projectName);
  const records = useProjectsStore((s) => s.projects);

  const tree = buildTree(files);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 展开的其他项目记录 id 集合（默认全部折叠） */
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // 其他已保存项目（排除当前项目名的记录与临时崩溃恢复记录），新保存的在前
  const otherProjects = records.filter((p) => p.id !== CURRENT_PROJECT_ID && p.name !== projectName);

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

  const toggleProject = (id: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const promptNewFile = async (dirHint: string) => {
    const answer = await askText({
      title: t('tree.newFilePrompt'),
      initial: dirHint ? `${dirHint}/` : '',
      placeholder: dirHint ? undefined : 'sections/notes.tex',
      confirmText: t('tree.newFile'),
      mode: 'prompt',
    });
    const trimmed = answer?.trim();
    if (!trimmed) return;
    createFile(trimmed, '');
  };

  const doRename = async (node: TreeNode) => {
    const target = await askText({
      title: t('tree.renamePrompt'),
      initial: node.path,
      confirmText: t('tree.rename'),
      mode: 'prompt',
    });
    const trimmed = target?.trim();
    if (!trimmed || trimmed === node.path) return;
    if (node.dir) {
      const prefix = `${node.path}/`;
      for (const p of Object.keys(files)) {
        if (p.startsWith(prefix)) renameFile(p, `${trimmed}/${p.slice(prefix.length)}`);
      }
    } else {
      renameFile(node.path, trimmed);
    }
  };

  const doDelete = async (node: TreeNode) => {
    const answer = await askText({
      title: `${t('tree.deleteConfirm')} ${node.path}?`,
      confirmText: t('tree.delete'),
      mode: 'confirm',
    });
    if (answer === null) return;
    if (node.dir) {
      const prefix = `${node.path}/`;
      for (const p of Object.keys(files)) if (p.startsWith(prefix)) deleteFile(p);
    } else {
      deleteFile(node.path);
    }
  };

  /** 切换到其他已保存项目（openProject + 本地目录磁盘同步），合并结果经轻提示 */
  const switchToProject = (id: string) => {
    void openProjectWithDiskSync(id).then((res) => {
      if (!res.opened) return;
      if (res.sync && (res.sync.merged.length > 0 || res.sync.updated.length > 0)) {
        useUiStore
          .getState()
          .showToast(t('toast.diskSync', { merged: res.sync.merged.length, updated: res.sync.updated.length }));
      }
    });
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
                  void promptNewFile(node.dir ? node.path : node.path.split('/').slice(0, -1).join('/'));
                }}
              >
                <Plus size={13} /> {t('tree.newFile')}
              </button>
              <button
                className="sf-menu-item"
                data-action="rename"
                onClick={() => {
                  setMenuFor(null);
                  void doRename(node);
                }}
              >
                <Pencil size={13} /> {t('tree.rename')}
              </button>
              <button
                className="sf-menu-item danger"
                data-action="delete"
                onClick={() => {
                  setMenuFor(null);
                  void doDelete(node);
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

  /** 其他项目的只读文件清单（来自 projectsStore 记录，不可点击打开） */
  const renderReadonlyRow = (projectId: string, path: string, depth: number) => {
    const Icon = iconFor(path);
    return (
      <div
        key={`${projectId}:${path}`}
        className="sf-tree-row readonly"
        data-readonly-path={path}
        style={{ paddingLeft: depth * 14 + 6 }}
        title={t('tree.readonlyHint')}
      >
        <span className="sf-tree-icon">
          <Icon size={14} />
        </span>
        <span className="sf-tree-name">{path}</span>
      </div>
    );
  };

  return (
    <div className="sf-tree">
      <div className="sf-tree-toolbar">
        <button className="sf-tree-new" title={t('tree.newFile')} onClick={() => void promptNewFile('')}>
          <Plus size={13} />
          <span>{t('tree.newFile')}</span>
        </button>
      </div>

      {/* 当前项目分组 */}
      <div className="sf-tree-project-head current" data-testid="tree-current-project">
        <span className="sf-tree-project-name" title={projectName}>
          {projectName || t('tree.untitledProject')}
        </span>
        <span className="sf-chip sf-tree-current-chip">{t('tree.currentChip')}</span>
      </div>
      {tree.length === 0 ? (
        <p className="placeholder sf-tree-empty">{t('tree.emptyGuide')}</p>
      ) : (
        tree.map((n) => renderRow(n, 0))
      )}

      {/* 其他已保存项目（折叠行，只读清单 + 切换） */}
      {otherProjects.length > 0 && <div className="sf-tree-other-title">{t('tree.otherProjects')}</div>}
      {otherProjects.map((rec) => {
        const expanded = expandedProjects.has(rec.id);
        const paths = Object.keys(rec.snapshot.files).sort();
        return (
          <div key={rec.id} className="sf-tree-project" data-project={rec.id}>
            <div
              className="sf-tree-project-head"
              data-action="toggle"
              onClick={() => toggleProject(rec.id)}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="sf-tree-project-name" title={rec.name}>
                {rec.name}
              </span>
              <span className="sf-tree-project-count">{t('tree.fileCount', { n: paths.length })}</span>
            </div>
            {expanded && (
              <div className="sf-tree-project-body" data-testid={`tree-project-${rec.id}`}>
                {paths.length === 0 ? (
                  <p className="placeholder">{t('tree.projectNoFiles')}</p>
                ) : (
                  paths.map((p) => renderReadonlyRow(rec.id, p, 0))
                )}
                <button
                  type="button"
                  className="sf-tree-switch"
                  data-action="switch"
                  onClick={(e) => {
                    e.stopPropagation();
                    switchToProject(rec.id);
                  }}
                >
                  {t('tree.switchTo')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
