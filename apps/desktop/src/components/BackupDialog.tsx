/**
 * 全量备份/恢复对话框（WS-F 应用设施，经命令 app.backup / uiStore.backupDialogOpen 挂载）：
 *  - 导出：从各 store 收集快照（settingsStore 经 stripSecrets 脱敏——API key 永不进备份）→
 *    buildBackup → Blob 下载 `scholarforge-backup-YYYYMMDD-HHmm.json`；
 *  - 恢复：file input 选择 json → validateBackup → 展示备份内容摘要（各部分条数）→
 *    应用内确认（uiStore.openTextDialog mode:'confirm'，不用 window.confirm）→ 逐 store 恢复：
 *    libraryStore.setState({papers}) / notesStore / annotationStore.setState({byFile}) /
 *    projectsStore（订阅自动回写 localStorage sf-projects）/ workspaceStore.loadProject /
 *    settingsStore 仅恢复 theme/language/embeddingModel（不恢复 providers，避免覆盖现有 key）。
 * 文案为组件内 zh/en 双语字典；不新增 CSS（复用 sf-dialog 体系）。
 */

import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import type { Paper, Annotation, Note } from '@scholarforge/shared';
import { buildBackup, stripSecrets, validateBackup, type BackupFile } from '../backup';
import { useAnnotationStore } from '../state/annotationStore';
import { useLibraryStore } from '../state/libraryStore';
import { useNotesStore } from '../state/notesStore';
import { useProjectsStore, type ProjectRecord } from '../state/projectsStore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore, type FileSnapshot } from '../state/workspaceStore';

// ---------------------------------------------------------------------------
// 双语文案（自包含，不进全局 i18n 字典）
// ---------------------------------------------------------------------------

interface Copy {
  title: string;
  close: string;
  exportTitle: string;
  exportButton: string;
  exportDone: (name: string) => string;
  restoreTitle: string;
  restorePick: string;
  restoreNow: string;
  restoreConfirmTitle: string;
  restoreConfirmText: string;
  restoreConfirm: string;
  restored: string;
  invalidFile: (reason: string) => string;
  readFail: (reason: string) => string;
  providersNote: string;
  backupOf: (at: string) => string;
  currentTitle: string;
  sumPapers: (n: number) => string;
  sumNotes: (n: number) => string;
  sumAnnotations: (n: number, files: number) => string;
  sumProjects: (n: number) => string;
  sumFiles: (projectName: string, n: number, entry: string) => string;
  sumSettings: (theme: string, language: string, embeddingModel: string) => string;
}

const COPY: Record<Language, Copy> = {
  zh: {
    title: '备份与恢复',
    close: '关闭',
    exportTitle: '导出全量备份',
    exportButton: '导出全量备份',
    exportDone: (name) => `已导出：${name}`,
    restoreTitle: '从备份恢复',
    restorePick: '选择备份文件（.json）',
    restoreNow: '从备份恢复',
    restoreConfirmTitle: '确认恢复？当前文献库、笔记、标注、项目与工作区将被备份内容覆盖（服务配置与 API key 不受影响）',
    restoreConfirmText: '恢复会覆盖现有数据，且不可撤销。建议先导出一份当前备份。',
    restoreConfirm: '恢复',
    restored: '已恢复，建议刷新页面',
    invalidFile: (reason) => `备份文件无效：${reason}`,
    readFail: (reason) => `读取文件失败：${reason}`,
    providersNote: '备份不含 API key；恢复不会覆盖现有模型服务配置（providers）。',
    backupOf: (at) => `备份内容（导出于 ${at}）`,
    currentTitle: '当前数据',
    sumPapers: (n) => `文献 ${n} 条`,
    sumNotes: (n) => `笔记 ${n} 张`,
    sumAnnotations: (n, files) => `PDF 标注 ${n} 条（${files} 个文件）`,
    sumProjects: (n) => `项目记录 ${n} 个`,
    sumFiles: (projectName, n, entry) => `工作区文件 ${n} 个（${projectName || '—'} · 入口 ${entry || '—'}）`,
    sumSettings: (theme, language, embeddingModel) =>
      `设置：主题 ${theme} · 语言 ${language} · 嵌入模型 ${embeddingModel || '（本地哈希）'}`,
  },
  en: {
    title: 'Backup & Restore',
    close: 'Close',
    exportTitle: 'Export full backup',
    exportButton: 'Export full backup',
    exportDone: (name) => `Exported: ${name}`,
    restoreTitle: 'Restore from backup',
    restorePick: 'Choose a backup file (.json)',
    restoreNow: 'Restore from backup',
    restoreConfirmTitle: 'Restore now? Library, notes, annotations, projects and workspace will be replaced (providers & API keys untouched)',
    restoreConfirmText: 'Restoring overwrites current data and cannot be undone. Export a backup first.',
    restoreConfirm: 'Restore',
    restored: 'Restored — a page refresh is recommended',
    invalidFile: (reason) => `Invalid backup file: ${reason}`,
    readFail: (reason) => `Failed to read file: ${reason}`,
    providersNote: 'Backups never contain API keys; restoring never touches provider configs.',
    backupOf: (at) => `Backup contents (exported ${at})`,
    currentTitle: 'Current data',
    sumPapers: (n) => `${n} papers`,
    sumNotes: (n) => `${n} notes`,
    sumAnnotations: (n, files) => `${n} annotations (${files} files)`,
    sumProjects: (n) => `${n} project records`,
    sumFiles: (projectName, n, entry) => `${n} workspace files (${projectName || '—'} · entry ${entry || '—'})`,
    sumSettings: (theme, language, embeddingModel) =>
      `Settings: theme ${theme} · language ${language} · embedding ${embeddingModel || '(local hash)'}`,
  },
};

/** 导出文件名时间戳（20260930-1416） */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function backupFileName(): string {
  return `scholarforge-backup-${stamp()}.json`;
}

/** Blob 下载（与 LibraryPanel 导出 .bib 同款手法） */
function downloadJson(json: string, name: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function annotationTotals(byFile: Record<string, unknown[]>): { total: number; files: number } {
  let total = 0;
  let files = 0;
  for (const list of Object.values(byFile)) {
    if (Array.isArray(list)) {
      total += list.length;
      files += 1;
    }
  }
  return { total, files };
}

/** 备份内容摘要行（各部分条数） */
function summaryLines(backup: BackupFile, c: Copy): string[] {
  const { data } = backup;
  const ann = annotationTotals(data.knowledge.annotationsByFile);
  return [
    c.sumPapers(data.library.papers.length),
    c.sumNotes(data.knowledge.notes.length),
    c.sumAnnotations(ann.total, ann.files),
    c.sumProjects(data.projects.length),
    c.sumFiles(
      data.workspace.projectName,
      Object.keys(data.workspace.files).length,
      data.workspace.entry,
    ),
    c.sumSettings(
      typeof data.settings.theme === 'string' ? data.settings.theme : '—',
      typeof data.settings.language === 'string' ? data.settings.language : '—',
      typeof data.settings.embeddingModel === 'string' ? data.settings.embeddingModel : '',
    ),
  ];
}

/** 把校验通过的备份逐 store 写回（settings 仅 theme/language/embeddingModel，不动 providers） */
function applyRestore(backup: BackupFile): void {
  const { data } = backup;
  useLibraryStore.setState({ papers: data.library.papers as Paper[] });
  useNotesStore.setState({ notes: data.knowledge.notes as Note[] });
  useAnnotationStore.setState({ byFile: data.knowledge.annotationsByFile as Record<string, Annotation[]> });
  // projectsStore 订阅会把该状态回写 localStorage（sf-projects）
  useProjectsStore.setState({ projects: data.projects as ProjectRecord[] });

  useWorkspaceStore
    .getState()
    .loadProject(
      data.workspace.projectName || 'restored-project',
      data.workspace.entry,
      { ...data.workspace.files },
    );
  if (data.workspace.snapshots !== undefined) {
    useWorkspaceStore.setState({
      snapshots: data.workspace.snapshots as Record<string, FileSnapshot[]>,
    });
  }

  const settings = useSettingsStore.getState();
  if (data.settings.theme === 'light' || data.settings.theme === 'dark') {
    settings.setTheme(data.settings.theme);
  }
  if (data.settings.language === 'zh' || data.settings.language === 'en') {
    settings.setLanguage(data.settings.language);
  }
  if (typeof data.settings.embeddingModel === 'string') {
    settings.setEmbeddingModel(data.settings.embeddingModel);
  }
  // 注意：providers（含 API key）不恢复，避免覆盖现有模型服务配置
}

export function BackupDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const c = COPY[language];

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 已选择并通过校验的备份（未确认恢复前仅展示摘要） */
  const [picked, setPicked] = useState<BackupFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 当前数据摘要（导出侧展示用）
  const lib = useLibraryStore((s) => s.papers);
  const notes = useNotesStore((s) => s.notes);
  const byFile = useAnnotationStore((s) => s.byFile);
  const projects = useProjectsStore((s) => s.projects);
  const files = useWorkspaceStore((s) => s.files);
  const entry = useWorkspaceStore((s) => s.entry);
  const projectName = useWorkspaceStore((s) => s.projectName);
  const theme = useSettingsStore((s) => s.theme);
  const embeddingModel = useSettingsStore((s) => s.embeddingModel);
  const annNow = annotationTotals(byFile);
  const currentSummary = [
    c.sumPapers(lib.length),
    c.sumNotes(notes.length),
    c.sumAnnotations(annNow.total, annNow.files),
    c.sumProjects(projects.length),
    c.sumFiles(projectName, Object.keys(files).length, entry),
    c.sumSettings(theme, language, embeddingModel || '（本地哈希）'),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 导出全量备份：收集（settingsStore 经 stripSecrets 脱敏）→ buildBackup → Blob 下载 */
  const exportBackup = (): void => {
    const libState = useLibraryStore.getState();
    const ws = useWorkspaceStore.getState();
    const st = useSettingsStore.getState();
    // settingsStore 经 stripSecrets 去 key：apiKey 一律置空串后再进入备份组装
    const safe = stripSecrets({
      providers: st.providers,
      activeProviderId: st.activeProviderId,
      embeddingModel: st.embeddingModel,
      theme: st.theme,
      language: st.language,
    });
    const backup = buildBackup({
      papers: libState.papers,
      notes: useNotesStore.getState().notes,
      annotationsByFile: useAnnotationStore.getState().byFile,
      projects: useProjectsStore.getState().projects,
      workspace: {
        projectName: ws.projectName,
        entry: ws.entry,
        files: ws.files,
        snapshots: ws.snapshots,
      },
      embeddingModel: safe.embeddingModel,
      theme: safe.theme,
      language: safe.language,
    });
    const name = backupFileName();
    downloadJson(JSON.stringify(backup, null, 2), name);
    setMsg({ ok: true, text: c.exportDone(name) });
  };

  /** 选择备份文件：读取 → JSON.parse → validateBackup → 摘要展示 */
  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (e) {
        setPicked(null);
        setMsg({ ok: false, text: c.invalidFile(e instanceof Error ? e.message : String(e)) });
        return;
      }
      const r = validateBackup(json);
      if (!r.ok) {
        setPicked(null);
        setMsg({ ok: false, text: c.invalidFile(r.error) });
        return;
      }
      setPicked(r.backup);
      setMsg(null);
    } catch (e) {
      setPicked(null);
      setMsg({ ok: false, text: c.readFail(e instanceof Error ? e.message : String(e)) });
    }
  };

  /** 恢复：应用内 confirm（openTextDialog mode:'confirm'）确认后逐 store 写回 */
  const restore = (): void => {
    if (!picked) return;
    void new Promise<string | null>((resolve) => {
      useUiStore.getState().openTextDialog({
        title: c.restoreConfirmTitle,
        mode: 'confirm',
        confirmText: c.restoreConfirm,
        resolve,
      });
    }).then((answer) => {
      if (answer === null) return;
      applyRestore(picked);
      setMsg({ ok: true, text: c.restored });
    });
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog sf-backup-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{c.title}</strong>
        </header>
        <div className="sf-dialog-body">
          <section>
            <strong className="sf-backup-section-title">{c.exportTitle}</strong>
            <ul className="sf-backup-summary" style={{ margin: '8px 0', paddingLeft: 18 }}>
              <li style={{ listStyle: 'none', fontWeight: 600 }}>{c.currentTitle}</li>
              {currentSummary.map((line) => (
                <li key={line} style={{ listStyle: 'none' }}>
                  {line}
                </li>
              ))}
            </ul>
            <button className="sf-btn sf-btn--primary" onClick={exportBackup}>
              <Download size={13} /> {c.exportButton}
            </button>
          </section>

          <section style={{ marginTop: 16 }}>
            <strong className="sf-backup-section-title">{c.restoreTitle}</strong>
            <p className="placeholder" style={{ margin: '8px 0' }}>
              {c.providersNote}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                await handleFile(file);
              }}
            />
            <button className="sf-btn" onClick={() => fileInputRef.current?.click()}>
              <Upload size={13} /> {c.restorePick}
            </button>
            {picked && (
              <div style={{ marginTop: 8 }}>
                <ul className="sf-backup-summary" style={{ margin: '8px 0', paddingLeft: 18 }}>
                  <li style={{ listStyle: 'none', fontWeight: 600 }}>
                    {c.backupOf(new Date(picked.exportedAt).toLocaleString())}
                  </li>
                  {summaryLines(picked, c).map((line) => (
                    <li key={line} style={{ listStyle: 'none' }}>
                      {line}
                    </li>
                  ))}
                </ul>
                <button className="sf-btn sf-btn--primary" onClick={restore}>
                  <RotateCcw size={13} /> {c.restoreNow}
                </button>
              </div>
            )}
          </section>

          {msg && (
            <p className="sf-cites-msg" role="status">
              {msg.text}
            </p>
          )}

          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={onClose}>
              {c.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
