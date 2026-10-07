/**
 * 版本面板（v5.6.0 内置 git + v5.7.0 差异查看/GitHub 同步）：
 * 远端同步区（关联 / push / pull）→ 提交历史（差异查看 / 恢复）。
 * 桌面形态 + 系统 git 可用时工作；否则明示原因（不伪装）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Diff, FileDiff, GitCommitHorizontal, Link2, History, RotateCcw, Undo2 } from 'lucide-react';
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
  gitResetToHead,
  gitShowCommit,
  onAutoCommit,
  subscribeGitAvailability,
  type GitCommitInfo,
} from '../git/gitService';
import { confirmDialog, promptDialog } from '../dialogs';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useT } from '../i18n';

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
  const t = useT();
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
      setNote(commit ? t('git.committed', { subject: commit.subject }) : t('git.nothingToCommit'));
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
    setNote(t('git.changesPdfBuilding', { subject: c.subject.slice(0, 20) }));
    try {
      const r = await buildChangesPdf(c.hash, c.subject);
      setNote(t('git.changesPdfDone', { files: r.fileCount, lines: r.lineCount }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** v7.2.0 F3：一键回滚到上次提交（丢弃全部未提交改动） */
  const onResetToHead = async () => {
    if (!(await confirmDialog(t('git.resetConfirmTitle'), t('git.resetToHead')))) {
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const r = await gitResetToHead();
      setNote(t('git.rolledBack', { n: r.fileCount }));
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLinkRemote = async () => {
    if (remote) {
      if (!(await confirmDialog(t('git.unlinkConfirmTitle', { remote }), t('git.unlink')))) return;
      setRemote(null);
      setNote(t('git.remoteUnlinked'));
      return;
    }
    const input = await promptDialog(t('git.remotePrompt'), t('git.remotePlaceholder'));
    const url = input?.trim();
    if (!url) return;
    setBusy(true);
    try {
      await gitSetRemote(url);
      setNote(t('git.remoteLinked'));
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPush = async () => {
    setBusy(true);
    setNote(t('git.push'));
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
    setNote(t('git.pull'));
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
    const subject = c.subject.slice(0, 40);
    if (!(await confirmDialog(t('git.restoreConfirmTitle', { subject }), t('git.restore')))) {
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const n = await gitRestore(c.hash);
      setNote(t('git.restored', { n, subject: c.subject.slice(0, 30) }));
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (avail === 'browser') {
    return <p className="placeholder">{t('git.browserOnly')}</p>;
  }
  if (avail === 'missing') {
    return <p className="placeholder">{t('git.missingGit')}</p>;
  }

  return (
    <div className="sf-gitpanel">
      {/* 远端同步（v5.7.0）：Overleaf GitHub Sync 的本地等价 */}
      <div className="sf-gitpanel-remote">
        <div className="sf-gitpanel-remote-row">
          <Link2 size={13} />
          <span className="sf-gitpanel-remote-url" title={remote ?? undefined}>
            {remote ?? t('git.remote')}
          </span>
          <button type="button" className="sf-gitpanel-mini" title={remote ? t('git.unlink') : t('git.linkRemote')} disabled={busy} onClick={() => void onLinkRemote()}>
            {remote ? t('git.unlink') : t('git.link')}
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
        <GitCommitHorizontal size={14} /> {t('git.commit', undefined)}
      </button>
      <button
        type="button"
        className="sf-gitpanel-commit"
        style={{ color: 'var(--err, #cf222e)' }}
        disabled={busy}
        title={t('git.resetToHeadTitle')}
        onClick={() => void onResetToHead()}
      >
        <Undo2 size={14} /> {t('git.resetToHead')}
      </button>
      {note ? <div className="sf-gitpanel-note">{note}</div> : null}
      <div className="sf-gitpanel-list">
        {commits.length === 0 ? (
          <p className="placeholder">
            <History size={14} style={{ verticalAlign: -2 }} /> {t('git.noCommits')}
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
                    title={t('git.diff')}
                    disabled={busy}
                    onClick={() => void onShowDiff(c)}
                    className={diffFor === c.hash ? 'active' : ''}
                  >
                    <Diff size={12} /> {t('git.diff')}
                  </button>
                  <button
                    type="button"
                    title={t('git.changesPdf')}
                    disabled={busy}
                    onClick={() => void onChangesPdf(c)}
                  >
                    <FileDiff size={12} /> {t('git.changesPdf')}
                  </button>
                  <button type="button" title={t('git.restoreTitle')} disabled={busy} onClick={() => void onRestore(c)}>
                    <RotateCcw size={12} /> {t('git.restore')}
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
