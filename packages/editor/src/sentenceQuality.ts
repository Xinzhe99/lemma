/**
 * 长句内联提示（v2.3.0 ②）：写作时的即时质量反馈——
 * 超过 35 词的句子以淡色虚线下划线标记（不打断写作流，与风格报告同口径）。
 *
 * 与 styleReport.ts 的 LONG_SENTENCE_WORDS 共用阈值。
 * 检测按行扫描（不做跨行句号拼接——文档级分析在风格报告做，这里只做行内即时反馈）。
 * 跳过注释行、命令行（\documentclass 等）、数学环境行。
 */

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, type Extension } from '@codemirror/state';
import { LONG_SENTENCE_WORDS } from './styleReport';

/** 行内词数（拉丁连续词计数） */
function wordCount(line: string): number {
  return (line.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
}

/** 该行是否应跳过（注释/纯命令/数学环境内部） */
function skippable(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('%')) return true;
  if (/^\\(begin|end)\{(equation|align|figure|table|theo|lemma|def)\b/.test(t)) return true;
  return false;
}

/** 构建行装饰集：长句行加淡虚线 */
function buildDecorations(doc: { lines: number; line(n: number): { from: number; to: number; text: string } }): DecorationSet {
  const builder: { from: number; deco: Decoration }[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (skippable(line.text)) continue;
    if (wordCount(line.text) > LONG_SENTENCE_WORDS) {
      builder.push({ from: line.from, deco: Decoration.line({ class: 'sf-long-sentence' }) });
    }
  }
  builder.sort((a, b) => a.from - b.from);
  const ranges = builder.map((b) => b.deco.range(b.from));
  return Decoration.set(ranges);
}

/** 长句质量扩展：doc 变化时重算行装饰 */
export function sentenceQualityExtension(): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state.doc),
    update: (value, tr) => (tr.docChanged ? buildDecorations(tr.state.doc) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
