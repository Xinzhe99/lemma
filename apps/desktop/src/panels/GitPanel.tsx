/**
 * 版本面板（v5.6.0 内置 git + v5.7.0 差异查看/GitHub 同步）：
 * 远端同步区（关联 / push / pull）→ 提交历史（差异查看 / 恢复）。
 * 桌面形态 + 系统 git 可用时工作；否则明示原因（不伪装）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Diff, FileDiff, GitCommitHorizontal, Link2, History, RotateCcw } from 'lucide-react';
import {
  detectGitAvailability,
  getGitAvailability,
  gitCommitAll,
  gitGetRemote,
  gitLog,
  gitPull,
  gitPush,
  gitRestore,
  gitSetRemote,
  buildChangesPdf,
  gitShowCommit,
  onAutoCommit,
  subscribeGitAvailability,
  type GitCommitInfo,
} from '../git/gitService';
import { confirmDialog, promptDialog } from '../dialogs';
import { useWorkspaceStore } from '../state/workspaceStore';

/** 统一 diff 着色渲染（行级 +/=/-） */
function DiffView({ text }: { text: string }) {
  return (
    <pre className="sf-git-diff">
      {text.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'sf-git-diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'sf-git-diff-del'
                : line.startsWith('@@')
                  ? 'sf-git-diff-hunk'
                  : undefined
          }
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

export function GitPanel() {
  const [avail, setAvail] = useState(getGitAvailability());
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ stat: string; diff: string } | null>(null);
  const [remote, setRemote] = useState<string | null>(null);
  const projectName = useWorkspaceStore((s) => s.projectName);

  useEffect(() => {
    void detectGitAvailability();
    return subscribeGitAvailability(() => setAvail(getGitAvailability()));
  }, []);

  const refresh = useCallback(async () => {
    if (getGitAvailability() !== 'ok') return;
    try {
      const [log, r] = await Promise.all([gitLog(50), gitGetRemote().catch(() => null)]);
      setCommits(log);
      setRemote(r);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAutoCommit(() => void refresh());
  }, [refresh, projectName]);

  const onCommit = async () => {
    setBusy(true);
    setNote('');
    try {
      const commit = await gitCommitAll();
      setNote(commit ? `已提交：${commit.subject}` : '没有可提交的变更');
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onShowDiff = async (c: GitCommitInfo) => {
    if (diffFor === c.hash) {
      setDiffFor(null);
      setDiff(null);
      return;
    }
    setDiffFor(c.hash);
    setDiff(null);
    try {
      setDiff(await gitShowCommit(c.hash));
    } catch (e) {
      setDiff({ stat: '', diff: e instanceof Error ? e.message : String(e) });
    }
  };

  /** v6.0.0：生成修改对照 PDF（该提交 vs 父），成功后右侧预览切换到 changes.pdf */
  const onChangesPdf = async (c: GitCommitInfo) => {
    setBusy(true);
    setNote(`生成对照 PDF（${c.subject.slice(0, 20)}…）…`);
    try {
      const r = await buildChangesPdf(c.hash, c.subject);
      setNote(`对照 PDF 已生成：${r.fileCount} 个文件 / ${r.lineCount} 行变更（右侧预览）`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLinkRemote = async () => {
    if (remote) {
      if (!(await confirmDialog('解除远端关联？', `将移除 origin（${remote}），本地历史保留。`))) return;
      setRemote(null);
      setNote('已解除（重启应用后生效）');
      return;
    }
    const input = await promptDialog('关联 GitHub 仓库', 'https://github.com/user/repo.git 或 git@github.com:user/repo.git');
    const url = input?.trim();
    if (!url) return;
    setBusy(true);
    try {
      await gitSetRemote(url);
      setNote('已关联远端');
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPush = async () => {
    setBusy(true);
    setNote('推送中…');
    try {
      setNote(await gitPush());
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPull = async () => {
    setBusy(true);
    setNote('拉取中…');
    try {
      setNote(await gitPull());
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async (c: GitCommitInfo) => {
    if (
      !(await confirmDialog(
        `恢复到「${c.subject.slice(0, 40)}」？`,
        '当前源文件将被该提交的版本覆盖（此操作本身也会产生新变更，可再提交）。',
      ))
    ) {
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const n = await gitRestore(c.hash);
      setNote(`已恢复 ${n} 个文件到「${c.subject.slice(0, 30)}」`);
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (avail === 'browser') {
    return <p className="placeholder">版本管理在桌面应用中可用（浏览器形态无本地 git）。</p>;
  }
  if (avail === 'missing') {
    return <p className="placeholder">未检测到系统 git——安装 git 后重启应用即可启用内置版本管理。</p>;
  }

  return (
    <div className="sf-gitpanel">
      {/* 远端同步（v5.7.0）：Overleaf GitHub Sync 的本地等价 */}
      <div className="sf-gitpanel-remote">
        <div className="sf-gitpanel-remote-row">
          <Link2 size={13} />
          <span className="sf-gitpanel-remote-url" title={remote ?? undefined}>
            {remote ?? '未关联远端'}
          </span>
          <button type="button" className="sf-gitpanel-mini" title={remote ? '解除关联' : '关联 GitHub 仓库'} disabled={busy} onClick={() => void onLinkRemote()}>
            {remote ? '解除' : '关联'}
          </button>
        </div>
        {remote ? (
          <div className="sf-gitpanel-remote-row">
            <button type="button" className="sf-pill-btn" disabled={busy} onClick={() => void onPush()}>
              ↑ Push
            </button>
            <button type="button" className="sf-pill-btn" disabled={busy} onClick={() => void onPull()}>
              ↓ Pull
            </button>
          </div>
        ) : null}
      </div>

      <button type="button" className="sf-gitpanel-commit" disabled={busy} onClick={() => void onCommit()}>
        <GitCommitHorizontal size={14} /> 提交当前进度
      </button>
      {note ? <div className="sf-gitpanel-note">{note}</div> : null}
      <div className="sf-gitpanel-list">
        {commits.length === 0 ? (
          <p className="placeholder">
            <History size={14} style={{ verticalAlign: -2 }} /> 还没有提交——AI 改动采纳后会自动提交，也可手动提交。
          </p>
        ) : (
          commits.map((c) => (
            <div key={c.hash} className="sf-gitpanel-item">
              <div className="sf-gitpanel-subject" title={c.subject}>
                {c.subject}
              </div>
              <div className="sf-gitpanel-meta">
                <span>{new Date(c.date).toLocaleString()}</span>
                <span className="sf-gitpanel-meta-actions">
                  <button
                    type="button"
                    title="查看差异"
                    disabled={busy}
                    onClick={() => void onShowDiff(c)}
                    className={diffFor === c.hash ? 'active' : ''}
                  >
                    <Diff size={12} /> 差异
                  </button>
                  <button
                    type="button"
                    title="生成修改对照 PDF（红删蓝增，编译后右侧预览）"
                    disabled={busy}
                    onClick={() => void onChangesPdf(c)}
                  >
                    <FileDiff size={12} /> 对照 PDF
                  </button>
                  <button type="button" title="恢复到此版本" disabled={busy} onClick={() => void onRestore(c)}>
                    <RotateCcw size={12} /> 恢复
                  </button>
                </span>
              </div>
              {diffFor === c.hash && diff ? (
                diff.stat ? (
                  <div className="sf-gitpanel-diffwrap">
                    <div className="sf-gitpanel-stat">{diff.stat}</div>
                    <DiffView text={diff.diff} />
                  </div>
                ) : (
                  <div className="sf-gitpanel-note">{diff.diff}</div>
                )
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
