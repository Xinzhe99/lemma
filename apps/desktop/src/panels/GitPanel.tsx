/**
 * 版本面板（v5.0.0 S4 内置 git）：提交历史 / 恢复 / 手动提交。
 * 桌面形态 + 系统 git 可用时工作；否则明示原因（不伪装）。
 */
import { useCallback, useEffect, useState } from 'react';
import { GitCommitHorizontal, History, RotateCcw } from 'lucide-react';
import {
  detectGitAvailability,
  getGitAvailability,
  gitCommitAll,
  gitLog,
  gitRestore,
  onAutoCommit,
  subscribeGitAvailability,
  type GitCommitInfo,
} from '../git/gitService';
import { confirmDialog } from '../dialogs';
import { useWorkspaceStore } from '../state/workspaceStore';

export function GitPanel() {
  const [avail, setAvail] = useState(getGitAvailability());
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const projectName = useWorkspaceStore((s) => s.projectName);

  useEffect(() => {
    void detectGitAvailability();
    return subscribeGitAvailability(() => setAvail(getGitAvailability()));
  }, []);

  const refresh = useCallback(async () => {
    if (getGitAvailability() !== 'ok') return;
    try {
      setCommits(await gitLog(50));
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
    return (
      <p className="placeholder">版本管理在桌面应用中可用（浏览器形态无本地 git）。</p>
    );
  }
  if (avail === 'missing') {
    return (
      <p className="placeholder">
        未检测到系统 git——安装 git 后重启应用即可启用内置版本管理。
      </p>
    );
  }

  return (
    <div className="sf-gitpanel">
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
                <button type="button" title="恢复到此版本" disabled={busy} onClick={() => void onRestore(c)}>
                  <RotateCcw size={12} /> 恢复
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
