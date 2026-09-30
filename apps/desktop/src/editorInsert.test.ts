import { describe, expect, it, vi } from 'vitest';
import { insertAtCursor, setInsertHandler } from './editorInsert';

describe('editorInsert 插入桥', () => {
  it('无 handler 时 insertAtCursor 返回 false 且不抛错', () => {
    setInsertHandler(null);
    expect(insertAtCursor('\\begin{tabular}{c}')).toBe(false);
  });

  it('注册 handler 后返回 true，并把代码原样交给 handler', () => {
    const received: string[] = [];
    setInsertHandler((code) => received.push(code));
    expect(insertAtCursor('X & Y \\\\')).toBe(true);
    expect(received).toEqual(['X & Y \\\\']);
    setInsertHandler(null);
  });

  it('setInsertHandler(null) 清理后恢复 false', () => {
    setInsertHandler(vi.fn());
    setInsertHandler(null);
    expect(insertAtCursor('anything')).toBe(false);
  });
});
