/**
 * 新建项目对话框（sf-dialog 正式形态，取代原 promptDialog 一句话输入）：
 * - 项目名称（必填）；
 * - 本地文件夹（可选）：桌面形态提供「选择…」原生文件夹选择器（tauri-plugin-dialog，
 *   注册于 lib.rs / 权限 dialog:default），同时保留路径手输输入框（选择器不可用 /
 *   取消时的回退）；创建前经写探针验证目录可写；
 * - 创建：载入最小可编译模板 → 绑定 projectDir → 存入 projectsStore（dir 持久化）→
 *   物化文件到所选目录（复用编译物化的逐文件写入方式，走 fs_write_absolute）→
 *   新建该项目下的首个 Agent 会话（沿用 SessionsPanel 既有行为）。
 * 双语文案用组件内本地字典（跟随 settingsStore.language，范式同 ProjectSwitcher）。
 */

import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useProjectsStore } from '../state/projectsStore';
import { useAgentHubStore } from '@lemma/agent-hub';
import { isDesktopKind, materializeProjectToDisk, probeDirWritable } from '../state/projectDisk';
import { tauriPickDirectory } from '../platform/tauri';
import { t } from '../i18n';

const STRINGS = {
  zh: {
    title: '新建项目',
    nameLabel: '项目名称',
    namePlaceholder: '如：我的第二篇论文',
    dirLabel: '本地文件夹（可选）',
    dirPlaceholder: '选择或粘贴一个文件夹，项目文件将同步保存到这里',
    browse: '选择…',
    browsing: '选择中…',
    create: '创建项目',
    cancel: '取消',
    dirChecking: '验证目录…',
    dirOk: '✓ 文件夹可写，项目文件将保存到这里',
    dirBad: (err: string) => `⚠ 无法写入该文件夹：${err}`,
    created: (name: string, dir: string | null) =>
      dir ? `已创建项目「${name}」，文件已保存到 ${dir}` : `已创建项目「${name}」`,
    materializeFail: (err: string) => `项目已创建，但写入本地文件夹失败：${err}`,
    browserHint: '当前为浏览器形态，无法写入本地文件夹（桌面版支持）。',
  },
  en: {
    title: 'New project',
    nameLabel: 'Project name',
    namePlaceholder: 'e.g. My second paper',
    dirLabel: 'Local folder (optional)',
    dirPlaceholder: 'Pick or paste a folder; project files will be saved there',
    browse: 'Browse…',
    browsing: 'Browsing…',
    create: 'Create project',
    cancel: 'Cancel',
    dirChecking: 'Checking folder…',
    dirOk: '✓ Folder is writable; files will be saved here',
    dirBad: (err: string) => `⚠ Cannot write to this folder: ${err}`,
    created: (name: string, dir: string | null) =>
      dir ? `Project "${name}" created; files saved to ${dir}` : `Project "${name}" created`,
    materializeFail: (err: string) => `Project created, but writing to the local folder failed: ${err}`,
    browserHint: 'Browser mode cannot write to local folders (desktop build supports it).',
  },
} as const;

type Dict = (typeof STRINGS)['zh'] | (typeof STRINGS)['en'];

/** 新项目的最小可编译模板（自 SessionsPanel 迁入，供对话框统一创建路径） */
export const NEW_PROJECT_FILES: Record<string, string> = {
  'main.tex': [
    '\\documentclass{article}',
    '\\usepackage{amsmath,graphicx,hyperref}',
    '',
    '\\title{新论文}',
    '\\author{}',
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    '\\section{引言}',
    '从这里开始写。',
    '',
    '\\end{document}',
    '',
  ].join('\n'),
};

/** 创建动作抽为可导出纯编排（对话框按钮与测试共用）：返回物化失败信息（无则 null） */
export async function createProjectWithName(name: string, dir: string | null): Promise<string | null> {
  useWorkspaceStore.getState().loadProject(name, 'main.tex', { ...NEW_PROJECT_FILES }, dir);
  useProjectsStore.getState().saveCurrent(name);
  // 物化失败不回滚项目（工作区内照常可用），把错误交回调用方提示
  if (dir && isDesktopKind()) {
    try {
      await materializeProjectToDisk(dir, useWorkspaceStore.getState().files);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  useAgentHubStore
    .getState()
    .newSession('host', name, t('sessions.newSession', useSettingsStore.getState().language));
  return null;
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L: Dict = STRINGS[language];
  const desktop = isDesktopKind();
  /** 卸载标记：await 期间对话框被关闭（Esc/遮罩）则放弃后续创建动作 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [dirStatus, setDirStatus] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle');
  const [dirError, setDirError] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUiStore.getState().textDialog) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 选择器选择或手输后（桌面形态）验证目录可写（写探针再删） */
  const verifyDir = async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed || !desktop) {
      setDirStatus('idle');
      setDirError('');
      return;
    }
    setDirStatus('checking');
    try {
      await probeDirWritable(trimmed);
      setDirStatus('ok');
      setDirError('');
    } catch (e) {
      setDirStatus('bad');
      setDirError(e instanceof Error ? e.message : String(e));
    }
  };

  const browse = async () => {
    setBrowsing(true);
    const picked = await tauriPickDirectory(L.title);
    setBrowsing(false);
    if (!picked) return;
    setDir(picked);
    void verifyDir(picked);
  };

  const canCreate = name.trim().length > 0 && dirStatus !== 'checking' && dirStatus !== 'bad' && !busy;

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const dirTrimmed = dir.trim() || null;
    setBusy(true);
    try {
      if (dirTrimmed && desktop && dirStatus !== 'ok') {
        await verifyDir(dirTrimmed); // 手输路径未经探针时创建前再验一次
        if (!aliveRef.current) return; // await 期间对话框已关闭
      }
      const fail = await createProjectWithName(trimmed, dirTrimmed);
      const ui = useUiStore.getState();
      if (fail) ui.showToast(L.materializeFail(fail));
      else ui.showToast(L.created(trimmed, dirTrimmed));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog sf-new-project" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body sf-new-project-body">
          <label className="sf-np-label" htmlFor="sf-np-name">
            {L.nameLabel}
          </label>
          <input
            id="sf-np-name"
            className="sf-np-input"
            data-testid="np-name"
            placeholder={L.namePlaceholder}
            value={name}
            autoFocus
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />

          <label className="sf-np-label" htmlFor="sf-np-dir">
            {L.dirLabel}
          </label>
          <div className="sf-np-dir-row">
            <input
              id="sf-np-dir"
              className="sf-np-input"
              data-testid="np-dir"
              placeholder={desktop ? L.dirPlaceholder : L.browserHint}
              value={dir}
              spellCheck={false}
              onChange={(e) => {
                setDir(e.target.value);
                setDirStatus('idle');
                setDirError('');
              }}
              onBlur={(e) => void verifyDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
            {desktop && (
              <button type="button" className="sf-btn sf-np-browse" data-testid="np-browse" onClick={() => void browse()} disabled={browsing}>
                <FolderOpen size={13} /> {browsing ? L.browsing : L.browse}
              </button>
            )}
          </div>
          {dirStatus === 'checking' && <p className="sf-np-hint">{L.dirChecking}</p>}
          {dirStatus === 'ok' && <p className="sf-np-hint ok">{L.dirOk}</p>}
          {dirStatus === 'bad' && <p className="sf-np-hint bad">{L.dirBad(dirError)}</p>}

          <div className="sf-np-actions">
            <button type="button" className="sf-btn" onClick={onClose} disabled={busy}>
              {L.cancel}
            </button>
            <button type="button" className="sf-btn primary" data-testid="np-create" onClick={() => void create()} disabled={!canCreate}>
              {L.create}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
