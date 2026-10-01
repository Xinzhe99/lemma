/**
 * Tauri 真实编译全流程（注入假 __TAURI__ 桥，不依赖真实进程）：
 * 验证 WS-2 编译成功后回读 main.synctex.gz 并经 parseSynctex 注册 SyncTeX 索引，
 * 以及回读失败时仅记录日志、停用同步、编译结果不受影响。
 * 独立成文件：getPlatform 平台单例在首次调用时确定形态，须先装桥再跑流程。
 * 另覆盖内置 Tectonic 自动下载链：系统引擎缺失 → 下载 → 以绝对路径真实编译；
 * 下载失败 → 中文日志说明 + 回退 MockEngine；二次编译复用已就绪的内置引擎。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { runCompile } from './compileAction';
import { resetTexSetupForTests } from './texSetup';
import { hasSynctexIndex, jumpSourceToPdf, onPdfGoto, setSynctexIndex } from './synctexBridge';
import { useWorkspaceStore } from './state/workspaceStore';
import { useUiStore } from './state/uiStore';

const g = globalThis as unknown as { window?: unknown };

/** 手写最小 .synctex 文本（非 gzip 也能被 parseSynctex 按文本解析） */
const SYNCTEX_TEXT = [
  'SyncTeX Version:1',
  'Input:1:./main.tex',
  'Content:',
  '{1}',
  '{1,12}',
  'h,x:1000,y:8000,w:4000,h:400',
].join('\n');

interface BridgeOptions {
  synctexBase64?: string | Error;
  pdfBase64?: string | Error;
}

/** 安装假 Tauri 桥：--version 探测放行 tectonic、拒绝 latexmk；编译成功；产物按需可失败 */
function installTauriBridge(opts: BridgeOptions = {}): void {
  g.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          const a = (args ?? {}) as { cmd?: string; args?: string[]; path?: string };
          if (cmd === 'proc_run') {
            if (a.args?.includes('--version')) {
              return a.cmd === 'tectonic'
                ? { code: 0, stdout: 'Tectonic 0.15.0', stderr: '' }
                : { code: 1, stdout: '', stderr: 'latexmk: command not found' };
            }
            return { code: 0, stdout: '', stderr: '' }; // 编译成功、干净日志（单趟）
          }
          if (cmd === 'fs_read_base64') {
            const failOrValue = a.path === 'main.pdf' ? opts.pdfBase64 : opts.synctexBase64;
            if (failOrValue instanceof Error) throw failOrValue;
            return (
              failOrValue ??
              Buffer.from(a.path === 'main.pdf' ? '%PDF-fake' : SYNCTEX_TEXT).toString('base64')
            );
          }
          if (cmd === 'fs_write' || cmd === 'fs_delete') return null;
          if (cmd === 'fs_read') return '';
          if (cmd === 'fs_list') return [];
          return null;
        },
      },
    },
  };
}

function seedProject(): void {
  useWorkspaceStore.setState({
    projectName: 'test',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}\n\\begin{document}hi\\end{document}\n' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
  useUiStore.setState({ pdfView: null, centerView: 'editor' });
}

afterEach(() => {
  delete g.window;
  setSynctexIndex(null);
  resetTexSetupForTests(); // 内置引擎会话状态不跨用例泄漏
});

describe('Tauri 真实编译：SyncTeX 索引注册（WS-2）', () => {
  it('编译成功 → 回读 main.synctex.gz 注册索引，源码 → PDF 查询可用并广播 goto', async () => {
    installTauriBridge();
    seedProject();
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    try {
      const result = await runCompile();
      expect(result).toMatchObject({ ok: true, entry: 'main.tex', diagnostics: 0 });
      expect(hasSynctexIndex()).toBe(true);
      expect(jumpSourceToPdf('main.tex', 12)).toBe(true);
      expect(gotos).toEqual([{ page: 1, y: 8000 }]);
      expect(useUiStore.getState().pdfView?.name).toBe('main.pdf');
      const log = useWorkspaceStore.getState().compileLog.join('\n');
      expect(log).toContain('main.synctex.gz');
      expect(log).toContain('SyncTeX 索引已注册');
    } finally {
      off();
    }
  });

  it('synctex.gz 回读失败 → 仅记录日志并停用同步（索引置 null），编译结果不受影响', async () => {
    installTauriBridge({ synctexBase64: new Error('ENOENT: main.synctex.gz') });
    seedProject();
    const result = await runCompile();
    expect(result.ok).toBe(true);
    expect(hasSynctexIndex()).toBe(false);
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).toContain('main.synctex.gz');
    expect(log).toContain('同步已停用');
  });

  it('编译失败 → 索引置 null（旧索引与最新源码不再一致）', async () => {
    g.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            const a = (args ?? {}) as { cmd?: string; args?: string[] };
            if (cmd === 'proc_run') {
              if (a.args?.includes('--version')) {
                return a.cmd === 'tectonic' ? { code: 0, stdout: 'Tectonic 0.15.0', stderr: '' } : { code: 1, stdout: '', stderr: '' };
              }
              return { code: 1, stdout: '', stderr: '! Undefined control sequence.\nl.9 \\badcmd\n' };
            }
            return null;
          },
        },
      },
    };
    seedProject();
    setSynctexIndex({
      version: 1,
      inputs: [{ tag: 1, path: 'main.tex' }],
      blocks: [{ page: 1, tag: 1, line: 1, x: 0, y: 0, w: 1000, h: 100 }],
    });
    const result = await runCompile();
    expect(result.ok).toBe(false);
    expect(hasSynctexIndex()).toBe(false);
  });
});

describe('Tauri 编译：内置 Tectonic 自动下载（系统引擎缺失时的全链兜底）', () => {
  const BUILTIN_PATH = 'C:\\AppData\\ScholarForge\\bin\\tectonic.exe';

  /** 系统引擎全缺失的桥：--version 一律 127；download_and_install_tectonic / 编译结果可注入 */
  function installNoEngineBridge(opts: {
    onDownload: () => Promise<unknown>;
    onCompile?: (cmd: string) => { code: number; stdout: string; stderr: string };
    ranCmds?: string[];
    downloadCount?: { n: number };
  }): void {
    g.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            const a = (args ?? {}) as { cmd?: string; args?: string[]; path?: string };
            if (cmd === 'proc_run') {
              if (a.args?.includes('--version')) {
                return { code: 127, stdout: '', stderr: 'command not found' };
              }
              opts.ranCmds?.push(a.cmd ?? '');
              return (
                opts.onCompile?.(a.cmd ?? '') ?? { code: 0, stdout: '', stderr: '' }
              );
            }
            if (cmd === 'download_and_install_tectonic') {
              if (opts.downloadCount) opts.downloadCount.n++;
              return opts.onDownload();
            }
            if (cmd === 'fs_read_base64') {
              const payload =
                a.path === 'main.pdf'
                  ? '%PDF-fake'
                  : ['SyncTeX Version:1', 'Input:1:./main.tex', 'Content:', '{1}', 'h,x:1000,y:8000,w:4000,h:400'].join('\n');
              return Buffer.from(payload).toString('base64');
            }
            return null; // fs_write / fs_delete / 其余命令
          },
        },
      },
    };
  }

  it('系统引擎缺失 → 自动下载内置 Tectonic，以其绝对路径真实编译（非裸 tectonic 命令）', async () => {
    const ranCmds: string[] = [];
    installNoEngineBridge({
      ranCmds,
      onDownload: async () => ({ path: BUILTIN_PATH, cached: false, firstRunNote: true }),
    });
    seedProject();
    const result = await runCompile();
    expect(result).toMatchObject({ ok: true, entry: 'main.tex', diagnostics: 0 });
    expect(ranCmds).toContain(BUILTIN_PATH);
    expect(ranCmds).not.toContain('tectonic');
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).toContain('未检测到 TeX 引擎，正在自动下载内置 Tectonic');
    expect(log).toContain('已就绪（缓存于应用数据目录）');
    expect(log).toContain('首次编译将联网获取宏包，稍慢属正常');
    expect(log).toContain('tectonic（内置）');
    expect(log).not.toContain('模拟引擎');
    expect(useWorkspaceStore.getState().compileStatus).toBe('ok');
  });

  it('下载失败 → 中文日志说明（含手动安装指引）并回退模拟引擎', async () => {
    installNoEngineBridge({
      onDownload: async () => {
        throw new Error('下载 Tectonic 失败：https://github.com/...: Dns Failed。请检查网络/代理；也可手动安装 Tectonic 或 TeX Live');
      },
    });
    seedProject();
    const result = await runCompile();
    expect(result.ok).toBe(true); // MockEngine 兜底
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).toContain('未检测到 TeX 引擎，正在自动下载内置 Tectonic');
    expect(log).toContain('内置 Tectonic 自动下载失败');
    expect(log).toContain('请检查网络/代理');
    expect(log).toContain('手动安装 Tectonic');
    expect(log).toContain('模拟引擎');
  });

  it('二次编译复用已就绪的内置引擎（不再触发下载命令）', async () => {
    const ranCmds: string[] = [];
    const downloadCount = { n: 0 };
    const bridge = {
      ranCmds,
      downloadCount,
      onDownload: async () => ({ path: BUILTIN_PATH, cached: false, firstRunNote: true }),
    };
    installNoEngineBridge(bridge);
    seedProject();
    await runCompile(); // 第一次：触发下载
    expect(downloadCount.n).toBe(1);

    seedProject(); // 清空编译日志再跑第二次
    const result = await runCompile();
    expect(result.ok).toBe(true);
    expect(downloadCount.n).toBe(1); // 未再次下载
    expect(ranCmds.filter((c) => c === BUILTIN_PATH).length).toBe(2); // 两次都以内置路径编译
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).not.toContain('正在自动下载'); // 已就绪路径直接编译，无下载提示
    expect(log).toContain('tectonic（内置）');
  });
});
