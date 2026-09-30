import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseProjectZip } from './zip';

function buildZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]),
    ),
  );
}

const MAIN = '\\documentclass{article}\n\\begin{document}\nhello\n\\end{document}\n';
const SUB = '\\section{Intro}\ntext\n';

describe('parseProjectZip', () => {
  it('解析 Overleaf 风格项目：入口 main.tex，文本全部收集', () => {
    const zip = buildZip({
      'main.tex': MAIN,
      'sections/intro.tex': SUB,
      'refs.bib': '@article{a, title={A}, year={2020}}',
      'README.md': '# demo',
    });
    const parsed = parseProjectZip(zip);
    expect(parsed.entry).toBe('main.tex');
    expect(Object.keys(parsed.files).sort()).toEqual(['README.md', 'main.tex', 'refs.bib', 'sections/intro.tex']);
    expect(parsed.files['main.tex']).toBe(MAIN);
    expect(parsed.skippedBinary).toEqual([]);
  });

  it('无 main.tex 时选择含 documentclass 的最浅 .tex 为入口', () => {
    const zip = buildZip({
      'paper/chapter1.tex': SUB,
      'paper/report.tex': MAIN,
      '__MACOSX/paper/junk': 'skip me',
      'paper/figure1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const parsed = parseProjectZip(zip);
    expect(parsed.entry).toBe('paper/report.tex');
    expect(parsed.files['__MACOSX/paper/junk']).toBeUndefined();
    expect(parsed.files['paper/figure1.png']).toBeUndefined();
    expect(parsed.skippedBinary).toContain('paper/figure1.png');
  });

  it('反斜杠路径（Windows zip）可解析', () => {
    const zip = buildZip({ 'sections\\intro.tex': SUB, 'main.tex': MAIN });
    const parsed = parseProjectZip(zip);
    expect(parsed.files['sections/intro.tex']).toBe(SUB);
  });

  it('无 .tex 时抛中文错误；损坏数据抛解压错误', () => {
    const onlyBib = buildZip({ 'refs.bib': '@misc{x, title={X}}' });
    expect(() => parseProjectZip(onlyBib)).toThrow('未找到 .tex');
    expect(() => parseProjectZip(new Uint8Array([1, 2, 3, 4]))).toThrow('无法解压');
  });
});
