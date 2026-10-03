/**
 * 工作流运行视图：步骤状态灯（pending/running/done/failed/checkpoint），checkpoint 提供继续按钮。
 */
import type { WorkflowStepDef } from '@lemma/shared';

export type WorkflowStepUiStatus = 'pending' | 'running' | 'done' | 'failed' | 'checkpoint';

export interface WorkflowRunViewProps {
  steps: WorkflowStepDef[];
  /** stepId → 展示状态；未列出的步骤视为 pending */
  statuses?: Record<string, WorkflowStepUiStatus>;
  outputs?: Record<string, string>;
  /** checkpoint 步骤的“继续”回调 */
  onContinue?: (stepId: string) => void;
}

const STATUS_LABEL: Record<WorkflowStepUiStatus, string> = {
  pending: '等待中',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  checkpoint: '等待确认',
};

export function WorkflowRunView({ steps, statuses = {}, outputs, onContinue }: WorkflowRunViewProps) {
  return (
    <div className="sf-ah-flow">
      <ol>
        {steps.map((s) => {
          const status = statuses[s.id] ?? 'pending';
          return (
            <li
              key={s.id}
              className={`sf-ah-flow-step sf-ah-flow-step--${status}`}
              data-step-id={s.id}
            >
              <span className={`sf-ah-dot sf-ah-dot--${status}`} title={STATUS_LABEL[status]} />
              <span className="sf-ah-flow-name">{s.name || s.id}</span>
              {outputs?.[s.id] ? (
                <details>
                  <summary className="sf-ah-flow-status">输出</summary>
                  <pre>{outputs[s.id].slice(0, 400)}</pre>
                </details>
              ) : null}
              <span className="sf-ah-flow-status">{STATUS_LABEL[status]}</span>
              {status === 'checkpoint' && onContinue ? (
                <button className="sf-ah-btn sf-ah-flow-checkpoint" onClick={() => onContinue(s.id)}>
                  继续
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
