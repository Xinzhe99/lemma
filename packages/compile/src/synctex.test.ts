import { readFileSync } from 'node:fs';
import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SP_PER_PDF_PT, lineLocation, parseSynctex, sourceLocation, spToPdfPt } from './synctex';

/**
 * 三组数据：
 * 1) 真实编译产物 fixtures/main.synctex.gz（TeX Live 2024 latexmk 编译 fixtures/main.tex，
 *    main.tex 第 4 行 \section{First}、第 9-11 行 equation）——真实回归测试；
 * 2) 手写「真实格式风格」fixture——多页 / 多文件 / gzip 覆盖；
 * 3) 旧自造子集文本（compileAction.tauri.test 同款语法）——兼容性覆盖。
 *
 * 单位校准依据（pdfjs 对 fixtures/main.pdf 第 1 页实测，viewport pt、原点左上、y 向下；
 * 页面为 A4 595.276×841.89pt）：
 *   "First" 标题基线 y=134.8，节号 "1" x=133.8      ↔ synctex (1,4:8799518,8865054
 *   正文第一段基线 y=156.6                            ↔ (1,7:8799518,10300473
 *   第二段基线 y=211.4                                ↔ (1,9:8799518,13903128
 *   方程基线 y=223.3、"E" x=286.3                     ↔ (1,11:18830283,14689560
 *   页脚页码 y=702.6、x=303.1                         ↔ (1,13:8799518,46220574 / k1,13:19940638
 * 全部与 spToPdfPt(v) = v/65781.76 吻合（65781.76 = 65536×72.27/72）。
 */

// —— 1) 真实编译产物 ——
const realBytes = new Uint8Array(readFileSync(new URL('./fixtures/main.synctex.gz', import.meta.url)));
const real = parseSynctex(realBytes);

// —— 2) 手写真实格式 fixture：两页、两个输入文件、Content 内再出现 Input、Postamble ——
const FIXTURE = [
  'SyncTeX Version:1',
  'Input:1:./main.tex',
  'Input:2:./sections/intro.tex',
  'Output:pdf',
  'Magnification:1000',
  'Unit:1',
  'X Offset:0',
  'Y Offset:0',
  'Content:',
  '!80',
  '{1',
  '[1,20:4736286,46220580:26673152,41484280,0',
  '(1,12:4736286,45600000:4000000,400000,100000',
  'g1,12:4736286,45600000',
  'x1,12:6000000,45600000',
  ')',
  '(2,40:4736286,44000000:3600000,300000,0',
  'x2,40:5000000,44000000',
  'g2,41:6000000,44000000',
  ')',
  ']',
  '!160',
  '{2',
  '[2,60:4736286,46220580:26673152,41484280,0',
  '(2,55:4736286,45600000:4200000,600000,0',
  'v2,55:4736286,45600000:4200000,600000,0',
  'x2,55:6000000,45600000',
  ')',
  '(2,70:4736286,44000000:1000000,200000,0',
  '(2,70:4736286,44000000:1000000,200000,0',
  'x2,70:5000000,44000000',
  ')',
  ')',
  ']',
  '}2',
  'Input:3:./main.aux',
  'Postamble:',
  'Count:30',
  'Post scriptum:',
].join('\n');

const textIndex = parseSynctex(new TextEncoder().encode(FIXTURE));
const gzipIndex = parseSynctex(gzipSync(new TextEncoder().encode(FIXTURE)));

// —— 3) 旧自造子集（{页号} / {tag,line} 锚点 / x:,y:,w:,h: 块）——
const LEGACY = [
  'SyncTeX Version:1',
  'Input:1:./main.tex',
  'Content:',
  '{1}',
  '{1,12}',
  'h,x:1000,y:8000,w:4000,h:400',
  '{1,30}',
  'x:1000,y:2000,w:4000,h:400',
].join('\n');
const legacyIndex = parseSynctex(new TextEncoder().encode(LEGACY));

// A4 页面（真实 fixture 的 PDF viewport 实测）
const PAGE_W = 595.276;
const PAGE_H = 841.89;

describe('parseSynctex：真实 fixture 解析', () => {
  it('头部字段齐全：版本 / 输入映射 / 放大 / 单位 / 页数', () => {
    expect(real.version).toBe(1);
    expect(real.magnification).toBe(1000);
    expect(real.unit).toBe(1);
    expect(real.pages).toBe(1);
    // 头部 10 条（含 article.cls 等系统文件）+ Content 内 1 条 main.aux
    expect(real.inputs).toHaveLength(11);
    expect(real.inputs[0]).toMatchObject({ tag: 1 });
    expect(real.inputs[0].path.endsWith('main.tex')).toBe(true);
    expect(real.inputs.some((i) => i.path.endsWith('article.cls'))).toBe(true);
  });

  it('解析出足够多的 hbox/vbox 与 kern/glue 锚点', () => {
    expect((real.boxes ?? []).length).toBeGreaterThanOrEqual(15);
    expect((real.points ?? []).length).toBeGreaterThanOrEqual(30);
    const kinds = new Set((real.boxes ?? []).map((b) => b.kind));
    expect(kinds).toEqual(new Set(['hbox', 'vbox']));
  });

  it('换算后的坐标全部落在 A4 页面范围内', () => {
    for (const b of real.boxes ?? []) {
      expect(b.page).toBe(1);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(PAGE_W + 0.5);
      expect(b.y - b.h).toBeGreaterThanOrEqual(-0.5);
      expect(b.y + b.d).toBeLessThanOrEqual(PAGE_H + 0.5);
    }
    for (const p of real.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(PAGE_W + 0.5);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(PAGE_H + 0.5);
    }
  });

  it('"First" 标题 hbox（main.tex 第 4 行）坐标与 pdfjs 实测一致', () => {
    const heading = (real.boxes ?? []).find((b) => b.tag === 1 && b.line === 4 && b.kind === 'hbox')!;
    expect(heading).toBeDefined();
    expect(heading.x).toBeCloseTo(133.77, 1); // pdfjs 实测节号 "1" x=133.8
    expect(heading.y).toBeCloseTo(134.76, 1); // pdfjs 实测基线 y=134.8
    expect(heading.w).toBeCloseTo(343.71, 1); // article 10pt \textwidth=345pt(TeX)=343.71bp
  });

  it('兼容视图 blocks：hbox 的左上角 + 全高矩形', () => {
    expect(real.blocks.length).toBeGreaterThanOrEqual(10);
    const b4 = real.blocks.find((b) => b.line === 4)!;
    expect(b4.y).toBeCloseTo(134.75 - 9.96, 1); // 基线 - 高度
  });
});

describe('spToPdfPt：单位校准（真实数据写死）', () => {
  it('常数：1 PDF pt = 65781.76 sp（65536×72.27/72，非 65736/65536）', () => {
    expect(SP_PER_PDF_PT).toBeCloseTo(65781.76, 2);
    expect(spToPdfPt(SP_PER_PDF_PT)).toBeCloseTo(1, 9);
    expect(spToPdfPt(0)).toBe(0);
    // 证伪候选常数：65536 → 135.22、65736 → 134.84，均偏离 pdfjs 实测 134.8 超过 0.05pt
    expect(Math.abs(spToPdfPt(8865054) - 8865054 / 65536)).toBeGreaterThan(0.1);
    expect(Math.abs(spToPdfPt(8865054) - 8865054 / 65736)).toBeGreaterThan(0.05);
  });

  it('关键锚点换算与 pdfjs 实测吻合', () => {
    expect(spToPdfPt(8865054)).toBeCloseTo(134.76, 1); // "First" 基线（实测 134.8）
    expect(spToPdfPt(10300473)).toBeCloseTo(156.6, 1); // 正文第一段（实测 156.6）
    expect(spToPdfPt(13903128)).toBeCloseTo(211.35, 1); // 第二段（实测 211.4）
    expect(spToPdfPt(14689560)).toBeCloseTo(223.3, 1); // 方程基线（实测 223.3）
    expect(spToPdfPt(46220574)).toBeCloseTo(702.61, 1); // 页脚（实测 702.6）
    expect(spToPdfPt(19940638)).toBeCloseTo(303.13, 1); // 页脚页码 x（实测 303.1）
    expect(spToPdfPt(22609920)).toBeCloseTo(343.71, 1); // \textwidth
  });

  it('magnification 线性缩放（官方 unit = pre_unit×mag/1000 方向）', () => {
    expect(spToPdfPt(8865054, 2000)).toBeCloseTo(2 * spToPdfPt(8865054), 9);
    expect(spToPdfPt(65536)).toBeCloseTo(72 / 72.27, 4); // 1 TeX pt 的 bp 值
  });
});

describe('lineLocation：真实文件源码 → PDF', () => {
  it('main.tex 第 4 行（\\section{First}）命中第 1 页标题位置', () => {
    const loc = lineLocation(real, 'main.tex', 4)!;
    expect(loc).toBeDefined();
    expect(loc.page).toBe(1);
    expect(loc.y).toBeGreaterThanOrEqual(50);
    expect(loc.y).toBeLessThanOrEqual(150);
    expect(Math.abs(loc.y - 134.8)).toBeLessThan(1);
    expect(Math.abs(loc.x - 133.8)).toBeLessThan(1);
  });

  it('第 3 行（\\begin{document}，最近行为第 4 行）同样落到标题区', () => {
    const loc = lineLocation(real, 'main.tex', 3)!;
    expect(loc.page).toBe(1);
    expect(loc.y).toBeGreaterThanOrEqual(50);
    expect(loc.y).toBeLessThanOrEqual(150);
  });

  it('正文行经 kern/glue 锚点精确落行（第 5/8 行）', () => {
    expect(lineLocation(real, 'main.tex', 5)!.y).toBeCloseTo(156.6, 1);
    expect(lineLocation(real, 'main.tex', 8)!.y).toBeCloseTo(211.4, 1);
  });

  it('方程行（第 11 行）落在方程基线附近', () => {
    const loc = lineLocation(real, 'main.tex', 11)!;
    expect(loc.page).toBe(1);
    expect(Math.abs(loc.y - 223.3)).toBeLessThan(2);
  });

  it('未知文件 / 无记录的系统文件返回 undefined', () => {
    expect(lineLocation(real, 'nope.tex', 1)).toBeUndefined();
    expect(lineLocation(real, 'article.cls', 1)).toBeUndefined();
  });
});

describe('sourceLocation：真实文件 PDF → 源码', () => {
  it('点击 "First" 标题（pdfjs 实测位置附近）→ main.tex 第 4 行（±1）', () => {
    const loc = sourceLocation(real, 1, 158, 134.5)!;
    expect(loc).toBeDefined();
    expect(loc.file.endsWith('main.tex')).toBe(true);
    expect(Math.abs(loc.line - 4)).toBeLessThanOrEqual(1);
  });

  it('点击第一段文字 → 第 5 行（±1）', () => {
    // x 取 170（"Hello world one." 文字中部）：该处最近锚点是 x1,5（166.5pt）；
    // 若点行首 x≈150 会命中段落起始 kern x1,7（TeX 把它记到段落结束行 7）
    const loc = sourceLocation(real, 1, 170, 156.5)!;
    expect(loc).toBeDefined();
    expect(loc.file.endsWith('main.tex')).toBe(true);
    expect(Math.abs(loc.line - 5)).toBeLessThanOrEqual(1);
  });

  it('点击方程 → 第 11 行（±1）', () => {
    const loc = sourceLocation(real, 1, 296, 222)!;
    expect(loc).toBeDefined();
    expect(Math.abs(loc.line - 11)).toBeLessThanOrEqual(1);
  });

  it('点击页脚页码 → 第 13 行', () => {
    const loc = sourceLocation(real, 1, 300, 702.4)!;
    expect(loc).toBeDefined();
    expect(loc.line).toBe(13);
  });

  it('远点 / 无记录页返回 undefined', () => {
    expect(sourceLocation(real, 1, 5000, 5000)).toBeUndefined();
    expect(sourceLocation(real, 5, 300, 300)).toBeUndefined();
  });
});

describe('手写真实格式 fixture（多页 / 多文件 / gzip）', () => {
  it('文本与 gzip 两种形态解析出等价的索引', () => {
    expect(gzipIndex).toEqual(textIndex);
    expect(textIndex.version).toBe(1);
    expect(textIndex.magnification).toBe(1000);
    expect(textIndex.pages).toBe(2);
    // 头部 2 条 + Content 内 1 条（main.aux）
    expect(textIndex.inputs).toHaveLength(3);
    expect(textIndex.inputs.map((i) => i.path)).toEqual(['main.tex', 'sections/intro.tex', 'main.aux']);
    expect((textIndex.boxes ?? []).length).toBe(7); // 2 个页面 vbox + 5 个 hbox
    expect((textIndex.points ?? []).length).toBe(7); // g/x/v 锚点
  });

  it('坐标按 sp → pt 换算（65781.76 sp = 1pt）', () => {
    const box12 = (textIndex.boxes ?? []).find((b) => b.tag === 1 && b.line === 12)!;
    expect(box12).toBeDefined();
    expect(box12.x).toBeCloseTo(spToPdfPt(4736286), 9);
    expect(box12.y).toBeCloseTo(spToPdfPt(45600000), 9);
    expect(box12.w).toBeCloseTo(spToPdfPt(4000000), 9);
  });
});

describe('lineLocation / sourceLocation：手写真实格式 fixture', () => {
  it('源码 → PDF：精确行 / 带 ./ 前缀 / 按文件名均可命中', () => {
    expect(lineLocation(textIndex, 'main.tex', 12)).toEqual({
      page: 1,
      x: spToPdfPt(4736286),
      y: spToPdfPt(45600000),
    });
    expect(lineLocation(textIndex, './sections/intro.tex', 40)).toEqual({
      page: 1,
      x: spToPdfPt(4736286),
      y: spToPdfPt(44000000),
    });
    expect(lineLocation(textIndex, 'intro.tex', 55)).toEqual({
      page: 2,
      x: spToPdfPt(4736286),
      y: spToPdfPt(45600000),
    });
  });

  it('就近行匹配：请求行取距离最近的记录（行距优先于 hbox/vbox 类别）', () => {
    // main.tex 有 hbox 行 12（d=1）与 vbox 行 20（d=7）：请求 13 命中 12
    expect(lineLocation(textIndex, 'main.tex', 13)!.y).toBeCloseTo(spToPdfPt(45600000), 9);
    // 请求 999：|20-999| < |12-999|，命中 vbox 行 20 的基线
    expect(lineLocation(textIndex, 'main.tex', 999)!.y).toBeCloseTo(spToPdfPt(46220580), 9);
  });

  it('未知文件返回 undefined', () => {
    expect(lineLocation(textIndex, 'nope.tex', 1)).toBeUndefined();
  });

  it('PDF → 源码：命中块内返回块行号', () => {
    // 页 1 main.tex 行 12 的 hbox 内（基线 45600000、上缘 45200000）
    const loc = sourceLocation(textIndex, 1, spToPdfPt(5000000), spToPdfPt(45590000));
    expect(loc).toEqual({ file: 'main.tex', line: 12 });
  });

  it('PDF → 源码：块内 kern/glue 锚点比块自身行号更精确', () => {
    // intro.tex 行 40 的盒内有一个行 41 的锚点，点它应得 41
    const loc = sourceLocation(textIndex, 1, spToPdfPt(6000000), spToPdfPt(44000000));
    expect(loc).toEqual({ file: 'sections/intro.tex', line: 41 });
  });

  it('PDF → 源码：嵌套盒取面积最小者；页 2 独立命中', () => {
    // 页 2 行 70 的盒与其内层同名同坐标盒重叠，取更具体者（同为行 70）
    const loc = sourceLocation(textIndex, 2, spToPdfPt(5000000), spToPdfPt(43990000));
    expect(loc).toEqual({ file: 'sections/intro.tex', line: 70 });
    // 页 2 行间空白处（盒基线 693.2/668.9 之间、x 在行 70 盒右缘之外）最近邻兜底到行 55 的 hbox
    const near = sourceLocation(textIndex, 2, 100, 675);
    expect(near).toEqual({ file: 'sections/intro.tex', line: 55 });
  });

  it('PDF → 源码：远点与无记录页返回 undefined', () => {
    expect(sourceLocation(textIndex, 1, 99999, 99999)).toBeUndefined();
    expect(sourceLocation(textIndex, 9, 100, 100)).toBeUndefined();
  });
});

describe('旧自造子集兼容（compileAction.tauri.test 同款语法）', () => {
  it('按文本解析：锚点块原样坐标进入 blocks，不产生真实格式 boxes/points', () => {
    expect(legacyIndex.version).toBe(1);
    expect(legacyIndex.inputs).toEqual([{ tag: 1, path: 'main.tex' }]);
    expect(legacyIndex.blocks).toEqual([
      { page: 1, tag: 1, line: 12, x: 1000, y: 8000, w: 4000, h: 400 },
      { page: 1, tag: 1, line: 30, x: 1000, y: 2000, w: 4000, h: 400 },
    ]);
    expect(legacyIndex.boxes).toEqual([]);
    expect(legacyIndex.points).toEqual([]);
  });

  it('查询为原样坐标透传（不经 sp 换算）', () => {
    expect(lineLocation(legacyIndex, 'main.tex', 12)).toEqual({ page: 1, x: 1000, y: 8000 });
    // 就近行匹配：行 12 与 30 之间请求 25 命中更近的 30
    expect(lineLocation(legacyIndex, 'main.tex', 25)).toEqual({ page: 1, x: 1000, y: 2000 });
    expect(sourceLocation(legacyIndex, 1, 1100, 8100)).toEqual({ file: 'main.tex', line: 12 });
    expect(sourceLocation(legacyIndex, 1, 99999, 99999)).toBeUndefined();
  });
});
