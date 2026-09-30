import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildProjectZip, packagingChecklist } from './export';

describe('packagingChecklist', () => {
  it('完整项目全部通过', () => {
    const files = {
      'main.tex': '\\begin{abstract}A\\end{abstract}\n\\label{sec:intro}\\ref{sec:intro}\n\\includegraphics{figs/plot}\n\\bibliography{refs}',
      'refs.bib': '@article{x, title={X}}',
      'figs/plot.png': '(binary placeholder as text)',
    };
    const items = packagingChecklist(files);
    expect(items.every((i) => i.ok)).toBe(true);
    expect(items.find((i) => i.item.includes('图表'))!.detail).toContain('1 处');
  });

  it('缺失 bib / 图 / 悬空 ref / 占位符 被指出', () => {
    const files = {
      'main.tex': '\\begin{abstract}A\\end{abstract}\n\\includegraphics{figs/missing}\n\\ref{ghost}\n\\bibliography{refs}\nTODO: {TITLE}',
    };
    const items = packagingChecklist(files);
    const failed = items.filter((i) => !i.ok);
    const names = failed.map((i) => i.item).join('|');
    expect(names).toContain('参考文献');
    expect(names).toContain('图表');
    expect(names).toContain('引用可解析');
    expect(names).toContain('占位符');
  });

  it('无 .tex 时入口项失败', () => {
    const items = packagingChecklist({ 'notes.md': 'x' });
    expect(items[0]!.ok).toBe(false);
  });
});

describe('buildProjectZip', () => {
  it('打包后可解压还原全部文本文件；项目名规范化', () => {
    const files = { 'main.tex': 'hello \\TeX', 'sections/a.tex': 'A' };
    const { name, bytes } = buildProjectZip(files, 'my paper v2!');
    expect(name).toBe('my_paper_v2_.zip');
    const restored = unzipSync(bytes);
    expect(strFromU8(restored['main.tex']!)).toBe('hello \\TeX');
    expect(strFromU8(restored['sections/a.tex']!)).toBe('A');
  });
});
