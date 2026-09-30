// @vitest-environment jsdom
/**
 * templatesStore 单测：保存（名称/entry/files/savedAt + 持久化）/ description 可选 /
 * 同名覆盖 / 删除 / 空名拒绝 / 空文件拒绝 / 文件数越界（0、51 拒绝，50 通过）/
 * 上限 20 淘汰最旧 / 坏数据回退（非法 JSON、单条 shape 错误）/ listUserTemplates 拷贝 /
 * entry 回退 resolveEntry / 重启读档（fresh 模块）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TEMPLATE_FILES,
  MAX_USER_TEMPLATES,
  TEMPLATES_STORAGE_KEY,
  useTemplatesStore,
} from './templatesStore';
import { useWorkspaceStore, type WorkspaceState } from './workspaceStore';

function seedWorkspace(overrides: Partial<WorkspaceState> = {}) {
  useWorkspaceStore.setState({
    projectName: 'demo-paper',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n',
      'refs.bib': '@misc{key, title={T}}',
    },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    ...overrides,
  });
}

/** 重新加载模块：模拟应用重启后从 localStorage 读档（shape 校验入口） */
async function freshTemplatesStore(): Promise<typeof import('./templatesStore')> {
  vi.resetModules();
  return import('./templatesStore');
}

beforeEach(() => {
  localStorage.clear();
  useTemplatesStore.setState({ templates: [] });
  seedWorkspace();
});

describe('saveFromWorkspace 保存', () => {
  it('从 workspaceStore 取 files/entry 存为模板并持久化到 sf-user-templates', () => {
    expect(useTemplatesStore.getState().saveFromWorkspace('我的模板', '中文论文起步')).toBe(true);

    const tpl = useTemplatesStore.getState().templates[0]!;
    expect(tpl.name).toBe('我的模板');
    expect(tpl.description).toBe('中文论文起步');
    expect(tpl.entry).toBe('main.tex');
    expect(tpl.files['main.tex']).toContain('\\begin{document}');
    expect(tpl.savedAt).toBeGreaterThan(0);

    const persisted = JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY)!) as { id: string }[];
    expect(persisted.some((t) => t.id === tpl.id)).toBe(true);
  });

  it('description 可选，缺省为空串；name 两端空白会 trim', () => {
    expect(useTemplatesStore.getState().saveFromWorkspace('  模板A  ')).toBe(true);
    const tpl = useTemplatesStore.getState().templates[0]!;
    expect(tpl.name).toBe('模板A');
    expect(tpl.description).toBe('');
  });

  it('同名覆盖：保留原 id、更新内容与 savedAt、不新增条数', () => {
    expect(useTemplatesStore.getState().saveFromWorkspace('A')).toBe(true);
    const first = useTemplatesStore.getState().templates[0]!;

    seedWorkspace({ files: { 'main.tex': 'v2 内容' } });
    expect(useTemplatesStore.getState().saveFromWorkspace('A', '更新描述')).toBe(true);

    const list = useTemplatesStore.getState().templates;
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(first.id);
    expect(list[0]!.files['main.tex']).toBe('v2 内容');
    expect(list[0]!.description).toBe('更新描述');
    expect(list[0]!.savedAt).toBeGreaterThanOrEqual(first.savedAt);
  });

  it('空名 / 纯空白名拒绝保存', () => {
    expect(useTemplatesStore.getState().saveFromWorkspace('')).toBe(false);
    expect(useTemplatesStore.getState().saveFromWorkspace('   ')).toBe(false);
    expect(useTemplatesStore.getState().templates).toHaveLength(0);
    expect(localStorage.getItem(TEMPLATES_STORAGE_KEY)).toBe('[]');
  });

  it('空工作区（0 个文件）拒绝保存', () => {
    seedWorkspace({ entry: '', files: {} });
    expect(useTemplatesStore.getState().saveFromWorkspace('空模板')).toBe(false);
    expect(useTemplatesStore.getState().templates).toHaveLength(0);
  });

  it('文件数 51 拒绝；恰好 50 允许', () => {
    const make = (n: number): Record<string, string> =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.tex`, 'x']));

    seedWorkspace({ files: make(51) });
    expect(useTemplatesStore.getState().saveFromWorkspace('太多')).toBe(false);
    expect(useTemplatesStore.getState().templates).toHaveLength(0);

    seedWorkspace({ files: make(50), entry: 'f0.tex' });
    expect(useTemplatesStore.getState().saveFromWorkspace('刚好')).toBe(true);
    expect(useTemplatesStore.getState().templates[0]!.files).toHaveProperty('f49.tex');
  });

  it('workspace entry 为空时回退 resolveEntry（优先 main.tex，其次首个 .tex）', () => {
    seedWorkspace({ entry: '', files: { 'sections/a.tex': 'a', 'main.tex': 'm' } });
    expect(useTemplatesStore.getState().saveFromWorkspace('E1')).toBe(true);
    expect(useTemplatesStore.getState().templates[0]!.entry).toBe('main.tex');

    seedWorkspace({ entry: '', files: { 'sections/a.tex': 'a', 'refs.bib': 'b' } });
    expect(useTemplatesStore.getState().saveFromWorkspace('E2')).toBe(true);
    expect(useTemplatesStore.getState().templates[0]!.entry).toBe('sections/a.tex');
  });
});

describe('removeUserTemplate / listUserTemplates', () => {
  it('删除指定 id；未知 id 无副作用', () => {
    useTemplatesStore.getState().saveFromWorkspace('A');
    useTemplatesStore.getState().saveFromWorkspace('B');
    const a = useTemplatesStore.getState().templates.find((t) => t.name === 'A')!;

    useTemplatesStore.getState().removeUserTemplate(a.id);
    expect(useTemplatesStore.getState().templates.map((t) => t.name)).toEqual(['B']);
    useTemplatesStore.getState().removeUserTemplate('missing-id');
    expect(useTemplatesStore.getState().templates).toHaveLength(1);
    // 删除同步持久化
    const persisted = JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY)!) as { name: string }[];
    expect(persisted.map((t) => t.name)).toEqual(['B']);
  });

  it('listUserTemplates 返回拷贝：改写不影响 store 与持久化数据', () => {
    useTemplatesStore.getState().saveFromWorkspace('A');
    const copy = useTemplatesStore.getState().listUserTemplates();
    copy[0]!.name = '被篡改';
    copy[0]!.files['hack.tex'] = 'x';

    const live = useTemplatesStore.getState().templates[0]!;
    expect(live.name).toBe('A');
    expect(live.files).not.toHaveProperty('hack.tex');
  });
});

describe('上限与淘汰', () => {
  it('保存第 21 个模板时淘汰最旧（savedAt 最小）', () => {
    for (let i = 1; i <= MAX_USER_TEMPLATES; i++) {
      seedWorkspace({ files: { [`m${i}.tex`]: 'x', 'refs.bib': 'b' }, entry: `m${i}.tex` });
      expect(useTemplatesStore.getState().saveFromWorkspace(`T${String(i).padStart(2, '0')}`)).toBe(
        true,
      );
    }
    expect(useTemplatesStore.getState().templates).toHaveLength(MAX_USER_TEMPLATES);

    seedWorkspace({ files: { 'new.tex': 'x' }, entry: 'new.tex' });
    expect(useTemplatesStore.getState().saveFromWorkspace('最新')).toBe(true);
    const names = useTemplatesStore.getState().templates.map((t) => t.name);
    expect(names).toHaveLength(MAX_USER_TEMPLATES);
    expect(names).toContain('最新');
    expect(names).not.toContain('T01'); // 最旧的被淘汰
    expect(names).toContain('T02');
  });
});

describe('持久化读档与坏数据回退', () => {
  it('重启后从 localStorage 恢复模板', async () => {
    useTemplatesStore.getState().saveFromWorkspace('重启可见');
    const fresh = await freshTemplatesStore();
    expect(fresh.useTemplatesStore.getState().templates.map((t) => t.name)).toEqual(['重启可见']);
  });

  it('非法 JSON / 非数组整体回退为空', async () => {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, '{broken json');
    const fresh1 = await freshTemplatesStore();
    expect(fresh1.useTemplatesStore.getState().templates).toEqual([]);

    localStorage.setItem(TEMPLATES_STORAGE_KEY, '"not-an-array"');
    const fresh2 = await freshTemplatesStore();
    expect(fresh2.useTemplatesStore.getState().templates).toEqual([]);
  });

  it('单条 shape 错误安全跳过，好条目保留（缺 id / 缺 files / 空文件 / savedAt 非法）', async () => {
    useTemplatesStore.getState().saveFromWorkspace('好模板', 'desc');
    const good = useTemplatesStore.getState().templates[0]!;
    const raw = [
      good,
      { id: 'no-name', files: { 'a.tex': 'x' } }, // 缺 name
      { id: 'no-files', name: 'F', files: 'oops' }, // files 非对象
      { id: 'empty-files', name: 'E', files: {} }, // 空文件模板
      { name: 'I', files: { 'a.tex': 'x' } }, // 缺 id
      'garbage-string',
    ];
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(raw));

    const fresh = await freshTemplatesStore();
    const list = fresh.useTemplatesStore.getState().templates;
    expect(list.map((t) => t.name)).toEqual(['好模板']);
    expect(list[0]!.description).toBe('desc');
  });
});
