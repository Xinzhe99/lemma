/**
 * Tauri 真实编译全流程（注入假 __TAURI__ 桥，不依赖真实进程）：
 * 验证 WS-2 编译成功后回读 main.synctex.gz 并经 parseSynctex 注册 SyncTeX 索引，
 * 以及回读失败时仅记录日志、停用同步、编译结果不受影响。
 * 独立成文件：getPlatform 平台单例在首次调用时确定形态，须先装桥再跑流程。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { runCompile } from './compileAction';
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
