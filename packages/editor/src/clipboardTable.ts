/**
 * 剪贴板数据 → LaTeX tabular（v3.1.0 ①）：
 * 从 Excel / Google Sheets / Numbers 复制的表格数据（TSV 或 CSV），
 * 一键转为 LaTeX tabular 代码。
 */

/** 检测分隔符并解析为二维数组 */
export function parseClipboardTable(text: string): string[][] | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const first = lines[0] ?? '';
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;

  let sep: string;
  if (tabs >= 1) sep = '\t';
  else if (commas >= 1) sep = ',';
  else if (semis >= 1) sep = ';';
  else return null;

  const rows: string[][] = [];
  for (const line of lines) {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    if (cells.length > 1) rows.push(cells);
  }
  if (rows.length < 2) return null;

  const maxCols = Math.max(...rows.map((r) => r.length));
  for (const r of rows) {
    while (r.length < maxCols) r.push('');
  }

  return rows;
}

/** LaTeX 特殊字符转义 */
function texEscape(s: string): string {
  return s.replace(/([&%#_])/g, '\\$1');
}

/** 生成 LaTeX tabular 代码 */
export function toLatexTabular(rows: string[][], options?: { caption?: string; label?: string }): string {
  if (rows.length === 0) return '';
  const cols = rows[0]!.length;
  const align = 'c'.repeat(cols);
  const [header, ...data] = rows;

  const lines: string[] = [];
  lines.push('\\begin{table}[htbp]');
  lines.push('  \\centering');
  if (options?.caption) lines.push(`  \\caption{${texEscape(options.caption)}}`);
  if (options?.label) lines.push(`  \\label{${options.label}}`);
  lines.push('  \\begin{tabular}{' + align + '}');
  lines.push('    \\toprule');
  lines.push('    ' + header!.map((c) => `\\textbf{${texEscape(c)}}`).join(' & ') + ' \\\\');
  lines.push('    \\midrule');
  for (const row of data) {
    lines.push('    ' + row.map(texEscape).join(' & ') + ' \\\\');
  }
  lines.push('    \\bottomrule');
  lines.push('  \\end{tabular}');
  lines.push('\\end{table}');

  return lines.join('\n');
}

/** 从剪贴板文本直接生成 LaTeX 表格 */
export function clipboardToTable(text: string, options?: { caption?: string; label?: string }): string | null {
  const rows = parseClipboardTable(text);
  if (!rows) return null;
  return toLatexTabular(rows, options);
}
