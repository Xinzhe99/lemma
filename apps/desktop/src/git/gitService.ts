/**
 * 内置 git 版本管理（v5.0.0 S4）：
 * 仓库 = 应用数据目录（编译物化目录），跟踪当前论文项目的全部源文件。
 * - 提交前先物化项目文件（与编译同路径，保证仓库即所见）；
 * - 桌面形态经 Tauri proc_run 调用系统 git（研究人员机器几乎必装；缺失时
 *   面板明示「未检测到 git」并停用，不伪装成功）；
 * - 身份兜底：仓库无 user.name/email 配置时以 -c 行内注入 Lemma 默认身份，
 *   不污染全局 git 配置；
 * - 自动提交：AI 改动（diff 审批采纳 / 工具 tex.edit）后防抖提交——像 Codex
 *   一样「AI 干的每一步都有版本可回滚」。
 */

import { getPlatform } from '../platform/types';
import { tauriProcRun } from '../platform/tauri';
import { materializeProjectFiles } from '../compileAction';
import { useWorkspaceStore } from '../state/workspaceStore';

export interface GitCommitInfo {
  hash: string;
  short: string;
  date: string;
  subject: string;
}

export type GitAvailability = 'checking' | 'ok' | 'missing' | 'browser';

let availability: GitAvailability = 'checking';
const availabilityListeners = new Set<() => void>();

function proc(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return tauriProcRun(cmd, args);
}

function isDesktop(): boolean {
  return typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ != null;
}

/** 探测 git 可用性（缓存 + 订阅；App 启动调一次） */
export async function detectGitAvailability(): Promise<GitAvailability> {
  if (!isDesktop()) {
    availability = 'browser';
  } else {
    try {
      const r = await proc('git', ['--version']);
      availability = r.code === 0 && r.stdout.includes('git version') ? 'ok' : 'missing';
    } catch {
      availability = 'missing';
    }
  }
  for (const cb of availabilityListeners) cb();
  return availability;
}

export function getGitAvailability(): GitAvailability {
  return availability;
}

export function subscribeGitAvailability(cb: () => void): () => void {
  availabilityListeners.add(cb);
  return () => availabilityListeners.delete(cb);
}

/** 仓库未初始化则 init + 首次提交（幂等） */
export async function ensureGitRepo(): Promise<boolean> {
  if (availability !== 'ok') return false;
  const inside = await proc('git', ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    const init = await proc('git', ['init']);
    if (init.code !== 0) return false;
  }
  // 编译产物的噪声文件不入库（源文件与 PDF 之外的中间物）
  const fs = getPlatform().fs;
  await fs.writeFile(
    '.gitignore',
    ['*.aux', '*.log', '*.out', '*.fls', '*.fdb_latexmk', '*.synctex.gz', '*.toc', '*.lof', '*.lot', '*.bcf', '*.run.xml', ''].join(
      '\n',
    ),
  );
  return true;
}

/** 物化当前项目文件到仓库工作区（与编译物化同一路径） */
async function materializeWorkspace(): Promise<number> {
  const ws = useWorkspaceStore.getState();
  const fs = getPlatform().fs;
  return materializeProjectFiles(ws.files, (p: string, c: string) => fs.writeFile(p, c));
}

const GIT_IDENTITY = ['-c', 'user.name=Lemma', '-c', 'user.email=lemma@local'];

/** 提交全部变更；无变更返回 null。message 缺省自动生成 */
export async function gitCommitAll(message?: string): Promise<GitCommitInfo | null> {
  if (!(await ensureGitRepo())) return null;
  await materializeWorkspace();
  await proc('git', ['add', '-A']);
  const subject = message?.trim() || '保存当前进度';
  const r = await proc('git', [...GIT_IDENTITY, 'commit', '-m', subject]);
  if (r.code !== 0) {
    // 「nothing to commit」视为无变更（而非失败）
    if (/nothing to commit|no changes added|nothing added/i.test(r.stdout + r.stderr)) return null;
    throw new Error(`git commit 失败：${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }
  const log = await gitLog(1);
  return log[0] ?? null;
}

/** 提交历史（最近 limit 条） */
export async function gitLog(limit = 50): Promise<GitCommitInfo[]> {
  if (!(await ensureGitRepo())) return [];
  const r = await proc('git', ['log', `-${limit}`, '--pretty=%H|%h|%ad|%s', '--date=iso-strict']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, short, date, ...rest] = line.split('|');
      return { hash: hash ?? '', short: short ?? '', date: date ?? '', subject: rest.join('|') };
    })
    .filter((c) => c.hash.length > 0);
}

/**
 * 恢复到指定提交：`git show hash:path` 逐文件回读并写回工作区 store
 * （只恢复该提交中存在的文件；store 中该提交没有的文件保持不动——保守恢复）。
 */
export async function gitRestore(hash: string): Promise<number> {
  if (!(await ensureGitRepo())) return 0;
  const tree = await proc('git', ['ls-tree', '-r', '--name-only', hash]);
  if (tree.code !== 0) throw new Error(`读取提交文件列表失败：${tree.stderr.trim().slice(0, 160)}`);
  const ws = useWorkspaceStore.getState();
  let restored = 0;
  for (const path of tree.stdout.split('\n').map((p) => p.trim()).filter(Boolean)) {
    if (!/\.(tex|bib|sty|cls|md|txt)$/i.test(path)) continue; // 只回读文本源文件
    const show = await proc('git', ['show', `${hash}:${path}`]);
    if (show.code !== 0) continue;
    if (ws.files[path] === undefined) ws.createFile(path, show.stdout);
    else if (ws.files[path] !== show.stdout) ws.updateFile(path, show.stdout);
    restored++;
  }
  return restored;
}

// ---------------------------------------------------------------------------
// AI 改动自动提交：防抖合并连续改动（一次任务多轮 tex.edit 只产生一个提交）
// ---------------------------------------------------------------------------

let autoCommitTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLabels: string[] = [];
let autoCommitEnabled = true;

/** AI 改动落盘后调用（审批采纳 / 工具应用）：防抖后自动提交 */
export function scheduleAutoCommit(label: string): void {
  if (!autoCommitEnabled || availability !== 'ok') return;
  pendingLabels.push(label);
  if (autoCommitTimer !== null) clearTimeout(autoCommitTimer);
  autoCommitTimer = setTimeout(() => {
    autoCommitTimer = null;
    const labels = [...new Set(pendingLabels)];
    pendingLabels = [];
    void gitCommitAll(labels.length > 0 ? `AI: ${labels.join(' + ')}` : 'AI 修改')
      .then((commit) => {
        if (commit) for (const cb of commitListeners) cb(commit);
      })
      .catch((e) => console.warn('[git] 自动提交失败：', e));
  }, 2000);
}

/** 关闭自动提交（测试用） */
export function setAutoCommitEnabled(enabled: boolean): void {
  autoCommitEnabled = enabled;
  if (!enabled && autoCommitTimer !== null) {
    clearTimeout(autoCommitTimer);
    autoCommitTimer = null;
  }
  pendingLabels = [];
}

export type CommitListener = (commit: GitCommitInfo) => void;
const commitListeners = new Set<CommitListener>();

export function onAutoCommit(cb: CommitListener): () => void {
  commitListeners.add(cb);
  return () => commitListeners.delete(cb);
}
