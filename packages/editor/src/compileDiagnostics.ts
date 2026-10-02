/**
 * 编译诊断标注（v1.5.1 D1）：把编译日志解析出的 error/warning 钉进编辑器——
 * 行高亮 + 沟槽标记（✗/⚠，title 原生悬浮显示消息），编译完成后由宿主经
 * setCompileDiagnosticsList 推送；扩展实例按文件名过滤展示。
 *
 * 模块级注册表 + 侦听：注册表变化时向所有活跃视图派发刷新 effect（重算装饰）。
 * 文件名归一：日志常见 './sections/intro.tex' → 去掉 './' 前缀再比对。
 */

import {
  EditorView,
  Decoration,
  hoverTooltip,
  GutterMarker,
  gutter,
  ViewPlugin,
  type DecorationSet,
} from '@codemirror/view';
import { Range, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';

export interface CompileDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/** 注册表刷新 effect（注册表变更 → 各视图重算装饰） */
const refreshDiag = StateEffect.define<null>();

// ---------------------------------------------------------------------------
// 注册表（模块级；宿主每次编译后整体替换）
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

/** 文件名归一：'./a/b.tex' → 'a/b.tex'；空段折叠 */
export function normalizeDiagFile(file: string | undefined): string {
  if (!file) return '';
  return file.replace(/\\/g, '/').replace(/^(\.\/)+/, '').trim();
}

let currentDiags: CompileDiagnostic[] = [];

/** 宿主推送一次编译的全部诊断（整体替换；空数组 = 清空标注） */
export function setCompileDiagnosticsList(diags: CompileDiagnostic[]): void {
  currentDiags = diags;
  for (const l of listeners) l();
}

/** 当前注册表快照（测试与宿主回显用） */
export function getCompileDiagnosticsList(): readonly CompileDiagnostic[] {
  return currentDiags;
}

// ---------------------------------------------------------------------------
// 纯函数：给定文档与文件名 → 命中行装饰数据（测试主战场）
// ---------------------------------------------------------------------------

export interface DiagLineHit {
  line: number; // 1-based，已夹取到文档行数
  severity: 'error' | 'warning' | 'info';
  message: string;
  column?: number;
}

/** 过滤 + 归一：diag.file 与目标文件一致（或缺 file 时不过滤？——缺 file 不展示，防误标） */
export function diagHitsForFile(
  doc: Text,
  file: string,
  diags: readonly CompileDiagnostic[],
): DiagLineHit[] {
  const target = normalizeDiagFile(file);
  const max = doc.lines;
  const hits: DiagLineHit[] = [];
  for (const d of diags) {
    if (typeof d.line !== 'number' || !Number.isFinite(d.line)) continue;
    if (normalizeDiagFile(d.file) !== target) continue;
    const line = Math.min(Math.max(1, Math.floor(d.line)), max);
    hits.push({ line, severity: d.severity, message: d.message, column: d.column });
  }
  // 同行多条：error 优先展示（装饰合并为最重级别）
  const byLine = new Map<number, DiagLineHit>();
  const rank = { error: 3, warning: 2, info: 1 } as const;
  for (const h of hits) {
    const prev = byLine.get(h.line);
    if (!prev || rank[h.severity] > rank[prev.severity]) {
      byLine.set(h.line, { ...h, message: prev ? `${prev.message}\n${h.message}` : h.message });
    } else {
      prev.message = `${prev.message}\n${h.message}`;
    }
  }
  return [...byLine.values()];
}

/** 级别 → CSS 类（styles.css 提供视觉；亮暗双主题变量） */
function lineClass(severity: DiagLineHit['severity']): string {
  return `sf-diag-line sf-diag-line--${severity}`;
}

class DiagGutterMarker extends GutterMarker {
  constructor(private readonly severity: DiagLineHit['severity'], private readonly message: string) {
    super();
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = `sf-diag-gutter sf-diag-gutter--${this.severity}`;
    el.textContent = this.severity === 'error' ? '✗' : this.severity === 'warning' ? '⚠' : '·';
    el.title = this.message; // 原生悬浮：消息全文（多行用 \n 拼接）
    return el;
  }
}

// ---------------------------------------------------------------------------
// StateField：装饰集（doc 变更 / 注册表刷新时重算）
// ---------------------------------------------------------------------------

/** 从当前注册表与文档构建行装饰 + 沟槽标记（create/update 共用） */
function buildSet(
  doc: Text,
  file: string,
): { deco: DecorationSet; markers: Map<number, DiagGutterMarker> } {
  const markers = new Map<number, DiagGutterMarker>();
  const builder: Range<Decoration>[] = [];
  for (const h of diagHitsForFile(doc, file, currentDiags)) {
    const line = doc.line(h.line);
    builder.push(Decoration.line({ class: lineClass(h.severity) }).range(line.from));
    markers.set(h.line, new DiagGutterMarker(h.severity, h.message));
  }
  builder.sort((a, b) => a.from - b.from);
  return { deco: Decoration.set(builder), markers };
}

/**
 * 编译诊断扩展（每个编辑器实例挂一次，绑定其文件名）。
 * - 行高亮 StateField：docChanged / refreshDiag 时重算；
 * - 沟槽：gutter() 的 lineMarker 按 field 内标记渲染（✗/⚠，title 悬浮全文）；
 * - hover：命中行上悬浮显示该行全部消息；
 * - 注册表侦听：宿主 setCompileDiagnosticsList → 各视图派发刷新。
 */
export function compileDiagnosticsExtension(file: string): Extension {
  const field = StateField.define<{ deco: DecorationSet; markers: Map<number, DiagGutterMarker> }>({
    create: (state) => buildSet(state.doc, file),
    update: (value, tr) => {
      if (!tr.docChanged && !tr.effects.some((e) => e.is(refreshDiag))) return value;
      return buildSet(tr.state.doc, file);
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  const hover = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const hits = diagHitsForFile(view.state.doc, file, currentDiags).filter((h) => h.line === line.number);
    if (hits.length === 0) return null;
    const dom = document.createElement('div');
    dom.className = 'sf-diag-hover';
    for (const h of hits) {
      const row = document.createElement('div');
      const tag = document.createElement('strong');
      tag.textContent = h.severity === 'error' ? '✗ ' : h.severity === 'warning' ? '⚠ ' : '· ';
      tag.style.color = h.severity === 'error' ? 'var(--err, #d9534f)' : 'var(--warn, #b8860b)';
      row.append(tag, document.createTextNode(h.message));
      dom.append(row);
    }
    return { pos: line.from, end: line.to, above: true, create: () => ({ dom }) };
  });

  return [
    field,
    gutter({
      class: 'sf-diag-gutters',
      lineMarker: (view, line) =>
        view.state.field(field).markers.get(view.state.doc.lineAt(line.from).number) ?? null,
    }),
    hover,
    ViewPlugin.fromClass(
      class {
        private readonly cb: () => void;
        constructor(view: EditorView) {
          this.cb = () => view.dispatch({ effects: refreshDiag.of(null) });
          listeners.add(this.cb);
        }
        destroy(): void {
          listeners.delete(this.cb);
        }
      },
    ),
  ];
}
