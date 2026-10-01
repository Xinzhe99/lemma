/**
 * 外部表格数据导入（表格编辑器的数据源层）：CSV/TSV 文本与 .xlsx 工作簿 → 字符串网格。
 *
 *  - parseCsv：RFC 4180 容错的手写解析器（引号包裹、字段内逗号/换行、"" 转义、
 *    CRLF/CR/LF、BOM、末尾空行剔除、跨行列数不齐补空）；分隔符在逗号/制表符间
 *    按首行出现次数自动探测（tab 多于逗号则按 TSV 解析）；
 *  - parseXlsx：最小 .xlsx 读取器（fflate unzipSync 解 zip 容器后只读
 *    xl/sharedStrings.xml 与 xl/worksheets/sheet1.xml 两个 XML）：
 *    t="s" 查共享字符串索引（含富文本 <r><t> 多段拼接）、t="inlineStr" 取内联
 *    <is><t>、t="str"/t="n"/无 t 取 <v> 原文（公式 <f> 一律跳过），
 *    单元格 r="A1" 引用反推行列位置、空洞补空串；非 zip 或缺 sheet1 抛中文错误。
 *
 * 全部为无副作用纯函数，可独立测试；与 tablegen.ts 的 gridToTabular 衔接
 * （string[][] → tabular 代码）。
 */

import { strFromU8, unzipSync } from 'fflate';

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

/** 探测分隔符：扫描首物理行（引号内不计），tab 数 > 逗号数 → TSV，否则按逗号 */
function detectDelimiter(text: string): string {
  let inQuotes = false;
  let tabs = 0;
  let commas = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text.charAt(i + 1) === '"') i++; // 引号内的 "" 转义整体跳过
      else inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (ch === '\n' || ch === '\r') break; // 引号未闭合：退回首行结尾即止
      continue;
    }
    if (ch === '\t') tabs++;
    else if (ch === ',') commas++;
    else if (ch === '\n' || ch === '\r') break;
  }
  return tabs > commas ? '\t' : ',';
}

/** 行列归一：跨行列数不齐补空串到最大列数；剔除末尾全空行 */
function normalizeGrid(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.every((c) => c === '')) end--;
  const kept = rows.slice(0, end);
  const cols = kept.reduce((m, r) => Math.max(m, r.length), 0);
  return kept.map((r) => (r.length < cols ? [...r, ...new Array<string>(cols - r.length).fill('')] : r));
}

/**
 * 解析 CSV/TSV 文本为字符串网格（RFC 4180 容错）：
 *  - 双引号包裹字段可含分隔符与换行；字段内 "" 转义为单个 "；
 *  - 行结束符 CRLF / CR / LF 均可，引号内换行归入字段值；
 *  - 未加引号的引号（如 12" 显示）按字面字符处理；
 *  - 开头 BOM 剔除；末尾连续空行剔除；跨行列数不齐补空串。
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // 剔除 U+FEFF BOM
  const delim = detectDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // 引号只在字段起点开启（容忍前面有空白）
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        // 引号内换行默认归入字段值；但若向后找不到闭合引号（未闭合容错），
        // 则按行结束处理，避免一行手误吞掉整个剩余文件
        if (!hasClosingQuoteAhead(src, i, delim)) {
          inQuotes = false;
          row.push(field);
          field = '';
          fieldStarted = false;
          rows.push(row);
          row = [];
          if (ch === '\r' && src.charAt(i + 1) === '\n') i++;
          i++;
          continue;
        }
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      fieldStarted = false;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src.charAt(i + 1) === '\n') i++; // CRLF 记一次换行
      row.push(field);
      field = '';
      fieldStarted = false;
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    fieldStarted = true;
    field += ch;
    i++;
  }
  // 末行无换行符收尾（或引号字段后直接结束）
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return normalizeGrid(rows);
}

/**
 * 未闭合引号容错：从 from 起向后找「有效闭合引号」（其后紧跟转义引号、
 * 分隔符、换行或文末才算闭合）。找不到 → 引号视为字面字符，换行按行结束处理。
 */
function hasClosingQuoteAhead(src: string, from: number, delim: string): boolean {
  for (let j = from + 1; j < src.length; j++) {
    if (src[j] !== '"') continue;
    const next = src.charAt(j + 1);
    if (next === '"' || next === delim || next === '\r' || next === '\n' || next === '') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// XLSX（最小读取器）
// ---------------------------------------------------------------------------

/** XML 实体解码：五种命名实体 + 十进制/十六进制数字字符引用 */
function decodeXmlEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (ent) => {
    switch (ent) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default: {
        const num = ent.startsWith('&#x') || ent.startsWith('&#X')
          ? Number.parseInt(ent.slice(3, -1), 16)
          : Number.parseInt(ent.slice(2, -1), 10);
        return Number.isFinite(num) ? String.fromCodePoint(num) : ent;
      }
    }
  });
}

/** 拼接一段 XML 内所有 <t>…</t> 的文本（富文本 <r><t>a</t></r><r><t>b</t></r> → ab） */
function concatTextRuns(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeXmlEntities(m[1] ?? '');
  }
  return out;
}

/** 列字母（A/B/…/AA）→ 0 起列号 */
function columnToIndex(letters: string): number {
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

/** 解析 xl/sharedStrings.xml：<si> 逐条（富文本多段 <t> 拼接） */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    out.push(concatTextRuns(m[1] ?? ''));
  }
  return out;
}

/** 解析 xl/worksheets/sheet1.xml 的 <sheetData>：<c r="A1" t="…"> 按引用落位，空洞补空 */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  // 兼容带体 <row …>…</row> 与自闭合 <row …/>（无单元格的空行）
  for (const rowM of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = rowM[1] ?? '';
    const body = rowM[2] ?? '';
    const rowNum = /(?:^|\s)r="(\d+)"/.exec(attrs);
    const rIdx = rowNum ? Number.parseInt(rowNum[1]!, 10) - 1 : rows.length;
    while (rows.length < rIdx) rows.push([]); // 行号跳跃：空行补位
    const cells: string[] = [];
    let fallbackCol = 0; // 无 r 属性的单元格按顺序落位
    for (const cM of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cAttrs = cM[1] ?? '';
      const cBody = cM[2] ?? '';
      const t = /(?:^|\s)t="([^"]+)"/.exec(cAttrs)?.[1];
      let value = '';
      if (t === 'inlineStr') {
        value = concatTextRuns(cBody); // <is><t>…</t></is>
      } else {
        // 公式单元格 <f>…</f> 跳过，只取缓存值 <v>…</v>
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cBody);
        if (v) {
          const raw = decodeXmlEntities(v[1] ?? '');
          if (t === 's') value = shared[Number.parseInt(raw, 10)] ?? '';
          else if (t === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else value = raw; // n / str / 无 t：原文输出
        }
      }
      const ref = /(?:^|\s)r="([A-Z]+)(\d+)"/.exec(cAttrs);
      if (ref) {
        const cIdx = columnToIndex(ref[1]!);
        while (cells.length < cIdx) cells.push(''); // 列空洞补位
        cells[cIdx] = value;
      } else {
        cells[fallbackCol] = value;
      }
      fallbackCol++;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * 读取 .xlsx（Office Open XML，zip 容器）第一个工作表为字符串网格。
 * 只解析 xl/sharedStrings.xml（可选）与 xl/worksheets/sheet1.xml：
 * 共享字符串（含富文本拼接）/ 内联字符串 / 数字原文均可读，公式取缓存值；
 * 单元格按 r 引用落位，行列空洞补空串，末尾全空行剔除，列数补齐到最宽行。
 * 非 zip 或缺 sheet1 时抛中文错误（可直接展示给用户）。
 */
export function parseXlsx(data: ArrayBuffer): string[][] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('无法解析该文件：不是有效的 .xlsx（Excel 工作簿）文件，请确认已保存为 .xlsx 格式');
  }
  const sheet = entries['xl/worksheets/sheet1.xml'];
  if (!sheet) {
    throw new Error('该 .xlsx 中未找到第一个工作表（xl/worksheets/sheet1.xml），请把目标工作表移到首位后重试');
  }
  const sharedBytes = entries['xl/sharedStrings.xml'];
  const shared = sharedBytes ? parseSharedStrings(strFromU8(sharedBytes)) : [];
  return normalizeGrid(parseSheet(strFromU8(sheet), shared));
}
