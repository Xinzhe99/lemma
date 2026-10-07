/**
 * updateStore 单元测试（不真实联网、不触 Tauri）：
 *  - 整模块 mock '@tauri-apps/plugin-updater'（check）与 '../updater/relaunch'
 *    （relaunchApp / getAppVersion / fetchUpdaterStatus）、'../platform/types'（getPlatform）；
 *  - 浏览器形态 unsupported（不启动定时器）；
 *  - 启动 8s 延迟检查（fake timers：7999ms 未查 / +1ms 查）与 6h 周期重复、init 幂等；
 *  - 状态机转换：null → up-to-date；有更新 → available → downloading → downloaded，
 *    下载进度百分比（contentLength 已知 / 未知）；
 *  - 失败语义：静默 check 失败 silent=true 记中文错误，手动 checkNow 失败 silent=false，
 *    浏览器形态手动检查给中文提示；未配置签名（updater_status 前置诊断）精确中文错误；
 *  - dismiss：phase 保持 downloaded 但 dismissed=true；
 *  - applyAndRestart：install + relaunchApp；install 失败中文错误；未就绪调用被拒。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/types', () => ({ getPlatform: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('../updater/relaunch', () => ({
  relaunchApp: vi.fn(),
  getAppVersion: vi.fn(),
  fetchUpdaterStatus: vi.fn(),
  isMacOSPlatform: vi.fn(() => false), // 测试默认 Windows 路径（不自动 install）
}));

import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import {
  UPDATE_RECHECK_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  resetUpdateSchedulerForTests,
  useUpdateStore,
  type UpdatePhase,
} from './updateStore';
import { getPlatform } from '../platform/types';
import { fetchUpdaterStatus, getAppVersion, relaunchApp } from '../updater/relaunch';

const mockedCheck = vi.mocked(check);
const mockedGetPlatform = vi.mocked(getPlatform);
const mockedRelaunch = vi.mocked(relaunchApp);
const mockedGetVersion = vi.mocked(getAppVersion);
const mockedStatus = vi.mocked(fetchUpdaterStatus);

const browserPlatform = { kind: 'browser' } as unknown as ReturnType<typeof getPlatform>;
const tauriPlatform = { kind: 'tauri' } as unknown as ReturnType<typeof getPlatform>;

/** 构造假的 plugin-updater Update（download 以 200 字节总长、180 字节两个分块回放）。 */
function fakeUpdate(version = '1.2.3', opts?: { contentLength?: number | null }) {
  const contentLength = opts?.contentLength === undefined ? 200 : opts.contentLength;
  const install = vi.fn(async () => undefined);
  const download = vi.fn(async (onEvent?: (ev: never) => void) => {
    const cb = onEvent as ((ev: { event: string; data?: unknown }) => void) | undefined;
    if (contentLength) cb?.({ event: 'Started', data: { contentLength } });
    cb?.({ event: 'Progress', data: { chunkLength: 100 } });
    cb?.({ event: 'Progress', data: { chunkLength: 80 } });
    cb?.({ event: 'Finished' });
  });
  return { currentVersion: '0.9.0', version, download, install } as unknown as Update & {
    install: ReturnType<typeof vi.fn>;
  };
}

/** 排空异步链（runCheck 内多次 await：诊断桥 / check / download 回放）。 */
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function resetStore(): void {
  useUpdateStore.setState({
    phase: 'idle',
    currentVersion: undefined,
    newVersion: undefined,
    progress: undefined,
    errorCode: undefined,
    errorDetail: undefined,
    silent: true,
    dismissed: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks(); // 清累计调用（实现/返回值在下方统一重设）
  resetUpdateSchedulerForTests();
  resetStore();
  mockedGetPlatform.mockReturnValue(tauriPlatform);
  mockedGetVersion.mockResolvedValue('0.9.0');
  mockedStatus.mockResolvedValue({ configured: true });
  mockedRelaunch.mockResolvedValue(undefined);
  mockedCheck.mockResolvedValue(null);
});

afterEach(() => {
  resetUpdateSchedulerForTests();
  vi.useRealTimers();
});

describe('updateStore · 平台形态与调度', () => {
  it('浏览器形态：initUpdateCheck 直接置 unsupported，且 8s 后仍不调用 check', async () => {
    mockedGetPlatform.mockReturnValue(browserPlatform);
    useUpdateStore.getState().initUpdateCheck();
    expect(useUpdateStore.getState().phase).toBe('unsupported');

    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS + 1000);
    await flush();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('Tauri 形态：启动后延迟 8s 才首次检查（7999ms 未查，+1ms 触发），并回填当前版本号', async () => {
    mockedCheck.mockResolvedValue(fakeUpdate());
    useUpdateStore.getState().initUpdateCheck();

    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS - 1);
    expect(mockedCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('downloaded');
    expect(s.currentVersion).toBe('0.9.0');
  });

  it('此后每 6h 重复静默检查（up-to-date 后 6h 触发第二次 check）', async () => {
    mockedCheck.mockResolvedValue(null);
    useUpdateStore.getState().initUpdateCheck();

    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS);
    await flush();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().phase).toBe('up-to-date');

    await vi.advanceTimersByTimeAsync(UPDATE_RECHECK_INTERVAL_MS);
    await flush();
    expect(mockedCheck).toHaveBeenCalledTimes(2);
    expect(useUpdateStore.getState().phase).toBe('up-to-date');
    expect(useUpdateStore.getState().silent).toBe(true);
  });

  it('initUpdateCheck 幂等：重复调用不叠加定时器（8s 后 check 仍只一次）', async () => {
    mockedCheck.mockResolvedValue(null);
    useUpdateStore.getState().initUpdateCheck();
    useUpdateStore.getState().initUpdateCheck();

    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS);
    await flush();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });

  it('已 downloaded（待重启）时跳过 6h 静默重查，避免重复下载', async () => {
    mockedCheck.mockResolvedValue(fakeUpdate());
    useUpdateStore.getState().initUpdateCheck();
    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS);
    await flush();
    expect(useUpdateStore.getState().phase).toBe('downloaded');

    await vi.advanceTimersByTimeAsync(UPDATE_RECHECK_INTERVAL_MS);
    await flush();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });
});

describe('updateStore · 状态机与下载进度', () => {
  it('check 返回 null → up-to-date，无新版本号', async () => {
    mockedCheck.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('up-to-date');
    expect(s.newVersion).toBeUndefined();
  });

  it('发现新版本 → available → 自动后台下载 → downloading → downloaded，进度按字节推进到 100', async () => {
    const update = fakeUpdate('1.2.3');
    mockedCheck.mockResolvedValue(update);
    const seen: { phase: UpdatePhase; progress?: number }[] = [];
    const unsub = useUpdateStore.subscribe((s) => seen.push({ phase: s.phase, progress: s.progress }));

    await useUpdateStore.getState().checkNow();

    unsub();
    const phases = seen.map((x) => x.phase);
    expect(phases).toEqual(expect.arrayContaining(['checking', 'available', 'downloading', 'downloaded']));
    // 180/200 字节 → 90%（未完成封顶 99）
    expect(seen.find((x) => x.phase === 'downloading' && x.progress === 90)).toBeTruthy();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('downloaded');
    expect(s.newVersion).toBe('1.2.3');
    expect(s.progress).toBe(100);
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).not.toHaveBeenCalled(); // 下载完成不自动安装
  });

  it('总长未知（contentLength 缺失）→ 下载中不显示百分比，完成仍置 100', async () => {
    mockedCheck.mockResolvedValue(fakeUpdate('1.2.3', { contentLength: null }));
    const seen: { phase: UpdatePhase; progress?: number }[] = [];
    const unsub = useUpdateStore.subscribe((s) => seen.push({ phase: s.phase, progress: s.progress }));

    await useUpdateStore.getState().checkNow();

    unsub();
    expect(seen.filter((x) => x.phase === 'downloading' && x.progress !== undefined)).toHaveLength(0);
    expect(useUpdateStore.getState().progress).toBe(100);
  });
});

describe('updateStore · 失败语义（静默 vs 手动）', () => {
  it('静默检查失败：phase=error 且 silent=true（UI 不展示），归因为稳定错误码', async () => {
    mockedCheck.mockRejectedValue(new Error('network request failed'));
    // 直接驱动静默路径：init 后走到 8s 定时器
    useUpdateStore.getState().initUpdateCheck();
    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS);
    await flush();

    const s = useUpdateStore.getState();
    expect(s.phase).toBe('error');
    expect(s.silent).toBe(true);
    expect(s.errorCode).toBe('network');
  });

  it('手动 checkNow 失败：silent=false（UI 展示错误横幅）', async () => {
    mockedCheck.mockRejectedValue(new Error('boom'));
    await useUpdateStore.getState().checkNow();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('error');
    expect(s.silent).toBe(false);
    expect(s.errorCode).toBe('checkFailed');
  });

  it('浏览器形态手动检查：归因 browser，不触达 check', async () => {
    mockedGetPlatform.mockReturnValue(browserPlatform);
    await useUpdateStore.getState().checkNow();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('error');
    expect(s.errorCode).toBe('browser');
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('未配置签名公钥（updater_status 前置诊断）：精确归因 signKeyMissing 且不发起 check', async () => {
    mockedStatus.mockResolvedValue({ configured: false });
    await useUpdateStore.getState().checkNow();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('error');
    expect(s.errorCode).toBe('signKeyMissing');
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('签名相关插件错误（诊断桥不可用）也归因为 signVerify', async () => {
    mockedStatus.mockResolvedValue(null);
    mockedCheck.mockRejectedValue(new Error('signature verification failed'));
    await useUpdateStore.getState().checkNow();
    expect(useUpdateStore.getState().errorCode).toBe('signVerify');
  });
});

describe('updateStore · dismiss 与重启安装', () => {
  it('dismiss：phase 保持 downloaded 但 dismissed=true（本次会话隐藏横幅）', async () => {
    mockedCheck.mockResolvedValue(fakeUpdate());
    await useUpdateStore.getState().checkNow();
    expect(useUpdateStore.getState().phase).toBe('downloaded');

    useUpdateStore.getState().dismiss();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('downloaded');
    expect(s.dismissed).toBe(true);
  });

  it('applyAndRestart：install 已下载的更新后 relaunch（install+relaunch 均被调）', async () => {
    const update = fakeUpdate('1.2.3');
    mockedCheck.mockResolvedValue(update);
    await useUpdateStore.getState().checkNow();

    await useUpdateStore.getState().applyAndRestart();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(mockedRelaunch).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().phase).toBe('downloaded');
  });

  it('applyAndRestart 失败：installFailed 且 silent=false', async () => {
    const update = fakeUpdate('1.2.3');
    (update.install as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('installer exited'));
    mockedCheck.mockResolvedValue(update);
    await useUpdateStore.getState().checkNow();

    await useUpdateStore.getState().applyAndRestart();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('error');
    expect(s.silent).toBe(false);
    expect(s.errorCode).toBe('installFailed');
    expect(mockedRelaunch).not.toHaveBeenCalled();
  });

  it('未就绪（idle / 无待装更新）调用 applyAndRestart 被拒并归因 notReady', async () => {
    await useUpdateStore.getState().applyAndRestart();
    const s = useUpdateStore.getState();
    expect(s.phase).toBe('error');
    expect(s.errorCode).toBe('notReady');
  });
});
