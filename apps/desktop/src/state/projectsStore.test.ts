// @vitest-environment jsdom
/**
 * projectsStore 单测：保存/打开（文件与页签恢复）/同名覆盖/重命名/复制/删除/
 * 上限淘汰（__current__ 不计入）/损坏持久化安全回退/P1 临时记录（saveCurrentTemp / promoteCurrent）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_PROJECT_ID,
  MAX_PROJECTS,
  PROJECTS_STORAGE_KEY,
  useProjectsStore,
} from './projectsStore';
import { useWorkspaceStore, type WorkspaceState } from './workspaceStore';

function seedWorkspace(overrides: Partial<WorkspaceState> = {}) {
  useWorkspaceStore.setState({
    projectName: 'demo-paper',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n',
      'refs.bib': '@misc{key, title={T}}',
    },
    openTabs: ['main.tex', 'refs.bib'],
    activeTab: 'refs.bib',
    snapshots: { 'main.tex': [{ content: '初始版本', ts: 1, label: 'v0' }] },
    ...overrides,
  });
}

const formal = () => useProjectsStore.getState().projects.filter((p) => p.id !== CURRENT_PROJECT_ID);

/** 重新加载模块：模拟应用重启后从 localStorage 读档（shape 校验入口） */
async function freshProjectsStore(): Promise<typeof import('./projectsStore')> {
  vi.resetModules();
  return import('./projectsStore');
}

beforeEach(() => {
  localStorage.clear();
  useProjectsStore.setState({ projects: [] });
  seedWorkspace();
});

describe('saveCurrent 保存当前项目', () => {
  it('从 workspaceStore 取当前状态存为记录并持久化到 sf-projects', () => {
    const id = useProjectsStore.getState().saveCurrent('论文A');
    const rec = useProjectsStore.getState().projects.find((p) => p.id === id);
    expect(rec).toBeTruthy();
    expect(rec!.name).toBe('论文A');
    expect(rec!.snapshot.projectName).toBe('demo-paper');
    expect(rec!.snapshot.entry).toBe('main.tex');
    expect(rec!.snapshot.files['main.tex']).toContain('\\begin{document}');
    expect(rec!.snapshot.openTabs).toEqual(['main.tex', 'refs.bib']);
    expect(rec!.snapshot.activeTab).toBe('refs.bib');
    expect(rec!.snapshot.snapshots['main.tex']![0]!.label).toBe('v0');

    const persisted = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!) as { id: string }[];
    expect(persisted.some((r) => r.id === id)).toBe(true);
  });

  it('name 缺省用当前 projectName；为空时回退「未命名项目」', () => {
    const id1 = useProjectsStore.getState().saveCurrent();
    expect(useProjectsStore.getState().projects.find((p) => p.id === id1)!.name).toBe('demo-paper');

    seedWorkspace({ projectName: '' });
    const id2 = useProjectsStore.getState().saveCurrent('   ');
    expect(useProjectsStore.getState().projects.find((p) => p.id === id2)!.name).toBe('未命名项目');
  });

  it('同名覆盖：保留原 id、更新快照、不新增条数', () => {
    const id1 = useProjectsStore.getState().saveCurrent('A');
    seedWorkspace({ files: { 'main.tex': 'v2 内容' } });
    const id2 = useProjectsStore.getState().saveCurrent('A');

    expect(id2).toBe(id1);
    expect(formal()).toHaveLength(1);
    const rec = useProjectsStore.getState().projects.find((p) => p.id === id1)!;
    expect(rec.snapshot.files['main.tex']).toBe('v2 内容');
  });
});

describe('openProject 打开项目', () => {
  it('恢复文件、页签与文件快照到 workspaceStore，并清除过期的临时记录', () => {
    const id = useProjectsStore.getState().saveCurrent('论文A');
    useProjectsStore.getState().saveCurrentTemp(); // 模拟切换器挂载过的临时记录

    // 破坏现场：载入另一个项目
    useWorkspaceStore.getState().loadProject('other', 'other.tex', { 'other.tex': 'other' });
    expect(useWorkspaceStore.getState().projectName).toBe('other');

    expect(useProjectsStore.getState().openProject(id)).toBe(true);
    const s = useWorkspaceStore.getState();
    expect(s.projectName).toBe('demo-paper');
    expect(s.entry).toBe('main.tex');
    expect(Object.keys(s.files).sort()).toEqual(['main.tex', 'refs.bib']);
    expect(s.openTabs).toEqual(['main.tex', 'refs.bib']);
    expect(s.activeTab).toBe('refs.bib');
    expect(s.snapshots['main.tex']![0]!.content).toBe('初始版本');
    expect(useProjectsStore.getState().projects.some((p) => p.id === CURRENT_PROJECT_ID)).toBe(false);
  });

  it('未知 id 与临时记录 id 返回 false', () => {
    expect(useProjectsStore.getState().openProject('missing-id')).toBe(false);
    expect(useProjectsStore.getState().openProject(CURRENT_PROJECT_ID)).toBe(false);
  });
});

describe('renameProject / duplicateProject / removeProject', () => {
  it('重命名更新记录名与快照内 projectName；空名不生效；重开后项目名一致', () => {
    const id = useProjectsStore.getState().saveCurrent('旧名');
    useWorkspaceStore.getState().loadProject('other', 'other.tex', { 'other.tex': 'x' });

    useProjectsStore.getState().renameProject(id, '   ');
    expect(useProjectsStore.getState().projects.find((p) => p.id === id)!.name).toBe('旧名');

    useProjectsStore.getState().renameProject(id, '新名');
    const rec = useProjectsStore.getState().projects.find((p) => p.id === id)!;
    expect(rec.name).toBe('新名');
    expect(rec.snapshot.projectName).toBe('新名');

    useProjectsStore.getState().openProject(id);
    expect(useWorkspaceStore.getState().projectName).toBe('新名');
  });

  it('复制副本：新 id、名称加「副本」、快照深拷贝；未知 id 返回 null', () => {
    const id = useProjectsStore.getState().saveCurrent('A');
    const dupId = useProjectsStore.getState().duplicateProject(id);
    expect(dupId).not.toBeNull();
    expect(dupId).not.toBe(id);

    const src = useProjectsStore.getState().projects.find((p) => p.id === id)!;
    const dup = useProjectsStore.getState().projects.find((p) => p.id === dupId!)!;
    expect(dup.name).toBe('A 副本');
    expect(dup.snapshot).toEqual(src.snapshot);
    expect(dup.snapshot.files).not.toBe(src.snapshot.files);
    expect(dup.snapshot.openTabs).not.toBe(src.snapshot.openTabs);

    expect(useProjectsStore.getState().duplicateProject('missing-id')).toBeNull();
  });

  it('删除记录并同步持久化', () => {
    const id = useProjectsStore.getState().saveCurrent('A');
    useProjectsStore.getState().removeProject(id);

    expect(useProjectsStore.getState().projects.find((p) => p.id === id)).toBeUndefined();
    const persisted = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!) as { id: string }[];
    expect(persisted.some((r) => r.id === id)).toBe(false);
  });
});

describe('上限与临时记录', () => {
  it('正式记录上限 20：超出挤掉最旧（savedAt 最小）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      for (let i = 0; i <= 20; i++) {
        useProjectsStore.getState().saveCurrent(`p-${String(i).padStart(2, '0')}`);
        vi.setSystemTime(Date.now() + 1000);
      }
    } finally {
      vi.useRealTimers();
    }

    const projects = formal();
    expect(projects).toHaveLength(MAX_PROJECTS);
    expect(projects.find((p) => p.name === 'p-00')).toBeUndefined(); // 最旧被挤掉
    expect(projects.find((p) => p.name === 'p-20')).toBeDefined(); // 最新保留
    const persisted = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!) as unknown[];
    expect(persisted).toHaveLength(MAX_PROJECTS);
  });

  it('临时记录 __current__ 不计入上限、不被挤掉', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      for (let i = 0; i < MAX_PROJECTS; i++) {
        useProjectsStore.getState().saveCurrent(`p-${i}`);
        vi.setSystemTime(Date.now() + 1000);
      }
      useProjectsStore.getState().saveCurrentTemp(); // 满员后写入临时记录
      expect(useProjectsStore.getState().projects).toHaveLength(MAX_PROJECTS + 1);

      vi.setSystemTime(Date.now() + 1000);
      useProjectsStore.getState().saveCurrent('p-new'); // 第 21 个正式记录 → 挤掉最旧
    } finally {
      vi.useRealTimers();
    }

    const projects = useProjectsStore.getState().projects;
    expect(projects.filter((p) => p.id !== CURRENT_PROJECT_ID)).toHaveLength(MAX_PROJECTS);
    expect(projects.find((p) => p.id === CURRENT_PROJECT_ID)).toBeDefined();
    expect(projects.find((p) => p.name === 'p-0')).toBeUndefined();
  });

  it('saveCurrentTemp：固定 id 幂等覆盖并置顶，名称取当前 projectName', () => {
    const formalId = useProjectsStore.getState().saveCurrent('A');
    useProjectsStore.getState().saveCurrentTemp();

    let projects = useProjectsStore.getState().projects;
    expect(projects[0]!.id).toBe(CURRENT_PROJECT_ID);
    expect(projects[0]!.name).toBe('demo-paper');
    expect(projects[0]!.snapshot.openTabs).toEqual(['main.tex', 'refs.bib']);
    expect(projects.find((p) => p.id === formalId)).toBeDefined();

    seedWorkspace({ projectName: 'changed' });
    useProjectsStore.getState().saveCurrentTemp();
    projects = useProjectsStore.getState().projects;
    expect(projects.filter((p) => p.id === CURRENT_PROJECT_ID)).toHaveLength(1);
    expect(projects[0]!.name).toBe('changed');
  });

  it('promoteCurrent：临时记录转正式（沿用名称与快照，同名覆盖），并移除临时记录', () => {
    useProjectsStore.getState().saveCurrentTemp();
    const id = useProjectsStore.getState().promoteCurrent();
    expect(id).not.toBeNull();
    expect(id).not.toBe(CURRENT_PROJECT_ID);

    const rec = useProjectsStore.getState().projects.find((p) => p.id === id)!;
    expect(rec.name).toBe('demo-paper');
    expect(rec.snapshot.activeTab).toBe('refs.bib');
    expect(useProjectsStore.getState().projects.some((p) => p.id === CURRENT_PROJECT_ID)).toBe(false);

    // 再次 temp + 转正式 → 同名覆盖回同一 id；无临时记录时返回 null
    useProjectsStore.getState().saveCurrentTemp();
    expect(useProjectsStore.getState().promoteCurrent()).toBe(id);
    expect(useProjectsStore.getState().promoteCurrent()).toBeNull();
  });
});

describe('损坏持久化安全回退（重启读档）', () => {
  it('整段坏数据（非 JSON / 非数组）：回退为空列表', async () => {
    localStorage.setItem(PROJECTS_STORAGE_KEY, '{oops-not-json');
    let mod = await freshProjectsStore();
    expect(mod.useProjectsStore.getState().projects).toEqual([]);

    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    mod = await freshProjectsStore();
    expect(mod.useProjectsStore.getState().projects).toEqual([]);
  });

  it('混合坏数据：仅合法记录保留，非法条目被跳过', async () => {
    const id = useProjectsStore.getState().saveCurrent('好的项目');
    const persisted = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!) as unknown[];
    localStorage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify([persisted[0], '垃圾字符串', { id: 123, name: 'x' }, null, { id: 'r2', name: '缺快照' }]),
    );

    const mod = await freshProjectsStore();
    const projects = mod.useProjectsStore.getState().projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]!.id).toBe(id);
    expect(projects[0]!.name).toBe('好的项目');
  });

  it('合法记录完整往返：快照逐字段还原（含文件快照与页签）', async () => {
    seedWorkspace();
    const id = useProjectsStore.getState().saveCurrent('往返');

    const mod = await freshProjectsStore();
    const rec = mod.useProjectsStore.getState().projects.find((p) => p.id === id)!;
    expect(rec).toBeTruthy();
    expect(rec.snapshot.files['main.tex']).toContain('\\begin{document}');
    expect(rec.snapshot.openTabs).toEqual(['main.tex', 'refs.bib']);
    expect(rec.snapshot.activeTab).toBe('refs.bib');
    expect(rec.snapshot.snapshots['main.tex']![0]!.content).toBe('初始版本');
  });
});

describe('dir 字段（新建项目选择本地路径）', () => {
  it('saveCurrent：把 workspace.projectDir 持久化到记录；无绑定为 undefined', () => {
    seedWorkspace({ projectDir: 'D:\\papers\\a' });
    const id = useProjectsStore.getState().saveCurrent('带目录');
    expect(useProjectsStore.getState().projects.find((p) => p.id === id)!.dir).toBe('D:\\papers\\a');

    seedWorkspace({ projectDir: null });
    const id2 = useProjectsStore.getState().saveCurrent('无目录');
    expect(useProjectsStore.getState().projects.find((p) => p.id === id2)!.dir).toBeUndefined();
  });

  it('同名覆盖：工作区无绑定时保留旧记录的 dir；有绑定时以工作区为准', () => {
    seedWorkspace({ projectDir: 'D:\\old' });
    const id = useProjectsStore.getState().saveCurrent('A');

    seedWorkspace({ projectDir: null });
    useProjectsStore.getState().saveCurrent('A');
    expect(useProjectsStore.getState().projects.find((p) => p.id === id)!.dir).toBe('D:\\old');

    seedWorkspace({ projectDir: 'D:\\new' });
    useProjectsStore.getState().saveCurrent('A');
    expect(useProjectsStore.getState().projects.find((p) => p.id === id)!.dir).toBe('D:\\new');
  });

  it('openProject：恢复记录的目录绑定到 workspace.projectDir；无绑定恢复为 null', () => {
    seedWorkspace({ projectDir: 'D:\\papers\\a' });
    const id = useProjectsStore.getState().saveCurrent('带目录');

    useWorkspaceStore.getState().loadProject('other', 'other.tex', { 'other.tex': 'x' }, 'D:\\elsewhere');
    expect(useProjectsStore.getState().openProject(id)).toBe(true);
    expect(useWorkspaceStore.getState().projectDir).toBe('D:\\papers\\a');

    seedWorkspace({ projectDir: null });
    const id2 = useProjectsStore.getState().saveCurrent('无目录');
    useProjectsStore.getState().openProject(id2);
    expect(useWorkspaceStore.getState().projectDir).toBeNull();
  });

  it('向后兼容：旧记录无 dir 字段照常工作（读档不报错、dir 为 undefined）', async () => {
    const id = useProjectsStore.getState().saveCurrent('旧格式');
    const persisted = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!) as Record<string, unknown>[];
    // 模拟旧版本持久化：抹掉 dir 字段
    localStorage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify(persisted.map((r) => ({ ...r, dir: undefined }))),
    );

    const mod = await freshProjectsStore();
    const wsMod = await import('./workspaceStore'); // resetModules 后与 mod 同一实例
    const rec = mod.useProjectsStore.getState().projects.find((p) => p.name === '旧格式')!;
    expect(rec).toBeTruthy();
    expect(rec.dir).toBeUndefined();
    expect(mod.useProjectsStore.getState().openProject(id)).toBe(true);
    expect(wsMod.useWorkspaceStore.getState().projectName).toBe('demo-paper');
    expect(wsMod.useWorkspaceStore.getState().projectDir).toBeNull();
  });

  it('持久化往返：dir 字段经 localStorage 保存与读档保留；非法 dir（非字符串）被丢弃', async () => {
    seedWorkspace({ projectDir: 'D:\\papers\\a' });
    const id = useProjectsStore.getState().saveCurrent('带目录');
    const persisted = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!) as Record<string, unknown>[];
    localStorage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify([...persisted, { id: 'r-bad', name: '坏目录', savedAt: 1, dir: 42, snapshot: persisted[0]!.snapshot }]),
    );

    const mod = await freshProjectsStore();
    expect(mod.useProjectsStore.getState().projects.find((p) => p.id === id)!.dir).toBe('D:\\papers\\a');
    expect(mod.useProjectsStore.getState().projects.find((p) => p.id === 'r-bad')!.dir).toBeUndefined();
  });
});
