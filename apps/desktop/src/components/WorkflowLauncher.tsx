/**
 * WF-3 A1 工作流启动器：替代 window.prompt 的逐项弹窗——单个 sf-dialog 表单内
 * 按 def.inputs 逐项收集（变量名 + 说明 + 默认值），一次提交。
 * 三个启动来源统一走本组件：
 *  1) 面板「内置工作流」按钮；
 *  2) 命令面板（uiStore.workflowLaunch + workflowLaunchVars：已预填的变量不出现在表单）；
 *  3) ReviewPanel 的 W7 衔接（presetVars 全量预填 → 仅剩确认一步）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowDef, WorkflowStepDef } from '@lemma/shared';
import { workflowName, workflowDescription } from '../workflowI18n';
import { useSettingsStore, type Language } from '../state/settingsStore';
import {
  getWorkflowOverrides,
  resetWorkflowOverrides,
  setStepOverride,
} from '../state/workflowOverrides';

/** 变量元信息：说明（双语）+ 默认值 + 是否多行 */
interface VarMeta {
  desc: Record<Language, string>;
  def: string;
  multiline?: boolean;
}

/**
 * 内置工作流输入变量的展示元数据（沿用 AgentPanel 旧 WORKFLOW_VAR_DEFAULTS 的取值思路）。
 * 未收录的变量降级为单行 input、空默认值。
 */
export const WORKFLOW_VAR_META: Record<string, VarMeta> = {
  section: { desc: { zh: '要起草的章节名（如 Introduction / Related Work）', en: 'Section to draft (e.g. Introduction / Related Work)' }, def: 'Introduction' },
  outline: {
    desc: { zh: '整体大纲（各节定位与层级）', en: 'Paper outline (role and level of each section)' },
    def: '1 引言：动机与贡献\n2 相关工作\n3 方法\n4 实验\n5 结论',
    multiline: true,
  },
  notes: { desc: { zh: '作者补充说明（写作约束、侧重）', en: 'Author notes (constraints, emphasis)' }, def: '保持简洁', multiline: true },
  manuscript: {
    desc: { zh: '待审/待检稿件全文（LaTeX 或纯文本）', en: 'Full manuscript to review/check (LaTeX or plain text)' },
    def: '本文提出了一种面向科研写作的智能体工作流。',
    multiline: true,
  },
  venue: { desc: { zh: '目标会议/期刊（审稿口味与要求来源）', en: 'Target venue (review criteria source)' }, def: 'NeurIPS' },
  highlights: { desc: { zh: '稿件亮点/核心贡献（分号分隔）', en: 'Paper highlights/contributions (semicolon-separated)' }, def: '', multiline: true },
  journal: { desc: { zh: '目标期刊/会议（自检清单来源）', en: 'Target journal/conference (checklist source)' }, def: 'NeurIPS' },
  reviews: { desc: { zh: '审稿意见全文（将逐条拆解回复）', en: 'Full review comments (parsed item by item)' }, def: '', multiline: true },
  text: { desc: { zh: '待润色文本', en: 'Text to polish' }, def: '本文提出了一种面向科研写作的智能体工作流。', multiline: true },
  target: { desc: { zh: '润色目标（风格/venue）', en: 'Polish target (style/venue)' }, def: 'NeurIPS' },
  paper: { desc: { zh: '相关论文主题描述', en: 'Description of the related paper' }, def: 'Lemma 演示论文' },
  selection: {
    desc: { zh: '编辑器选中的待改写片段', en: 'Selected snippet to rewrite' },
    def: 'In order to demonstrate the pipeline, we utilize a number of examples.',
    multiline: true,
  },
  styleNotes: { desc: { zh: '风格备注（语气、术语约束）', en: 'Style notes (tone, terminology)' }, def: '保持简洁' },
};

const STRINGS = {
  zh: {
    title: (name: string) => `启动工作流：${name}`,
    presetChip: '已预填',
    fieldLabel: (name: string) => name,
    noFields: '所需变量均已预填，确认后即可启动。',
    cancel: '取消',
    submit: '启动工作流',
    confirmOnly: '确认启动',
    required: '必填',
    // 工作流透明化：「流程与提示词」区块
    stepsTitle: '流程与提示词',
    stepsHint:
      '以下是每一步实际发给模型的提示词，可直接修改（本次及以后的启动都会生效）；{{var}} 占位符在执行时自动替换为上方变量。',
    checkpoint: '人工检查点',
    checkpointTitle: '执行到该步骤前会暂停，等待人工确认后继续',
    dependsOn: (deps: string) => `依赖：${deps}`,
    modifiedChip: '已修改',
    modifiedCount: (n: number) => `${n} 步已修改`,
    revertStep: '还原',
    revertAll: '全部还原',
    promptAria: (name: string) => `步骤「${name}」的提示词`,
  },
  en: {
    title: (name: string) => `Launch workflow: ${name}`,
    presetChip: 'prefilled',
    fieldLabel: (name: string) => name,
    noFields: 'All variables are prefilled. Confirm to launch.',
    cancel: 'Cancel',
    submit: 'Launch workflow',
    confirmOnly: 'Launch',
    required: 'required',
    stepsTitle: 'Pipeline & prompts',
    stepsHint:
      'These are the prompts actually sent to the model for each step. Edit them freely — changes apply to this and future launches; {{var}} placeholders are substituted with the variables above at run time.',
    checkpoint: 'Checkpoint',
    checkpointTitle: 'Pauses before this step and waits for manual confirmation',
    dependsOn: (deps: string) => `Depends on: ${deps}`,
    modifiedChip: 'modified',
    modifiedCount: (n: number) => `${n} modified`,
    revertStep: 'Revert',
    revertAll: 'Revert all',
    promptAria: (name: string) => `Prompt for step "${name}"`,
  },
} as const;

export interface WorkflowLauncherProps {
  def: WorkflowDef;
  /** 已由调用方提供的变量（不渲染表单项，提交时原样合并） */
  presetVars?: Record<string, string>;
  /** 表单提交：presetVars 与用户填写的合并结果 */
  onSubmit: (vars: Record<string, string>) => void;
  onCancel: () => void;
}

export function WorkflowLauncher({ def, presetVars = {}, onSubmit, onCancel }: WorkflowLauncherProps) {
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language];

  /** 需要用户填写的变量：preset 中已有非空值的跳过 */
  const missing = useMemo(
    () => def.inputs.filter((k) => presetVars[k] === undefined || presetVars[k] === ''),
    [def.inputs, presetVars],
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(missing.map((k) => [k, WORKFLOW_VAR_META[k]?.def ?? ''])),
  );

  const submit = () => {
    const vars: Record<string, string> = { ...presetVars };
    for (const key of missing) vars[key] = (values[key] ?? '').trim();
    onSubmit(vars);
  };

  return (
    <div className="sf-dialog-overlay" role="dialog" aria-modal="true" data-agent-launcher>
      <div className="sf-dialog sf-wf-launcher">
        <div className="sf-dialog-header">
          <span>{t.title(workflowName(def.id, def.name, language))}</span>
          <button className="sf-link-btn" onClick={onCancel} aria-label={t.cancel}>
            ✕
          </button>
        </div>
        <div className="sf-dialog-body">
          <p className="sf-wf-launcher-desc">{workflowDescription(def.id, def.description, language)}</p>
          {missing.length === 0 ? (
            <p className="sf-wf-launcher-empty">{t.noFields}</p>
          ) : (
            <form
              className="sf-wf-launcher-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {missing.map((key) => {
                const meta = WORKFLOW_VAR_META[key];
                const value = values[key] ?? '';
                return (
                  <label key={key} className="sf-wf-launcher-field">
                    <span className="sf-wf-launcher-field-name">
                      {/* v7.7.1：字段名本地化（此前直接显示 raw 变量名 journal/highlights） */}
                      {meta ? meta.desc[language] : t.fieldLabel(key)}
                      <code className="sf-wf-launcher-field-var">{key}</code>
                      <em className="sf-wf-launcher-field-required">{t.required}</em>
                    </span>

                    {meta?.multiline ? (
                      <textarea
                        rows={3}
                        value={value}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                        autoFocus
                      />
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      />
                    )}
                  </label>
                );
              })}
            </form>
          )}
          {/* 工作流透明化：步骤信息与 prompt 查看/修改（默认折叠） */}
          <WorkflowStepsEditor def={def} language={language} />
        </div>
        <div className="sf-lib-dialog-actions sf-wf-launcher-actions">
          <button className="sf-btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            className="sf-btn sf-btn--primary"
            onClick={submit}
            disabled={missing.some((k) => !(values[k] ?? '').trim())}
          >
            {missing.length === 0 ? t.confirmOnly : t.submit}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 「流程与提示词」区块（工作流透明化）：默认折叠的 details，
 * 逐卡展示每个步骤的序号 / id / modelTier / checkpoint / dependsOn，并以 textarea
 * 呈现当前生效的 prompt（覆盖值 ?? YAML 原文）。
 * 编辑防抖（500ms）写入 workflowOverrides；改回原文、单步「还原」、「全部还原」都会
 * 移除覆盖回退原文；卸载时冲刷未保存的编辑，保证「改了就关」也不丢。
 */
export function WorkflowStepsEditor({ def, language }: { def: WorkflowDef; language: Language }) {
  const t = STRINGS[language];

  /** 各步骤的 YAML 原文（def 来自内置工作流，稳定引用） */
  const originalPrompts = useMemo(() => Object.fromEntries(def.steps.map((s) => [s.id, s.prompt])), [def]);

  /** textarea 当前值：初始为生效值（覆盖 ?? 原文），编辑后为草稿 */
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      def.steps.map((s) => [s.id, getWorkflowOverrides()[def.id]?.[s.id] ?? s.prompt]),
    ),
  );

  /** 待防抖保存的草稿（stepId → value）；还原操作会把对应条目摘除 */
  const pendingRef = useRef<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 立即把待保存草稿写入覆盖层（值等于原文 → 还原） */
  const commitPending = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    for (const [stepId, value] of Object.entries(pending)) {
      setStepOverride(def.id, stepId, value === originalPrompts[stepId] ? null : value);
    }
    pendingRef.current = {};
  };

  /** 卸载时冲刷未保存的编辑（用户改完直接点「启动工作流」也不丢） */
  useEffect(() => {
    return () => commitPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPromptChange = (stepId: string, value: string) => {
    setDrafts((d) => ({ ...d, [stepId]: value }));
    pendingRef.current[stepId] = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commitPending, 500);
  };

  const revertStep = (stepId: string) => {
    delete pendingRef.current[stepId];
    setDrafts((d) => ({ ...d, [stepId]: originalPrompts[stepId] }));
    setStepOverride(def.id, stepId, null);
  };

  const revertAll = () => {
    pendingRef.current = {};
    setDrafts({ ...originalPrompts });
    resetWorkflowOverrides(def.id);
  };

  const modifiedIds = def.steps.filter((s) => (drafts[s.id] ?? s.prompt) !== s.prompt).map((s) => s.id);

  return (
    <details className="sf-wf-launcher-steps" data-wf-steps>
      <summary className="sf-wf-launcher-steps-summary">
        <span>{t.stepsTitle}</span>
        <span className="sf-wf-launcher-steps-count">{def.steps.length}</span>
        {modifiedIds.length > 0 && <span className="sf-chip warn">{t.modifiedCount(modifiedIds.length)}</span>}
      </summary>
      <p className="sf-wf-launcher-steps-hint">{t.stepsHint}</p>
      <ol className="sf-wf-launcher-step-list">
        {def.steps.map((step, index) => (
          <WorkflowStepCard
            key={step.id}
            step={step}
            index={index}
            language={language}
            value={drafts[step.id] ?? step.prompt}
            modified={modifiedIds.includes(step.id)}
            onChange={(v) => onPromptChange(step.id, v)}
            onRevert={() => revertStep(step.id)}
          />
        ))}
      </ol>
      <div className="sf-wf-launcher-steps-footer">
        <button className="sf-btn" type="button" disabled={modifiedIds.length === 0} onClick={revertAll}>
          {t.revertAll}
        </button>
      </div>
    </details>
  );
}

/** 单个步骤卡：序号 + id + 名称 + modelTier / checkpoint / dependsOn 徽标 + prompt textarea */
function WorkflowStepCard(props: {
  step: WorkflowStepDef;
  index: number;
  language: Language;
  value: string;
  modified: boolean;
  onChange: (value: string) => void;
  onRevert: () => void;
}) {
  const { step, index, language, value, modified, onChange, onRevert } = props;
  const t = STRINGS[language];
  return (
    <li className="sf-wf-launcher-step" data-step-id={step.id}>
      <div className="sf-wf-launcher-step-head">
        <span className="sf-wf-launcher-step-index">{index + 1}</span>
        <code className="sf-wf-launcher-step-id">{step.id}</code>
        <span className="sf-wf-launcher-step-name">{step.name}</span>
        {step.modelTier && (
          <span className={`sf-chip ${step.modelTier === 'flagship' ? 'warn' : 'dim'}`}>{step.modelTier}</span>
        )}
        {step.checkpoint && (
          <span className="sf-chip sf-wf-launcher-step-checkpoint" title={t.checkpointTitle}>
            ↺ {t.checkpoint}
          </span>
        )}
        {step.dependsOn && step.dependsOn.length > 0 && (
          <span className="sf-wf-launcher-step-deps">{t.dependsOn(step.dependsOn.join(', '))}</span>
        )}
        {modified && (
          <span className="sf-wf-launcher-step-actions">
            <span className="sf-chip warn">{t.modifiedChip}</span>
            <button className="sf-link-btn" type="button" onClick={onRevert}>
              {t.revertStep}
            </button>
          </span>
        )}
      </div>
      <textarea
        className="sf-wf-launcher-step-prompt"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t.promptAria(step.name || step.id)}
      />
    </li>
  );
}
