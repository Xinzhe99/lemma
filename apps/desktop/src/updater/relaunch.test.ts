// @vitest-environment jsdom
/**
 * updater/relaunch 薄封装测试：
 *  - relaunchApp / getAppVersion 动态转发到 plugin-process / @tauri-apps/api（整模块 mock），
 *    插件拒绝时原样抛出（由 updateStore 捕获转中文提示）；
 *  - fetchUpdaterStatus：__TAURI__.core.invoke 桥转发 updater_status；无桥 / 命令失败 → null。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { fetchUpdaterStatus, getAppVersion, relaunchApp } from './relaunch';

const mockedRelaunch = vi.mocked(relaunch);
const mockedGetVersion = vi.mocked(getVersion);

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
}

beforeEach(() => {
  mockedRelaunch.mockReset();
  mockedGetVersion.mockReset();
  delete (window as unknown as TauriGlobal).__TAURI__;
});

afterEach(() => {
  delete (window as unknown as TauriGlobal).__TAURI__;
});

describe('relaunch.ts · 插件转发', () => {
  it('relaunchApp 转发到 plugin-process 的 relaunch', async () => {
    mockedRelaunch.mockResolvedValue(undefined);
    await relaunchApp();
    expect(mockedRelaunch).toHaveBeenCalledTimes(1);
  });

  it('插件 relaunch 拒绝时原样抛错（上层负责转中文提示）', async () => {
    mockedRelaunch.mockRejectedValue(new Error('restart denied'));
    await expect(relaunchApp()).rejects.toThrow('restart denied');
  });

  it('getAppVersion 转发 @tauri-apps/api 的 getVersion；失败同样向上抛', async () => {
    mockedGetVersion.mockResolvedValue('0.9.0');
    await expect(getAppVersion()).resolves.toBe('0.9.0');
    mockedGetVersion.mockRejectedValue(new Error('not in tauri'));
    await expect(getAppVersion()).rejects.toThrow('not in tauri');
  });
});

describe('relaunch.ts · updater_status 诊断桥', () => {
  it('有 __TAURI__ 桥：以 updater_status 命令名转发并返回结果', async () => {
    const invoke = vi.fn(async () => ({ configured: false })) as unknown as <
      T,
    >(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    (window as unknown as TauriGlobal).__TAURI__ = { core: { invoke } };
    await expect(fetchUpdaterStatus()).resolves.toEqual({ configured: false });
    expect(invoke).toHaveBeenCalledWith('updater_status', undefined);
  });

  it('无桥（浏览器/测试环境）：返回 null 而非抛错', async () => {
    await expect(fetchUpdaterStatus()).resolves.toBeNull();
  });

  it('桥命令失败：返回 null（调用方继续走 check() 兜底）', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('command not registered');
    }) as unknown as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    (window as unknown as TauriGlobal).__TAURI__ = { core: { invoke } };
    await expect(fetchUpdaterStatus()).resolves.toBeNull();
  });
});
