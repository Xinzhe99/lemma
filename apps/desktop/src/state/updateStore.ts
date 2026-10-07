/**
 * 自动更新状态机（类 Codex 的无感三段体验）：
 *   闲时静默检查（启动后 8s，此后每 6h）→ 发现新版本立即后台下载 →
 *   「重启即完成」（用户点【立即重启】才 install + relaunch，绝不自动重启）。
 *
 * 平台边界：仅 Tauri 形态（getPlatform().kind === 'tauri'）启用；浏览器形态
 * 直接置 'unsupported'，UpdateBar 完全不渲染。plugin-updater 的 check 静态引入
 * （模块顶层仅函数定义，浏览器形态加载无副作用，调用被平台检查挡住）；relaunch /
 * 版本号 / 签名诊断桥经 ../updater/relaunch 薄封装（测试对两层分别 mock 整模块）。
 *
 * 失败策略：静默检查失败只记 error（silent=true，横幅不显示，不打扰）；
 * 手动 checkNow() 失败 silent=false，横幅按界面语言展示错误文案（update.error.*）。
 * 未配置签名公钥（集成者生成密钥前）经 updater_status 前置诊断给出精确归因。
 */

import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { getPlatform } from '../platform/types';
import { fetchUpdaterStatus, getAppVersion, relaunchApp, isMacOSPlatform } from '../updater/relaunch';

export type UpdatePhase =
  | 'unsupported' // 浏览器形态：不支持应用内更新
  | 'idle' // Tauri 形态，尚未检查
  | 'checking' // check() 进行中
  | 'up-to-date' // 已是最新
  | 'available' // 发现新版本（即将自动转 downloading）
  | 'downloading' // 后台下载中（progress 为百分比）
  | 'downloaded' // 已就绪，等待用户重启
  | 'error'; // 检查/下载/安装失败（是否展示由 silent 决定）

/** 启动后首次检查延迟：避开首屏争抢（闲时静默）。 */
export const UPDATE_STARTUP_DELAY_MS = 8_000;
/** 之后的重复检查间隔（6 小时）。 */
export const UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/**
 * v7.10 更新闭环：applyAndRestart 重启前登记「待更新完成」标记；重启后 App 首屏
 * 检测到即提示「已更新到 x.y.z，会话与项目状态已恢复」（状态由既有持久化恢复）。
 */
export const UPDATE_MARKER_KEY = 'lemma.pendingUpdate';

/** v7.5.0：失败原因稳定错误码（store 不存自然语言——渲染层按界面语言翻译） */
export type UpdateErrorCode =
  | 'browser' // 浏览器形态不支持应用内更新
  | 'notReady' // 更新尚未就绪就点了安装
  | 'installFailed' // 安装失败
  | 'signKeyMissing' // 签名公钥未配置（发布流程收尾前）
  | 'signVerify' // 更新包签名校验失败
  | 'network' // 网络请求失败
  | 'checkFailed'; // 其余检查失败（细节在 errorDetail）

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion?: string;
  newVersion?: string;
  /** 下载进度 0-100；总长未知时 undefined（UI 显示不定态文案）。 */
  progress?: number;
  /** 最近一次失败的稳定错误码（展示文案见 i18n update.error.*）。 */
  errorCode?: UpdateErrorCode;
  /** 面向开发者的原始错误细节（展示在主文案之后，可选）。 */
  errorDetail?: string;
  /** 最近一次检查是否静默（静默失败不显示错误横幅）。 */
  silent: boolean;
  /** 用户点了【稍后】：phase 不变（保持 downloaded/error）但横幅隐藏（本会话）。 */
  dismissed: boolean;
  /** macOS 下载完已自动 install（替换了 app bundle）：重启即生效，无需再点按钮（v2.2.0）。 */
  autoInstalled: boolean;
  /** App 首屏后调用一次：Tauri 形态启动 8s 延迟检查 + 6h 周期检查；浏览器置 unsupported。 */
  initUpdateCheck(): void;
  /** 手动检查（命令面板入口）：失败显示错误横幅。 */
  checkNow(): Promise<void>;
  /** 【立即重启】：安装并重启（macOS 已 autoInstalled 则仅 relaunch）。 */
  applyAndRestart(): Promise<void>;
  /** 【稍后】：本会话隐藏横幅。 */
  dismiss(): void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  phase: 'idle',
  silent: true,
  dismissed: false,
  autoInstalled: false,

  initUpdateCheck: () => {
    if (schedulerInited) return;
    schedulerInited = true;
    if (getPlatform().kind !== 'tauri') {
      set({ phase: 'unsupported' });
      return;
    }
    // 版本号展示用；失败（桥异常）不阻断更新流程
    void getAppVersion().then(
      (v) => useUpdateStore.getState().currentVersion === undefined && set({ currentVersion: v }),
      () => undefined,
    );
    startupTimer = setTimeout(() => void runCheck(true), UPDATE_STARTUP_DELAY_MS);
    recheckTimer = setInterval(() => void runCheck(true), UPDATE_RECHECK_INTERVAL_MS);
  },

  checkNow: async () => {
    if (getPlatform().kind !== 'tauri') {
      set({ phase: 'error', silent: false, dismissed: false, errorCode: 'browser' });
      return;
    }
    await runCheck(false);
  },

  applyAndRestart: async () => {
    const st = useUpdateStore.getState();
    if (st.phase !== 'downloaded' || !pending) {
      set({ phase: 'error', silent: false, dismissed: false, errorCode: 'notReady' });
      return;
    }
    // v7.10：重启前登记标记——新版本首屏据此提示「已更新 + 状态已恢复」
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          UPDATE_MARKER_KEY,
          JSON.stringify({ from: st.currentVersion ?? '', to: st.newVersion ?? '', at: Date.now() }),
        );
      }
    } catch {
      /* 标记写失败不影响更新本身 */
    }
    try {
      // macOS 且已 autoInstalled：bundle 已替换，只需 relaunch 进入新版本
      if (!st.autoInstalled) {
        // Windows：install 启动安装器（updater 模式静默安装并自动重启应用）后本进程
        // 即退出（relaunch 不可达）；macOS/Linux：install 返回后 relaunch 进入新版本。
        await pending.install();
      }
      await relaunchApp();
    } catch (err) {
      set({ phase: 'error', silent: false, dismissed: false, errorCode: 'installFailed', errorDetail: errMsg(err) });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));

// ---------------------------------------------------------------------------
// 模块级调度状态（不进 store：定时器句柄与待安装的 Update 资源引用）
// ---------------------------------------------------------------------------

let schedulerInited = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let recheckTimer: ReturnType<typeof setInterval> | null = null;
/** 已下载、等待用户重启的更新资源（install 持有 Rust 侧句柄）。 */
let pending: Update | null = null;

/** 检查 + 自动后台下载一条龙。silent 决定失败时横幅是否展示。 */
async function runCheck(silent: boolean): Promise<void> {
  const st = useUpdateStore.getState();
  if (st.phase === 'downloading') return; // 下载中不重入
  if (silent && st.phase === 'downloaded') return; // 已就绪待重启，无需再查
  useUpdateStore.setState({ phase: 'checking', errorCode: undefined, errorDetail: undefined, silent, dismissed: false });
  try {
    // 前置诊断：签名公钥未配置（发布流程收尾前）→ 精确中文提示，
    // 避免把晦涩的插件签名错误抛给用户。桥不可用（null）则继续走 check()。
    const status = await fetchUpdaterStatus();
    if (status && !status.configured) throw new Error('UPDATE_SIGNATURE_MISSING');
    const update = await check();
    if (!update) {
      pending = null;
      useUpdateStore.setState({ phase: 'up-to-date', newVersion: undefined, progress: undefined });
      return;
    }
    pending = update;
    useUpdateStore.setState({
      phase: 'available',
      newVersion: update.version,
      currentVersion: st.currentVersion ?? update.currentVersion,
      progress: undefined,
    });
    // 发现新版本：立即自动后台下载（不安装、不重启，进度回调写百分比）
    useUpdateStore.setState({ phase: 'downloading', progress: undefined });
    let totalBytes = 0;
    let contentLength = 0;
    await update.download((ev) => {
      if (ev.event === 'Started' && ev.data.contentLength) contentLength = ev.data.contentLength;
      else if (ev.event === 'Progress') {
        totalBytes += ev.data.chunkLength;
        if (contentLength > 0) {
          useUpdateStore.setState({ progress: Math.min(99, Math.floor((totalBytes / contentLength) * 100)) });
        }
      }
    });
    // Codex 体验（v2.2.0）：macOS 下载完立即 install（替换 app bundle，不杀进程）——
    // 用户正常退出重开即拿到新版本，无需点【立即重启】。横幅改为"已安装，重启即完成"。
    // Windows NSIS 的 install 会启动安装器并退出进程，不能自动调——保持手动确认。
    if (isMacOSPlatform()) {
      try {
        await update.install();
        useUpdateStore.setState({ phase: 'downloaded', progress: 100, dismissed: false, autoInstalled: true });
      } catch {
        // macOS 自动 install 失败：退回手动模式（用户点按钮时 install + relaunch）
        useUpdateStore.setState({ phase: 'downloaded', progress: 100, dismissed: false, autoInstalled: false });
      }
    } else {
      useUpdateStore.setState({ phase: 'downloaded', progress: 100, dismissed: false, autoInstalled: false });
    }
  } catch (err) {
    pending = null;
    const h = humanizeError(err);
    useUpdateStore.setState({ phase: 'error', errorCode: h.code, errorDetail: h.detail, silent });
  }
}

/** 错误归一化为稳定错误码（签名缺失/网络失败单独归因，原始信息进 detail）。 */
function humanizeError(err: unknown): { code: UpdateErrorCode; detail?: string } {
  if (err instanceof Error && err.message === 'UPDATE_SIGNATURE_MISSING') {
    return { code: 'signKeyMissing' };
  }
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  if (low.includes('pubkey') || low.includes('public key') || low.includes('signature')) {
    return { code: 'signVerify', detail: raw };
  }
  if (
    low.includes('network') ||
    low.includes('fetch') ||
    low.includes('timeout') ||
    low.includes('dns') ||
    low.includes('econnrefused') ||
    low.includes('reqwest')
  ) {
    return { code: 'network', detail: raw };
  }
  return { code: 'checkFailed', detail: raw };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** App 首屏后的独立入口（与 initLibrary/initWorkspace 同风格；幂等）。 */
export function initUpdateCheck(): void {
  useUpdateStore.getState().initUpdateCheck();
}

/** 测试专用：清空调度器（定时器/幂等标记/待安装引用），不重置 store 状态。 */
export function resetUpdateSchedulerForTests(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (recheckTimer) clearInterval(recheckTimer);
  startupTimer = null;
  recheckTimer = null;
  schedulerInited = false;
  pending = null;
}
