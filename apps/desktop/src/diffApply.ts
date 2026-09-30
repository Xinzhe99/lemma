/**
 * Unified diff 应用器：把标准 unified diff（---/+++ 与 @@ hunk）应用到原文。
 * 严格校验上下文与删除行匹配，不匹配即整体失败（宁可不改，不可错改）。
 */

export type DiffApplyResult = { ok: true; text: string } | { ok: false; error: string };

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function applyUnifiedDiff(before: string, diff: string): DiffApplyResult {
  const srcLines = before.split('\n');
  const out = [...srcLines];
  const lines = diff.split('\n');

  let cursor = 0;
  // 跳过 ---/+++ 文件头与可能的 garbage，直达首个 hunk
  while (cursor < lines.length && !HUNK_RE.test(lines[cursor] ?? '')) {
    const line = lines[cursor] ?? '';
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.trim() === '') {
      cursor++;
    } else {
      return { ok: false, error: `diff 头部出现无法识别的行：${line}` };
    }
  }
  if (cursor >= lines.length) return { ok: false, error: 'diff 中没有 hunk（@@ 头）' };

  let offset = 0;
  while (cursor < lines.length) {
    const header = lines[cursor] ?? '';
    const m = HUNK_RE.exec(header);
    if (!m) return { ok: false, error: `无法解析的 hunk 头：${header}` };
    cursor++;

    const oldStart = Math.max(0, parseInt(m[1]!, 10) - 1);
    const oldChunk: string[] = [];
    const newChunk: string[] = [];

    while (cursor < lines.length) {
      const line = lines[cursor] ?? '';
      if (HUNK_RE.test(line)) break;
      cursor++;
      if (line === '') break; // hunk 末尾空行
      const tag = line[0];
      const rest = line.slice(1);
      if (tag === '\\') continue; // "\ No newline at end of file"
      if (tag === ' ') {
        oldChunk.push(rest);
        newChunk.push(rest);
      } else if (tag === '-') {
        oldChunk.push(rest);
      } else if (tag === '+') {
        newChunk.push(rest);
      } else {
        return { ok: false, error: `无法识别的 diff 行（应以 +/-/空格 开头）：${line}` };
      }
    }

    if (oldChunk.length === 0 && newChunk.length === 0) continue;

    const pos = oldStart + offset;
    for (let i = 0; i < oldChunk.length; i++) {
      if ((out[pos + i] ?? '') !== oldChunk[i]) {
        return {
          ok: false,
          error: `hunk 与文件内容不匹配（第 ${pos + i + 1} 行附近期望「${oldChunk[i]}」，实际「${out[pos + i] ?? '（不存在）'}」）`,
        };
      }
    }
    out.splice(pos, oldChunk.length, ...newChunk);
    offset += newChunk.length - oldChunk.length;
  }

  return { ok: true, text: out.join('\n') };
}
