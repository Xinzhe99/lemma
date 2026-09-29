// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { LatexEditor } from './LatexEditor';

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

afterEach(cleanup);

describe('LatexEditor', () => {
  it('挂载初始内容，编辑器内可见文本', () => {
    let view: EditorView | null = null;
    render(
      <LatexEditor
        value={'\\section{引言}\n正文'}
        onEditorReady={(v) => {
          view = v;
        }}
      />,
    );
    expect(view).toBeInstanceOf(EditorView);
    expect(view!.state.doc.toString()).toBe('\\section{引言}\n正文');
    expect(document.querySelector('.cm-content')?.textContent).toContain('引言');
    expect(document.querySelector('.cm-editor')).toBeTruthy();
  });

  it('输入触发 onChange', () => {
    let view: EditorView | null = null;
    const onChange = vi.fn();
    render(
      <LatexEditor
        value={'第一行\n第二行'}
        onChange={onChange}
        onEditorReady={(v) => {
          view = v;
        }}
      />,
    );
    act(() => {
      view!.dispatch({ selection: { anchor: view!.state.doc.length } });
      view!.dispatch(view!.state.replaceSelection('追加'));
    });
    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('第一行\n第二行追加');
  });

  it('外部 value 更新生效且不触发 onChange 回声', () => {
    let view: EditorView | null = null;
    const onChange = vi.fn();
    const onReady = (v: EditorView | null) => {
      view = v;
    };
    const initial = { value: 'aaa', onChange, onEditorReady: onReady };
    const { rerender } = render(<LatexEditor {...initial} />);
    act(() => {
      view!.dispatch({ changes: { from: 3, insert: 'bbb' } });
    });
    expect(onChange).toHaveBeenLastCalledWith('aaabbb');

    onChange.mockClear();
    rerender(<LatexEditor {...initial} value="全新的外部内容" />);
    expect(view!.state.doc.toString()).toBe('全新的外部内容');
    expect(onChange).not.toHaveBeenCalled();

    // 相同 value 不再 dispatch
    rerender(<LatexEditor {...initial} value="全新的外部内容" />);
    expect(view!.state.doc.toString()).toBe('全新的外部内容');
  });

  it('外部 value 局部变化做最小替换（仅替换变化区间）', () => {
    let view: EditorView | null = null;
    const spans: { from: number; to: number; inserted: string }[] = [];
    const trackChanges = EditorView.updateListener.of((vu) => {
      for (const tr of vu.transactions) {
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) =>
          spans.push({ from: fromA, to: toA, inserted: inserted.toString() }),
        );
      }
    });
    const props = {
      value: 'introduction\nbody\n',
      extraExtensions: [trackChanges],
      onEditorReady: (v: EditorView | null) => {
        view = v;
      },
    };
    const { rerender } = render(<LatexEditor {...props} />);
    spans.length = 0;
    // 模拟 AI 只改中间一段：在 body 前插入 'revised '
    rerender(<LatexEditor {...props} value={'introduction\nrevised body\n'} />);
    expect(view!.state.doc.toString()).toBe('introduction\nrevised body\n');
    // 仅一个 8 字符的纯插入事务，而非整篇 18 字符替换
    expect(spans).toHaveLength(1);
    expect(spans[0]!.inserted).toBe('revised ');
    expect(spans[0]!.to - spans[0]!.from).toBe(0);
  });

  it('光标移动回调行号', () => {
    let view: EditorView | null = null;
    const onCursorLine = vi.fn();
    render(
      <LatexEditor
        value={'a\nb\nc'}
        onCursorLine={onCursorLine}
        onEditorReady={(v) => {
          view = v;
        }}
      />,
    );
    expect(onCursorLine).toHaveBeenCalledWith(1);
    onCursorLine.mockClear();
    act(() => {
      view!.dispatch({ selection: { anchor: view!.state.doc.line(3).from } });
    });
    expect(onCursorLine).toHaveBeenCalledWith(3);
    expect(onCursorLine).not.toHaveBeenCalledWith(2);
  });

  it('卸载时销毁编辑器并回调 null', () => {
    let view: EditorView | null = null;
    const onReady = vi.fn((v: EditorView | null) => {
      view = v;
    });
    const { unmount } = render(<LatexEditor value="x" onEditorReady={onReady} />);
    expect(onReady).toHaveBeenCalledWith(view);
    unmount();
    expect(onReady).toHaveBeenLastCalledWith(null);
    expect(document.querySelector('.cm-editor')).toBeNull();
  });
});
