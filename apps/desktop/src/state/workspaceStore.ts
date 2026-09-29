/**
 * 工作区状态：项目文件、打开的标签页、编译日志。
 * 持久化：订阅 store，把快照 JSON 写入 platform.fs 的 "workspace.json"；启动时恢复（缺失则载入演示项目）。
 */

import { create } from 'zustand';
import { getPlatform } from '../platform/types';

export type CompileStatus = 'idle' | 'running' | 'ok' | 'fail';

interface WorkspaceSnapshot {
  projectName: string;
  entry: string;
  files: Record<string, string>;
  openTabs: string[];
  activeTab: string | null;
}

export interface WorkspaceState extends WorkspaceSnapshot {
  compileLog: string[];
  compileStatus: CompileStatus;
  loadDemoProject(): void;
  openFile(path: string): void;
  closeTab(path: string): void;
  setActive(path: string): void;
  updateFile(path: string, content: string): void;
  createFile(path: string, content?: string): void;
  deleteFile(path: string): void;
  renameFile(from: string, to: string): void;
  appendCompileLog(line: string): void;
  clearCompileLog(): void;
  setCompileStatus(status: CompileStatus): void;
}

const WORKSPACE_FILE = 'workspace.json';
const PERSIST_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// 内置演示 LaTeX 项目
// ---------------------------------------------------------------------------

const DEMO_MAIN_TEX = `\\documentclass[11pt]{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage[colorlinks, citecolor=blue]{hyperref}

\\title{ScholarForge 演示论文：AI 辅助科研写作方法综述}
\\author{ScholarForge Demo}
\\date{2026}

\\begin{document}
\\maketitle

\\begin{abstract}
本文演示 ScholarForge 工作站的项目结构：主文件通过 \\input 组织章节，参考文献集中于 refs.bib。
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

ScholarForge 内置示例，展示标准项目结构：

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
  compileLog: [],
  compileStatus: 'idle',

  loadDemoProject() {
    set({ ...demoSnapshot(), compileLog: [], compileStatus: 'idle' });
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
    set((s) => (path in s.files ? { files: { ...s.files, [path]: content } } : s));
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
      const openTabs = s.openTabs.filter((p) => p !== path);
      const activeTab = s.activeTab === path ? (openTabs[0] ?? null) : s.activeTab;
      return { files, openTabs, activeTab };
    });
  },

  renameFile(from, to) {
    set((s) => {
      const dst = to.trim();
      if (!(from in s.files) || !dst || from === dst) return s;
      const files = { ...s.files };
      files[dst] = files[from]!;
      delete files[from];
      const openTabs = s.openTabs.map((p) => (p === from ? dst : p));
      const activeTab = s.activeTab === from ? dst : s.activeTab;
      return { files, openTabs, activeTab };
    });
  },

  appendCompileLog(line) {
    set((s) => ({ compileLog: [...s.compileLog, line] }));
  },

  clearCompileLog() {
    set({ compileLog: [] });
  },

  setCompileStatus(status) {
    set({ compileStatus: status });
  },
}));

// ---------------------------------------------------------------------------
// 持久化（workspace.json）
// ---------------------------------------------------------------------------

let lastPersisted = '';
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(s: WorkspaceState): WorkspaceSnapshot {
  return {
    projectName: s.projectName,
    entry: s.entry,
    files: s.files,
    openTabs: s.openTabs,
    activeTab: s.activeTab,
  };
}

useWorkspaceStore.subscribe((s) => {
  const json = JSON.stringify(snapshot(s));
  if (json === lastPersisted) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    lastPersisted = json;
    getPlatform()
      .fs.writeFile(WORKSPACE_FILE, json)
      .catch(() => {
        /* 持久化失败不打断 UI */
      });
  }, PERSIST_DEBOUNCE_MS);
});

/** 启动恢复：读取 workspace.json，缺失或损坏时载入演示项目。 */
export async function initWorkspace(): Promise<void> {
  try {
    const raw = await getPlatform().fs.readFile(WORKSPACE_FILE);
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as Partial<WorkspaceSnapshot>;
    if (!parsed || typeof parsed.files !== 'object' || parsed.files === null) throw new Error('快照损坏');
    lastPersisted = JSON.stringify(parsed);
    useWorkspaceStore.setState({
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : 'workspace',
      entry: typeof parsed.entry === 'string' ? parsed.entry : '',
      files: parsed.files,
      openTabs: Array.isArray(parsed.openTabs) ? parsed.openTabs.filter((p) => p in parsed.files!) : [],
      activeTab:
        typeof parsed.activeTab === 'string' && parsed.activeTab in parsed.files ? parsed.activeTab : null,
      compileLog: [],
      compileStatus: 'idle',
    });
  } catch {
    useWorkspaceStore.getState().loadDemoProject();
  }
}
