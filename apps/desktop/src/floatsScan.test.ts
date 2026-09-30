/**
 * floatsScan 单测：四类环境识别 / 星号变体 / algorithm2e / label+caption 提取 /
 * 嵌套花括号 caption / caption 可选参 [短标题] / 注释忽略（含 \% 转义）/ 多行 caption /
 * 同行紧凑写法 / 非浮动环境忽略 / 非 .tex 文件忽略 / 未闭合环境 / 多文件排序 / 无 floats。
 */
import { describe, expect, it } from 'vitest';
import { plainText, scanFloats, stripComment, type FloatItem } from './floatsScan';

function scanOne(doc: string, file = 'main.tex'): FloatItem[] {
  return scanFloats({ [file]: doc });
}

describe('stripComment（注释剥离，editor 包语义简化版）', () => {
  it('去掉未转义 % 及其后内容；\\% 不算注释', () => {
    expect(stripComment('\\begin{figure} % 备注')).toBe('\\begin{figure} ');
    expect(stripComment('准确率 50\\% 的对比')).toBe('准确率 50\\% 的对比');
    expect(stripComment('无注释行')).toBe('无注释行');
  });
});

describe('plainText（caption 纯文本化）', () => {
  it('去 TeX 命令与花括号、还原转义、压缩空白', () => {
    expect(plainText('{Results of} \\textbf{our method}')).toBe('Results of our method');
    expect(plainText('A 50\\% gain')).toBe('A 50% gain');
    expect(plainText('line\\\\break\nnext  gap')).toBe('line break next gap');
    expect(plainText('~引用')).toBe('引用');
  });
});

describe('scanFloats 环境识别', () => {
  it('四类环境各识别 kind 与起始行号', () => {
    const items = scanOne(
      [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\begin{figure}',
        '\\end{figure}',
        '\\begin{table}',
        '\\end{table}',
        '\\begin{equation}',
        '\\end{equation}',
        '\\begin{algorithm}',
        '\\end{algorithm}',
        '\\end{document}',
      ].join('\n'),
    );
    expect(items.map((f) => f.kind)).toEqual(['figure', 'table', 'equation', 'algorithm']);
    expect(items.map((f) => f.line)).toEqual([3, 5, 7, 9]);
    expect(items.every((f) => f.file === 'main.tex')).toBe(true);
  });

  it('星号变体归并：figure* / table* / equation* / align*', () => {
    const items = scanOne(
      [
        '\\begin{figure*}\\end{figure*}',
        '\\begin{table*}\\end{table*}',
        '\\begin{equation*}\\end{equation*}',
        '\\begin{align*}\\end{align*}',
      ].join('\n'),
    );
    expect(items.map((f) => f.kind)).toEqual(['figure', 'table', 'equation', 'equation']);
  });

  it('align 与 algorithm2e 环境分别归入式与算法', () => {
    const items = scanOne('\\begin{align}\\end{align}\n\\begin{algorithm2e}\\end{algorithm2e}');
    expect(items.map((f) => f.kind)).toEqual(['equation', 'algorithm']);
  });

  it('近似环境名不误判：aligned / figures / itemize / tabular', () => {
    expect(
      scanOne(
        '\\begin{aligned}\\end{aligned}\n\\begin{figures}\\end{figures}\n' +
          '\\begin{itemize}\\end{itemize}\n\\begin{tabular}\\end{tabular}',
      ),
    ).toEqual([]);
  });

  it('环境可带位置可选参 [htbp]，不影响识别', () => {
    const items = scanOne('\\begin{figure}[htbp]\n\\end{figure}');
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('figure');
    expect(items[0]!.line).toBe(1);
  });
});

describe('scanFloats label 与 caption 提取', () => {
  it('提取体内首个 \\label 与 \\caption（去命令后的纯文本）', () => {
    const items = scanOne(
      [
        '\\begin{figure}',
        '  \\centering',
        '  \\includegraphics{plot.pdf}',
        '  \\caption{Results of \\textbf{our method} on ImageNet}',
        '  \\label{fig:main}',
        '\\end{figure}',
      ].join('\n'),
    );
    expect(items[0]!.label).toBe('fig:main');
    expect(items[0]!.caption).toBe('Results of our method on ImageNet');
  });

  it('caption 嵌套花括号一层可完整提取', () => {
    const items = scanOne(
      '\\begin{table}\n\\caption{F1 on {SQuAD} and \\texttt{CoNLL}}\n\\end{table}',
    );
    expect(items[0]!.caption).toBe('F1 on SQuAD and CoNLL');
  });

  it('caption 带可选参 [短标题] 时取长标题', () => {
    const items = scanOne('\\begin{table}\n\\caption[短]{完整标题内容}\n\\end{table}');
    expect(items[0]!.caption).toBe('完整标题内容');
  });

  it('caption 跨行书写可提取（换行压缩为空格）', () => {
    const items = scanOne(
      ['\\begin{figure}', '\\caption{第一行', '第二行}', '\\end{figure}'].join('\n'),
    );
    expect(items[0]!.caption).toBe('第一行 第二行');
  });

  it('同行紧凑写法 begin+caption+label+end 依序处理', () => {
    const items = scanOne('\\begin{equation}\\label{eq:compact}E=mc^2\\end{equation}');
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('eq:compact');
  });

  it('无 caption / label 时字段缺省不出现', () => {
    const items = scanOne('\\begin{equation}\nx = y\n\\end{equation}');
    expect(items[0]!.label).toBeUndefined();
    expect(items[0]!.caption).toBeUndefined();
    expect(Object.keys(items[0]!).sort()).toEqual(['file', 'kind', 'line']);
  });

  it('label/caption 归属最内层嵌套环境（figure 内 equation）', () => {
    const items = scanOne(
      [
        '\\begin{figure}',
        '  \\caption{总览}',
        '  \\begin{equation}',
        '    \\label{eq:inner}',
        '  \\end{equation}',
        '\\end{figure}',
      ].join('\n'),
    );
    expect(items).toHaveLength(2);
    const inner = items.find((f) => f.kind === 'equation')!;
    const outer = items.find((f) => f.kind === 'figure')!;
    expect(inner.label).toBe('eq:inner');
    expect(inner.caption).toBeUndefined();
    expect(outer.caption).toBe('总览');
    expect(outer.label).toBeUndefined();
  });
});

describe('scanFloats 注释与容错', () => {
  it('注释行中的环境与 label 均忽略；\\% 转义不破坏识别', () => {
    const items = scanOne(
      [
        '% \\begin{figure}',
        '% \\label{fig:commented}',
        '\\begin{table} % 行尾注释 \\end{figure}',
        '\\caption{50\\% 提升}',
        '\\end{table}',
      ].join('\n'),
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('table');
    expect(items[0]!.line).toBe(3);
    expect(items[0]!.caption).toBe('50% 提升');
  });

  it('未闭合环境在文件结束时报出（导航器应显示实际内容）', () => {
    const items = scanOne('\\begin{figure}\n\\caption{未结束}');
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('figure');
    expect(items[0]!.caption).toBe('未结束');
  });
});

describe('scanFloats 文件范围与排序', () => {
  it('跨多个 .tex 文件扫描并按 file+line 排序；非 .tex 文件忽略', () => {
    const files: Record<string, string> = {
      'refs.bib': '@misc{k, title={\\begin{figure}}}',
      'sections/method.tex': '\\begin{table}\n\\end{table}\n\\begin{equation}\n\\end{equation}',
      'main.tex': '\\begin{figure}\n\\end{figure}',
      'sections/intro.tex': '\\begin{algorithm}\n\\end{algorithm}',
    };
    const items = scanFloats(files);
    expect(items.map((f) => `${f.file}:${f.kind}`)).toEqual([
      'main.tex:figure',
      'sections/intro.tex:algorithm',
      'sections/method.tex:table',
      'sections/method.tex:equation',
    ]);
  });

  it('无 floats（或空文件集）返回空数组', () => {
    expect(scanFloats({})).toEqual([]);
    expect(scanOne('% 只有注释\n\\section{引言}\n正文')).toEqual([]);
  });
});
