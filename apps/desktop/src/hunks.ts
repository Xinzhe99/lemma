/**
 * hunk 切分 / 部分采纳的纯函数（diff 审批体验升级，设计 5.6 的「逐块采纳」落地）。
 *
 * 行的约定：一行 = 原文中携带自身换行符的精确子串（仅文本最后一行可能没有 \n）。
 * 这样 applyHunks 的输出可由 before / after 的原文切片逐字拼回——
 * 「全接受 === after」「全拒绝 === before」在字节层面成立（含行尾换行差异）。
 *
 * 行号约定（unified diff 语义）：
 * - beforeStart/beforeEnd、afterStart/afterEnd 均为 1-based 闭区间；
 * - 区间长度 = 对应行数组长度；
 * - 纯插入 hunk（beforeLines 为空）的 beforeStart === beforeEnd = 插入点所
 *   在旧行号（插在该行之后；文件头部插入为 0，即 @@ -0,0 +1,n @@）；
 * - 纯删除 hunk（afterLines 为空）同理，afterStart === afterEnd = 新文件中
 *   删除内容原本所在位置之后已达成的行号。
 *
 * diff 算法复用 jsdiff 的 diffLines（行级 LCS）：packages/editor 已依赖 diff@7
 * 且根已提升，desktop 在 package.json 声明同一版本，无新增安装。
 */

import { diffLines, type Change } from 'diff';

export interface Hunk {
  /** 稳定 id（splitHunks 内按出现顺序编号 h1、h2…；applyHunks/审批卡以 id 索引） */
  id: string;
  /** unified 风格头：@@ -beforeStart,beforeCount +afterStart,afterCount @@ */
  header: string;
  /** 旧文件行号区间（1-based 闭区间；空区间见上文约定） */
  beforeStart: number;
  beforeEnd: number;
  /** 新文件行号区间（1-based 闭区间；空区间见上文约定） */
  afterStart: number;
  afterEnd: number;
  /** 被替换的旧片段（行含换行符；纯插入时为空数组） */
  beforeLines: string[];
  /** 替换后的新片段（行含换行符；纯删除时为空数组） */
  afterLines: string[];
}

/** 文本 → 行数组（每行携带自身换行符；空文本 → 空数组） */
export function toDiffLines(text: string): string[] {
  if (text === '') return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** 把 diffLines 的一个 change 值切成行（携带换行符），行数以 count 为准 */
function changeLines(ch: Change): string[] {
  if (ch.value === '') return [];
  const lines = toDiffLines(ch.value);
  return ch.count === undefined ? lines : lines.slice(0, ch.count);
}

/** @@ 头：始终带计数（-a,b +c,d），与 Hunk 的行号约定一一对应 */
function hunkHeader(beforeStart: number, beforeCount: number, afterStart: number, afterCount: number): string {
  return `@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`;
}

/**
 * 把 before → after 的行级差异切为若干 hunk：
 * 相邻（中间无未变行）的增/删 change 合并为一个 hunk，未变行是 hunk 边界。
 * before === after 时返回空数组。
 */
export function splitHunks(before: string, after: string): Hunk[] {
  const changes = diffLines(before, after);
  const hunks: Hunk[] = [];
  let oldNo = 0; // 已走过的旧文件行数
  let newNo = 0; // 已走过的旧/新文件行数（context 两侧同进）
  let run: { beforeLines: string[]; afterLines: string[] } | null = null;

  const flush = () => {
    if (!run) return;
    const { beforeLines, afterLines } = run;
    // 空区间（纯插入/纯删除）的起点 = run 开始前已走过的行数（=「插在该行之后」）
    const beforeStart = beforeLines.length > 0 ? oldNo - beforeLines.length + 1 : oldNo;
    const afterStart = afterLines.length > 0 ? newNo - afterLines.length + 1 : newNo;
    hunks.push({
      id: `h${hunks.length + 1}`,
      header: hunkHeader(beforeStart, beforeLines.length, afterStart, afterLines.length),
      beforeStart,
      beforeEnd: beforeLines.length > 0 ? beforeStart + beforeLines.length - 1 : beforeStart,
      afterStart,
      afterEnd: afterLines.length > 0 ? afterStart + afterLines.length - 1 : afterStart,
      beforeLines,
      afterLines,
    });
    run = null;
  };

  for (const ch of changes) {
    if (ch.added || ch.removed) {
      if (!run) run = { beforeLines: [], afterLines: [] };
      const lines = changeLines(ch);
      if (ch.removed) {
        run.beforeLines.push(...lines);
        oldNo += lines.length;
      } else {
        run.afterLines.push(...lines);
        newNo += lines.length;
      }
    } else {
      flush();
      const n = changeLines(ch).length;
      oldNo += n;
      newNo += n;
    }
  }
  flush();
  return hunks;
}

/** hunk 在旧文件中的起始下标（0-based；纯插入 = 插入下标本身） */
function beforeStartIndex(hunk: Hunk): number {
  return hunk.beforeLines.length > 0 ? hunk.beforeStart - 1 : hunk.beforeStart;
}

/**
 * 部分采纳：从原始 before 出发按行号区间重组——
 * 接受的 hunk 用 afterLines 替换其旧区间，拒绝的保持 beforeLines（即原样），
 * hunk 之间的空隙照抄。返回重组后的完整文本。
 *
 * accepted 中的 id 被采纳；不在集合中的 id 一律按拒绝处理。
 *
 * 重叠防御：splitHunks 产出的 hunk 理论上互不重叠，但本函数也接受外部构造
 * 的 hunk——若出现重叠（后一个 hunk 的起点落在前一个已消费区间内），按传入
 * 顺序应用并把起点钳制到已消费位置，绝不读越界、绝不丢空隙。
 */
export function applyHunks(before: string, hunks: Hunk[], accepted: Set<string>): string {
  // 纯插入（空旧区间）排在同下标的替换之前，保证「先插后换」语义稳定
  const insertionFirst = (h: Hunk) => (h.beforeLines.length === 0 ? 0 : 1);
  const ordered = [...hunks].sort(
    (a, b) => beforeStartIndex(a) - beforeStartIndex(b) || insertionFirst(a) - insertionFirst(b),
  );
  const oldLines = toDiffLines(before);
  const out: string[] = [];
  let cursor = 0; // 已消费的旧行下标（exclusive）

  for (const hunk of ordered) {
    let start = beforeStartIndex(hunk);
    let overlap = 0;
    if (start < cursor) {
      // 重叠防御：起点钳制到已消费位置，已被前一个 hunk 覆盖掉的旧行
      // （前 overlap 行）从本 hunk 的替换范围中剔除，只处理剩余部分
      overlap = cursor - start;
      start = cursor;
    }
    out.push(...oldLines.slice(cursor, start)); // 空隙照抄
    const restBefore = overlap > 0 ? hunk.beforeLines.slice(overlap) : hunk.beforeLines;
    out.push(...(accepted.has(hunk.id) ? hunk.afterLines : restBefore));
    cursor = start + restBefore.length;
  }
  out.push(...oldLines.slice(cursor)); // 尾部空隙
  return out.join('');
}
