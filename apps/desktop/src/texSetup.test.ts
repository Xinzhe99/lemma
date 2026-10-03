/**
 * 内置 TeX 引擎自动下载管理器（texSetup）单测：
 * - 浏览器形态：无桥 → 固定中文错误 + phase=error；
 * - Tauri 形态：命令成功（fresh 下载 / Rust cached 透传）、会话内幂等、并发去重、
 *   失败路径（mock invoke 抛中文错误）；
 * - 状态机 phase/message 与 i18n 不确定进度文案。
 * 平台单例在首次 getPlatform 时定型：Tauri 用例经 vi.resetModules + 动态 import 隔离
 * （与 compileAction.test.ts 同一套路）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureBuiltinTectonic,
  getTexSetupState,
  isBuiltinTectonicInfo,
  resetTexSetupForTests,
  texSetupPhaseText,
} from './texSetup';

const g = globalThis as unknown as { window?: unknown };

describe('texSetupPhaseText（i18n 进度文案，纯函数）', () => {
  it('各 phase 的 zh/en 文案与插值', () => {
    expect(texSetupPhaseText('downloading', 'zh')).toBe('正在下载 Tectonic（约 30MB）…');
    expect(texSetupPhaseText('downloading', 'en')).toBe('Downloading Tectonic (~30 MB)…');
    expect(texSetupPhaseText('ready', 'zh')).toBe('内置 Tectonic 已就绪（缓存于应用数据目录）');
    expect(texSetupPhaseText('ready', 'en')).toBe('Bundled Tectonic is ready (cached in the app data directory)');
    expect(texSetupPhaseText('error', 'zh', '超时')).toBe('内置 Tectonic 获取失败：超时');
    expect(texSetupPhaseText('error', 'en', 'timeout')).toBe('Failed to get the bundled Tectonic: timeout');
    expect(texSetupPhaseText('idle', 'zh')).toBe('');
  });
});

describe('浏览器形态（无 Tauri 桥）', () => {
  afterEach(() => {
    resetTexSetupForTests();
  });

  it('ensureBuiltinTectonic 返回固定中文错误，状态机进入 error', async () => {
    const r = await ensureBuiltinTectonic();
    expect(isBuiltinTectonicInfo(r)).toBe(false);
    if (!isBuiltinTectonicInfo(r)) {
      expect(r.error).toBe('浏览器形态无法内置编译器，请使用桌面版');
    }
    const st = getTexSetupState();
    expect(st.phase).toBe('error');
    expect(st.error).toBe('浏览器形态无法内置编译器，请使用桌面版');
  });
});

describe('Tauri 形态（mock __TAURI__ 桥）', () => {
  type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  /** 重置模块图 → 装桥 → 动态 import 全新 texSetup 实例（平台单例随之定型为 tauri） */
  async function freshTexSetup(invoke: Invoke): Promise<typeof import('./texSetup')> {
    vi.resetModules();
    g.window = { __TAURI__: { core: { invoke } } };
    return import('./texSetup');
  }

  afterEach(() => {
    delete g.window;
    vi.resetModules();
  });

  it('命令成功：透传 path/cached/firstRunNote，状态机 ready 且 path 可查', async () => {
    const calls: string[] = [];
    const mod = await freshTexSetup(async (cmd) => {
      calls.push(cmd);
      if (cmd === 'download_and_install_tectonic') {
        return { path: 'C:\\AppData\\Lemma\\bin\\tectonic.exe', cached: false, firstRunNote: true };
      }
      return null;
    });
    const r = await mod.ensureBuiltinTectonic();
    expect(calls).toEqual(['download_and_install_tectonic']);
    expect(isBuiltinTectonicInfo(r)).toBe(true);
    expect(r).toMatchObject({
      path: 'C:\\AppData\\Lemma\\bin\\tectonic.exe',
      cached: false,
      firstRunNote: true,
    });
    const st = mod.getTexSetupState();
    expect(st.phase).toBe('ready');
    expect(st.path).toBe('C:\\AppData\\Lemma\\bin\\tectonic.exe');
    expect(st.message).toBe('内置 Tectonic 已就绪（缓存于应用数据目录）');
    expect(mod.getReadyBuiltinTectonicPath()).toBe('C:\\AppData\\Lemma\\bin\\tectonic.exe');
  });

  it('Rust 返回 cached:true（数据目录已有二进制）时原样透传', async () => {
    const mod = await freshTexSetup(async (cmd) =>
      cmd === 'download_and_install_tectonic'
        ? { path: '/Users/x/Library/Application Support/Lemma/bin/tectonic', cached: true, firstRunNote: true }
        : null,
    );
    const r = await mod.ensureBuiltinTectonic();
    expect(isBuiltinTectonicInfo(r)).toBe(true);
    if (isBuiltinTectonicInfo(r)) {
      expect(r.cached).toBe(true);
      expect(r.path).toContain('bin/tectonic');
    }
  });

  it('幂等：就绪后再次调用直接返回 cached:true，不再走桥', async () => {
    let count = 0;
    const mod = await freshTexSetup(async (cmd) => {
      if (cmd === 'download_and_install_tectonic') {
        count++;
        return { path: '/data/bin/tectonic', cached: false, firstRunNote: true };
      }
      return null;
    });
    await mod.ensureBuiltinTectonic();
    const second = await mod.ensureBuiltinTectonic();
    expect(count).toBe(1);
    expect(second).toMatchObject({ path: '/data/bin/tectonic', cached: true });
  });

  it('并发调用共享同一次在途请求（只触发一次命令）', async () => {
    let count = 0;
    const mod = await freshTexSetup(async (cmd) => {
      if (cmd === 'download_and_install_tectonic') {
        count++;
        return { path: '/data/bin/tectonic', cached: false, firstRunNote: true };
      }
      return null;
    });
    const [a, b] = await Promise.all([mod.ensureBuiltinTectonic(), mod.ensureBuiltinTectonic()]);
    expect(count).toBe(1);
    expect(a).toEqual(b);
  });

  it('下载期间 phase=downloading 且为不确定进度文案（约 30MB）', async () => {
    let resolve!: (v: unknown) => void;
    const mod = await freshTexSetup(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const pending = mod.ensureBuiltinTectonic();
    await Promise.resolve(); // 微任务排空：状态已切换、命令尚未返回
    expect(mod.getTexSetupState().phase).toBe('downloading');
    expect(mod.getTexSetupState().message).toBe('正在下载 Tectonic（约 30MB）…');
    resolve({ path: '/data/bin/tectonic', cached: false, firstRunNote: true });
    await pending;
    expect(mod.getTexSetupState().phase).toBe('ready');
  });

  it('命令失败：返回 { error }，状态机 error 且 message 带 i18n 前缀', async () => {
    const mod = await freshTexSetup(async () => {
      throw new Error('下载 Tectonic 失败：https://github.com/...: Dns Failed。请检查网络/代理；也可手动安装 Tectonic 或 TeX Live');
    });
    const r = await mod.ensureBuiltinTectonic();
    expect(isBuiltinTectonicInfo(r)).toBe(false);
    if (!isBuiltinTectonicInfo(r)) {
      expect(r.error).toContain('请检查网络/代理');
      expect(r.error).toContain('手动安装 Tectonic');
    }
    const st = mod.getTexSetupState();
    expect(st.phase).toBe('error');
    expect(st.message).toContain('内置 Tectonic 获取失败');
    expect(mod.getReadyBuiltinTectonicPath()).toBeNull();
  });
});
