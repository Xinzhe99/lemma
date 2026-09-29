import { describe, expect, it } from 'vitest';
import { diagnosticHint } from './quickfix';

function hint(message: string, severity: 'error' | 'warning' | 'info' = 'error'): string | undefined {
  return diagnosticHint({ severity, message });
}

describe('diagnosticHint', () => {
  it('常见错误均能命中中文提示（≥10 条规则）', () => {
    const cases: Array<[string, string]> = [
      ['Undefined control sequence.', '拼写'],
      ['Missing $ inserted.', '数学模式'],
      ["LaTeX Error: File `algorithms.sty' not found.", '文件名'],
      ["Citation `knuth84' on page 1 undefined on input line 12.", 'citekey'],
      ["Reference `fig:overview' on page 2 undefined on input line 45.", 'label'],
      ['There were undefined references.', '再编译'],
      ['Label(s) may have changed. Rerun to get cross-references right.', '再编译'],
      ["Label `eq:1' multiply defined.", '重复'],
      ['Overfull \\hbox (28.45274pt too wide) in paragraph at lines 34--40', '版心'],
      ['Underfull \\hbox (badness 10000) in paragraph at lines 50--55', '排版'],
      ['LaTeX Error: Environment align undefined.', '环境名'],
      ['LaTeX Error: Can be used only in preamble.', '导言区'],
      ['Runaway argument?', '配对'],
      ["\\begin{itemize} ended by \\end{enumerate}", '一致'],
    ];
    for (const [message, keyword] of cases) {
      const h = hint(message);
      expect(h, `message=${message}`).toBeDefined();
      expect(h).toContain(keyword);
    }
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('未知消息返回 undefined', () => {
    expect(hint('Something entirely unknown happened')).toBeUndefined();
  });

  it('命中其一即返回（不叠加）且提示为中文', () => {
    const h = hint('Undefined control sequence.');
    expect(typeof h).toBe('string');
    expect(/[\u4e00-\u9fff]/.test(h as string)).toBe(true);
  });
});
