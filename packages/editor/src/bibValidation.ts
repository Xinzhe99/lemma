/**
 * BibTeX 缺字段提示（v2.7.0 ③）：.bib 文件中每个条目检查
 * author / title / year 是否缺失，缺失的条目行加黄色边线。
 *
 * 纯函数：parse → validate → 装饰行号列表。
 */

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, type Extension } from '@codemirror/state';

/** 必填字段（缺了会编译出空引用） */
const REQUIRED = ['author', 'title', 'year'] as const;

export interface BibEntry {
  startLine: number;
  missing: string[];
}

/** 扫描 BibTeX 文本，返回每个条目的起始行号与缺失字段列表 */
export function validateBibtex(text: string): BibEntry[] {
  const lines = text.split('\n');
  const entries: BibEntry[] = [];
  let current: { start: number; fields: Set<string> } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // @article{key, 或 @inproceedings{key,
    const begin = /^@\w+\{/.exec(trimmed);
    if (begin) {
      if (current) entries.push(toEntry(current));
      current = { start: i + 1, fields: new Set() };
      continue;
    }

    if (trimmed === '}') {
      if (current) {
        entries.push(toEntry(current));
        current = null;
      }
      continue;
    }

    // 字段行： key = {value} 或 key = "value"
    if (current) {
      const field = /^\s*(\w+)\s*=/.exec(line);
      if (field) current.fields.add(field[1]!.toLowerCase());
    }
  }
  if (current) entries.push(toEntry(current));

  return entries;
}

function toEntry(c: { start: number; fields: Set<string> }): BibEntry {
  const missing = REQUIRED.filter((f) => !c.fields.has(f));
  return { startLine: c.start, missing: [...missing] };
}

/** 构建 .bib 验证装饰集 */
function buildDecorations(doc: { lines: number; line(n: number): { from: number; text: string } }): DecorationSet {
  const text = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text).join('\n');
  const entries = validateBibtex(text);
  const ranges = entries
    .filter((e) => e.missing.length > 0)
    .map((e) =>
      Decoration.line({
        class: 'sf-bib-missing-field',
      }).range(doc.line(e.startLine).from),
    );
  return Decoration.set(ranges);
}

/** .bib 文件验证扩展 */
export function bibValidationExtension(): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state.doc),
    update: (value, tr) => (tr.docChanged ? buildDecorations(tr.state.doc) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
