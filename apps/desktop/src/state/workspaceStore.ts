/**
 * 工作区状态：项目文件、打开的标签页、编译日志。
 * 持久化：订阅 store，把快照 JSON 写入 platform.fs 的 "workspace.json"；启动时恢复
 * （缺失/损坏则保持空工作区，由编辑器空态引导卡接手——演示项目不再默认载入）。
 */

import { create } from 'zustand';
import { getPlatform } from '../platform/types';

export type CompileStatus = 'idle' | 'running' | 'ok' | 'fail';

/** 文件快照：AI 修改采纳前自动创建，可随时恢复（设计 4.8 版本控制） */
export interface FileSnapshot {
  content: string;
  ts: number;
  label: string;
}

interface WorkspaceSnapshot {
  projectName: string;
  entry: string;
  files: Record<string, string>;
  openTabs: string[];
  activeTab: string | null;
  snapshots: Record<string, FileSnapshot[]>;
  /** 用户为当前项目选择的本地文件夹（绝对路径；未选择为 null）。物化/磁盘同步的目标目录 */
  projectDir?: string | null;
}

export interface WorkspaceState extends WorkspaceSnapshot {
  compileLog: string[];
  compileStatus: CompileStatus;
  /** 编辑器内容有未落盘的改动（updateFile 置 true，持久化写盘成功后置 false） */
  dirty: boolean;
  /** 最近一次持久化写盘成功的时间戳；尚未保存过为 null */
  lastSavedAt: number | null;
  /** 当前项目的本地文件夹（绝对路径；未绑定磁盘目录为 null） */
  projectDir: string | null;
  loadDemoProject(): void;
  /** 载入一个完整项目（模板向导脚手架产出）；dir 为可选的本地文件夹绑定 */
  loadProject(name: string, entry: string, files: Record<string, string>, dir?: string | null): void;
  /** 打开文件 */
  openFile(path: string): void;
  closeTab(path: string): void;
  setActive(path: string): void;
  updateFile(path: string, content: string): void;
  createFile(path: string, content?: string): void;
  deleteFile(path: string): void;
  renameFile(from: string, to: string): void;
  /** 为文件创建快照（AI 修改采纳前强制调用），每文件保留最近 20 份 */
  snapshotFile(path: string, label: string): void;
  /** 恢复文件到指定快照 */
  restoreSnapshot(path: string, index: number): void;
  appendCompileLog(line: string): void;
  clearCompileLog(): void;
  setCompileStatus(status: CompileStatus): void;
  /** 最近一次编译的诊断（编辑器标注数据源；不持久化，重编译整体替换） */
  compileDiagnostics: import('@lemma/shared').Diagnostic[];
  setCompileDiagnostics(list: import('@lemma/shared').Diagnostic[]): void;
}

const WORKSPACE_FILE = 'workspace.json';
const PERSIST_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// 内置演示 LaTeX 项目
// ---------------------------------------------------------------------------

const DEMO_MAIN_TEX = `\\documentclass[11pt]{ctexart}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage[colorlinks, citecolor=blue]{hyperref}

\\title{Lemma 演示论文：AI 辅助科研写作方法综述}
\\author{Lemma Demo}
\\date{2026}

\\begin{document}
\\maketitle

\\begin{abstract}
本文演示 Lemma 工作站的项目结构：主文件通过 \\texttt{\\string\\input} 组织章节，参考文献集中于 refs.bib。
\\end{abstract}

\\input{sections/intro}
\\input{sections/method}

\\bibliographystyle{unsrt}
\\bibliography{refs}

\\end{document}
`;

const DEMO_INTRO_TEX = `\\section{引言}
大语言模型的兴起正在重塑科研写作的各个环节 \\cite{vaswani2017attention}。
从文献调研、大纲起草到润色与投稿，写作流程中重复性最高的部分逐步可由智能体接管 \\cite{brown2020language}。

\\section{相关工作}
既有写作辅助工具多聚焦单点功能（语法检查、引用格式化），
缺乏面向「一篇论文的完整生命周期」的一站式工作区。
本文以演示项目为例，说明结构化项目组织的必要性。

\\paragraph{研究问题}
如何在保证作者最终裁决权的前提下，让智能体安全地参与稿件修改？
`;

const DEMO_METHOD_TEX = `\\section{方法}
我们提出一个三阶段流水线：

\\begin{enumerate}
  \\item \\textbf{上下文组装}：抽取大纲、术语表与相关文献摘要，构成上下文包；
  \\item \\textbf{多智能体起草}：按章节分派给不同角色的审稿与写作智能体 \\cite{openai2023gpt4}；
  \\item \\textbf{Diff 审批}：所有修改以 latexdiff 呈现，由作者逐条采纳或回滚。
\\end{enumerate}

\\section{实验设置}
演示项目仅包含静态文本，编译流程由 WS-B 编译服务接入后启用。

\\begin{equation}
  \\mathrm{Score}(q, d) = \\frac{q \\cdot d}{\\lVert q \\rVert \\, \\lVert d \\rVert}
\\end{equation}
`;

const DEMO_REFS_BIB = `@inproceedings{vaswani2017attention,
  title     = {Attention Is All You Need},
  author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {30},
  pages     = {5998--6008},
  year      = {2017}
}

@inproceedings{brown2020language,
  title     = {Language Models are Few-Shot Learners},
  author    = {Brown, Tom B. and Mann, Benjamin and Ryder, Nick and Subbiah, Melanie and others},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {33},
  pages     = {1877--1901},
  year      = {2020}
}

@misc{openai2023gpt4,
  title         = {{GPT-4} Technical Report},
  author        = {{OpenAI}},
  year          = {2023},
  eprint        = {2303.08774},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CL}
}
`;

const DEMO_README_MD = `# 演示论文项目

Lemma 内置示例，展示标准项目结构：

- \`main.tex\` —— 主文件，通过 \\input 组织章节
- \`sections/intro.tex\` —— 引言与相关工作
- \`sections/method.tex\` —— 方法与实验设置
- \`refs.bib\` —— 参考文献条目

提示：按 Ctrl+K 打开命令面板，可执行新建文件、编译、切换主题等操作。
`;

function demoSnapshot(): WorkspaceSnapshot {
  return {
    projectName: 'demo-paper',
    entry: 'main.tex',
    files: {
      'main.tex': DEMO_MAIN_TEX,
      'sections/intro.tex': DEMO_INTRO_TEX,
      'sections/method.tex': DEMO_METHOD_TEX,
      'refs.bib': DEMO_REFS_BIB,
      'README.md': DEMO_README_MD,
    },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  projectName: '',
  entry: '',
  files: {},
  openTabs: [],
  activeTab: null,
  snapshots: {},
  projectDir: null,
  compileLog: [],
  compileStatus: 'idle',
  compileDiagnostics: [],
  dirty: false,
  lastSavedAt: null,

  loadDemoProject() {
    set({
      ...demoSnapshot(),
      projectDir: null,
      compileLog: [],
      compileStatus: 'idle',
      dirty: false,
      lastSavedAt: null,
    });
  },

  loadProject(name, entry, files, dir = null) {
    const openTabs = entry in files ? [entry] : Object.keys(files).slice(0, 1);
    set({
      projectName: name,
      entry,
      files,
      openTabs,
      activeTab: openTabs[0] ?? null,
      snapshots: {},
      projectDir: dir ?? null,
      compileLog: [],
      compileStatus: 'idle',
      dirty: false,
      lastSavedAt: null,
    });
  },

  openFile(path) {
    set((s) => ({
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
      activeTab: path,
    }));
  },

  closeTab(path) {
    set((s) => {
      const idx = s.openTabs.indexOf(path);
      if (idx === -1) return s;
      const openTabs = s.openTabs.filter((p) => p !== path);
      const activeTab =
        s.activeTab === path ? (openTabs[Math.min(idx, openTabs.length - 1)] ?? null) : s.activeTab;
      return { openTabs, activeTab };
    });
  },

  setActive(path) {
    set((s) => (s.openTabs.includes(path) ? { activeTab: path } : s));
  },

  updateFile(path, content) {
    set((s) =>
      path in s.files ? { files: { ...s.files, [path]: content }, dirty: true } : s,
    );
  },

  createFile(path, content = '') {
    set((s) => {
      const trimmed = path.trim();
      if (!trimmed) return s;
      // 已存在的文件不覆盖内容，仅打开
      const files = { ...s.files, [trimmed]: trimmed in s.files ? s.files[trimmed]! : content };
      return {
        files,
        openTabs: s.openTabs.includes(trimmed) ? s.openTabs : [...s.openTabs, trimmed],
        activeTab: trimmed,
      };
    });
  },

  deleteFile(path) {
    set((s) => {
      if (!(path in s.files)) return s;
      const files = { ...s.files };
      delete files[path];
      const snapshots = { ...s.snapshots };
      delete snapshots[path];
      const openTabs = s.openTabs.filter((p) => p !== path);
      const activeTab = s.activeTab === path ? (openTabs[0] ?? null) : s.activeTab;
      return { files, openTabs, activeTab, snapshots };
    });
  },

  renameFile(from, to) {
    set((s) => {
      const dst = to.trim();
      if (!(from in s.files) || !dst || from === dst) return s;
      // v7.0.0 修复：目标已存在时静默覆盖既无快照也无提示——直接拒绝
      if (dst in s.files) return s;
      const files = { ...s.files };
      files[dst] = files[from]!;
      delete files[from];
      const openTabs = s.openTabs.map((p) => (p === from ? dst : p));
      const activeTab = s.activeTab === from ? dst : s.activeTab;
      const snapshots = { ...s.snapshots };
      if (snapshots[from]) {
        snapshots[dst] = snapshots[from]!;
        delete snapshots[from];
      }
      return { files, openTabs, activeTab, snapshots };
    });
  },

  snapshotFile(path, label) {
    set((s) => {
      const content = s.files[path];
      if (content === undefined) return s;
      const list = [{ content, ts: Date.now(), label }, ...(s.snapshots[path] ?? [])].slice(0, 20);
      return { snapshots: { ...s.snapshots, [path]: list } };
    });
  },

  restoreSnapshot(path, index) {
    set((s) => {
      const snap = s.snapshots[path]?.[index];
      if (!snap || !(path in s.files)) return s;
      return { files: { ...s.files, [path]: snap.content } };
    });
  },

  appendCompileLog(line) {
    set((s) => {
      // FIFO 上限：防长会话无限增长（每次 append 触发控制台面板重渲染）
      const next = [...s.compileLog, line];
      return { compileLog: next.length > 500 ? next.slice(next.length - 500) : next };
    });
  },

  clearCompileLog() {
    set({ compileLog: [] });
  },

  setCompileStatus(status) {
    set({ compileStatus: status });
  },

  setCompileDiagnostics(list) {
    set({ compileDiagnostics: list });
  },
}));

// ---------------------------------------------------------------------------
// 持久化（workspace.json）
// ---------------------------------------------------------------------------

let lastPersisted = '';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * 启动恢复进行中（v7.8.0）。此窗口内 store 还是**未水合的空工作区**：
 * 一旦落盘就会把用户已保存的项目覆盖成空项目（真正的数据丢失）。
 * 因此恢复期间不排新的写盘任务，恢复结束时丢弃此前排队的陈旧快照。
 */
let hydrationInFlight = false;

function snapshot(s: WorkspaceState): WorkspaceSnapshot {
  return {
    projectName: s.projectName,
    entry: s.entry,
    files: s.files,
    openTabs: s.openTabs,
    activeTab: s.activeTab,
    snapshots: s.snapshots,
    projectDir: s.projectDir,
  };
}

/** 防抖排程落盘（hydrationInFlight 期间跳过；同内容不重复写）。 */
function schedulePersist(s: WorkspaceState): void {
  if (hydrationInFlight) return;
  const json = JSON.stringify(snapshot(s));
  if (json === lastPersisted) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      getPlatform()
        .fs.writeFile(WORKSPACE_FILE, json)
        .then(() => {
          // v7.0.0：写盘成功才标记 lastPersisted（与 30s 安全网同修复——
          // 先标记后写盘会让一次失败后该版本永不重试）
          lastPersisted = json;
          // 写盘成功：仅当期间没有新改动（当前快照与写盘内容一致）时标记已保存，
          // 避免写盘进行中的编辑被误标为 "✓ 已保存"。
          if (JSON.stringify(snapshot(useWorkspaceStore.getState())) === json) {
            useWorkspaceStore.setState({ dirty: false, lastSavedAt: Date.now() });
          }
        })
        .catch((e) => {
          // 持久化失败不打断 UI（dirty 保持 true），但记录日志便于诊断
          console.warn('[workspace] 持久化写盘失败（dirty 保持 true）：', e);
        });
    } catch (e) {
      // v7.8.0：平台桥不可用时同步抛错会变成未捕获异常
      console.warn('[workspace] 持久化写盘跳过：', e);
    }
  }, PERSIST_DEBOUNCE_MS);
}

/** 启动恢复结束：丢弃未水合期间排队的陈旧快照，并按水合结果重新排程。 */
function finishHydration(): void {
  hydrationInFlight = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  // 水合期间的 setState 不会触发订阅排程（被 hydrationInFlight 挡下），
  // 这里补一次：水合结果与磁盘内容不一致（如补入 figures/ 元数据）时才落盘。
  schedulePersist(useWorkspaceStore.getState());
}

let safetyTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribePersist: (() => void) | null = null;

/**
 * Node 环境下让定时器不阻止进程退出（浏览器无 unref，静默跳过）。
 * 测试进程里这个 30s 安全网此前会一直吊住事件循环，并在环境销毁后触发。
 */
function unrefTimer(t: unknown): void {
  const maybe = t as { unref?: () => void } | null;
  if (maybe && typeof maybe.unref === 'function') maybe.unref();
}

/**
 * 启动持久化副作用（30s 安全网 + store 订阅）。
 * 模块加载时自动调用；测试或需要彻底停机的场景可先 stopWorkspacePersistence()。
 */
export function startWorkspacePersistence(): void {
  if (safetyTimer) return;
  // 30 秒定时强制保存安全网（v2.7.0 ②）：即使无变更触发（防抖窗口外的场景），
  // dirty 状态下每 30s 强制写盘一次。崩溃时最多丢 30 秒工作，而非整个防抖周期。
  safetyTimer = setInterval(() => {
    try {
      if (hydrationInFlight) return; // 启动恢复期间不写盘（防空快照覆盖用户项目）
      const st = useWorkspaceStore.getState();
      if (!st.dirty) return;
      const json = JSON.stringify(snapshot(st));
      if (json === lastPersisted) return;
      getPlatform()
        .fs.writeFile(WORKSPACE_FILE, json)
        .then(() => {
          // v7.0.0 修复：写盘成功才标记 lastPersisted——此前先标记后写盘，
          // 一次瞬时写失败后该版本内容永久无法落盘（30s 安全网因相等比较跳过）
          lastPersisted = json;
          useWorkspaceStore.setState({ dirty: false, lastSavedAt: Date.now() });
        })
        .catch(() => undefined);
    } catch (e) {
      // v7.8.0：平台桥不可用时（模块 mock 未就绪 / bridge 缺失）同步抛错会变成
      // 未捕获异常——定时器回调里必须是「静默跳过 + 日志」，绝不能让安全网自己炸掉。
      console.warn('[workspace] 30s 安全网写盘跳过：', e);
    }
  }, 30_000);
  unrefTimer(safetyTimer);

  unsubscribePersist = useWorkspaceStore.subscribe((s) => schedulePersist(s));
}

/** 停机：清理定时器与订阅（测试收尾 / 卸载用；重复调用安全）。 */
export function stopWorkspacePersistence(): void {
  if (safetyTimer) {
    clearInterval(safetyTimer);
    safetyTimer = null;
  }
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (unsubscribePersist) {
    unsubscribePersist();
    unsubscribePersist = null;
  }
}

startWorkspacePersistence();

/**
 * 启动恢复：读取 workspace.json 还原当前项目；缺失或损坏时保持空工作区——
 * 不再自动载入演示项目（首启引导：用户显式选择「新建项目」或「先看看演示项目」，
 * 演示入口保留在编辑器空态引导卡与命令面板）。
 */
export async function initWorkspace(): Promise<void> {
  hydrationInFlight = true;
  try {
    await loadWorkspaceSnapshot();
  } finally {
    // 无论成功/损坏/异常，恢复流程到此结束——此后才允许落盘
    finishHydration();
  }
}

/** 恢复主体：任何分支都不会抛出（失败即保持空工作区，由首启引导卡接手）。 */
async function loadWorkspaceSnapshot(): Promise<void> {
  let raw: string | Uint8Array;
  try {
    raw = await getPlatform().fs.readFile(WORKSPACE_FILE);
  } catch {
    // 全新安装（无快照）：空工作区 + 首启引导，不塞演示项目
    return;
  }
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as Partial<WorkspaceSnapshot>;
    if (!parsed || typeof parsed.files !== 'object' || parsed.files === null) throw new Error('快照损坏');
    const snapshots =
      parsed.snapshots && typeof parsed.snapshots === 'object' && !Array.isArray(parsed.snapshots)
        ? parsed.snapshots
        : {};
    lastPersisted = JSON.stringify(parsed);
    // 补充 figures/ 元数据（v2.1.2 Fix 3：文件树可见性——图片在磁盘但不在 files map）
    try {
      const all = await getPlatform().fs.list();
      const figurePaths = all.filter((p) => p.startsWith('figures/'));
      if (figurePaths.length > 0) {
        const filesWithFigures = { ...parsed.files };
        for (const fp of figurePaths) {
          if (filesWithFigures[fp] === undefined) {
            filesWithFigures[fp] = ''; // 空串标记：文件树可见但不参与文本编辑
          }
        }
        parsed.files = filesWithFigures;
      }
    } catch {
      // 列表失败不阻塞启动
    }
    useWorkspaceStore.setState({
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : 'workspace',
      entry: typeof parsed.entry === 'string' ? parsed.entry : '',
      files: parsed.files,
      openTabs: Array.isArray(parsed.openTabs) ? parsed.openTabs.filter((p) => p in parsed.files!) : [],
      activeTab:
        typeof parsed.activeTab === 'string' && parsed.activeTab in parsed.files ? parsed.activeTab : null,
      snapshots,
      // 旧快照无 projectDir 字段 → null（向后兼容）
      projectDir: typeof parsed.projectDir === 'string' && parsed.projectDir.trim() ? parsed.projectDir : null,
      compileLog: [],
      compileStatus: 'idle',
      dirty: false,
      lastSavedAt: null,
    });
  } catch {
    // 快照损坏：保持空工作区（与全新安装同语义），由引导卡接手
  }
}
