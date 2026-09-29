/**
 * diff 审批卡：write 级修改的呈现与处置（采纳 / 逐块采纳占位 / 回滚）。
 */
import { useState } from 'react';

export interface DiffApprovalCardProps {
  title: string;
  /** unified diff 纯文本 */
  patch: string;
  onAdopt?: () => void;
  onRollback?: () => void;
  /** 已处理（采纳或回滚）后禁用按钮 */
  resolved?: boolean;
}

/** patch 逐行高亮渲染（纯展示，无内部状态） */
export function PatchView({ patch }: { patch: string }) {
  return (
    <pre>
      {patch.split('\n').map((line, i) => {
        // '---'/'+++' 是文件头，不算增删行
        const isAdd = line.startsWith('+') && !line.startsWith('+++');
        const isDel = line.startsWith('-') && !line.startsWith('---');
        return (
          <span
            key={i}
            className={
              isAdd
                ? 'sf-ah-diff-line sf-ah-diff-line--add'
                : isDel
                  ? 'sf-ah-diff-line sf-ah-diff-line--del'
                  : 'sf-ah-diff-line'
            }
          >
            {line}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

export function DiffApprovalCard({ title, patch, onAdopt, onRollback, resolved }: DiffApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const disabled = resolved || busy;

  const act = (fn?: () => void) => () => {
    setBusy(true);
    fn?.();
  };

  return (
    <div className="sf-ah-diffcard">
      <div className="sf-ah-diffcard-title">{title}</div>
      <PatchView patch={patch} />
      <div className="sf-ah-diffcard-actions">
        <button className="sf-ah-btn sf-ah-btn--primary" onClick={act(onAdopt)} disabled={disabled}>
          采纳
        </button>
        {/* 占位：逐块采纳将按 hunk 粒度给出选择器，当前版本提供整卡采纳 */}
        <button className="sf-ah-btn" disabled title="逐块采纳（按 hunk 选择）将在后续版本提供">
          逐块采纳
        </button>
        <button className="sf-ah-btn sf-ah-btn--danger" onClick={act(onRollback)} disabled={disabled}>
          回滚
        </button>
      </div>
    </div>
  );
}
