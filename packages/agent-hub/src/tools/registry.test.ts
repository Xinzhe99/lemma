import { describe, expect, it } from 'vitest';
import { createToolExecutor, PAPER_TOOLS, PAPER_TOOLS_BY_NAME, validateArgs } from './registry';

const tool = (name: string) => {
  const def = PAPER_TOOLS_BY_NAME.get(name);
  if (!def) throw new Error(`测试依赖的工具不存在：${name}`);
  return def;
};

describe('PAPER_TOOLS 注册表', () => {
  it('包含设计文档 5.3 + v3.7.0 + v5.2.0 的全部 21 个工具，id 唯一', () => {
    expect(PAPER_TOOLS).toHaveLength(21);
    const names = PAPER_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(21);
    expect(names).toContain('project.read_file');
    expect(names).toContain('project.find_in_files');
    expect(names).toContain('project.list_files');
    expect(names).toContain('tex.create_file');
    expect(names).toContain('library.search');
    expect(names).toContain('library.search_fulltext');
    expect(names).toContain('paper.read');
    expect(names).toContain('tex.compile');
    expect(names).toContain('tex.edit');
    expect(names).toContain('citation.validate');
    expect(names).toContain('project.context');
    expect(names).toContain('snapshot.create');
    expect(names).toContain('submission.checklist');
  });

  it('每个工具都有中文描述、权限分级与 object Schema', () => {
    for (const t of PAPER_TOOLS) {
      expect(t.description.length).toBeGreaterThan(4);
      expect(['read', 'execute', 'write', 'export']).toContain(t.permission);
      expect((t.parameters as { type?: string }).type).toBe('object');
    }
    expect(tool('tex.edit').permission).toBe('write');
    expect(tool('tex.compile').permission).toBe('execute');
    expect(tool('library.search').permission).toBe('read');
  });
});

describe('validateArgs', () => {
  it('合法参数返回 null', () => {
    expect(validateArgs(tool('library.search'), { query: 'diffusion' })).toBeNull();
    expect(validateArgs(tool('library.search'), { query: 'diffusion', filters: { yearFrom: 2020, readStatus: 'done' } })).toBeNull();
    expect(validateArgs(tool('paper.read'), { id: 'p1', pages: [1, 2] })).toBeNull();
    expect(validateArgs(tool('tex.last_errors'), {})).toBeNull();
  });

  it('缺少必填参数', () => {
    expect(validateArgs(tool('library.search'), {})).toMatch(/query/);
    expect(validateArgs(tool('citation.validate'), { key: 'k' })).toMatch(/claim/);
  });

  it('类型错误', () => {
    expect(validateArgs(tool('library.search'), { query: 123 })).toMatch(/query.*string/);
    expect(validateArgs(tool('paper.read'), { id: 'p', pages: '1-2' })).toMatch(/pages.*array/);
    expect(validateArgs(tool('paper.read'), { id: 'p', pages: [1, 'x'] })).toMatch(/pages\[1\].*integer/);
  });

  it('嵌套对象校验', () => {
    expect(validateArgs(tool('library.search'), { query: 'q', filters: { yearFrom: '2020' } })).toMatch(
      /filters\.yearFrom.*integer/,
    );
    expect(validateArgs(tool('citation.add'), { entry: { title: 'T' } })).toMatch(/citekey/);
    expect(validateArgs(tool('citation.add'), { entry: { citekey: 'k', title: 'T', year: 2024, authors: ['A', 'B'] } })).toBeNull();
  });

  it('enum 校验', () => {
    expect(validateArgs(tool('paper.citations'), { id: 'p', direction: 'up' })).toMatch(/枚举/);
    expect(validateArgs(tool('paper.citations'), { id: 'p', direction: 'upstream' })).toBeNull();
    expect(validateArgs(tool('library.search'), { query: 'q', filters: { readStatus: 'maybe' } })).toMatch(/枚举/);
  });
});

describe('createToolExecutor', () => {
  it('未知工具抛错', async () => {
    const executor = createToolExecutor({});
    await expect(executor.execute({ id: 'c1', tool: 'nope.nope', args: {} })).rejects.toThrow(/未知工具/);
  });

  it('校验失败抛错', async () => {
    const executor = createToolExecutor({ 'library.search': async () => 'ok' });
    await expect(executor.execute({ id: 'c1', tool: 'library.search', args: {} })).rejects.toThrow(/参数校验失败.*query/);
  });

  it('未注册处理器抛错', async () => {
    const executor = createToolExecutor({});
    await expect(executor.execute({ id: 'c1', tool: 'tex.compile', args: {} })).rejects.toThrow(/未注册处理器/);
  });

  it('校验通过后执行 handler 并返回结果', async () => {
    const executor = createToolExecutor({
      'tex.compile': async (args) => ({ compiled: true, force: args.force === true }),
    });
    await expect(executor.execute({ id: 'c1', tool: 'tex.compile', args: { force: true } })).resolves.toEqual({
      compiled: true,
      force: true,
    });
  });
});
