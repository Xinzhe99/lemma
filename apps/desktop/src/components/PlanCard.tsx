/**
 * 计划模式消息内嵌卡片：渲染在承载计划的 assistant 消息位置。
 * 自包含展示组件（不 import aiActions / 不发请求）：执行态由 execution prop
 * 给出，动作经回调上抛——集成者在 AgentPanel 渲染 assistant 消息时查
 * useAgentPlansStore.plans[msgId]，命中即替换/叠加渲染本卡片，并把
 * onApprove→executePlan(msgId)、onSkip→skipFailedStep(msgId, stepId)、
 * onRetry→executePlan(msgId)、onAbort→abortPlan() 接上（接线详见交接说明）。
 * 样式：既有类（sf-btn/sf-chip/sf-agent-run-head）+ 少量内联样式；
 * 文案 zh/en 内置（跟随设置语言，lang prop 可覆盖，便于测试）。
 */

import { useState } from 'react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { planPhase, planProgress, type PlanExecution, type PlanStepStatus } from '../state/agentPlans';
import type { PlanStep } from '../planMode';

export interface PlanCardProps {
  /** 承载计划的 assistant 消息 id（data 属性透传，集成者定位用） */
  msgId: string;
  execution: PlanExecution;
  /** 【批准并执行】（awaiting 相位显示） */
  onApprove?: () => void;
  /** 【跳过失败步】（failed 相位显示；参数为要跳过的步骤 id） */
  onSkip?: (stepId: string) => void;
  /** 【中止】（running 相位显示） */
  onAbort?: () => void;
  /** 【重试该步】（failed 相位显示；参数为要重试的步骤 id） */
  onRetry?: (stepId: string) => void;
  /** 语言覆盖（缺省跟随设置） */
  lang?: Language;
}

interface PlanCardDict {
  phaseAwaiting: string;
  phaseRunning: string;
  phaseFailed: string;
  phaseFinished: string;
  approve: string;
  skip: string;
  retry: string;
  abort: string;
  stepsUnit: string;
  stepDetail: string;
  stepOutput: string;
  noOutput: string;
  statusLabel: Record<PlanStepStatus, string>;
}

export const PLAN_CARD_STRINGS: Record<Language, PlanCardDict> = {
  zh: {
    phaseAwaiting: '待批准',
    phaseRunning: '执行中',
    phaseFailed: '有失败',
    phaseFinished: '已完成',
    approve: '批准并执行',
    skip: '跳过失败步',
    retry: '重试该步',
    abort: '中止',
    stepsUnit: '步',
    stepDetail: '详情',
    stepOutput: '产出',
    noOutput: '（暂无产出）',
    statusLabel: { pending: '待执行', running: '进行中', done: '已完成', failed: '失败', skipped: '已跳过' },
  },
  en: {
    phaseAwaiting: 'Awaiting approval',
    phaseRunning: 'Running',
    phaseFailed: 'Failed',
    phaseFinished: 'Finished',
    approve: 'Approve & run',
    skip: 'Skip failed step',
    retry: 'Retry step',
    abort: 'Abort',
    stepsUnit: 'steps',
    stepDetail: 'Detail',
    stepOutput: 'Output',
    noOutput: '(no output yet)',
    statusLabel: { pending: 'pending', running: 'running', done: 'done', failed: 'failed', skipped: 'skipped' },
  },
};

/** 状态图标（与 buildStepPrompt 概览标记语义一致） */
const STATUS_ICON: Record<PlanStepStatus, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✗',
  skipped: '⇣',
};

const OUTPUT_PREVIEW_CHARS = 400;

/** 单步行：图标 + 标题（点击展开 detail/产出） */
function PlanStepRow({
  step,
  status,
  output,
  dict,
}: {
  step: PlanStep;
  status: PlanStepStatus;
  output?: string;
  dict: PlanCardDict;
}) {
  const [open, setOpen] = useState(false);
  // 任何步骤都可展开：无 detail/产出的步骤显示「（暂无产出）」占位（pending 步
  // 展开即为"确认还没产出"），避免死区
  return (
    <li className="sf-plan-step" data-step-id={step.id} data-status={status}>
      <button
        type="button"
        className="sf-plan-step-head"
        style={{
          all: 'unset',
          display: 'flex',
          gap: 6,
          alignItems: 'baseline',
          width: '100%',
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={dict.statusLabel[status]}
      >
        <span className={`sf-plan-icon sf-plan-icon--${status}`} aria-label={dict.statusLabel[status]}>
          {STATUS_ICON[status]}
        </span>
        <span className="sf-plan-step-id sf-chip dim" style={{ fontSize: 11 }}>{step.id}</span>
        <span className="sf-plan-step-title">{step.title}</span>
        <span className={`sf-plan-step-status sf-chip ${status === 'done' ? 'ok' : status === 'failed' ? 'err' : status === 'running' ? 'warn' : 'dim'}`}>
          {dict.statusLabel[status]}
        </span>
      </button>
      {open && (
        <div className="sf-plan-step-body" style={{ margin: '4px 0 4px 20px', fontSize: 12 }}>
          {step.detail && (
            <p style={{ margin: '0 0 4px' }}>
              <strong>{dict.stepDetail}：</strong>
              {step.detail}
            </p>
          )}
          {step.usesTools?.length ? (
            <p style={{ margin: '0 0 4px' }}>
              <span className="sf-chip dim">{step.usesTools.join(' · ')}</span>
            </p>
          ) : null}
          <div>
            <strong>{dict.stepOutput}：</strong>
            <pre
              className="sf-plan-step-output"
              style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto' }}
            >
              {output ? output.slice(0, OUTPUT_PREVIEW_CHARS) + (output.length > OUTPUT_PREVIEW_CHARS ? '…' : '') : dict.noOutput}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

/** 计划卡：goal 标题 + 步骤清单（状态图标/可展开）+ 进度条 N/M + 相位按钮组 */
export function PlanCard({ msgId, execution, onApprove, onSkip, onAbort, onRetry, lang }: PlanCardProps) {
  const settingsLang = useSettingsStore((s) => s.language);
  const dict = PLAN_CARD_STRINGS[lang ?? settingsLang];
  const phase = planPhase(execution);
  const { done, total, skipped } = planProgress(execution);
  const finishedCount = done + skipped;
  const pct = total > 0 ? Math.round((finishedCount / total) * 100) : 0;
  const failedStep = execution.plan.steps.find((s) => execution.statuses[s.id] === 'failed');

  const phaseChip =
    phase === 'finished' ? (
      <span className="sf-chip ok">{dict.phaseFinished}</span>
    ) : phase === 'failed' ? (
      <span className="sf-chip err">{dict.phaseFailed}</span>
    ) : phase === 'running' ? (
      <span className="sf-chip warn">{dict.phaseRunning}</span>
    ) : (
      <span className="sf-chip warn">{dict.phaseAwaiting}</span>
    );

  return (
    <div className="sf-plan-card sf-agent-approval" data-msg-id={msgId} data-phase={phase}>
      <div className="sf-agent-run-head">
        <strong className="sf-plan-goal">{execution.plan.goal}</strong>
        {phaseChip}
      </div>

      {/* 进度条 + N/M */}
      <div className="sf-plan-progress-row" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
        <div
          className="sf-plan-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={finishedCount}
          style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--sf-border, #d8d4cc)', overflow: 'hidden' }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--sf-accent, #2b6cb0)', transition: 'width .2s' }} />
        </div>
        <span className="sf-plan-progress-text">
          {finishedCount}/{total} {dict.stepsUnit}
        </span>
      </div>

      <ol className="sf-plan-steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {execution.plan.steps.map((s) => (
          <PlanStepRow
            key={s.id}
            step={s}
            status={execution.statuses[s.id] ?? 'pending'}
            output={execution.outputs[s.id]}
            dict={dict}
          />
        ))}
      </ol>

      {/* 相位按钮组：awaiting→批准并执行（主钮）；running→中止；failed→跳过/重试 */}
      <div className="sf-lib-dialog-actions sf-plan-actions" style={{ marginTop: 8 }}>
        {phase === 'awaiting' && (
          <button type="button" className="sf-btn sf-btn--primary sf-plan-approve" onClick={() => onApprove?.()}>
            {dict.approve}
          </button>
        )}
        {phase === 'running' && onAbort && (
          <button type="button" className="sf-btn sf-plan-abort" onClick={() => onAbort()}>
            {dict.abort}
          </button>
        )}
        {phase === 'failed' && failedStep && (
          <>
            {onSkip && (
              <button
                type="button"
                className="sf-btn sf-plan-skip"
                onClick={() => onSkip(failedStep.id)}
              >
                {dict.skip}
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="sf-btn sf-btn--primary sf-plan-retry"
                onClick={() => onRetry(failedStep.id)}
              >
                {dict.retry}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
