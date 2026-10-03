/**
 * 新手任务清单（GettingStarted）：Dashboard 顶部卡片，5 步自动检测完成态（用户无需手点「完成」）。
 *  - 完成态 = 实时探测 || onboardingStore.completedSteps 闩锁：
 *    dirty / compileLog / 会话数等信号重启后会复位，一旦检测为真即 markStep 落盘，清单不倒退；
 *  - 未完成步骤给行动按钮，直跳对应功能（模板向导/zip 导入、文件树、编译、Agent 会话、设置）；
 *  - 进度条 N/5；「收起」仅本次会话（可再展开），「不再显示」持久（dismissChecklist）；
 *  - 全部完成或 dismissed 后不再渲染。
 * 检测逻辑抽为纯函数 computeChecklist（导出并单测）；样式复用 sf-btn/sf-chip + 内联样式。
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { FolderPlus, MessageSquare, PenLine, Play, Plug } from 'lucide-react';
import { useAgentHubStore } from '@lemma/agent-hub';
import { useT } from '../i18n';
import { runCompile } from '../compileAction';
import { sendChatMessage } from '../aiActions';
import { useSettingsStore } from '../state/settingsStore';
import { useOnboardingStore, CHECKLIST_STEP_IDS, type ChecklistStepId } from '../state/onboardingStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';

// ---------------------------------------------------------------------------
// 完成态检测（纯函数，导出单测）
// ---------------------------------------------------------------------------

/** computeChecklist 的探测输入：各数据源在调用时刻的快照 */
export interface ChecklistState {
  /** 工作区文件（demo 项目也算——有 main.tex 即视为「已有项目」） */
  files: Record<string, string>;
  /** 编辑器有未落盘改动（updateFile 置 true，写盘成功后复位——瞬时信号） */
  dirty: boolean;
  /** 编译日志（编译过即非空；重启后清空——瞬时信号） */
  compileLog: string[];
  /** Agent 会话数（内存态，重启后清零——瞬时信号） */
  agentSessions: number;
  /** 已配置的模型服务数（settingsStore 持久化） */
  providers: number;
  /** onboardingStore 闩锁：曾达成过的步骤 */
  completedSteps: string[];
}

export interface ChecklistEntry {
  id: ChecklistStepId;
  done: boolean;
}

/**
 * 5 步完成态：done = 实时探测 || completedSteps 闩锁。
 * 顺序固定：project → write → compile → chat → provider。
 */
export function computeChecklist(state: ChecklistState): ChecklistEntry[] {
  const latched = (id: ChecklistStepId): boolean => state.completedSteps.includes(id);
  return [
    { id: 'project', done: 'main.tex' in state.files || latched('project') },
    { id: 'write', done: state.dirty || latched('write') },
    { id: 'compile', done: state.compileLog.length > 0 || latched('compile') },
    { id: 'chat', done: state.agentSessions > 0 || latched('chat') },
    { id: 'provider', done: state.providers > 0 || latched('provider') },
  ];
}

/** 此刻由实时信号（不含闩锁）判定的已完成步骤 id：组件据此调用 markStep 落盘 */
export function probeLiveStepIds(
  state: Omit<ChecklistState, 'completedSteps'>,
): ChecklistStepId[] {
  const ids: ChecklistStepId[] = [];
  if ('main.tex' in state.files) ids.push('project');
  if (state.dirty) ids.push('write');
  if (state.compileLog.length > 0) ids.push('compile');
  if (state.agentSessions > 0) ids.push('chat');
  if (state.providers > 0) ids.push('provider');
  return ids;
}

/**
 * 打开设置对话框：uiStore 没有 settingsOpen 槽位（App 本地状态），
 * 而 App 全局监听 Ctrl/⌘ + , 打开设置——派发该快捷键事件是最小耦合路径（不改 App / uiStore）。
 */
export function openSettingsViaShortcut(): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const STEP_ICON: Record<ChecklistStepId, typeof FolderPlus> = {
  project: FolderPlus,
  write: PenLine,
  compile: Play,
  chat: MessageSquare,
  provider: Plug,
};

/** 步骤 id → i18n 键段（gs.stepProject.* / gs.stepWrite.* / …） */
const STEP_KEY: Record<ChecklistStepId, string> = {
  project: 'Project',
  write: 'Write',
  compile: 'Compile',
  chat: 'Chat',
  provider: 'Provider',
};

export function GettingStarted() {
  const t = useT();
  const files = useWorkspaceStore((s) => s.files);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const compileLog = useWorkspaceStore((s) => s.compileLog);
  const agentSessions = useAgentHubStore((s) => s.sessions.length);
  const providers = useSettingsStore((s) => s.providers.length);
  const completedSteps = useOnboardingStore((s) => s.completedSteps);
  const checklistDismissed = useOnboardingStore((s) => s.checklistDismissed);
  const [collapsed, setCollapsed] = useState(false); // 仅本次会话

  const steps = useMemo(
    () =>
      computeChecklist({
        files,
        dirty,
        compileLog,
        agentSessions,
        providers,
        completedSteps,
      }),
    [files, dirty, compileLog, agentSessions, providers, completedSteps],
  );

  // 瞬时信号闩锁：一旦探测为真就 markStep 持久化，重启后清单不倒退（幂等）
  useEffect(() => {
    const live = probeLiveStepIds({ files, dirty, compileLog, agentSessions, providers });
    const ob = useOnboardingStore.getState();
    for (const id of live) {
      if (!ob.completedSteps.includes(id)) ob.markStep(id);
    }
  }, [files, dirty, compileLog, agentSessions, providers]);

  if (checklistDismissed) return null;
  if (steps.every((s) => s.done)) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const doneMap = new Map(steps.map((s) => [s.id, s.done]));

  if (collapsed) {
    return (
      <button
        type="button"
        className="sf-link-btn sf-gs-expand"
        onClick={() => setCollapsed(false)}
        style={{ alignSelf: 'flex-start', padding: 0 }}
      >
        {t('gs.expand')}
      </button>
    );
  }

  const actions: Record<ChecklistStepId, () => void> = {
    project: () => useUiStore.getState().setTemplateWizardOpen(true),
    write: () => useUiStore.getState().setSidebarTab('files'),
    compile: () => void runCompile(),
    chat: () => void sendChatMessage(t('onboarding.agentSampleQuestion')),
    provider: openSettingsViaShortcut,
  };

  const cardStyle: CSSProperties = {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
  };

  const stepRow = (id: ChecklistStepId) => {
    const done = doneMap.get(id) ?? false;
    const Icon = STEP_ICON[id];
    return (
      <li
        key={id}
        className={`sf-gs-step ${done ? 'done' : ''}`}
        data-step={id}
        data-done={done}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 8px',
          borderRadius: 'var(--radius)',
          background: done ? 'transparent' : 'var(--bg-3)',
          opacity: done ? 0.75 : 1,
        }}
      >
        <span
          className="sf-gs-check"
          aria-hidden="true"
          style={{
            flex: 'none',
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: done ? 'var(--ok)' : '#fff',
            border: done ? '1px solid var(--ok)' : 'none',
            background: done ? 'transparent' : 'var(--accent)',
          }}
        >
          {done ? '✓' : <Icon size={12} />}
        </span>
        <div className="sf-gs-main" style={{ flex: 1, minWidth: 0 }}>
          <span className="sf-gs-step-title" style={{ fontSize: 12.5, fontWeight: 600, display: 'block' }}>
            {t(`gs.step${STEP_KEY[id]}.title`)}
          </span>
          <span className="sf-gs-step-desc" style={{ fontSize: 11.5, color: 'var(--fg-1)', display: 'block' }}>
            {done ? t(id === 'project' ? 'gs.stepProject.done' : 'gs.done') : t(`gs.step${STEP_KEY[id]}.desc`)}
          </span>
        </div>
        {!done && (
          <div className="sf-gs-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="sf-btn sf-gs-action" onClick={actions[id]}>
              {t(`gs.step${STEP_KEY[id]}.btn`)}
            </button>
            {id === 'project' && (
              <button
                type="button"
                className="sf-btn sf-gs-action-alt"
                onClick={() => useUiStore.getState().requestZipPicker()}
              >
                {t('gs.stepProject.alt')}
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="sf-gs" style={cardStyle} data-done-count={doneCount}>
      <header
        className="sf-gs-head"
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong className="sf-gs-title" style={{ fontSize: 13 }}>
              {t('gs.title')}
            </strong>
            <span className="sf-chip dim sf-gs-progress" data-count={doneCount}>
              {t('gs.progress', { n: doneCount })}
            </span>
          </div>
          <p className="sf-gs-subtitle" style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--fg-1)' }}>
            {t('gs.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
          <button type="button" className="sf-link-btn sf-gs-collapse" onClick={() => setCollapsed(true)}>
            {t('gs.collapse')}
          </button>
          <button
            type="button"
            className="sf-link-btn sf-gs-dismiss"
            onClick={() => useOnboardingStore.getState().dismissChecklist()}
          >
            {t('gs.dismiss')}
          </button>
        </div>
      </header>

      <div
        className="sf-gs-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={doneCount}
        style={{ height: 6, borderRadius: 3, background: 'var(--bg-3)', overflow: 'hidden', marginTop: 8 }}
      >
        <div
          className="sf-gs-bar-fill"
          style={{ width: `${(doneCount / 5) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }}
        />
      </div>

      <ul className="sf-gs-list" style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {CHECKLIST_STEP_IDS.map(stepRow)}
      </ul>
    </section>
  );
}
