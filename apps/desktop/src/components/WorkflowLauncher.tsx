/**
 * WF-3 A1 工作流启动器：替代 window.prompt 的逐项弹窗——单个 sf-dialog 表单内
 * 按 def.inputs 逐项收集（变量名 + 说明 + 默认值），一次提交。
 * 三个启动来源统一走本组件：
 *  1) 面板「内置工作流」按钮；
 *  2) 命令面板（uiStore.workflowLaunch + workflowLaunchVars：已预填的变量不出现在表单）；
 *  3) ReviewPanel 的 W7 衔接（presetVars 全量预填 → 仅剩确认一步）。
 */

import { useMemo, useState } from 'react';
import type { WorkflowDef } from '@scholarforge/shared';
import { useSettingsStore, type Language } from '../state/settingsStore';

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
  journal: { desc: { zh: '目标期刊/会议（自检清单来源）', en: 'Target journal/conference (checklist source)' }, def: 'NeurIPS' },
  reviews: { desc: { zh: '审稿意见全文（将逐条拆解回复）', en: 'Full review comments (parsed item by item)' }, def: '', multiline: true },
  text: { desc: { zh: '待润色文本', en: 'Text to polish' }, def: '本文提出了一种面向科研写作的智能体工作流。', multiline: true },
  target: { desc: { zh: '润色目标（风格/venue）', en: 'Polish target (style/venue)' }, def: 'NeurIPS' },
  paper: { desc: { zh: '相关论文主题描述', en: 'Description of the related paper' }, def: 'ScholarForge 演示论文' },
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
          <span>{t.title(def.name)}</span>
          <button className="sf-link-btn" onClick={onCancel} aria-label={t.cancel}>
            ✕
          </button>
        </div>
        <div className="sf-dialog-body">
          <p className="sf-wf-launcher-desc">{def.description}</p>
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
                      {t.fieldLabel(key)}
                      <em className="sf-wf-launcher-field-required">{t.required}</em>
                    </span>
                    <span className="sf-wf-launcher-field-desc">{meta ? meta.desc[language] : ''}</span>
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
