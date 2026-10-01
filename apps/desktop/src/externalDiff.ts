/**
 * 外部版本对比（导师改稿 vs 当前工作区）的匹配纯函数：
 * 导师发回的 .tex 常与工作区路径不完全一致（去掉/加了目录前缀、改了大小写、
 * 连字符风格不同），matchExternalFiles 按三级策略做一对一匹配并给出三态清单：
 * 1. 同名精确：外部路径 === 本地路径；
 * 2. basename：文件名（去目录）相等——导师可能只发回平铺文件；
 * 3. 归一化：小写 + 去连字符后比对全路径与 basename（My-File.tex ↔ my_file 风格差异）。
 * 逐级贪婪匹配（先到先得），保证确定性；未匹配的外部文件为 only-external（可新增），
 * 未被对比的本地文件为 only-local（仅供展示）。
 */

export type ExternalMatchStatus = 'matched' | 'only-external' | 'only-local';

export interface ExternalMatch {
  /** matched / only-local = 工作区路径；only-external = 外部文件名 */
  file: string;
  status: ExternalMatchStatus;
  /** matched 时对应的外部文件键（取外部内容用） */
  external?: string;
}

/** 路径的文件名部分（同时容忍 / 与 \ 分隔） */
export function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** 归一化：小写 + 去连字符与空白（用于第三级模糊比对） */
export function normalizeFileName(path: string): string {
  return path.toLowerCase().replace(/[-\s]/g, '');
}

/**
 * 三级策略匹配外部文件与工作区文件（纯函数）：
 * 返回 matched（按本地插入序）→ only-external（按外部插入序）→ only-local（按本地插入序），
 * matched 项额外携带 external 键。
 */
export function matchExternalFiles(
  external: Record<string, string>,
  local: Record<string, string>,
): ExternalMatch[] {
  const localPaths = Object.keys(local);
  const externalKeys = Object.keys(external);

  /** localPath -> externalKey 的匹配结果（一对一） */
  const matched = new Map<string, string>();
  const usedExternal = new Set<string>();

  const tryTier = (equal: (localPath: string, externalKey: string) => boolean): void => {
    for (const lp of localPaths) {
      if (matched.has(lp)) continue;
      for (const ek of externalKeys) {
        if (usedExternal.has(ek)) continue;
        if (equal(lp, ek)) {
          matched.set(lp, ek);
          usedExternal.add(ek);
          break;
        }
      }
    }
  };

  // 1) 同名精确
  tryTier((lp, ek) => lp === ek);
  // 2) basename 相等
  tryTier((lp, ek) => basenameOf(lp) === basenameOf(ek));
  // 3) 归一化（小写、去连字符）：先全路径，再 basename
  tryTier((lp, ek) => normalizeFileName(lp) === normalizeFileName(ek));
  tryTier((lp, ek) => normalizeFileName(basenameOf(lp)) === normalizeFileName(basenameOf(ek)));

  const result: ExternalMatch[] = localPaths
    .filter((lp) => matched.has(lp))
    .map((lp) => ({ file: lp, status: 'matched' as const, external: matched.get(lp)! }));
  for (const ek of externalKeys) {
    if (!usedExternal.has(ek)) result.push({ file: ek, status: 'only-external' as const });
  }
  for (const lp of localPaths) {
    if (!matched.has(lp)) result.push({ file: lp, status: 'only-local' as const });
  }
  return result;
}
