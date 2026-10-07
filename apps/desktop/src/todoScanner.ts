/**
 * 稿件待办扫描器（v1.3.0）：把散落在 LaTeX 源码里的写作计划收进一处。
 *
 * 识别三类标记（均忽略大小写）：
 *  - `% TODO: ...` / `% TODO ...`（注释待办，含全角冒号）
 *  - `% FIXME: ...`
 *  - `\todo{...}` / `\todo[...]{}（todonotes 宏包，正文待办）
 *
 * 口径：行级扫描 .tex 文件；`\todo{...}` 取同行的第一个花括号内容（跨行待办截断
 * 到行尾，够用——跳转与提醒是目的，不是完整解析）；忽略 `\%` 转义；每文件与全局
 * 均设上限（防巨型工程拖垮首页）。纯函数，无 store 依赖。
 */

export type TodoKind = 'todo' | 'fixme' | 'todonotes';

export interface TodoItem {
  file: string;
  /** 1-based 行号 */
  line: number;
  kind: TodoKind;
  /** 待办正文（去标记后的说明；可空串） */
  text: string;
}

/** 单文件扫描上限 */
export const PER_FILE_LIMIT = 100;
/** 全项目（多文件聚合）上限 */
export const TOTAL_LIMIT = 300;

/** 注释型标记：% TODO... / % FIXME...（`\%` 转义不算注释起点） */
const COMMENT_TODO_RE = /(?:^|[^\\])%\s*(TODO|FIXME)\b\s*[:：]?\s*(.*)/i;
/** todonotes：\todo{...}（带可选 [..]） */
const TODONOTES_RE = /\\todo\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/i;

function scanFile(file: string, content: string, out: TodoItem[]): void {
  const lines = content.split('\n');
  // 单文件上限以「本文件新增条数」计（v7.8.0 修复）：此前直接用 out.length（全局累计），
  // 首个 TODO 密集文件打满 PER_FILE_LIMIT 后，后续所有文件一行都不再扫描（待办整批丢失）
  const base = out.length;
  for (let i = 0; i < lines.length && out.length - base < PER_FILE_LIMIT; i++) {
    const raw = lines[i] ?? '';
    const cm = COMMENT_TODO_RE.exec(raw);
    if (cm) {
      const kind: TodoKind = cm[1]!.toUpperCase() === 'FIXME' ? 'fixme' : 'todo';
      out.push({ file, line: i + 1, kind, text: cm[2]?.trim() ?? '' });
      continue;
    }
    const tm = TODONOTES_RE.exec(raw);
    if (tm) {
      out.push({ file, line: i + 1, kind: 'todonotes', text: (tm[1] ?? '').trim() });
    }
  }
}

/**
 * 扫描工作区全部 .tex 文件（按文件名排序保证稳定输出），聚合截断到 TOTAL_LIMIT。
 * 返回顺序：文件名字典序 → 行号升序。
 */
export function scanTodos(files: Record<string, string>): TodoItem[] {
  const out: TodoItem[] = [];
  for (const file of Object.keys(files).sort()) {
    if (!file.endsWith('.tex')) continue;
    scanFile(file, files[file] ?? '', out);
    if (out.length >= TOTAL_LIMIT) break;
  }
  return out.slice(0, TOTAL_LIMIT);
}

/** 待办计数（首页卡与命令面板 hint 用） */
export function countTodos(files: Record<string, string>): number {
  return scanTodos(files).length;
}
