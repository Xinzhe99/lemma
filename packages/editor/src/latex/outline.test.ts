import { describe, expect, it } from 'vitest';
import {
  CITE_COMMANDS,
  collectCitekeys,
  collectLabels,
  parseOutline,
  stripLineComment,
} from './outline';

const doc = [
  '\\documentclass{article}',
  '% \\section{注释中的节} \\label{commented} \\cite{ghost}',
  '\\begin{document}',
  '\\section{引言}',
  '正文',
  '\\subsection{背景}',
  '\\subsection{贡献}',
  '\\section{方法}',
  '\\label{sec:method}',
  '\\subsection{实验}',
  '如 \\cite{vaswani2017, devlin2019} 所述，再次 \\citep[p.~5]{devlin2019}。',
  '详见 \\cref{eq:loss, tab:results}。',
  '\\subsubsection{数据集}',
  '\\paragraph{说明}',
  '\\% 这不是注释',
  '\\part{附录}',
  '\\chapter{第一章}',
  '\\end{document}',
].join('\n');

describe('parseOutline', () => {
  it('识别多级标题并给出层级与行号', () => {
    const nodes = parseOutline(doc);
    expect(nodes).toEqual([
      { level: 3, title: '引言', line: 4, command: 'section' },
      { level: 4, title: '背景', line: 6, command: 'subsection' },
      { level: 4, title: '贡献', line: 7, command: 'subsection' },
      { level: 3, title: '方法', line: 8, command: 'section' },
      { level: 4, title: '实验', line: 10, command: 'subsection' },
      { level: 5, title: '数据集', line: 13, command: 'subsubsection' },
      { level: 6, title: '说明', line: 14, command: 'paragraph' },
      { level: 1, title: '附录', line: 16, command: 'part' },
      { level: 2, title: '第一章', line: 17, command: 'chapter' },
    ]);
  });

  it('忽略注释行中的标题与 label', () => {
    const nodes = parseOutline('% \\section{隐藏}\n\\section{可见}');
    expect(nodes.map((n) => n.title)).toEqual(['可见']);
  });

  it('带可选参数的标题取花括号内文本', () => {
    const nodes = parseOutline('\\section[短标题]{长标题}');
    expect(nodes[0]?.title).toBe('长标题');
  });

  it('\\sectionfoo 等非分级命令不产生节点', () => {
    expect(parseOutline('\\sectionmark{x}')).toEqual([]);
  });
});

describe('stripLineComment', () => {
  it('去掉未转义 % 及其后内容', () => {
    expect(stripLineComment('\\section{A} % 备注')).toBe('\\section{A} ');
    expect(stripLineComment('% 全行注释')).toBe('');
  });

  it('\\% 不开启注释', () => {
    expect(stripLineComment('纯度 100\\% 的行')).toBe('纯度 100\\% 的行');
  });

  it('\\\\% 中 % 仍为注释（反斜杠自身被转义）', () => {
    expect(stripLineComment('换行\\\\% 注释')).toBe('换行\\\\');
  });
});

describe('collectLabels', () => {
  it('收集 \\label 并给出行号', () => {
    expect(collectLabels(doc)).toEqual([{ name: 'sec:method', line: 9 }]);
  });

  it('忽略注释中的 label，收集同一行多个 label', () => {
    const labels = collectLabels('\\label{a}% \\label{bad}\n\\label{b} 与 \\label{c}');
    expect(labels).toEqual([
      { name: 'a', line: 1 },
      { name: 'b', line: 2 },
      { name: 'c', line: 2 },
    ]);
  });
});

describe('collectCitekeys', () => {
  it('按出现顺序去重收集逗号分隔的 key', () => {
    expect(collectCitekeys(doc)).toEqual([
      'vaswani2017',
      'devlin2019',
      'eq:loss',
      'tab:results',
    ]);
  });

  it('忽略注释中的引用，容忍空段与多余空格', () => {
    const keys = collectCitekeys('\\cite{ a ,, b , }\n% \\cite{ghost}\n\\citet{x}');
    expect(keys).toEqual(['a', 'b', 'x']);
  });

  it('覆盖 natbib/biblatex/cleveref 常用命令', () => {
    const key = '\\cite{}';
    expect(CITE_COMMANDS).toContain('citep');
    expect(CITE_COMMANDS).toContain('cref');
    expect(() => collectCitekeys(key)).not.toThrow();
    expect(collectCitekeys('\\parencite{p1} \\textcite{t1}')).toEqual(['p1', 't1']);
  });
});
