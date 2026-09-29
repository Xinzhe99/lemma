// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DiffView } from './DiffView';

// 测试模块图统一使用根 node_modules 的 React（与 react-dom/@testing-library 同实例），
// 规避本包嵌套 react 18 与根 react 19 的双实例冲突。见 test-utils/root-react.ts。
vi.mock('react', async () => {
  const { rootReactRequire } = await import('../test-utils/root-react');
  const mod = rootReactRequire()('react');
  return { ...mod, default: mod };
});

vi.mock('react/jsx-runtime', async () => {
  const { rootReactRequire } = await import('../test-utils/root-react');
  const mod = rootReactRequire()('react/jsx-runtime');
  return { ...mod, default: mod };
});

// TSX 在测试环境编译为 react/jsx-dev-runtime，同样需要重定向
vi.mock('react/jsx-dev-runtime', async () => {
  const { rootReactRequire } = await import('../test-utils/root-react');
  const mod = rootReactRequire()('react/jsx-dev-runtime');
  return { ...mod, default: mod };
});

describe('DiffView', () => {
  it('渲染增删行、行号与文件名统计', () => {
    const { container } = render(
      <DiffView
        before={'第一行\n旧二\n第三行\n'}
        after={'第一行\n新二\n第三行\n追加\n'}
        filename="main.tex"
      />,
    );

    expect(container.querySelector('.sf-diff-filename')?.textContent).toBe('main.tex');
    expect(container.querySelector('.sf-diff-adds')?.textContent).toBe('+2');
    expect(container.querySelector('.sf-diff-dels')?.textContent).toBe('-1');

    const adds = Array.from(container.querySelectorAll('[data-kind="add"]'));
    const dels = Array.from(container.querySelectorAll('[data-kind="del"]'));
    const ctx = Array.from(container.querySelectorAll('[data-kind="context"]'));

    expect(adds).toHaveLength(2);
    expect(dels).toHaveLength(1);
    expect(ctx).toHaveLength(2);
    expect(adds[0]!.textContent).toContain('+ 新二');
    expect(adds[1]!.textContent).toContain('+ 追加');
    expect(dels[0]!.textContent).toContain('- 旧二');
    expect(ctx[0]!.textContent).toContain('第一行');
  });

  it('新旧行号各按自身序列递增', () => {
    const { container } = render(
      <DiffView before={'a\nb\nc\n'} after={'a\nx\nc\n'} filename="f.tex" />,
    );
    const rows = Array.from(container.querySelectorAll('[data-kind]'));
    // 行结构：[oldNo, newNo, text] 三个 span
    const number = (row: Element, i: number) => row.children[i]?.textContent ?? '';
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['context', 'del', 'add', 'context']);
    expect(number(rows[0]!, 0)).toBe('1');
    expect(number(rows[0]!, 1)).toBe('1');
    expect(number(rows[1]!, 0)).toBe('2'); // 旧行号 2 被删除
    expect(number(rows[1]!, 1)).toBe('');
    expect(number(rows[2]!, 0)).toBe('');
    expect(number(rows[2]!, 1)).toBe('2'); // 新行号 2 为新增
    expect(number(rows[3]!, 0)).toBe('3');
    expect(number(rows[3]!, 1)).toBe('3');
  });

  it('无差异时增删统计为 0 且全部为上下文行', () => {
    const { container } = render(<DiffView before={'相同\n内容\n'} after={'相同\n内容\n'} />);
    expect(container.querySelectorAll('[data-kind="add"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-kind="context"]')).toHaveLength(2);
    expect(container.querySelector('.sf-diff-adds')?.textContent).toBe('+0');
    expect(container.querySelector('.sf-diff-dels')?.textContent).toBe('-0');
  });

  it('缺省文件名显示占位标题', () => {
    const { container } = render(<DiffView before="a" after="b" />);
    expect(container.querySelector('.sf-diff-filename')?.textContent).toBe('变更对比');
  });
});
