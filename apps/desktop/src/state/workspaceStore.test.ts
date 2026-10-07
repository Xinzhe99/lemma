import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore, initWorkspace } from './workspaceStore';

// 持久化写盘改为可控挂起：手动放行以确定性验证 dirty 生命周期（成功回调）。
// readFile 可控（readState.next）：验证 initWorkspace 的启动恢复语义。
const pendingWrites = vi.hoisted(() => [] as (() => void)[]);
const readState = vi.hoisted(() => ({
  next: undefined as string | undefined,
  /** 置位后 readFile 挂起，直到测试显式放行（模拟慢磁盘/冷 IndexedDB 的启动窗口） */
  gate: undefined as Promise<void> | undefined,
}));
const writeCalls = vi.hoisted(() => [] as Array<{ path: string; content: string }>);
vi.mock('../platform/types', () => ({
  getPlatform: () => ({
    kind: 'browser' as const,
    fs: {
      async readFile() {
        if (readState.gate) await readState.gate;
        if (readState.next === undefined) throw new Error('测试环境无快照');
        return readState.next;
      },
      writeFile(path: string, content: string) {
        writeCalls.push({ path, content });
        return new Promise<void>((resolve) => {
          pendingWrites.push(resolve);
        });
      },
      async deleteFile() {},
      async list() {
        return [];
      },
    },
    secrets: {
      async get() {
        return undefined;
      },
      async set() {},
    },
  }),
}));

function reset() {
  readState.next = undefined;
  readState.gate = undefined;
  useWorkspaceStore.setState({
    projectName: '',
    entry: '',
    files: {},
    openTabs: [],
    activeTab: null,
    snapshots: {},
    projectDir: null,
    compileLog: [],
    compileStatus: 'idle',
    dirty: false,
    lastSavedAt: null,
  });
}

/** 等待防抖（300ms）定时器与微任务链：写盘发起 → 成功回调入队执行 */
const afterDebounce = () => new Promise((r) => setTimeout(r, 350));

/** 可手动放行的挂起闸门（模拟慢启动读取） */
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

function flushWrites() {
  pendingWrites.splice(0).forEach((resolve) => resolve());
}

beforeEach(reset);

describe('workspaceStore.loadDemoProject', () => {
  it('内置演示项目文件齐全且结构正确', () => {
    useWorkspaceStore.getState().loadDemoProject();
    const s = useWorkspaceStore.getState();
    expect(Object.keys(s.files).sort()).toEqual(
      ['README.md', 'main.tex', 'refs.bib', 'sections/intro.tex', 'sections/method.tex'].sort(),
    );
    expect(s.entry).toBe('main.tex');
    expect(s.projectName).toBe('demo-paper');
    expect(s.files['main.tex']).toContain('\\input{sections/intro}');
    expect(s.files['main.tex']).toContain('\\input{sections/method}');
    expect(s.files['refs.bib']).toMatch(/@inproceedings\{vaswani2017attention/);
    expect((s.files['refs.bib'].match(/@/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(s.openTabs).toEqual(['main.tex']);
    expect(s.activeTab).toBe('main.tex');
  });

  it('demo 正文不含裸 \\input（回归：摘要说明文字曾被真实引擎当作命令 → I can\'t find file → Emergency stop）', () => {
    useWorkspaceStore.getState().loadDemoProject();
    const main = useWorkspaceStore.getState().files['main.tex'] ?? '';
    // 所有 \input 必须是带花括号的 \input{...}；\string\input（字面排印）除外——
    // 裸 \input 后跟中文会被 TeX 扫成文件名
    expect(main.match(/(?<!\\string)\\input(?!\{)/g)).toBeNull();
    expect(main).toContain('\\input{sections/intro}');
    expect(main).toContain('\\input{sections/method}');
    // 说明文字里的命令名经 \string 转义，不再被引擎执行
    expect(main).toContain('\\texttt{\\string\\input}');
  });

  it('demo 使用带 CJK 能力的文档类（回归：article + 中文正文在真实引擎下中文静默丢字）', () => {
    useWorkspaceStore.getState().loadDemoProject();
    const main = useWorkspaceStore.getState().files['main.tex'] ?? '';
    expect(main).toMatch(/\\documentclass\[[^\]]*\]\{ctexart\}/);
  });
});

describe('workspaceStore tabs 一致性', () => {
  beforeEach(() => useWorkspaceStore.getState().loadDemoProject());

  it('openFile 追加标签并置为 active，重复打开不重复追加', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.openFile('sections/method.tex');
    s.openFile('sections/intro.tex');
    const st = useWorkspaceStore.getState();
    expect(st.openTabs).toEqual(['main.tex', 'sections/intro.tex', 'sections/method.tex']);
    expect(st.activeTab).toBe('sections/intro.tex');
  });

  it('closeTab 关闭非活动标签不影响 activeTab；关闭活动标签则切换到邻近标签', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.openFile('sections/method.tex');
    s.closeTab('sections/intro.tex');
    expect(useWorkspaceStore.getState().activeTab).toBe('sections/method.tex');
    expect(useWorkspaceStore.getState().openTabs).toEqual(['main.tex', 'sections/method.tex']);
    s.closeTab('main.tex');
    expect(useWorkspaceStore.getState().activeTab).toBe('sections/method.tex');
  });

  it('关闭最后一个标签后 activeTab 为 null', () => {
    const s = useWorkspaceStore.getState();
    s.closeTab('main.tex');
    const st = useWorkspaceStore.getState();
    expect(st.openTabs).toEqual([]);
    expect(st.activeTab).toBeNull();
  });

  it('renameFile 同步维护 openTabs 与 activeTab', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.renameFile('sections/intro.tex', 'sections/introduction.tex');
    const st = useWorkspaceStore.getState();
    expect(st.files['sections/introduction.tex']).toBeTruthy();
    expect(st.files['sections/intro.tex']).toBeUndefined();
    expect(st.openTabs).toEqual(['main.tex', 'sections/introduction.tex']);
    expect(st.activeTab).toBe('sections/introduction.tex');
  });

  it('deleteFile 移除文件与标签并修正 activeTab', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.deleteFile('sections/intro.tex');
    const st = useWorkspaceStore.getState();
    expect(st.files['sections/intro.tex']).toBeUndefined();
    expect(st.openTabs).toEqual(['main.tex']);
    expect(st.activeTab).toBe('main.tex');
  });

  it('createFile 创建并打开；对已存在文件不覆盖内容', () => {
    const s = useWorkspaceStore.getState();
    s.createFile('notes.md', '# 新笔记');
    let st = useWorkspaceStore.getState();
    expect(st.files['notes.md']).toBe('# 新笔记');
    expect(st.activeTab).toBe('notes.md');
    s.createFile('notes.md', '# 应被忽略');
    st = useWorkspaceStore.getState();
    expect(st.files['notes.md']).toBe('# 新笔记');
    expect(st.openTabs.filter((p) => p === 'notes.md')).toHaveLength(1);
  });

  it('updateFile 修改内容，未知路径不生效', () => {
    const s = useWorkspaceStore.getState();
    s.updateFile('main.tex', 'new content');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('new content');
    s.updateFile('ghost.tex', 'x');
    expect(useWorkspaceStore.getState().files['ghost.tex']).toBeUndefined();
  });
});

describe('workspaceStore 编译日志', () => {
  it('appendCompileLog 逐行追加，clearCompileLog 清空，setCompileStatus 更新状态', () => {
    const s = useWorkspaceStore.getState();
    s.appendCompileLog('line 1');
    s.appendCompileLog('line 2');
    expect(useWorkspaceStore.getState().compileLog).toEqual(['line 1', 'line 2']);
    s.setCompileStatus('running');
    expect(useWorkspaceStore.getState().compileStatus).toBe('running');
    s.clearCompileLog();
    expect(useWorkspaceStore.getState().compileLog).toEqual([]);
    s.setCompileStatus('ok');
    expect(useWorkspaceStore.getState().compileStatus).toBe('ok');
  });
});

describe('workspaceStore 保存状态（dirty 生命周期）', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().loadDemoProject();
    useWorkspaceStore.setState({ dirty: false, lastSavedAt: null });
  });

  it('updateFile 置 dirty=true（未知路径不置位）', () => {
    useWorkspaceStore.getState().updateFile('main.tex', 'dirty 生命周期 v1');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    useWorkspaceStore.getState().updateFile('ghost.tex', 'x');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('持久化写盘成功后 dirty=false 并记录 lastSavedAt', async () => {
    useWorkspaceStore.getState().updateFile('main.tex', 'dirty 生命周期 v1');
    expect(useWorkspaceStore.getState().dirty).toBe(true);

    await afterDebounce(); // 300ms 防抖结束，写盘发起（挂起）
    flushWrites(); // 写盘成功回调
    await afterDebounce(); // 让成功回调的微任务链执行完

    const s = useWorkspaceStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.lastSavedAt).not.toBeNull();
  });

  it('写盘在途时的新编辑不会被误标已保存（快照一致性守卫）', async () => {
    useWorkspaceStore.getState().updateFile('main.tex', '在途守卫 v1');
    await afterDebounce(); // W1 发起
    useWorkspaceStore.getState().updateFile('main.tex', '在途守卫 v2'); // W1 在途时再编辑

    flushWrites(); // W1 成功，但当前内容已是 v2
    await afterDebounce();
    expect(useWorkspaceStore.getState().dirty).toBe(true);

    await afterDebounce(); // 新防抖结束，W2 发起
    flushWrites();
    await afterDebounce();
    const s = useWorkspaceStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.lastSavedAt).not.toBeNull();
  });

  it('loadDemoProject / loadProject 重置 dirty 与 lastSavedAt', () => {
    useWorkspaceStore.setState({ dirty: true, lastSavedAt: 123 });
    useWorkspaceStore.getState().loadDemoProject();
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().lastSavedAt).toBeNull();

    useWorkspaceStore.setState({ dirty: true, lastSavedAt: 123 });
    useWorkspaceStore.getState().loadProject('p', 'main.tex', { 'main.tex': 'x' });
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().lastSavedAt).toBeNull();
  });
});

describe('workspaceStore projectDir 绑定', () => {
  beforeEach(reset);

  it('loadProject 可绑定本地目录；缺省重置为 null；loadDemoProject 重置为 null', () => {
    useWorkspaceStore.getState().loadProject('p', 'main.tex', { 'main.tex': 'x' }, 'D:\\papers\\p');
    expect(useWorkspaceStore.getState().projectDir).toBe('D:\\papers\\p');

    // 不传 dir（模板向导/导入 zip 路径）：绑定清空
    useWorkspaceStore.getState().loadProject('q', 'main.tex', { 'main.tex': 'y' });
    expect(useWorkspaceStore.getState().projectDir).toBeNull();

    useWorkspaceStore.getState().loadProject('r', 'main.tex', { 'main.tex': 'z' }, 'D:\\papers\\r');
    useWorkspaceStore.getState().loadDemoProject();
    expect(useWorkspaceStore.getState().projectDir).toBeNull();
  });

  it('持久化快照携带 projectDir（workspace.json 恢复当前项目的目录绑定）', async () => {
    writeCalls.length = 0;
    useWorkspaceStore.getState().loadProject('p', 'main.tex', { 'main.tex': 'x' }, 'D:\\papers\\p');
    useWorkspaceStore.getState().updateFile('main.tex', '触发持久化');
    await afterDebounce();
    flushWrites();
    await afterDebounce();

    const wsWrite = writeCalls.find((c) => c.path === 'workspace.json');
    expect(wsWrite).toBeTruthy();
    expect(JSON.parse(wsWrite!.content).projectDir).toBe('D:\\papers\\p');
  });
});

describe('initWorkspace 启动语义（无 demo fallback）', () => {
  beforeEach(reset);

  it('全新安装（无 workspace.json）：保持空工作区，不再自动载入演示项目', async () => {
    await initWorkspace();
    const s = useWorkspaceStore.getState();
    expect(s.files).toEqual({});
    expect(s.projectName).toBe('');
    expect(s.activeTab).toBeNull();
  });

  it('快照损坏：同样保持空工作区（由首启引导卡接手）', async () => {
    readState.next = '{oops not json';
    await initWorkspace();
    const s = useWorkspaceStore.getState();
    expect(s.files).toEqual({});
    expect(s.projectName).toBe('');
  });

  it('有快照：恢复正常，并兼容旧快照缺 projectDir 字段（→ null）', async () => {
    readState.next = JSON.stringify({
      projectName: '论文A',
      entry: 'main.tex',
      files: { 'main.tex': 'x' },
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
      snapshots: {},
    });
    await initWorkspace();
    const s = useWorkspaceStore.getState();
    expect(s.projectName).toBe('论文A');
    expect(s.files['main.tex']).toBe('x');
    expect(s.activeTab).toBe('main.tex');
    expect(s.projectDir).toBeNull();
  });

  it('有快照且带 projectDir：目录绑定一并恢复', async () => {
    readState.next = JSON.stringify({
      projectName: '论文B',
      entry: 'main.tex',
      files: { 'main.tex': 'y' },
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
      snapshots: {},
      projectDir: 'D:\\papers\\b',
    });
    await initWorkspace();
    expect(useWorkspaceStore.getState().projectDir).toBe('D:\\papers\\b');
  });
});

describe('启动窗口内的落盘保护（v7.8.0：空快照不得覆盖用户项目）', () => {
  beforeEach(reset);

  const realSnapshot = () =>
    JSON.stringify({
      projectName: '论文A',
      entry: 'main.tex',
      files: { 'main.tex': 'user content' },
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
      snapshots: {},
    });

  it('恢复进行中：用户操作（如 Ctrl+Enter 编译）不触发落盘（否则空项目覆盖磁盘快照）', async () => {
    readState.next = realSnapshot();
    await afterDebounce(); // 先让 beforeEach/reset 引发的排程跑完，避免串扰
    const gate = deferred();
    readState.gate = gate.promise;
    writeCalls.length = 0;

    const init = initWorkspace(); // 挂起在 readFile 上（慢磁盘 / 冷 IndexedDB 的真实情形）
    // 恢复尚未完成时用户按下编译（全局快捷键）→ store 变化
    useWorkspaceStore.getState().setCompileStatus('running');
    useWorkspaceStore.getState().appendCompileLog('▶ 编译中');

    await afterDebounce();
    expect(writeCalls.filter((c) => c.path === 'workspace.json')).toHaveLength(0);

    gate.release();
    await init;
    flushWrites();
    await afterDebounce();

    // 恢复完成后磁盘内容要么没被改写，要么是真实项目——绝不出现空项目
    for (const w of writeCalls.filter((c) => c.path === 'workspace.json')) {
      expect(JSON.parse(w.content).projectName).toBe('论文A');
    }
  });

  it('恢复完成前排队、完成时已陈旧的写盘任务会被丢弃', async () => {
    readState.next = realSnapshot();
    await afterDebounce(); // 同上：清掉 reset 引发的排程
    const gate = deferred();
    readState.gate = gate.promise;
    writeCalls.length = 0;

    const init = initWorkspace();
    // 恢复前先制造一次变化（排在恢复之前，携带未水合的空快照）
    useWorkspaceStore.getState().loadDemoProject();
    await afterDebounce();
    gate.release();
    await init;

    await afterDebounce(); // 若陈旧任务未被丢弃，此刻会写盘
    const staleWrites = writeCalls.filter(
      (c) => c.path === 'workspace.json' && JSON.parse(c.content).projectName === 'demo-paper',
    );
    expect(staleWrites).toHaveLength(0);
    expect(useWorkspaceStore.getState().projectName).toBe('论文A');
  });

  it('恢复完成后的正常编辑仍然照常落盘（保护不误伤持久化）', async () => {
    readState.next = realSnapshot();
    writeCalls.length = 0;
    await initWorkspace();

    useWorkspaceStore.getState().updateFile('main.tex', 'edited after hydration');
    await afterDebounce();
    flushWrites();
    await afterDebounce();

    const ws = writeCalls.filter((c) => c.path === 'workspace.json');
    expect(ws.length).toBeGreaterThan(0);
    expect(JSON.parse(ws[ws.length - 1]!.content).files['main.tex']).toBe('edited after hydration');
  });
});
