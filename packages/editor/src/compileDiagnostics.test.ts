/**
 * 编译诊断标注测试（v1.5.1 D1）：文件归一 / 行夹取 / 同行合并（error 优先）/
 * 注册表整体替换 / 扩展组装冒烟（EditorState 无 DOM 构建）。
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  compileDiagnosticsExtension,
  diagHitsForFile,
  getCompileDiagnosticsList,
  normalizeDiagFile,
  setCompileDiagnosticsList,
  type CompileDiagnostic,
} from './compileDiagnostics';
import { Text } from '@codemirror/state';

const DOC = Text.of(['line one', 'line two', 'line three']);

describe('normalizeDiagFile', () => {
  it("去 './' 前缀、反斜杠归一、去空白", () => {
    expect(normalizeDiagFile('./sections/intro.tex')).toBe('sections/intro.tex');
    expect(normalizeDiagFile('.\\sections\\intro.tex')).toBe('sections/intro.tex');
    expect(normalizeDiagFile('  main.tex ')).toBe('main.tex');
    expect(normalizeDiagFile(undefined)).toBe('');
  });
});

describe('diagHitsForFile', () => {
  it('按文件命中 + 行号夹取；无 file/无 line 的诊断不展示', () => {
    const diags: CompileDiagnostic[] = [
      { severity: 'error', message: 'Undefined control sequence', file: './main.tex', line: 2 },
      { severity: 'error', message: '其他文件', file: 'other.tex', line: 1 },
      { severity: 'error', message: '无行号', file: 'main.tex' },
      { severity: 'warning', message: '无文件', line: 1 },
    ];
    const hits = diagHitsForFile(DOC, 'main.tex', diags);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 2, severity: 'error', message: 'Undefined control sequence' });
  });

  it('行号越界夹取到文档行数；同行多条合并（error 优先级覆盖，消息拼接保留）', () => {
    const diags: CompileDiagnostic[] = [
      { severity: 'warning', message: 'W1', file: 'main.tex', line: 99 },
      { severity: 'warning', message: 'W2', file: 'main.tex', line: 3 },
      { severity: 'error', message: 'E1', file: 'main.tex', line: 3 },
    ];
    const hits = diagHitsForFile(DOC, 'main.tex', diags);
    // 99 夹取到末行 3 → 与既有第 3 行组合并
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 3, severity: 'error' });
    expect(hits[0].message).toContain('W1');
    expect(hits[0].message).toContain('W2');
    expect(hits[0].message).toContain('E1');
  });
});

describe('注册表', () => {
  it('setCompileDiagnosticsList 整体替换（空数组清空）', () => {
    setCompileDiagnosticsList([{ severity: 'error', message: 'x', file: 'a.tex', line: 1 }]);
    expect(getCompileDiagnosticsList()).toHaveLength(1);
    setCompileDiagnosticsList([]);
    expect(getCompileDiagnosticsList()).toHaveLength(0);
  });
});

describe('compileDiagnosticsExtension（组装冒烟）', () => {
  it('无 DOM 构建 EditorState 不抛错；诊断注册后 hits 可按文件查询', () => {
    setCompileDiagnosticsList([{ severity: 'error', message: 'boom', file: 'main.tex', line: 1 }]);
    const state = EditorState.create({ doc: 'hello\nworld', extensions: [compileDiagnosticsExtension('main.tex')] });
    expect(state.doc.lines).toBe(2);
    expect(diagHitsForFile(state.doc, 'main.tex', getCompileDiagnosticsList())[0]?.message).toBe('boom');
    setCompileDiagnosticsList([]);
  });
});
