/**
 * 首页指挥台（Dashboard）：打开应用第一眼即见「今天该做什么」。
 *  - 新手任务清单：顶部渲染 <GettingStarted />（完整新手引导系统），5 步自动检测完成态，
 *    全部完成或 dismissed 后组件自身不再显示；
 *  - 问候行：项目名 + 本地日期；无项目数据时给出「从模板新建 / 导入 zip」引导；
 *  - 今日写作卡：wordsToday / dailyGoal 进度条 + 🔥 streakDays + 「继续写作」（跳文件树）；
 *    goal 未设（<=0）时不给目标压力——只显示字数、不渲染进度条；
 *  - arXiv 晨报块：整体复用 <DigestPanel />（自包含：订阅管理 + 近三日新论文 +
 *    空订阅引导，挂载即读缓存并静默刷新）；
 *  - deadline 卡：submitStore.deadline → deadlineCountdown 大字（⚠ 临期 / 过期态着色），
 *    未设置时温和提示并可一键跳投稿页补填；
 *  - 稿件健康度卡：computeHealth(files)（useMemo，仅 files 变化重算）分数大字按
 *    ≥85 绿 / 60–85 黄 / <60 着色 + 四类 issue 计数 chips，行动按钮跳引用面板；
 *  - 未处理事项卡：未解决批注数（去处理 → 批注面板）+ 正式项目数。
 *
 * 契约：LazyPanel 动态加载——export function Dashboard()，无 props。
 * 样式：sf-dash-* 语义类名 + 内联样式（不新增 CSS 文件），复用 sf-btn / sf-chip。
 */

import { useEffect, useMemo, type CSSProperties } from 'react';
import { DigestPanel } from './DigestPanel';
import { GettingStarted } from '../components/GettingStarted';
import { ProjectStats } from '../components/ProjectStats';
import { ReadingQueuePanel } from './ReadingQueuePanel';
import { computeHealth, healthTone, type HealthIssueKind, type HealthTone } from '../healthScore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useWritingStatsStore } from '../state/writingStats';
import { scanTodos } from '../todoScanner';
import { jumpTo } from '../editorJump';
import { deadlineCountdown, useSubmitStore } from '../state/submitStore';
import { useCommentsStore } from '../state/commentsStore';
import { CURRENT_PROJECT_ID, useProjectsStore } from '../state/projectsStore';

// ---------------------------------------------------------------------------
// 双语文案（组件内本地字典，不进全局 i18n——与 DigestPanel / CitationsPanel 同约定）
// ---------------------------------------------------------------------------

interface DashDict {
  emptyTitle: string;
  emptyDesc: string;
  newProject: string;
  importProject: string;
  todayTitle: string;
  wordsUnit: string;
  goalLabel(n: number): string;
  goalUnset: string;
  streakUnit: string;
  focusLabel(m: number): string;
  continueWriting: string;
  deadlineTitle: string;
  deadlineNone: string;
  goSubmit: string;
  setDeadline: string;
  healthTitle: string;
  healthWords(n: number): string;
  viewIssues: string;
  issueLabels: Record<HealthIssueKind, string>;
  pendingTitle: string;
  unresolved(n: number): string;
  noUnresolved: string;
  goResolve: string;
  projects(n: number): string;
  todoTitle: string;
  todoCount(n: number): string;
  todoNone: string;
  todoJump: string;
}

const DICT: Record<Language, DashDict> = {
  zh: {
    emptyTitle: '开始你的第一个项目',
    emptyDesc: '从模板新建，或导入已有的论文项目 zip',
    newProject: '从模板新建',
    importProject: '导入项目',
    todayTitle: '今日写作',
    wordsUnit: '字',
    goalLabel: (n) => `每日目标 ${n} 字`,
    goalUnset: '尚未设置每日目标——想写多少都可以',
    streakUnit: '天',
    focusLabel: (m: number) => '专注 ' + (m < 60 ? m + ' 分钟' : Math.floor(m / 60) + ' 小时 ' + Math.round(m % 60) + ' 分'),
    continueWriting: '继续写作',
    deadlineTitle: '投稿倒计时',
    deadlineNone: '未设置投稿截止日期',
    goSubmit: '去投稿准备',
    setDeadline: '设置截止日期',
    healthTitle: '稿件健康度',
    healthWords: (n) => `全稿 ${n} 字`,
    viewIssues: '查看引用与问题',
    issueLabels: { lint: '语法', spell: '拼写', glossary: '术语', citation: '悬空引用' },
    pendingTitle: '待处理',
    unresolved: (n) => `${n} 条未解决批注`,
    noUnresolved: '没有待处理的批注',
    goResolve: '去处理',
    projects: (n) => `共 ${n} 个项目`,
    todoTitle: '稿件待办',
    todoCount: (n) => `${n} 条 TODO/FIXME`,
    todoNone: '稿件里没有 TODO 标记',
    todoJump: '去处理',
  },
  en: {
    emptyTitle: 'Start your first project',
    emptyDesc: 'Create from a template, or import an existing paper project zip',
    newProject: 'New from template',
    importProject: 'Import project',
    todayTitle: "Today's writing",
    wordsUnit: 'words',
    goalLabel: (n) => `Daily goal: ${n} words`,
    goalUnset: 'No daily goal set — write as much as you like',
    streakUnit: 'days',
    focusLabel: (m: number) => 'Focused ' + (m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + Math.round(m % 60) + 'm'),
    continueWriting: 'Keep writing',
    deadlineTitle: 'Submission countdown',
    deadlineNone: 'No submission deadline set',
    goSubmit: 'Open submission desk',
    setDeadline: 'Set a deadline',
    healthTitle: 'Manuscript health',
    healthWords: (n) => `${n} words in total`,
    viewIssues: 'View citations & issues',
    issueLabels: { lint: 'LaTeX', spell: 'Spelling', glossary: 'Glossary', citation: 'Dangling cites' },
    pendingTitle: 'Pending',
    unresolved: (n) => `${n} unresolved comment${n > 1 ? 's' : ''}`,
    noUnresolved: 'No unresolved comments',
    goResolve: 'Resolve now',
    projects: (n) => `${n} project${n > 1 ? 's' : ''}`,
    todoTitle: 'Manuscript todos',
    todoCount: (n) => `${n} TODO/FIXME item${n > 1 ? 's' : ''}`,
    todoNone: 'No TODO markers in the manuscript',
    todoJump: 'Open',
  },
};

/** 健康度色调 → 主题色变量（与 styles.css 的 --ok/--warn/--err 对应） */
const TONE_COLOR: Record<HealthTone, string> = {
  good: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--err)',
};

/** 本地化日期行（如「2026年10月1日 周四」/「Thu, October 1, 2026」） */
function localeDate(d: Date, lang: Language): string {
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

/**
 * deadline 倒计时文案：zh 用 deadlineCountdown 自带 label（含 ⚠/已过期），
 * en 由天数推导同构文案。
 */
function deadlineLabel(days: number, zhLabel: string, lang: Language): string {
  if (lang === 'zh') return zhLabel;
  if (days < 0) return `Overdue by ${-days} day${-days > 1 ? 's' : ''}`;
  if (days === 0) return '⚠ Due today';
  return `${days} day${days > 1 ? 's' : ''} left`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function Dashboard() {
  const language = useSettingsStore((s) => s.language);
  const d = DICT[language];

  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const setTemplateWizardOpen = useUiStore((s) => s.setTemplateWizardOpen);
  const requestZipPicker = useUiStore((s) => s.requestZipPicker);

  const projectName = useWorkspaceStore((s) => s.projectName);
  const files = useWorkspaceStore((s) => s.files);

  const wordsToday = useWritingStatsStore((s) => s.wordsToday);
  const dailyGoal = useWritingStatsStore((s) => s.dailyGoal);
  const streakDays = useWritingStatsStore((s) => s.streakDays);
  const focusMinutes = useWritingStatsStore((s) => s.focusMinutes);
  const ensureToday = useWritingStatsStore((s) => s.ensureToday);

  const deadline = useSubmitStore((s) => s.deadline);

  const comments = useCommentsStore((s) => s.comments);

  const projects = useProjectsStore((s) => s.projects);

  // 挂载即校正跨天（隔天重开应用时不把昨日的 wordsToday 当成今天）
  useEffect(() => {
    ensureToday();
  }, [ensureToday]);

  const hasProject = Object.keys(files).length > 0;
  const dateText = useMemo(() => localeDate(new Date(), language), [language]);

  // 稿件健康度：纯函数聚合，仅在 files 变化时重算（性能口径见 healthScore.ts）
  const health = useMemo(() => computeHealth(files), [files]);
  const tone = healthTone(health.score);

  // 今日进度（goal 未设则不给百分比压力）
  const pct = dailyGoal > 0 ? Math.min(100, Math.round((wordsToday / dailyGoal) * 100)) : null;
  const goalMet = pct !== null && wordsToday >= dailyGoal;

  const countdown = useMemo(
    () => (deadline ? deadlineCountdown(deadline) : null),
    [deadline],
  );
  // 过期 / 临期（<3 天）着色：err / warn；其余走正文色
  const deadlineColor =
    countdown === null ? undefined : countdown.days < 0 ? 'var(--err)' : countdown.days < 3 ? 'var(--warn)' : undefined;

  const unresolved = useMemo(() => comments.filter((c) => !c.resolved).length, [comments]);

  // 稿件待办（v1.3.0）：扫描 % TODO/FIXME 与 	odo{}，仅在 files 变化时重算
  const todos = useMemo(() => scanTodos(files), [files]);
  // 正式项目数（__current__ 崩溃恢复临时记录不计）
  const projectCount = useMemo(
    () => projects.filter((p) => p.id !== CURRENT_PROJECT_ID).length,
    [projects],
  );

  const cardStyle: CSSProperties = {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
  };

  return (
    <div className="sf-dash" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 16px' }}>
      {/* —— 新手任务清单（完整新手引导系统）：未全部完成且未 dismissed 时显示，自带判定 —— */}
      <GettingStarted />

      {/* —— 问候行：项目名 + 日期（无项目时引导新建/导入） —— */}
      <header className="sf-dash-head">
        {hasProject ? (
          <div className="sf-dash-head-row" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong className="sf-dash-project" style={{ fontSize: 15 }}>
              {projectName || 'workspace'}
            </strong>
            <span className="sf-dash-date" style={{ fontSize: '0.85em', color: 'var(--fg-1)' }}>
              {dateText}
            </span>
          </div>
        ) : (
          <div className="sf-dash-empty">
            <div className="sf-dash-head-row" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15 }}>{d.emptyTitle}</strong>
              <span className="sf-dash-date" style={{ fontSize: '0.85em', color: 'var(--fg-1)' }}>
                {dateText}
              </span>
            </div>
            <p className="placeholder" style={{ margin: '6px 0' }}>
              {d.emptyDesc}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="sf-btn primary sf-dash-new"
                onClick={() => setTemplateWizardOpen(true)}
              >
                {d.newProject}
              </button>
              <button type="button" className="sf-btn sf-dash-import" onClick={requestZipPicker}>
                {d.importProject}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* —— 今日写作卡 —— */}
      {hasProject && (
        <section className="sf-dash-card sf-dash-today" style={cardStyle}>
          <h4 className="sf-dash-title" style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-1)', letterSpacing: '0.5px' }}>
            {d.todayTitle}
          </h4>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong className="sf-dash-today-words" style={{ fontSize: 22, fontWeight: 600 }}>
              {wordsToday}
            </strong>
            <span style={{ color: 'var(--fg-1)', fontSize: '0.85em' }}>{d.wordsUnit}</span>
            <span
              className="sf-dash-streak"
              style={streakDays > 0 ? { fontWeight: 600 } : { opacity: 0.45 }}
              title={d.streakUnit}
            >
              🔥 {streakDays} {d.streakUnit}
            </span>
          </div>
          {pct !== null ? (
            <div
              className="sf-dash-progress"
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="sf-dash-progress-track"
                style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-3)', overflow: 'hidden' }}
              >
                <div
                  className="sf-dash-progress-fill"
                  data-pct={pct}
                  style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}
                />
              </div>
              <span className="sf-dash-progress-pct" style={{ minWidth: 44, textAlign: 'right', fontSize: '0.85em' }}>
                {goalMet ? `✓ ${pct}%` : `${pct}%`}
              </span>
            </div>
          ) : (
            <p className="sf-dash-goal-unset" style={{ margin: '6px 0 0', fontSize: '0.85em', color: 'var(--fg-1)' }}>
              {d.goalUnset}
            </p>
          )}
          {pct !== null && (
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--fg-1)' }}>{d.goalLabel(dailyGoal)}</div>
          )}
          <button
            type="button"
            className="sf-btn primary sf-dash-write"
            style={{ marginTop: 8 }}
            onClick={() => setSidebarTab('files')}
          >
            {d.continueWriting}
          </button>
        </section>
      )}

      {/* —— 稿件健康度卡 —— */}
      {hasProject && (
        <section className="sf-dash-card sf-dash-health" style={cardStyle}>
          <h4 className="sf-dash-title" style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-1)', letterSpacing: '0.5px' }}>
            {d.healthTitle}
          </h4>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong
              className={`sf-dash-health-score sf-dash-tone-${tone}`}
              data-tone={tone}
              style={{ fontSize: 26, fontWeight: 700, color: TONE_COLOR[tone] }}
            >
              {health.score}
            </strong>
            <span className="sf-dash-health-words" style={{ color: 'var(--fg-1)', fontSize: '0.85em' }}>
              {d.healthWords(health.words)}
            </span>
          </div>
          <div className="sf-dash-health-chips" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {health.issues.map((issue) => (
              <span
                key={issue.kind}
                className={`sf-chip sf-dash-chip sf-dash-chip-${issue.kind} ${issue.count > 0 ? 'warn' : 'ok'}`}
                title={issue.sample || d.issueLabels[issue.kind]}
              >
                {d.issueLabels[issue.kind]} {issue.count}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="sf-btn sf-dash-go-citations"
            style={{ marginTop: 8 }}
            onClick={() => setSidebarTab('citations')}
          >
            {d.viewIssues}
          </button>
        </section>
      )}

      {/* —— deadline 卡 —— */}
      <section className="sf-dash-card sf-dash-deadline" style={cardStyle}>
        <h4 className="sf-dash-title" style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-1)', letterSpacing: '0.5px' }}>
          {d.deadlineTitle}
        </h4>
        {countdown ? (
          <>
            <div
              className={`sf-dash-deadline-count ${countdown.days < 0 ? 'sf-dash-overdue' : countdown.days < 3 ? 'sf-dash-soon' : 'sf-dash-ok'}`}
              data-days={countdown.days}
              style={{ fontSize: 20, fontWeight: 600, color: deadlineColor }}
            >
              {deadlineLabel(countdown.days, countdown.label, language)}
            </div>
            <div className="sf-dash-deadline-date" style={{ marginTop: 2, fontSize: '0.85em', color: 'var(--fg-1)' }}>
              {deadline}
            </div>
          </>
        ) : (
          <p className="placeholder sf-dash-deadline-none" style={{ margin: '2px 0' }}>
            {d.deadlineNone}
          </p>
        )}
        <button
          type="button"
          className="sf-btn sf-dash-go-submit"
          style={{ marginTop: 8 }}
          onClick={() => setSidebarTab('submit')}
        >
          {countdown ? d.goSubmit : d.setDeadline}
        </button>
      </section>

      {/* —— 未处理事项卡：未解决批注 + 项目数 —— */}
      <section className="sf-dash-card sf-dash-pending" style={cardStyle}>
        <h4 className="sf-dash-title" style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-1)', letterSpacing: '0.5px' }}>
          {d.pendingTitle}
        </h4>
        <p className={unresolved > 0 ? 'sf-dash-pending-comments' : 'placeholder sf-dash-pending-none'} style={{ margin: '2px 0' }}>
          {unresolved > 0 ? d.unresolved(unresolved) : d.noUnresolved}
        </p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          {unresolved > 0 && (
            <button
              type="button"
              className="sf-btn sf-dash-go-comments"
              onClick={() => setSidebarTab('comments')}
            >
              {d.goResolve}
            </button>
          )}
          <span className="sf-chip dim sf-dash-projects">{d.projects(projectCount)}</span>
        </div>
      </section>

      {/* —— 稿件待办卡（v1.3.0）：TODO/FIXME 扫描 + 前五条点击跳源码行 —— */}
      {hasProject && (
        <section className="sf-dash-card sf-dash-todos" style={cardStyle}>
          <h4 className="sf-dash-title" style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-1)', letterSpacing: '0.5px' }}>
            {d.todoTitle}
          </h4>
          {todos.length === 0 ? (
            <p className="placeholder sf-dash-todos-none" style={{ margin: '2px 0' }}>
              {d.todoNone}
            </p>
          ) : (
            <>
              <p className="sf-dash-todos-count" style={{ margin: '2px 0', fontWeight: 600 }}>
                {d.todoCount(todos.length)}
              </p>
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4 }}>
                {todos.slice(0, 5).map((t) => (
                  <li key={`${t.file}:${t.line}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
                    <span className={`sf-chip ${t.kind === 'fixme' ? 'err' : t.kind === 'todonotes' ? 'warn' : 'dim'}`}>
                      {t.kind === 'fixme' ? 'FIXME' : t.kind === 'todonotes' ? '	odo' : 'TODO'}
                    </span>
                    <button
                      type="button"
                      className="sf-link-btn sf-dash-todo-item"
                      style={{ textAlign: 'left', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={`${t.file}:${t.line}`}
                      onClick={() => jumpTo({ file: t.file, line: t.line })}
                    >
                      {t.text || `${t.file}:${t.line}`}
                    </button>
                    <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{t.file}:{t.line}</span>
                  </li>
                ))}
              </ul>
              {todos.length > 5 && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--fg-2)' }}>+{todos.length - 5}</p>
              )}
            </>
          )}
        </section>
      )}

      {/* —— 项目统计卡（v2.4.0 ④）：一栏看完引用/图表/字数 —— */}
      {hasProject && <ProjectStats />}

      {/* —— 写作进度图（v2.8.0 ②） —— */}

      {/* —— 阅读队列（v2.8.0 ①） —— */}
      <ReadingQueuePanel />

      {/* —— arXiv 晨报块（整体复用 DigestPanel：自包含，空订阅自带引导） —— */}
      <section className="sf-dash-card sf-dash-digest" style={cardStyle}>
        <DigestPanel />
      </section>
    </div>
  );
}
