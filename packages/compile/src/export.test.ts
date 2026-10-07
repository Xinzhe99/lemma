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

  it('中文项目名回退为 project.zip（回归：此前得到「_____.zip」）', () => {
    expect(buildProjectZip({ 'main.tex': 'x' }, '我的论文').name).toBe('project.zip');
    expect(buildProjectZip({ 'main.tex': 'x' }, '论文A').name).toBe('_A.zip');
    expect(buildProjectZip({ 'main.tex': 'x' }, '').name).toBe('project.zip');
  });

  it('二进制附件覆盖空串占位（回归：figures/ 占位曾让投稿包图片变 0 字节）', () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    // workspace 文件表对磁盘上的图片只放空串占位（见 workspaceStore.initWorkspace）
    const files = { 'main.tex': 'x', 'figures/plot.png': '' };
    const restored = unzipSync(buildProjectZip(files, 'p', { 'figures/plot.png': png }).bytes);
    expect([...(restored['figures/plot.png'] ?? [])]).toEqual([...png]);
  });

  it('非空文本条目优先于同名二进制（不反向覆盖正文）', () => {
    const files = { 'main.tex': 'text wins', 'figures/plot.png': 'placeholder text' };
    const restored = unzipSync(
      buildProjectZip(files, 'p', { 'figures/plot.png': new Uint8Array([1, 2, 3]) }).bytes,
    );
    expect(strFromU8(restored['figures/plot.png']!)).toBe('placeholder text');
    expect(strFromU8(restored['main.tex']!)).toBe('text wins');
  });

  it('仅有二进制（文本表无该路径）时照常入包', () => {
    const png = new Uint8Array([9, 8, 7]);
    const restored = unzipSync(buildProjectZip({ 'main.tex': 'x' }, 'p', { 'figures/a.png': png }).bytes);
    expect([...(restored['figures/a.png'] ?? [])]).toEqual([9, 8, 7]);
  });
});
