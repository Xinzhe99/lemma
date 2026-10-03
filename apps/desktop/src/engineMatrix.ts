/**
 * LaTeX 编译引擎全矩阵（v2.0.0）：检测全部主流引擎 + 用户偏好 + 自动下载兜底。
 *
 * 检测矩阵（按推荐优先级排序）：
 *  1. tectonic      — 内置下载友好（自动装 ~30MB），零配置
 *  2. lualatex      — TeX Live / MiKTeX 自带，对 Lua 扩展与 Unicode 原生支持
 *  3. xelatex       — TeX Live / MiKTeX 自带，对系统字体与 Unicode 原生支持
 *  4. pdflatex      — 最经典的 pdfTeX 引擎，兼容性最好
 *  5. latexmk       — Perl 编排器（自动多趟），底层调用 pdflatex/xelatex/lualatex
 *
 * 用户可通过 settingsStore.enginePreference 锁定引擎（'auto' 或任一引擎名）；
 * 锁定的引擎不可用时回落 auto 并在日志中说明。
 *
 * 自动下载：tectonic 为默认兜底（ensureBuiltinTectonic 已有）；其他引擎
 * 不可下载（TeX Live ~4GB），在日志中引导安装。
 */

export type EngineKind = 'tectonic' | 'lualatex' | 'xelatex' | 'pdflatex' | 'latexmk' | 'builtin-tectonic';

/** 引擎检测命令 */
export const ENGINE_PROBE_COMMANDS: readonly { kind: EngineKind; cmd: string }[] = [
  { kind: 'tectonic', cmd: 'tectonic' },
  { kind: 'lualatex', cmd: 'lualatex' },
  { kind: 'xelatex', cmd: 'xelatex' },
  { kind: 'pdflatex', cmd: 'pdflatex' },
  { kind: 'latexmk', cmd: 'latexmk' },
];

/** 引擎元数据（展示名 / 支持说明 / 引导安装命令） */
export const ENGINE_INFO: Readonly<Record<EngineKind, { label: string; note: string; installHint: string }>> = {
  tectonic: { label: 'Tectonic', note: '零配置 Rust 引擎，自动下载宏包', installHint: '自动下载（点击编译即触发）' },
  lualatex: { label: 'LuaLaTeX', note: 'Lua 扩展引擎，Unicode 原生支持', installHint: 'TeX Live / MiKTeX 安装时勾选 lualatex' },
  xelatex: { label: 'XeLaTeX', note: '系统字体引擎，Unicode 原生支持', installHint: 'TeX Live / MiKTeX 安装时勾选 xelatex' },
  pdflatex: { label: 'pdfLaTeX', note: '经典引擎，兼容性最好', installHint: 'TeX Live / MiKTeX 默认包含' },
  latexmk: { label: 'latexmk', note: '自动多趟编排器，处理交叉引用', installHint: 'TeX Live / MiKTeX 安装时勾选 latexmk' },
  'builtin-tectonic': { label: 'tectonic（内置）', note: '应用自动下载的 Tectonic', installHint: '自动下载（点击编译即触发）' },
};

/** 引擎编译命令参数（entry 为 .tex 入口文件） */
export function engineArgs(kind: EngineKind, entry: string): string[] {
  switch (kind) {
    case 'tectonic':
    case 'builtin-tectonic':
      return ['-X', 'compile', entry, '--synctex'];
    case 'lualatex':
      return ['--synctex=1', '--interaction=nonstopmode', entry];
    case 'xelatex':
      return ['--synctex=1', '--interaction=nonstopmode', entry];
    case 'pdflatex':
      return ['--synctex=1', '--interaction=nonstopmode', entry];
    case 'latexmk':
      return ['-pdf', '-interaction=nonstopmode', '-synctex=1', entry];
  }
}

/** 多趟需要：引擎是否需要多次调用（latexmk 内部自动处理；tectonic 自动） */
export function engineNeedsMultiplePasses(kind: EngineKind): boolean {
  return kind === 'lualatex' || kind === 'xelatex' || kind === 'pdflatex';
}

/**
 * 从探测结果矩阵选择引擎：
 *  1. 用户偏好锁定 → 若可用直接选；不可用回落 auto
 *  2. auto：按推荐优先级（tectonic > lualatex > xelatex > pdflatex > latexmk > builtin）
 */
export function selectEngine(
  probes: Partial<Record<EngineKind, { ok: boolean }>>,
  preference: 'auto' | EngineKind,
  builtinReady: boolean,
): { kind: EngineKind; fellBack: boolean } | null {
  const available = new Set<EngineKind>();
  for (const { kind } of ENGINE_PROBE_COMMANDS) {
    if (probes[kind]?.ok) available.add(kind);
  }
  if (builtinReady) available.add('builtin-tectonic');

  // 用户偏好
  if (preference !== 'auto' && available.has(preference)) {
    return { kind: preference, fellBack: false };
  }
  const fellBack = preference !== 'auto';

  // auto：优先级序
  const order: EngineKind[] = ['tectonic', 'lualatex', 'xelatex', 'pdflatex', 'latexmk', 'builtin-tectonic'];
  for (const k of order) {
    if (available.has(k)) return { kind: k, fellBack };
  }
  return fellBack ? null : null;
}
