/**
 * tabularData 纯函数测试。
 *  - parseCsv：RFC 4180 容错（引号内逗号/换行/转义引号、tab 探测、CRLF/CR/LF、
 *    末尾空行剔除、列数不齐补齐、BOM、空输入、未闭合引号容错）；
 *  - parseXlsx：用 fflate zipSync 在测试内构造最小 .xlsx fixture
 *    （sharedStrings + sheet1 两个 XML 打 zip），覆盖共享字符串索引/富文本拼接/
 *    内联字符串/数字原文/公式跳过/行列空洞补齐/缺 sharedStrings/坏文件/缺 sheet1。
 */
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseCsv, parseXlsx } from './tabularData';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('parseCsv：基础与 RFC 4180', () => {
  it('简单逗号分隔 + 末行无换行符也能收尾', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('引号内逗号不切分', () => {
    expect(parseCsv('"Smith, J",90\n"Lee, K",85')).toEqual([
      ['Smith, J', '90'],
      ['Lee, K', '85'],
    ]);
  });

  it('引号内换行归入字段值（跨物理行）', () => {
    expect(parseCsv('"line1\nline2",b\nc,d')).toEqual([
      ['line1\nline2', 'b'],
      ['c', 'd'],
    ]);
  });

  it('引号内 CRLF 归入字段值，行间 CRLF 只记一次换行', () => {
    expect(parseCsv('"a\r\nb",x\r\nc,d\r\n')).toEqual([
      ['a\r\nb', 'x'],
      ['c', 'd'],
    ]);
  });

  it('转义引号 "" 还原为单个引号', () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']]);
  });

  it('行注释不存在（CSV 无注释语义）：# 与空白按字面保留', () => {
    expect(parseCsv('#id, name\n 1 , 2')).toEqual([
      ['#id', ' name'],
      [' 1 ', ' 2'],
    ]);
  });
});

describe('parseCsv：分隔符与行结束符容错', () => {
  it('tab 探测：首行 tab 多于逗号 → 按 TSV 解析（窄行补空）', () => {
    expect(parseCsv('a\tb\tc\n1,2\t3')).toEqual([
      ['a', 'b', 'c'],
      ['1,2', '3', ''], // 引号外的逗号在 TSV 下不切分；列数补齐到最宽行
    ]);
  });

  it('逗号为主时不受个别 tab 干扰', () => {
    expect(parseCsv('a,b\nc,d\te')).toEqual([
      ['a', 'b'],
      ['c', 'd\te'],
    ]);
  });

  it('探测忽略引号内分隔符：引号内 tab 不触发 TSV，仍按逗号解析', () => {
    expect(parseCsv('"x\ty",b\n1,2')).toEqual([
      ['x\ty', 'b'],
      ['1', '2'],
    ]);
  });

  it('CR 与 LF 行结束符均可', () => {
    expect(parseCsv('a,b\rc,d\ne,f')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });
});

describe('parseCsv：网格归一', () => {
  it('跨行列数不齐补空到最宽行', () => {
    expect(parseCsv('a,b,c\n1\nx,y')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['x', 'y', ''],
    ]);
  });

  it('末尾空行剔除（含全空字段行与连续空行尾巴）', () => {
    expect(parseCsv('a,b\n1,2\n,\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('空输入 / 纯换行输入 → 空网格', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });

  it('UTF-8 BOM 剔除，不污染首字段', () => {
    expect(parseCsv('﻿a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('未闭合引号容错：换行按行结束处理（不吞掉剩余文件），引号内逗号保留', () => {
    expect(parseCsv('"unclosed,b\nc,d')).toEqual([
      ['unclosed,b', ''],
      ['c', 'd'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// XLSX（zipSync 构造最小 fixture）
// ---------------------------------------------------------------------------

/** 把 { 路径: xml } 打成 zip 的 .xlsx 字节（parseXlsx 只读这两个条目，容器条目齐全与否不影响） */
function buildXlsx(parts: Record<string, string>): ArrayBuffer {
  const zipped = zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const SHARED_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
<si><t>Method</t></si>
<si><r><rPr><b/></rPr><t>Rich</t></r><r><t> text</t></r></si>
<si><t>A &amp; B &lt;x&gt;</t></si>
<si><t xml:space="preserve">kept  </t></si>
<si><t>negative</t></si>
</sst>`;

const SHEET_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="n"><v>42</v></c><c r="C1"><v>3.14</v></c><c r="D1"><v>-1.5</v></c></row>
<row r="2"><c r="B2" t="s"><v>1</v></c><c r="C2"/><c r="D2" t="s"><v>3</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>Inline</t></is></c><c r="B4" t="str"><v>cached formula text</v></c></row>
<row r="5"><c r="A5"><f>B1+C1</f><v>45.14</v></c><c r="B5" t="b"><v>1</v></c></row>
</sheetData>
</worksheet>`;

/** 内容齐全的标准 fixture（sheet1 + sharedStrings） */
function fullXlsx(): ArrayBuffer {
  return buildXlsx({ 'xl/sharedStrings.xml': SHARED_XML, 'xl/worksheets/sheet1.xml': SHEET_XML });
}

describe('parseXlsx：单元格类型', () => {
  it('共享字符串索引 / 数字原文（t="n" 与缺省 t）', () => {
    const rows = parseXlsx(fullXlsx());
    expect(rows[0]).toEqual(['Method', '42', '3.14', '-1.5']);
  });

  it('富文本多个 <r><t> 拼接为一段；xml:space="preserve" 原样保留', () => {
    const row2 = parseXlsx(fullXlsx())[1]!;
    expect(row2[1]).toBe('Rich text');
    expect(row2[3]).toBe('kept  '); // shared[3]，尾随空格不丢
  });

  it('XML 实体解码（&amp; / &lt; / &gt;）', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c></row></sheetData></worksheet>`;
    expect(parseXlsx(buildXlsx({ 'xl/sharedStrings.xml': SHARED_XML, 'xl/worksheets/sheet1.xml': sheet }))[0]).toEqual([
      'A & B <x>',
    ]);
  });

  it('内联字符串 t="inlineStr" 与公式缓存值 t="str"', () => {
    expect(parseXlsx(fullXlsx())[3]).toEqual(['Inline', 'cached formula text', '', '']);
  });

  it('公式 <f> 跳过、取缓存 <v>；布尔 t="b" 输出 TRUE/FALSE', () => {
    expect(parseXlsx(fullXlsx())[4]).toEqual(['45.14', 'TRUE', '', '']);
  });

  it('数字输出原文，不做浮点重格式化', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1"><v>0.30000000000000004</v></c><c r="B1"><v>1E+2</v></c></row></sheetData></worksheet>`;
    expect(parseXlsx(buildXlsx({ 'xl/worksheets/sheet1.xml': sheet }))[0]).toEqual([
      '0.30000000000000004',
      '1E+2',
    ]);
  });
});

describe('parseXlsx：位置与空洞', () => {
  it('r 引用反推行列：行号跳跃补空行、列空洞补空串、自闭合单元格为空', () => {
    // fixture：r=2 的 B2 单独出现 → A2 空洞、C2 自闭合；r=3 缺失 → 补位空行
    const rows = parseXlsx(fullXlsx());
    expect(rows).toHaveLength(5); // 行 1..5
    expect(rows[1]).toEqual(['', 'Rich text', '', 'kept  ']);
    expect(rows[2]).toEqual(['', '', '', '']); // r=3 缺失 → 补位空行
  });

  it('多字母列引用（AA → 第 27 列）落位正确', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="AA1"><v>27</v></c></row></sheetData></worksheet>`;
    const row = parseXlsx(buildXlsx({ 'xl/worksheets/sheet1.xml': sheet }))[0]!;
    expect(row[0]).toBe('1');
    expect(row[26]).toBe('27');
    expect(row).toHaveLength(27);
  });

  it('末尾全空行剔除（含自闭合 row）+ 列数补齐到最宽行', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c></row><row r="3"/><row r="4"><c r="A4"/></row></worksheet>`;
    expect(parseXlsx(buildXlsx({ 'xl/worksheets/sheet1.xml': sheet }))).toEqual([
      ['1', '2'],
      ['3', ''], // 不齐行补空；其后两个全空行（无单元格/仅空单元格）剔除
    ]);
  });

  it('空工作表 → 空网格', () => {
    expect(parseXlsx(buildXlsx({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' }))).toEqual([]);
  });
});

describe('parseXlsx：错误路径', () => {
  it('非 zip 内容抛中文错误', () => {
    const bytes = new TextEncoder().encode('this is not a zip file');
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(() => parseXlsx(buf)).toThrow(/不是有效的 \.xlsx/);
  });

  it('zip 内缺 xl/worksheets/sheet1.xml 抛中文错误', () => {
    expect(() => parseXlsx(buildXlsx({ 'xl/sharedStrings.xml': SHARED_XML }))).toThrow(/sheet1/);
  });

  it('缺 sharedStrings.xml 但无 t="s" 单元格时仍可解析', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`;
    expect(parseXlsx(buildXlsx({ 'xl/worksheets/sheet1.xml': sheet }))).toEqual([['7']]);
  });

  it('t="s" 索引越界（缺 sharedStrings）回退为空串不抛错', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>99</v></c><c r="B1"><v>1</v></c></row></sheetData></worksheet>`;
    expect(parseXlsx(buildXlsx({ 'xl/worksheets/sheet1.xml': sheet }))).toEqual([['', '1']]);
  });
});
