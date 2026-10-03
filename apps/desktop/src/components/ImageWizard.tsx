/**
 * 插图向导对话框：本地选图 → 规范化为 figures/ 下的 kebab-case 路径（重名自动 -2/-3）
 * → 生成 \includegraphics 代码插入编辑器光标处；主文件缺 \usepackage{graphicx} 时
 * 自动补入导言区（先 snapshotFile 建快照）。
 *
 * 形态差异：Tauri 桌面形态经 fs_write_base64 约定桥把图片写入数据目录 figures/；
 * 浏览器形态无本地 FS 写入能力，跳过写盘并提示说明。
 * 模态结构复用 sf-dialog 家族；新增样式位使用 sf-table-* 语义类名（不新增 CSS，同 TableEditor）。
 * UI 字符串使用组件内 zh/en 本地字典（不触碰 i18n.ts）。
 */

import { useEffect, useRef, useState } from 'react';
import { stripLineComment } from '@lemma/editor';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { insertAtCursor } from '../editorInsert';
import { getPlatform } from '../platform/types';
import { tauriWriteFileBase64 } from '../platform/tauri';

const STRINGS = {
  zh: {
    title: '插图向导',
    pick: '选择本地图片',
    pickTitle: '支持 png / jpg / gif / pdf 等常见图片格式',
    pathLabel: '项目内路径（可编辑，重名自动加 -2/-3）',
    previewPlaceholder: '选择图片后在此预览生成的 LaTeX 代码',
    preview: '将插入的代码',
    insert: '插入到光标处',
    insertTitle: '插入到当前打开文件的编辑器光标处',
    cancel: '取消',
    noEditor: '未找到可用的编辑器：请先打开一个 .tex 文件再插入',
    browserNote: '浏览器预览模式：图片未写入磁盘，请手动放置到项目 figures/ 目录后编译',
    writeFailed: '图片写入失败：',
    graphicxAdded: '已自动在主文件导言区补充 \\usepackage{graphicx}',
  },
  en: {
    title: 'Figure wizard',
    pick: 'Pick local image',
    pickTitle: 'Supports png / jpg / gif / pdf and other common formats',
    pathLabel: 'In-project path (editable, -2/-3 suffix on conflicts)',
    previewPlaceholder: 'LaTeX code preview appears here after picking an image',
    preview: 'Code to insert',
    insert: 'Insert at cursor',
    insertTitle: 'Insert into the open file at the editor cursor',
    cancel: 'Cancel',
    noEditor: 'No active editor found: open a .tex file before inserting',
    browserNote: 'Browser preview: image was not written to disk — place it under figures/ manually before compiling',
    writeFailed: 'Image write failed: ',
    graphicxAdded: '\\usepackage{graphicx} was added to the main file preamble',
  },
} as const;

// ---------------------------------------------------------------------------
// 纯函数（导出供测试与复用）
// ---------------------------------------------------------------------------

/** 文件基名 → kebab-case：camelCase 分词、空格/下划线转 -、去非法字符（含中文）、折叠/修剪连字符 */
function toKebabBase(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // 变音符脱落（café → cafe）
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2') // camelCase → camel-case
    .replace(/[\s_]+/g, '-') // 空白/下划线 → -
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '') // 非法字符（含中文、括号、点）剔除
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'image';
}

/**
 * 生成不与 existing 冲突的插图路径：`figures/<kebab>.<小写扩展名>`，重名追加 -2/-3。
 * 仅去空格与非法字符（中文转拼音为可选增强，未实现——中文被剔除，空基名回退 image）。
 */
export function normalizeImagePath(name: string, existing: string[]): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const bare = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = bare.lastIndexOf('.');
  const rawBase = dot > 0 ? bare.slice(0, dot) : bare;
  const rawExt = dot > 0 ? bare.slice(dot + 1) : '';
  const base = toKebabBase(rawBase);
  const ext = rawExt.toLowerCase();
  const taken = new Set(existing.map((p) => p.replace(/\\/g, '/').toLowerCase()));
  const candidate = (n: number | null) =>
    `figures/${base}${n == null ? '' : `-${n}`}${ext ? `.${ext}` : ''}`;
  if (!taken.has(candidate(null))) return candidate(null);
  for (let n = 2; ; n++) {
    if (!taken.has(candidate(n))) return candidate(n);
  }
}

/** 生成插图代码：\includegraphics[width=0.8\textwidth]{path} */
export function buildIncludeGraphics(path: string): string {
  return `\\includegraphics[width=0.8\\textwidth]{${path}}`;
}

/** 主文件是否缺少 graphicx 宏包（忽略注释行；\usepackage[选项]{graphicx} 亦算已引入） */
export function needsGraphicx(mainTex: string): boolean {
  const code = mainTex
    .split('\n')
    .map((line) => stripLineComment(line))
    .join('\n');
  return !/\\usepackage(?:\[[^\]]*\])?\{[^}]*graphicx[^}]*\}/.test(code);
}

/**
 * 向主文件导言区补 \usepackage{graphicx}：插在 \documentclass 行之后；
 * 找不到 \documentclass 时置于文件最前。已引入 graphicx 时原样返回（幂等）。
 */
export function addGraphicxToPreamble(mainTex: string): string {
  if (!needsGraphicx(mainTex)) return mainTex;
  const lines = mainTex.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\\documentclass\b/.test(lines[i]!)) {
      lines.splice(i + 1, 0, '\\usepackage{graphicx}');
      return lines.join('\n');
    }
  }
  return `\\usepackage{graphicx}\n${mainTex}`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/** 选择的主图：原始 File + 目标路径（可编辑） */
interface PickedImage {
  file: File;
  path: string;
}

/** FileReader dataURL → 纯 base64（去掉 data:image/...;base64, 前缀） */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** 主文件选取：workspaceStore.entry（.tex）→ main.tex → 当前活动 .tex */
function pickMainTex(ws: ReturnType<typeof useWorkspaceStore.getState>): string | null {
  if (ws.entry && ws.entry.toLowerCase().endsWith('.tex') && ws.files[ws.entry] !== undefined) {
    return ws.entry;
  }
  if (ws.files['main.tex'] !== undefined) return 'main.tex';
  if (ws.activeTab && ws.activeTab.toLowerCase().endsWith('.tex') && ws.files[ws.activeTab] !== undefined) {
    return ws.activeTab;
  }
  return null;
}

export function ImageWizard({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];
  const files = useWorkspaceStore((s) => s.files);

  const inputRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<string | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [hint, setHint] = useState('');
  const [graphicxHint, setGraphicxHint] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 缩略图 objectURL 生命周期：更换/卸载时回收
  useEffect(() => {
    return () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    };
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    thumbRef.current = URL.createObjectURL(file);
    setPicked({ file, path: normalizeImagePath(file.name, Object.keys(files)) });
    setHint('');
    setGraphicxHint(false);
  };

  /** 主文件缺 graphicx 时补导言区（先快照，可经历史对话框恢复） */
  const ensureGraphicx = (): boolean => {
    const ws = useWorkspaceStore.getState();
    const mainPath = pickMainTex(ws);
    if (!mainPath) return false;
    const mainTex = ws.files[mainPath] ?? '';
    if (!needsGraphicx(mainTex)) return false;
    ws.snapshotFile(mainPath, '插图向导：自动补 \\usepackage{graphicx}');
    ws.updateFile(mainPath, addGraphicxToPreamble(mainTex));
    return true;
  };

  const insert = async () => {
    if (!picked) return;
    const isTauri = getPlatform().kind === 'tauri';
    // Tauri 形态：先把图片写入数据目录 figures/（fs_write_base64 约定桥）
    if (isTauri) {
      try {
        const base64 = await readAsBase64(picked.file);
        await tauriWriteFileBase64(picked.path, base64);
      } catch (err) {
        setHint(`${L.writeFailed}${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    if (!insertAtCursor(buildIncludeGraphics(picked.path))) {
      setHint(L.noEditor); // 插入失败：保持打开并提示
      return;
    }
    setGraphicxHint(ensureGraphicx());
    if (isTauri) {
      onClose();
      return;
    }
    // 浏览器形态：跳过写盘，提示说明后延时关闭（等效 toast）
    setHint(L.browserNote);
    window.setTimeout(onClose, 2600);
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog sf-table-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onPick}
          />
          <div className="sf-table-toolbar">
            <button className="sf-btn" title={L.pickTitle} onClick={() => inputRef.current?.click()}>
              {L.pick}
            </button>
            {picked && thumbRef.current && (
              <img
                className="sf-table-figure-thumb"
                src={thumbRef.current}
                alt={picked.file.name}
                style={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain', borderRadius: 4 }}
              />
            )}
            {picked && <span className="sf-table-colspec-label">{picked.file.name}</span>}
          </div>
          <label className="sf-form-field">
            {L.pathLabel}
            <input
              className="sf-input"
              value={picked?.path ?? ''}
              disabled={!picked}
              onChange={(e) => setPicked((p) => (p ? { ...p, path: e.target.value } : p))}
            />
          </label>
          <div className="sf-table-preview-label">{L.preview}</div>
          <pre className="sf-table-preview">{picked ? buildIncludeGraphics(picked.path) : L.previewPlaceholder}</pre>
          {graphicxHint && <p className="sf-table-hint">{L.graphicxAdded}</p>}
          {hint && (
            <p className="sf-table-hint" role="alert">
              {hint}
            </p>
          )}
          <div className="sf-table-actions">
            <button className="sf-btn" onClick={onClose}>
              {L.cancel}
            </button>
            <button
              className="sf-btn sf-btn--primary"
              title={L.insertTitle}
              disabled={!picked}
              onClick={() => void insert()}
            >
              {L.insert}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
