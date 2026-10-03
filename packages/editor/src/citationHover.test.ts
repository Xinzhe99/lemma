/**
 * 引用悬停定位测试（v1.6.0 ①）：citeKeyAt 纯函数——
 * 单键 / 多键（逗号+空格）/ 光标边界 / 非 cite 命令不命中 / 命令带可选参数。
 */

import { describe, expect, it } from 'vitest';
import { citeKeyAt } from './citationHover';

describe('citeKeyAt', () => {
  const line = 'Prior work \\cite{vaswani2017attention} and \\citep[p.~12]{ho2020, chan2021} shows.';

  it('单键：光标在键内任一位置命中', () => {
    const at = (pos: number) => citeKeyAt(line, pos)?.key;
    expect(at(line.indexOf('vaswani') + 3)).toBe('vaswani2017attention');
    expect(at(line.indexOf('vaswani'))).toBe('vaswani2017attention');
    expect(at(line.indexOf('attention') + 8)).toBe('vaswani2017attention'); // 键末尾
  });

  it('多键（带可选参数 [p.~12]）：命中光标所在的那个键', () => {
    const at = (pos: number) => citeKeyAt(line, pos)?.key;
    expect(at(line.indexOf('ho2020') + 2)).toBe('ho2020');
    expect(at(line.indexOf('chan2021') + 4)).toBe('chan2021');
  });

  it('多键内逗号后空格：键定位正确（trim）', () => {
    const l2 = 'see \\cite{a1, b2, c3} here';
    expect(citeKeyAt(l2, l2.indexOf('b2') + 1)?.key).toBe('b2');
    expect(citeKeyAt(l2, l2.indexOf('c3') + 1)?.key).toBe('c3');
  });

  it('cite 命令之外 / 普通花括号不命中', () => {
    expect(citeKeyAt('plain {braces} here', 8)).toBeNull();
    expect(citeKeyAt('\\textbf{bold}', 8)).toBeNull();
  });

  it('返回键的行内区间（from/to）', () => {
    const l3 = 'x \\cite{key1} y';
    const hit = citeKeyAt(l3, l3.indexOf('key1') + 1);
    expect(hit).not.toBeNull();
    expect(l3.slice(hit!.from, hit!.to)).toBe('key1');
  });
});
