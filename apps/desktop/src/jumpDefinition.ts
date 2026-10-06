/**
 * Ctrl+点击跳转定义（v7.3.0）：
 * - \cite{key} / \citep{key} → 跳到 .bib 文件中 `@…{key,` 所在行
 * - \ref{label} / \eqref{label} → 跳到任意 .tex 文件中 `\label{label}` 所在行
 * 纯函数层（解析+查找），供 CodeMirror 扩展层调用；测试友好。
 */

export interface JumpTargetResult {
  file: string;
  line: number; // 1-based
}

/** 从点击位置提取 \cite/\ref 的键；不是 cite/ref 上下文返回 null */
export function extractKeyAtPosition(
  lineText: string,
  clickCol: number, // 0-based 点击列
): { kind: 'cite' | 'ref'; key: string } | null {
  // 找到所有 \cite*/\ref*/\eqref 命令及其花括号参数
  const cmdRegex = /\\(cite[pt]?\*?|ref\*?|eqref|autoref|cref)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;
  for (const m of lineText.matchAll(cmdRegex)) {
    const start = m.index!;
    const end = start + m[0].length;
    // 点击必须落在命令范围内
    if (clickCol < start || clickCol >= end) continue;
    const cmd = m[1]!;
    const args = m[2] ?? '';
    // cite 可能多个 key（\cite{a,b,c}）：定位点击落在哪个 key
    if (cmd.startsWith('cite')) {
      const keys = args.split(',').map((k) => k.trim()).filter(Boolean);
      if (keys.length === 1) return { kind: 'cite', key: keys[0]! };
      // 多 key：计算每个 key 在原始文本中的位置
      let offset = m[0].indexOf('{') + 1; // 花括号内容起始
      for (const raw of args.split(',')) {
        const key = raw.trim();
        const keyStart = offset + raw.indexOf(key);
        const keyEnd = keyStart + key.length;
        if (clickCol >= keyStart && clickCol <= keyEnd && key) {
          return { kind: 'cite', key };
        }
        offset += raw.length + 1; // +1 for comma
      }
      return keys.length > 0 ? { kind: 'cite', key: keys[0]! } : null;
    }
    // ref 类：单 key
    const key = args.trim();
    return key ? { kind: 'ref', key } : null;
  }
  return null;
}

/** 在 bib 文件中查找 `@…{key,` 所在行（1-based）；未找到返回 null */
export function findBibEntryLine(bibContent: string, citekey: string): number | null {
  const lines = bibContent.split('\n');
  const pattern = new RegExp(`@\\w+\\{\\s*${escapeRegex(citekey)}\\s*,`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return i + 1;
  }
  return null;
}

/** 在 tex 文件中查找 `\label{label}` 所在行（1-based）；未找到返回 null */
export function findLabelLine(texContent: string, label: string): number | null {
  const pattern = new RegExp(`\\\\label\\s*\\{\\s*${escapeRegex(label)}\\s*\\}`);
  const lines = texContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return i + 1;
  }
  return null;
}

/** 跨全部文件查找引用键的定义位置 */
export function resolveJumpTarget(
  files: Record<string, string>,
  kind: 'cite' | 'ref',
  key: string,
): JumpTargetResult | null {
  if (kind === 'cite') {
    // 优先在 .bib 文件中找
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith('.bib')) continue;
      const line = findBibEntryLine(content, key);
      if (line !== null) return { file: path, line };
    }
    return null;
  }
  // ref：在所有 .tex 文件中找 \label
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.tex')) continue;
    const line = findLabelLine(content, key);
    if (line !== null) return { file: path, line };
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
