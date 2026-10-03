/**
 * 编译动作单测：引擎探测/选择、PDF 产物路径推算、文件物化、错误跳转定位、
 * base64 解码（PDF 读回）与浏览器形态 MockEngine 回退；
 * D14：真实编译产物缓存（reopenLastPdf 重看）；D15：编译日志双语。
 * 全程不依赖真实进程：--version 探测结果一律以 ExecOutcome 注入。
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import type { SynctexIndex } from '@lemma/compile';
import type { Diagnostic } from '@lemma/shared';
import {
  detectEngine,
  engineLabel,
  firstErrorJump,
  materializeProjectFiles,
  pdfTargetFor,
  probeFromError,
  probeFromRun,
  reopenLastPdf,
  runCompile,
  synctexTargetFor,
  withBuiltinTectonic,
} from './compileAction';
import { base64ToBytes, tauriReadBase64 } from './platform/tauri';
import { useWorkspaceStore } from './state/workspaceStore';
import { useUiStore } from './state/uiStore';
import { useSettingsStore } from './state/settingsStore';
import { jumpTo, setJumpHandler } from './editorJump';
import { hasSynctexIndex, setSynctexIndex } from './synctexBridge';

const ok = (text = 'Tectonic 0.15.0'): { ok: boolean; text: string } => ({ ok: true, text });
const bad = (text = '无法启动命令'): { ok: boolean; text: string } => ({ ok: false, text });

describe('detectEngine（探测结果注入，不依赖真实进程）', () => {
  it('tectonic 可用时优先选择 tectonic', () => {
    expect(detectEngine({ tectonic: ok(), latexmk: bad() })).toBe('tectonic');
    expect(detectEngine({ tectonic: ok(), latexmk: ok() })).toBe('tectonic');
  });

  it('tectonic 不可用、latexmk 可用时选择 latexmk', () => {
    expect(detectEngine({ tectonic: bad(), latexmk: ok('latexmk 4.81 (TeX Live 2024)') })).toBe('latexmk');
  });

  it('两者都不可用返回 null（应回退模拟引擎）', () => {
    expect(detectEngine({ tectonic: bad(), latexmk: bad() })).toBeNull();
  });
});

describe('detectEngine + builtinTectonicPath（内置引擎探测注入点）', () => {
  const builtin = 'C:\\AppData\\Lemma\\bin\\tectonic.exe';

  it('系统引擎均不可用、注入内置路径时选择 builtin-tectonic', () => {
    expect(detectEngine({ tectonic: bad(), latexmk: bad(), builtinTectonicPath: builtin })).toBe('builtin-tectonic');
    expect(detectEngine({ tectonic: bad(), latexmk: bad(), builtinTectonicPath: '/data/bin/tectonic' })).toBe(
      'builtin-tectonic',
    );
  });

  it('优先级：系统 tectonic > 系统 latexmk > 内置 tectonic', () => {
    expect(detectEngine({ tectonic: ok(), latexmk: bad(), builtinTectonicPath: builtin })).toBe('tectonic');
    expect(detectEngine({ tectonic: bad(), latexmk: ok(), builtinTectonicPath: builtin })).toBe('latexmk');
    expect(detectEngine({ tectonic: ok(), latexmk: ok(), builtinTectonicPath: builtin })).toBe('tectonic');
  });

  it('内置路径为 null/空串时不参与选择（保持既有行为）', () => {
    expect(detectEngine({ tectonic: bad(), latexmk: bad(), builtinTectonicPath: null })).toBeNull();
    expect(detectEngine({ tectonic: bad(), latexmk: bad(), builtinTectonicPath: '' })).toBeNull();
  });

  it('engineLabel：内置引擎标注（内置），其余原样', () => {
    expect(engineLabel('builtin-tectonic')).toBe('tectonic（内置）');
    expect(engineLabel('tectonic')).toBe('tectonic');
    expect(engineLabel('latexmk')).toBe('latexmk');
  });
});

describe('withBuiltinTectonic（runner 命令重映射）', () => {
  const fakeRunner = {
    async run(
      cmd: string,
      args: string[],
      _opts: { cwd: string; stdin?: string },
    ): Promise<{ code: number; stdout: string; stderr: string }> {
      return { code: 0, stdout: `ran:${cmd}:${args.join(',')}`, stderr: '' };
    },
  };

  it('注入路径时把 tectonic 重映射到绝对路径，其余命令原样', async () => {
    const wrapped = withBuiltinTectonic(fakeRunner, 'C:\\bin\\tectonic.exe');
    const t = await wrapped.run('tectonic', ['-X', 'compile', 'main.tex'], { cwd: '' });
    expect(t.stdout).toBe('ran:C:\\bin\\tectonic.exe:-X,compile,main.tex');
    const b = await wrapped.run('bibtex', ['main.aux'], { cwd: '' });
    expect(b.stdout).toBe('ran:bibtex:main.aux');
    const l = await wrapped.run('latexmk', ['-pdf'], { cwd: '' });
    expect(l.stdout).toBe('ran:latexmk:-pdf');
  });

  it('路径为 null 时返回原 runner（系统引擎路径零开销）', () => {
    expect(withBuiltinTectonic(fakeRunner, null)).toBe(fakeRunner);
  });
});

describe('探测结果构造', () => {
  it('probeFromRun：退出码 0 即可用，stdout/stderr 合并为 text', () => {
    expect(probeFromRun({ code: 0, stdout: 'tectonic 0.15.0\n', stderr: '' })).toEqual({
      ok: true,
      text: 'tectonic 0.15.0',
    });
  });

  it('probeFromRun：非 0 退出码不可用', () => {
    const r = probeFromRun({ code: 1, stdout: '', stderr: 'not found' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('not found');
  });

  it('probeFromError：命令无法启动视为不可用，text 为错误消息', () => {
    expect(probeFromError(new Error('无法启动命令 tectonic'))).toEqual({ ok: false, text: '无法启动命令 tectonic' });
    expect(probeFromError('boom')).toEqual({ ok: false, text: 'boom' });
  });
});

describe('pdfTargetFor（入口 → 产物 PDF 路径）', () => {
  it('标准入口 main.tex → main.pdf', () => {
    expect(pdfTargetFor('main.tex')).toBe('main.pdf');
  });

  it('无扩展名与子目录入口均按去扩展名推算', () => {
    expect(pdfTargetFor('paper')).toBe('paper.pdf');
    expect(pdfTargetFor('sections/paper.tex')).toBe('sections/paper.pdf');
    expect(pdfTargetFor('Main.TEX')).toBe('Main.pdf');
  });
});

describe('synctexTargetFor（入口 → SyncTeX 索引路径，与 pdfTargetFor 对齐）', () => {
  it('标准入口 main.tex → main.synctex.gz', () => {
    expect(synctexTargetFor('main.tex')).toBe('main.synctex.gz');
  });

  it('无扩展名与子目录入口均按去扩展名推算', () => {
    expect(synctexTargetFor('paper')).toBe('paper.synctex.gz');
    expect(synctexTargetFor('sections/paper.tex')).toBe('sections/paper.synctex.gz');
    expect(synctexTargetFor('Main.TEX')).toBe('Main.synctex.gz');
  });
});

describe('materializeProjectFiles（编译前物化项目文件）', () => {
  it('写入全部文本文件并返回数量', async () => {
    const written: [string, string][] = [];
    const n = await materializeProjectFiles(
      { 'main.tex': 'A', 'sections/intro.tex': 'B', 'refs.bib': 'C' },
      async (p, c) => {
        written.push([p, c]);
      },
    );
    expect(n).toBe(3);
    expect(written).toEqual([
      ['main.tex', 'A'],
      ['sections/intro.tex', 'B'],
      ['refs.bib', 'C'],
    ]);
  });

  it('跳过二进制条目（Uint8Array 不参与文本物化）', async () => {
    const written: string[] = [];
    const n = await materializeProjectFiles(
      { 'main.tex': 'A', 'logo.png': new Uint8Array([1, 2, 3]) },
      async (p) => {
        written.push(p);
      },
    );
    expect(n).toBe(1);
    expect(written).toEqual(['main.tex']);
  });

  it('写盘失败时异常上抛（由编排层降级回退）', async () => {
    await expect(
      materializeProjectFiles({ 'main.tex': 'A' }, async () => {
        throw new Error('磁盘已满');
      }),
    ).rejects.toThrow('磁盘已满');
  });
});

describe('firstErrorJump（编译错误跳转定位）', () => {
  const d = (over: Partial<Diagnostic> & { severity: Diagnostic['severity']; message: string }): Diagnostic => over as Diagnostic;

  it('选中第一条 error 级且带 file+line 的诊断', () => {
    const diags: Diagnostic[] = [
      d({ severity: 'warning', message: 'w', file: 'main.tex', line: 3 }),
      d({ severity: 'error', message: 'e1', file: 'main.tex', line: 12 }),
      d({ severity: 'error', message: 'e2', file: 'other.tex', line: 5 }),
    ];
    expect(firstErrorJump(diags)).toEqual({ file: 'main.tex', line: 12 });
  });

  it('仅 warning 或缺少 file/line 的 error 不触发跳转', () => {
    expect(
      firstErrorJump([d({ severity: 'warning', message: 'w', file: 'main.tex', line: 3 })]),
    ).toBeNull();
    expect(firstErrorJump([d({ severity: 'error', message: 'e', file: 'main.tex' })])).toBeNull();
    expect(firstErrorJump([d({ severity: 'error', message: 'e', line: 4 })])).toBeNull();
    expect(firstErrorJump([])).toBeNull();
  });
});

describe('base64ToBytes（PDF 产物读回的解码）', () => {
  it('标准向量：空串 / 1-3 字节 padding 对齐', () => {
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
    expect(base64ToBytes('QQ==')).toEqual(new Uint8Array([0x41]));
    expect(base64ToBytes('QUI=')).toEqual(new Uint8Array([0x41, 0x42]));
    expect(base64ToBytes('QUJD')).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
  });

  it('缺省 padding 与空白字符可容忍', () => {
    expect(base64ToBytes('QQ')).toEqual(new Uint8Array([0x41]));
    expect(base64ToBytes('QUJD\n R0Y=')).toEqual(new Uint8Array([0x41, 0x42, 0x43, 0x47, 0x46]));
  });

  it('全字节域往返（0-255）', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const encoded = Buffer.from(bytes).toString('base64');
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('非法字符抛错', () => {
    expect(() => base64ToBytes('**')).toThrow('base64 解码失败');
  });
});

describe('浏览器形态 runCompile（MockEngine，行为不变）', () => {
  afterEach(() => {
    setJumpHandler(null);
    setSynctexIndex(null);
  });

  it('无 Tauri 桥时走 MockEngine 并产出成功结果与模拟日志', async () => {
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
    const result = await runCompile();
    expect(result).toMatchObject({ ok: true, entry: 'main.tex', diagnostics: 0 });
    expect(result.passes).toBeGreaterThanOrEqual(1);
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).toContain('模拟引擎');
    expect(useWorkspaceStore.getState().compileStatus).toBe('ok');
  });

  it('模拟编译路径将 SyncTeX 索引置 null（清除旧真实编译的残留索引）', async () => {
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
    // 预置一个旧索引（手造 SynctexIndex 对象），模拟编译后必须停用同步
    const staleIndex: SynctexIndex = {
      version: 1,
      inputs: [{ tag: 1, path: 'main.tex' }],
      blocks: [{ page: 1, tag: 1, line: 12, x: 1000, y: 8000, w: 4000, h: 400 }],
    };
    setSynctexIndex(staleIndex);
    await runCompile();
    expect(hasSynctexIndex()).toBe(false);
  });

  it('error 级诊断存在时经 jumpTo 桥跳转到首个出错行', () => {
    const jumps: { file: string; line: number }[] = [];
    setJumpHandler((t) => jumps.push(t));
    // runCompile 的真实/模拟两条路径在拿到诊断后都用 firstErrorJump 定位并调用 jumpTo
    const target = firstErrorJump([
      { severity: 'error', message: 'Undefined control sequence', file: 'main.tex', line: 9 },
    ]);
    expect(target).toEqual({ file: 'main.tex', line: 9 });
    jumpTo(target!);
    expect(jumps).toEqual([{ file: 'main.tex', line: 9 }]);
  });
});

describe('tauriReadBase64（Tauri 桥注入）', () => {
  const g = globalThis as unknown as { window?: unknown };

  afterEach(() => {
    delete g.window;
  });

  it('桥存在时读回 base64 并解码为字节', async () => {
    const fake = Buffer.from([0x25, 0x50, 0x44, 0x46]).toString('base64'); // %PDF
    g.window = { __TAURI__: { core: { invoke: async (cmd: string) => (cmd === 'fs_read_base64' ? fake : '') } } };
    const bytes = await tauriReadBase64('main.pdf');
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('桥不存在时抛中文错误「待 Tauri 桥接」', async () => {
    await expect(tauriReadBase64('main.pdf')).rejects.toThrow('待 Tauri 桥接');
  });
});

// ---------------------------------------------------------------------------
// D14：编译产物缓存（真实编译读回 PDF → 预览关闭后 reopenLastPdf 重看）
// ---------------------------------------------------------------------------

/** 与既有浏览器用例一致的最小项目状态（注入到给定 store 实例） */
function seedProjectTo(ws: typeof useWorkspaceStore, ui: typeof useUiStore): void {
  ws.setState({
    projectName: 'test',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}\n\\begin{document}hi\\end{document}\n' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
  ui.setState({ pdfView: null, centerView: 'editor' });
}

describe('reopenLastPdf（D14：编译 PDF 关闭后重看）', () => {
  it('从未真实编译读回产物时返回 false，且不触碰 PDF 视图（模拟编译不缓存）', async () => {
    seedProjectTo(useWorkspaceStore, useUiStore);
    expect(reopenLastPdf()).toBe(false);
    expect(useUiStore.getState().pdfView).toBeNull();

    const result = await runCompile(); // 浏览器形态 → MockEngine，无真实产物
    expect(result.ok).toBe(true);
    expect(reopenLastPdf()).toBe(false);
    expect(useUiStore.getState().pdfView).toBeNull();
  });

  it('真实编译读回产物并缓存：关闭预览后 reopenLastPdf() 恢复 PDF 并返回 true', async () => {
    // getPlatform 为首次调用定型的单例：本文件此前用例已按浏览器形态运行，
    // 这里 vi.resetModules() 取全新模块图，先装假 Tauri 桥再动态 import。
    vi.resetModules();
    const g = globalThis as unknown as { window?: unknown };
    g.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            const a = (args ?? {}) as { cmd?: string; args?: string[]; path?: string };
            if (cmd === 'proc_run') {
              if (a.args?.includes('--version')) {
                return a.cmd === 'tectonic'
                  ? { code: 0, stdout: 'Tectonic 0.15.0', stderr: '' }
                  : { code: 1, stdout: '', stderr: '' };
              }
              return { code: 0, stdout: '', stderr: '' }; // 编译成功、干净日志
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
    try {
      const { runCompile: runCompileFresh, reopenLastPdf: reopenFresh } = await import('./compileAction');
      const { useWorkspaceStore: wsFresh } = await import('./state/workspaceStore');
      const { useUiStore: uiFresh } = await import('./state/uiStore');
      seedProjectTo(wsFresh, uiFresh);

      const result = await runCompileFresh();
      expect(result).toMatchObject({ ok: true, entry: 'main.tex' });
      // 读回产物即自动打开预览
      expect(uiFresh.getState().pdfView?.name).toBe('main.pdf');

      // 用户关闭 PDF 预览 → 视图清空；reopenLastPdf 用缓存重开（D14 修复路径）
      uiFresh.getState().setPdfView(null);
      expect(uiFresh.getState().pdfView).toBeNull();
      expect(reopenFresh()).toBe(true);
      expect(uiFresh.getState().pdfView?.name).toBe('main.pdf');
      const data = uiFresh.getState().pdfView?.data;
      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(data as ArrayBuffer))).toEqual(Array.from(Buffer.from('%PDF-fake')));
      expect(uiFresh.getState().centerView).toBe('pdf'); // setPdfView 同时切回 PDF 视图
    } finally {
      delete g.window;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// D15：编译日志双语（zh 原文保持，en 为准确翻译；语言在发日志时动态读取）
// ---------------------------------------------------------------------------

describe('编译日志双语（D15）', () => {
  afterEach(() => {
    useSettingsStore.setState({ language: 'zh' });
  });

  it('language=en 时模拟编译日志为英文', async () => {
    useSettingsStore.setState({ language: 'en' });
    seedProjectTo(useWorkspaceStore, useUiStore);
    const result = await runCompile();
    expect(result.ok).toBe(true);
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).toContain('▶ Compiling main.tex (mock engine)');
    expect(log).toContain('succeeded');
    expect(log).not.toContain('模拟引擎');
    expect(log).not.toContain('成功');
  });

  it('切回 zh 时恢复中文原文', async () => {
    seedProjectTo(useWorkspaceStore, useUiStore);
    await runCompile();
    const log = useWorkspaceStore.getState().compileLog.join('\n');
    expect(log).toContain('▶ 开始编译 main.tex（模拟引擎）');
    expect(log).toContain('成功');
  });
});
