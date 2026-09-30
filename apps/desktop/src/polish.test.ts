import { describe, expect, it } from 'vitest';
import { buildPolishPrompt, draftSectionOffline, extractLatexBody, rulePolish } from './polish';

describe('rulePolish', () => {
  it('替换冗余表达并清理空白', () => {
    const src = 'In order to  test, we utilize a number of methods due to the fact that it is very effective.';
    const out = rulePolish(src);
    expect(out).toBe('To test, we use several methods because it is effective.');
  });

  it('LaTeX 命令与结构不受影响', () => {
    const src = '\\section{Intro}\nWe  utilize data.\n\\cite{x}';
    expect(rulePolish(src)).toBe('\\section{Intro}\nWe use data.\n\\cite{x}');
  });

  it('无匹配时原样返回', () => {
    expect(rulePolish('\\begin{equation}x=1\\end{equation}')).toBe(
      '\\begin{equation}x=1\\end{equation}',
    );
  });
});

describe('buildPolishPrompt / extractLatexBody', () => {
  it('prompt 包含源码与围栏', () => {
    const p = buildPolishPrompt('\\section{T}');
    expect(p).toContain('```latex');
    expect(p).toContain('\\section{T}');
    expect(p).toContain('不要任何解释');
  });

  it('提取围栏内的 LaTeX（latex/tex/无语言标记三种）', () => {
    expect(extractLatexBody('说明文字\n```latex\n\\section{A}\n```')).toBe('\\section{A}');
    expect(extractLatexBody('```tex\nB\n```')).toBe('B');
    expect(extractLatexBody('```\nC\n```')).toBe('C');
  });

  it('无围栏时原样返回', () => {
    expect(extractLatexBody('  \\section{D}  ')).toBe('\\section{D}');
  });
});

describe('draftSectionOffline', () => {
  it('生成包含标题的结构模板', () => {
    const draft = draftSectionOffline('Discussion');
    expect(draft).toContain('\\section{Discussion}');
    expect(draft).toContain('\\subsection{动机}');
    expect(draft).toContain('离线模板起草');
  });
});
