// @vitest-environment jsdom
/**
 * 内置 pandoc（docx 导出）单测（texSetup/compileAction 同一套路）：
 * - 纯函数：docxTargetFor / buildPandocArgs（参数组装）/ docxDownloadName / 双语字典；
 * - 浏览器形态：exportDocx 与 ensureBuiltinPandoc 返回固定中文提示「导出 docx 需桌面版」；
 * - Tauri 形态（mock __TAURI__ 桥 + vi.resetModules 隔离平台单例）：
 *   探测链（系统 pandoc --version → 内置下载命令）、会话内缓存与并发去重、
 *   下载失败中文错误；
 * - exportDocx 全流程：物化文件（fs_write）→ pandoc 参数（--from=latex --to=docx）
 *   → 读回（fs_read_base64）→ Blob 下载（stub URL.createObjectURL + anchor click）；
 * - 错误路径：无入口 / pandoc 非 0 退出码 / 产物读回失败 / 物化失败。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPandocArgs,
  docxDownloadName,
  docxTargetFor,
  ensureBuiltinPandoc,
  exportDocx,
  isBuiltinPandocInfo,
  pick,
  type BuiltinPandocInfo,
} from './pandoc';
import { useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';

const g = globalThis as unknown as { window?: unknown };

function seedProject(): void {
  useWorkspaceStore.setState({
    projectName: 'my-paper',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}hi\\end{document}\n',
      'sections/intro.tex': '\\section{引言}\n正文\n',
      'refs.bib': '@misc{k, title={T}}\n',
    },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
  useSettingsStore.setState({ language: 'zh' });
}

describe('纯函数（参数组装与命名）', () => {
  it('docxTargetFor：入口 → 产物路径（与 pdfTargetFor 同一约定）', () => {
    expect(docxTargetFor('main.tex')).toBe('main.docx');
    expect(docxTargetFor('sections/paper.tex')).toBe('sections/paper.docx');
    expect(docxTargetFor('Paper.TEX')).toBe('Paper.docx');
  });

  it('buildPandocArgs：[entry, -o, out, --from=latex, --to=docx]', () => {
    expect(buildPandocArgs('main.tex', 'main.docx')).toEqual([
      'main.tex',
      '-o',
      'main.docx',
      '--from=latex',
      '--to=docx',
    ]);
  });

  it('docxDownloadName：项目名优先，非法字符清理，回落入口名', () => {
    expect(docxDownloadName('my paper', 'main.tex')).toBe('my paper.docx');
    expect(docxDownloadName('a/b:*c?', 'main.tex')).toBe('a_b_c_.docx');
    expect(docxDownloadName('  ', 'sections/intro.tex')).toBe('intro.docx');
    expect(docxDownloadName('', '')).toBe('manuscript.docx');
  });

  it('双语字典：zh 原文 / en 翻译', () => {
    expect(pick('zh').browserUnsupported).toBe('导出 docx 需桌面版（浏览器形态无法内置 pandoc）');
    expect(pick('en').browserUnsupported).toContain('desktop app');
    expect(pick('zh').noEntry).toBe('未找到可导出的 .tex 入口文件');
  });
});

describe('浏览器形态（无 Tauri 桥）', () => {
  it('exportDocx 返回中文提示「导出 docx 需桌面版」，不触碰任何桥', async () => {
    seedProject();
    const r = await exportDocx();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(pick('zh').browserUnsupported);
  });

  it('ensureBuiltinPandoc 返回同一中文错误，形态判别为失败', async () => {
    const r = await ensureBuiltinPandoc();
    expect(isBuiltinPandocInfo(r)).toBe(false);
    if (!isBuiltinPandocInfo(r)) expect(r.error).toContain('导出 docx 需桌面版');
  });
});

// ---------------------------------------------------------------------------
// Tauri 形态：mock 桥 + 全新模块图（平台单例定型为 tauri）
// ---------------------------------------------------------------------------

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Fresh {
  pandoc: typeof import('./pandoc');
  ws: typeof import('./state/workspaceStore');
  settings: typeof import('./state/settingsStore');
}

async function freshPandoc(invoke: Invoke): Promise<Fresh> {
  vi.resetModules();
  g.window = { __TAURI__: { core: { invoke } } };
  const pandoc = await import('./pandoc');
  const ws = await import('./state/workspaceStore');
  const settings = await import('./state/settingsStore');
  return { pandoc, ws, settings };
}

/** 通用假桥：记录 proc/fs 调用，行为按 opts 配置 */
function makeBridge(opts: {
  systemPandoc?: boolean;
  install?: BuiltinPandocInfo | { error: string } | (() => Promise<unknown>);
  pandocRun?: { code: number; stdout: string; stderr: string };
  docxPayload?: string;
  failWrite?: boolean;
  failRead?: boolean;
}) {
  const procRuns: { cmd: string; args: string[]; cwd: string }[] = [];
  const writes: [string, string][] = [];
  const reads: string[] = [];
  const invokes: string[] = [];
  const invoke: Invoke = async (cmd, args) => {
    invokes.push(cmd);
    const a = (args ?? {}) as { cmd?: string; args?: string[]; cwd?: string; path?: string; content?: string };
    if (cmd === 'proc_run') {
      procRuns.push({ cmd: a.cmd ?? '', args: a.args ?? [], cwd: a.cwd ?? '' });
      if ((a.args ?? []).includes('--version')) {
        return a.cmd === 'pandoc' && opts.systemPandoc !== false
          ? { code: 0, stdout: 'pandoc 3.1.9', stderr: '' }
          : { code: 1, stdout: '', stderr: '' };
      }
      if (a.cmd === 'pandoc' && opts.systemPandoc !== false) {
        return opts.pandocRun ?? { code: 0, stdout: '', stderr: '' };
      }
      // 内置 pandoc.exe 的转换调用（或系统 pandoc 转换调用）
      return opts.pandocRun ?? { code: 0, stdout: '[INFO] Converted', stderr: '' };
    }
    if (cmd === 'download_and_install_pandoc') {
      if (typeof opts.install === 'function') return opts.install();
      const r = opts.install ?? { path: 'C:\\Data\\Lemma\\bin\\pandoc.exe', cached: false };
      if ('error' in r) throw new Error(r.error);
      return r;
    }
    if (cmd === 'fs_write') {
      if (opts.failWrite) throw new Error('磁盘已满');
      writes.push([a.path ?? '', a.content ?? '']);
      return null;
    }
    if (cmd === 'fs_read_base64') {
      if (opts.failRead) throw new Error('文件不存在：main.docx');
      reads.push(a.path ?? '');
      return btoa(opts.docxPayload ?? 'PK-fake-docx');
    }
    return null;
  };
  return { invoke, procRuns, writes, reads, invokes };
}

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Tauri 形态 ensureBuiltinPandoc（探测链）', () => {
  it('系统 pandoc 可用：--version 通过即直接使用，不触发内置下载', async () => {
    const b = makeBridge({ systemPandoc: true });
    const { pandoc } = await freshPandoc(b.invoke);
    const r = await pandoc.ensureBuiltinPandoc();
    expect(r).toEqual({ path: 'pandoc', cached: true });
    // 只有一次 --version 探测（workspace.json 的 fs_write 为 store 自动持久化噪音，不计入）
    expect(b.procRuns).toEqual([{ cmd: 'pandoc', args: ['--version'], cwd: '' }]);
    expect(b.invokes).not.toContain('download_and_install_pandoc');
  });

  it('系统 pandoc 不可用：调 download_and_install_pandoc 并透传结果', async () => {
    const b = makeBridge({
      systemPandoc: false,
      install: { path: 'C:\\Data\\Lemma\\bin\\pandoc.exe', cached: false },
    });
    const { pandoc } = await freshPandoc(b.invoke);
    const r = await pandoc.ensureBuiltinPandoc();
    expect(r).toMatchObject({ path: 'C:\\Data\\Lemma\\bin\\pandoc.exe', cached: false });
    expect(b.invokes).toEqual(['proc_run', 'download_and_install_pandoc']);
  });

  it('会话内缓存：就绪后再次调用不再探测/下载；并发调用共享同一次在途请求', async () => {
    let installs = 0;
    const b = makeBridge({
      systemPandoc: false,
      install: async () => {
        installs++;
        return { path: '/data/bin/pandoc', cached: false };
      },
    });
    const { pandoc } = await freshPandoc(b.invoke);
    const [a1, a2] = await Promise.all([pandoc.ensureBuiltinPandoc(), pandoc.ensureBuiltinPandoc()]);
    expect(installs).toBe(1);
    expect(a1).toEqual(a2);
    await pandoc.ensureBuiltinPandoc(); // 命中缓存
    expect(installs).toBe(1);
  });

  it('下载失败：返回 { error }（Rust 侧中文指引原样透传）', async () => {
    const b = makeBridge({
      systemPandoc: false,
      install: { error: '当前平台暂不支持内置 pandoc 自动下载，请先安装系统 pandoc（macOS：brew install pandoc）' },
    });
    const { pandoc } = await freshPandoc(b.invoke);
    const r = await pandoc.ensureBuiltinPandoc();
    expect(isBuiltinPandocInfo(r)).toBe(false);
    if (!isBuiltinPandocInfo(r)) {
      expect(r.error).toContain('brew install pandoc');
    }
  });
});

describe('Tauri 形态 exportDocx（全流程与错误路径）', () => {
  function stubDownload(): { names: string[] } {
    const names: string[] = [];
    const urls: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => {
        const u = `blob:fake-${urls.length}`;
        urls.push(u);
        return u;
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { names };
  }

  it('成功路径：物化 → pandoc 参数组装 → 读回 → Blob 下载', async () => {
    const b = makeBridge({
      systemPandoc: false,
      install: { path: 'C:\\Data\\Lemma\\bin\\pandoc.exe', cached: false },
      pandocRun: { code: 0, stdout: '[INFO] Converted', stderr: '' },
    });
    const dl = stubDownload();
    const { pandoc, ws } = await freshPandoc(b.invoke);
    seedProjectFresh(ws);
    const r = await pandoc.exportDocx();
    expect(r).toEqual({ ok: true, entry: 'main.tex', docxPath: 'main.docx', bytes: 'PK-fake-docx'.length });
    // 物化：全部文本文件写入数据目录（cwd 根）；workspace.json 为 store 自动持久化，不计入
    const materialized = b.writes.map(([p]) => p).filter((p) => p !== 'workspace.json').sort();
    expect(materialized).toEqual(['main.tex', 'refs.bib', 'sections/intro.tex'].sort());
    // pandoc 转换：内置绝对路径 + 参数组装 + cwd 为数据目录根
    const conv = b.procRuns.find((p) => !(p.args as string[]).includes('--version'))!;
    expect(conv.cmd).toBe('C:\\Data\\Lemma\\bin\\pandoc.exe');
    expect(conv.args).toEqual(['main.tex', '-o', 'main.docx', '--from=latex', '--to=docx']);
    expect(conv.cwd).toBe('');
    // 读回产物并触发下载（文件名来自项目名）
    expect(b.reads).toEqual(['main.docx']);
    expect(dl.names).toEqual(['my-paper.docx']);
  });

  it('系统 pandoc 可用时直接用系统命令转换（不触发内置下载）', async () => {
    const b = makeBridge({ systemPandoc: true });
    const dl = stubDownload();
    const { pandoc, ws } = await freshPandoc(b.invoke);
    seedProjectFresh(ws);
    const r = await pandoc.exportDocx();
    expect(r.ok).toBe(true);
    expect(b.invokes).not.toContain('download_and_install_pandoc');
    const conv = b.procRuns.find((p) => !(p.args as string[]).includes('--version'))!;
    expect(conv.cmd).toBe('pandoc');
    expect(dl.names).toEqual(['my-paper.docx']);
  });

  it('无 .tex 入口：返回中文错误，不触发任何桥调用', async () => {
    const b = makeBridge({ systemPandoc: true });
    const { pandoc, ws } = await freshPandoc(b.invoke);
    ws.useWorkspaceStore.setState({ entry: '', files: { 'refs.bib': '' } });
    const r = await pandoc.exportDocx();
    expect(r).toEqual({ ok: false, error: '未找到可导出的 .tex 入口文件' });
    // 不做探测/下载/转换（workspace.json 的 fs_write 为 store 自动持久化噪音，允许）
    expect(b.procRuns).toEqual([]);
    expect(b.invokes).not.toContain('download_and_install_pandoc');
    expect(b.invokes.filter((c) => c === 'proc_run')).toEqual([]);
  });

  it('pandoc 非 0 退出码：错误含退出码与 stderr 摘要', async () => {
    const b = makeBridge({
      systemPandoc: true,
      pandocRun: { code: 65, stdout: '', stderr: 'Error: cannot parse LaTeX' },
    });
    const { pandoc, ws } = await freshPandoc(b.invoke);
    seedProjectFresh(ws);
    const r = await pandoc.exportDocx();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('退出码 65');
      expect(r.error).toContain('cannot parse LaTeX');
    }
  });

  it('产物读回失败：中文「读回失败」错误', async () => {
    const b = makeBridge({ systemPandoc: true, failRead: true });
    const { pandoc, ws } = await freshPandoc(b.invoke);
    seedProjectFresh(ws);
    const r = await pandoc.exportDocx();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('docx 产物读回失败');
  });

  it('物化失败：中文「物化失败」错误（写入抛错上抛为结果）', async () => {
    const b = makeBridge({ systemPandoc: true, failWrite: true });
    const { pandoc, ws } = await freshPandoc(b.invoke);
    seedProjectFresh(ws);
    const r = await pandoc.exportDocx();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('项目文件物化失败');
  });
});

/** 给 fresh 模块图里的 workspaceStore 注入测试项目（同 seedProject，但作用于重置后的实例） */
function seedProjectFresh(ws: typeof import('./state/workspaceStore')): void {
  ws.useWorkspaceStore.setState({
    projectName: 'my-paper',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}hi\\end{document}\n',
      'sections/intro.tex': '\\section{引言}\n正文\n',
      'refs.bib': '@misc{k, title={T}}\n',
    },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
}
