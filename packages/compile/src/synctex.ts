import { gunzipSync } from 'fflate';

/**
 * SyncTeX 解析与 PDF↔源码正反向查询（真实 TeX Live 格式 + 旧自造子集兼容）。
 *
 * —— 真实 .synctex 结构（TeX Live 2024 latexmk 实测，fixtures/main.synctex.gz）——
 *   SyncTeX Version:1                     版本头
 *   Input:tag:绝对路径                     输入文件记录：头部与 Content 内均可出现；
 *                                         含 cls/sty/aux 等系统文件，主文件 tag=1
 *   Output:pdf                             输出名
 *   Magnification:1000 / Unit:1            单位与放大倍率
 *   X Offset:0 / Y Offset:0                原点偏移（synctex 单位）
 *   Content:                               记录流开始
 *   !字节偏移                              文件内字节锚点（忽略）
 *   {页号                                  页开始；}页号 页结束
 *   [tag,line:x,y:w,h,d                    vbox 开始
 *   (tag,line:x,y:w,h,d                    hbox 开始
 *   ) / ]                                  闭合 hbox / vbox（当前点弹栈恢复父坐标）
 *   h|v tag,line:x,y:w,h,d                 当前 h/v 框位置锚点
 *   x|k|g tag,line:x,y[:w]                 kern/glue 锚点：把当前点移动到 (x,y)
 *   p|n x,y                                裸当前点（无 tag/line，仅推进坐标）
 *   Postamble: / Count:n / Post scriptum:  尾部（到此为止）
 *   记录流可层叠嵌套，一行至多 glued 多条记录（逐条消费直至行尾）。
 *
 * —— 坐标系（用真实 fixture 与 pdfjs 对 main.pdf 文本位置交叉校准）——
 *   记录坐标为「页面绝对坐标」，原点在页面左上，x 向右、y 向下、盒子的 y 取基线，
 *   已含全部祖先偏移——子框坐标不随嵌套累加（实证：标题 hbox (1,4:…,8865054)
 *   换算 134.75pt 与 pdfjs 实测 "First" 基线 134.8pt 一致；页脚 kern 锚点
 *   x=19940638 换算 303.08pt 与 pdfjs 实测 303.1pt 一致）。解析器仍按格式规则
 *   维护当前点栈：进框保存父当前点，x/g/k/h/v 记录推进当前点，闭合弹栈恢复。
 *
 * —— 单位换算 ——
 *   真实文件坐标为 scaled point（sp）。1 PDF pt（big point）= 72.27/72 TeX pt，
 *   即 SP_PER_PDF_PT = 65536×72.27/72 = 65781.76 sp——既非 65736 也非 65536
 *   （65736 会把 "First" 基线算成 134.84pt、65536 算成 135.22pt，均偏离实测
 *   134.8pt；65781.76 得 134.75pt）。文件头 Unit/Magnification 按官方 synctex
 *   解析器的整数规则折算：effUnit = ⌊unit×mag+500)/1000⌋。解析产物
 *   boxes/points/blocks 的坐标一律已换算为 PDF pt（真实页面为 A4
 *   595.276×841.89pt，全部落在页内）。
 *
 * —— 旧自造子集兼容（compileAction.tauri.test 等仍在用）——
 *   {页号}（带右花括号）、{tag,line} 输入锚点、`[hv],?x:n,y:n,w:n,h:n` 块记录。
 *   旧子集块按「原样坐标 = PDF pt 语义、y 为上缘」直接进入 index.blocks，不经
 *   单位换算；手造 SynctexIndex（synctexBridge.test）同样按 pt 语义查询。
 */

export interface SynctexInput {
  tag: number;
  path: string;
}

/** 兼容视图：块记录（真实解析时为各 hbox 的 pt 矩形，y 为上缘、h 含深度；旧子集为原样坐标） */
export interface SynctexBlock {
  page: number;
  tag: number;
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SynctexBoxKind = 'hbox' | 'vbox';

/** 真实格式的 hbox/vbox 记录（坐标已换算 PDF pt，页面绝对坐标） */
export interface SynctexBox {
  page: number;
  tag: number;
  line: number;
  kind: SynctexBoxKind;
  /** 盒子左缘（PDF pt） */
  x: number;
  /** 基线（PDF pt，页面左上为原点向下） */
  y: number;
  /** 宽（PDF pt） */
  w: number;
  /** 基线以上高度（PDF pt） */
  h: number;
  /** 基线以下深度（PDF pt） */
  d: number;
  /** 嵌套深度（0 = 页面顶层） */
  depth: number;
}

/** 真实格式的 kern/glue/当前框锚点（坐标已换算 PDF pt；正反向查询的最细粒度） */
export interface SynctexPoint {
  page: number;
  tag: number;
  line: number;
  x: number;
  y: number;
  depth: number;
}

export interface SynctexIndex {
  version: number;
  inputs: SynctexInput[];
  blocks: SynctexBlock[];
  /** 新增字段全部可选：手造索引（synctexBridge.test / compileAction.test）只填 version/inputs/blocks */
  output?: string;
  magnification?: number;
  unit?: number;
  xOffset?: number;
  yOffset?: number;
  boxes?: SynctexBox[];
  points?: SynctexPoint[];
  /** 出现过的最大页号 */
  pages?: number;
}

export interface SourceLocation {
  file: string;
  line: number;
}

export interface PdfLocation {
  page: number;
  x: number;
  y: number;
}

/** 1 PDF pt（big point）对应的 scaled point 数：65536×72.27/72 = 65781.76（真实 fixture 校准） */
export const SP_PER_PDF_PT = (65536 * 72.27) / 72;

/**
 * synctex 单位（scaled point）→ PDF pt。
 * magnification 为文件头 Magnification（缺省 1000）：pt = sp×(mag/1000)/65781.76，
 * 与官方 synctex 解析器 unit = pre_unit×mag/1000 的缩放方向一致。
 */
export function spToPdfPt(v: number, magnification = 1000): number {
  return (v * magnification) / (1000 * SP_PER_PDF_PT);
}

/** 解析 .synctex（gzip 魔数 0x1f 0x8b 自动解压，否则按 UTF-8 文本处理） */
export function parseSynctex(bytes: Uint8Array): SynctexIndex {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = new TextDecoder('utf-8').decode(isGzip ? gunzipSync(bytes) : bytes);
  return parseSynctexText(text);
}

// ---------------------------------------------------------------------------
// 记录文法（逐条锚定匹配；一行可能 glued 多条记录）
// ---------------------------------------------------------------------------

interface RawBox {
  page: number;
  tag: number;
  line: number;
  kind: SynctexBoxKind;
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
  depth: number;
}

interface RawPoint {
  page: number;
  tag: number;
  line: number;
  x: number;
  y: number;
  depth: number;
}

const RE_VERSION = /^SyncTeX Version:(-?\d+)/;
const RE_INPUT = /^Input:(-?\d+):(.+)$/;
const RE_OUTPUT = /^Output:(\S*)/;
const RE_MAGNIFICATION = /^Magnification:(-?\d+)/;
const RE_UNIT = /^Unit:(-?\d+)/;
const RE_X_OFFSET = /^X Offset:(-?\d+)/;
const RE_Y_OFFSET = /^Y Offset:(-?\d+)/;
const RE_CONTENT = /^Content:/;
const RE_POSTAMBLE = /^Postamble:/;
const RE_COUNT = /^Count:(-?\d+)/;
const RE_BYTE_OFFSET = /^!(-?\d+)/;
/** 旧自造子集：输入锚点 {tag,line}（真实格式没有带逗号的 { 记录） */
const RE_LEGACY_ANCHOR = /^\{(-?\d+),(-?\d+)\}/;
/** 页开始 {页号（真实格式无右花括号；旧子集 {页号} 由页结束规则吞掉剩余 } ） */
const RE_PAGE_OPEN = /^\{(-?\d+)/;
/** 页结束 }页号（页号可缺省） */
const RE_PAGE_CLOSE = /^\}(?:-?\d+)?/;
const RE_VBOX_OPEN = /^\[(-?\d+),(-?\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/;
const RE_HBOX_OPEN = /^\((-?\d+),(-?\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/;
const RE_CLOSE_HBOX = /^\)/;
const RE_CLOSE_VBOX = /^\]/;
/** 当前 h/v 框锚点：h|v tag,line:x,y:w,h,d */
const RE_CURBOX = /^[hv](-?\d+),(-?\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/;
/** kern/glue/数学锚点：x|k|g|$ tag,line:x,y[:w] */
const RE_POINT = /^[$xkg](-?\d+),(-?\d+):(-?\d+),(-?\d+)(?::(-?\d+))?/;
/** 裸当前点：p|n x,y（无 tag/line，仅推进坐标） */
const RE_BARE_POINT = /^[pn](-?\d+),(-?\d+)/;
/** 旧自造子集块：[hv],?x:n,y:n,w:n,h:n */
const RE_LEGACY_BLOCK = /^(?:([hv]),)?x:(-?\d+),y:(-?\d+),w:(-?\d+),h:(-?\d+)/;

function parseSynctexText(text: string): SynctexIndex {
  const index: SynctexIndex = { version: 0, inputs: [], blocks: [] };
  let magnification = 1000;
  let unit = 1;
  let xOffset = 0;
  let yOffset = 0;
  let inContent = false;
  let postamble = false;
  let currentPage = 0;
  let maxPage = 0;
  let legacyAnchor: { tag: number; line: number } | undefined;
  const rawBoxes: RawBox[] = [];
  const rawPoints: RawPoint[] = [];
  // 当前点栈：进框保存父当前点，闭合恢复（格式规则；真实文件坐标本身已是页面绝对值）
  let curX = 0;
  let curY = 0;
  const savedCur: Array<[number, number]> = [];

  for (const raw of text.split(/\r?\n/)) {
    let s = raw.trim();
    while (s.length > 0) {
      let m = RE_INPUT.exec(s);
      if (m) {
        index.inputs.push({ tag: Number(m[1]), path: normalizePath(m[2]) });
        s = s.slice(m[0].length);
        continue;
      }
      if (!inContent) {
        if ((m = RE_VERSION.exec(s))) index.version = Number(m[1]);
        else if ((m = RE_OUTPUT.exec(s))) index.output = m[1];
        else if ((m = RE_MAGNIFICATION.exec(s))) magnification = Number(m[1]);
        else if ((m = RE_UNIT.exec(s))) unit = Number(m[1]);
        else if ((m = RE_X_OFFSET.exec(s))) xOffset = Number(m[1]);
        else if ((m = RE_Y_OFFSET.exec(s))) yOffset = Number(m[1]);
        else if (RE_CONTENT.exec(s)) inContent = true;
        s = '';
        continue;
      }
      if (postamble) {
        s = '';
        continue;
      }
      if (RE_POSTAMBLE.exec(s)) {
        postamble = true;
        s = '';
        continue;
      }
      if ((m = RE_COUNT.exec(s))) {
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_BYTE_OFFSET.exec(s))) {
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_LEGACY_ANCHOR.exec(s))) {
        legacyAnchor = { tag: Number(m[1]), line: Number(m[2]) };
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_PAGE_OPEN.exec(s))) {
        currentPage = Number(m[1]);
        maxPage = Math.max(maxPage, currentPage);
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_PAGE_CLOSE.exec(s))) {
        s = s.slice(m[0].length);
        continue;
      }
      const before = s;
      if ((m = RE_VBOX_OPEN.exec(s)) || (m = RE_HBOX_OPEN.exec(s))) {
        const kind: SynctexBoxKind = s[0] === '[' ? 'vbox' : 'hbox';
        const [tag, line, x, y, w, h, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7])];
        savedCur.push([curX, curY]);
        curX = x;
        curY = y;
        rawBoxes.push({ page: currentPage, tag, line, kind, x: x + xOffset, y: y + yOffset, w, h, d, depth: savedCur.length - 1 });
        s = s.slice(m[0].length);
        continue;
      }
      if (RE_CLOSE_HBOX.exec(s) || RE_CLOSE_VBOX.exec(s)) {
        const restore = savedCur.pop();
        if (restore) {
          curX = restore[0];
          curY = restore[1];
        }
        s = s.slice(1);
        continue;
      }
      if ((m = RE_CURBOX.exec(s))) {
        rawPoints.push({ page: currentPage, tag: Number(m[1]), line: Number(m[2]), x: Number(m[3]) + xOffset, y: Number(m[4]) + yOffset, depth: savedCur.length });
        curX = Number(m[3]);
        curY = Number(m[4]);
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_POINT.exec(s))) {
        rawPoints.push({ page: currentPage, tag: Number(m[1]), line: Number(m[2]), x: Number(m[3]) + xOffset, y: Number(m[4]) + yOffset, depth: savedCur.length });
        curX = Number(m[3]);
        curY = Number(m[4]);
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_BARE_POINT.exec(s))) {
        curX = Number(m[1]);
        curY = Number(m[2]);
        s = s.slice(m[0].length);
        continue;
      }
      if ((m = RE_LEGACY_BLOCK.exec(s)) && legacyAnchor) {
        // 旧自造子集块：原样坐标（pt 语义、y 为上缘），不经单位换算
        index.blocks.push({
          page: currentPage,
          tag: legacyAnchor.tag,
          line: legacyAnchor.line,
          x: Number(m[2]),
          y: Number(m[3]),
          w: Number(m[4]),
          h: Number(m[5]),
        });
        s = s.slice(m[0].length);
        continue;
      }
      // 未知记录：丢弃整行，避免死循环
      if (s === before) s = '';
    }
  }

  // 单位换算：官方整数规则 effUnit = ⌊unit×mag+500)/1000⌋（unit、mag 为文件头值）
  let effUnit = Math.floor((unit * magnification + 500) / 1000);
  if (!(effUnit > 0)) effUnit = 1;
  const toPt = (sp: number): number => spToPdfPt(sp * effUnit);

  index.magnification = magnification;
  index.unit = unit;
  index.xOffset = xOffset;
  index.yOffset = yOffset;
  index.pages = maxPage;
  index.boxes = rawBoxes.map((b) => ({
    ...b,
    x: toPt(b.x),
    y: toPt(b.y),
    w: toPt(b.w),
    h: toPt(b.h),
    d: toPt(b.d),
  }));
  index.points = rawPoints.map((p) => ({ ...p, x: toPt(p.x), y: toPt(p.y) }));
  // 兼容视图：hbox → 左上角 + 全高（含深度），与旧子集块的矩形语义一致
  for (const b of index.boxes) {
    if (b.kind === 'hbox') {
      index.blocks.push({ page: b.page, tag: b.tag, line: b.line, x: b.x, y: b.y - b.h, w: b.w, h: b.h + b.d });
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/** 点击未落在任何记录附近时的最近邻兜底上限（PDF pt）——超出视为未命中 */
const NEAR_MISS_LIMIT_PT = 100;

interface QueryRect {
  tag: number;
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

function boxRect(b: SynctexBox): QueryRect {
  return { tag: b.tag, line: b.line, x: b.x, y: b.y - b.h, w: b.w, h: b.h + b.d, area: b.w * (b.h + b.d) };
}

function blockRect(b: SynctexBlock): QueryRect {
  return { tag: b.tag, line: b.line, x: b.x, y: b.y, w: b.w, h: b.h, area: b.w * b.h };
}

function rectContains(r: QueryRect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function rectDistance(r: QueryRect, px: number, py: number): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** 字典序比较键：less(a,b) = a 是否应排在 b 前 */
function keyLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** PDF→源码：页码与页面坐标（PDF pt，原点页面左上、y 向下）→ 源文件与行号；未命中返回 undefined */
export function sourceLocation(index: SynctexIndex, page: number, x: number, y: number): SourceLocation | undefined {
  const resolve = (tag: number, line: number): SourceLocation | undefined => {
    const input = index.inputs.find((i) => i.tag === tag);
    return input ? { file: input.path, line } : undefined;
  };

  const boxes = index.boxes ?? [];
  const points = index.points ?? [];
  const useLegacy = boxes.length === 0 && points.length === 0;

  if (!useLegacy) {
    const pageBoxes = boxes.filter((b) => b.page === page);
    const pagePoints = points.filter((p) => p.page === page);
    // 1) 最小面积命中 hbox（越内层越具体）
    const containing = pageBoxes
      .filter((b) => b.kind === 'hbox')
      .map(boxRect)
      .filter((r) => rectContains(r, x, y));
    if (containing.length > 0) {
      const best = containing.reduce((a, b) => (b.area < a.area ? b : a));
      // 2) 命中框内最近的 kern/glue 锚点（比框级行号更精确，贴近官方 synctex 行为）
      const inner = pagePoints.filter((p) => rectContains(best, p.x, p.y));
      if (inner.length > 0) {
        const pt = inner.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));
        return resolve(pt.tag, pt.line);
      }
      return resolve(best.tag, best.line);
    }
    // 3) 最近邻兜底（点击落在行间距/页边距等空白处）。只看 hbox 与锚点：
    //    页面级 vbox 几乎覆盖整页且行号粗糙（多为结尾行），纳入会让空白点击全部命中它
    let bestTag = 0;
    let bestLine = 0;
    let bestKey: number[] | undefined;
    for (const b of pageBoxes) {
      if (b.kind !== 'hbox') continue;
      const r = boxRect(b);
      const key = [rectDistance(r, x, y), r.area, r.y, r.x];
      if (!bestKey || keyLess(key, bestKey)) {
        bestKey = key;
        bestTag = b.tag;
        bestLine = b.line;
      }
    }
    for (const p of pagePoints) {
      const key = [Math.hypot(p.x - x, p.y - y), 0, p.y, p.x];
      if (!bestKey || keyLess(key, bestKey)) {
        bestKey = key;
        bestTag = p.tag;
        bestLine = p.line;
      }
    }
    if (!bestKey || bestKey[0] > NEAR_MISS_LIMIT_PT) return undefined;
    return resolve(bestTag, bestLine);
  }

  // 旧子集 / 手造索引：blocks 即全部记录（y 为上缘的原样坐标）
  const pageBlocks = index.blocks.filter((b) => b.page === page).map(blockRect);
  if (pageBlocks.length === 0) return undefined;
  const containing = pageBlocks.filter((r) => rectContains(r, x, y));
  if (containing.length > 0) {
    const best = containing.reduce((a, b) => (b.area < a.area ? b : a));
    return resolve(best.tag, best.line);
  }
  const nearest = pageBlocks.reduce((a, b) => {
    const da = rectDistance(a, x, y);
    const db = rectDistance(b, x, y);
    return db < da || (db === da && b.area < a.area) ? b : a;
  });
  if (rectDistance(nearest, x, y) > NEAR_MISS_LIMIT_PT) return undefined;
  return resolve(nearest.tag, nearest.line);
}

/** 源码→PDF：文件与行号 → 页码与锚点坐标（PDF pt，y 为基线、自页顶向下）；未命中返回 undefined */
export function lineLocation(index: SynctexIndex, file: string, line: number): PdfLocation | undefined {
  const target = normalizePath(file);
  const base = basename(target);
  const tags = new Set(
    index.inputs
      .filter((i) => {
        const p = normalizePath(i.path);
        return p === target || p.endsWith('/' + target) || basename(p) === base;
      })
      .map((i) => i.tag),
  );
  if (tags.size === 0) return undefined;

  interface Cand {
    page: number;
    x: number;
    y: number;
    key: number[]; // [行距, 类型(hbox<vbox<锚点), 页, -y, x, 面积]
  }
  const cands: Cand[] = [];
  const boxes = index.boxes ?? [];
  const points = index.points ?? [];
  const useLegacy = boxes.length === 0 && points.length === 0;
  if (useLegacy) {
    for (const b of index.blocks) {
      if (!tags.has(b.tag)) continue;
      cands.push({ page: b.page, x: b.x, y: b.y, key: [Math.abs(b.line - line), 0, b.page, -b.y, b.x, b.w * b.h] });
    }
  } else {
    for (const b of boxes) {
      if (!tags.has(b.tag)) continue;
      cands.push({
        page: b.page,
        x: b.x,
        y: b.y,
        key: [Math.abs(b.line - line), b.kind === 'hbox' ? 0 : 1, b.page, -b.y, b.x, b.w * (b.h + b.d)],
      });
    }
    for (const p of points) {
      if (!tags.has(p.tag)) continue;
      cands.push({ page: p.page, x: p.x, y: p.y, key: [Math.abs(p.line - line), 2, p.page, -p.y, p.x, 0] });
    }
  }
  if (cands.length === 0) return undefined;
  // -y：同一行的多个盒子中优先最低基线（主线基线），上标等高层嵌套盒次之
  const best = cands.reduce((a, b) => (keyLess(b.key, a.key) ? b : a));
  return { page: best.page, x: best.x, y: best.y };
}

function normalizePath(p: string): string {
  let s = p.trim();
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}
