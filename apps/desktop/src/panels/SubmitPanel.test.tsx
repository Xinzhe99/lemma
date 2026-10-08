// @vitest-environment jsdom
/**
 * SubmitPanel 增量测试：
 * 1.「导出 Word (.docx)」按钮（pandoc 导出）；
 * 2.「投稿文书」区（代理D）：四键生成（Highlights / 利益声明 / 数据可用性 / 中文
 *   Cover Letter）——resolveProvider + runAgentTurn 只读消费（mock 两者），流式
 *   展示在本区内、Highlights 逐条 + 字数徽标（超 85 字 warn）、每类结果复制、
 *   loading/错误态中文、en 字典；既有功能（deadline/W12/docx/zip）零回归。
 * 测试环境说明同 libraryRis.test.tsx：mock zustand 为仅依赖本包 react@18 的
 * 等价实现；mock ../pandoc 的 exportDocx（不触发真实桥/下载）。
 * 覆盖验收路径：
 *  - 按钮渲染于打包导出区（zip 按钮旁），不受自检清单阻断（docx 非投稿包）；
 *  - 点击 → exportDocx 被调用一次；在途时按钮显示「导出中…」并禁用；
 *  - 成功 → 恢复初始文案，无错误提示；
 *  - 失败 → 自检卡片下方显示中文错误（pandoc 不可用等）；
 *  - en 语言字典。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zustand', async () => {
  const { useSyncExternalStore } = await import('react');
  interface Listener {
    (state: unknown, prev: unknown): void;
  }
  function impl<S extends object>(init: (set: unknown, get: unknown) => S) {
    let state: S;
    const listeners = new Set<Listener>();
    const setState = (partial: Partial<S> | ((s: S) => Partial<S>)) => {
      const patch = typeof partial === 'function' ? (partial as (s: S) => Partial<S>)(state) : partial;
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    };
    const getState = () => state;
    const subscribe = (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    };
    state = init(setState, getState);
    const useStore = <T,>(sSelector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => sSelector(state),
        () => sSelector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

const exportDocxMock = vi.fn();
vi.mock('../pandoc', () => ({
  exportDocx: (...args: unknown[]) => exportDocxMock(...(args as [])),
}));

const resolveProviderMock = vi.fn();
vi.mock('../aiActions', () => ({
  resolveProvider: (...args: unknown[]) => resolveProviderMock(...(args as [])),
}));

const runAgentTurnMock = vi.fn();
vi.mock('../agentTools', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurnMock(...(args as [unknown])),
}));

import { SubmitPanel } from './SubmitPanel';
import { exportDocx } from '../pandoc';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSubmitStore, type SubmissionRound } from '../state/submitStore';
import { DOC_SYSTEM_PROMPT } from '../submissionDocs';

vi.mocked(exportDocx);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SubmitPanel />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function btn(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function seedWorkspace() {
  useWorkspaceStore.setState({
    projectName: 'my-paper',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}\n\\begin{document}hi\\end{document}\n' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
  useSubmitStore.setState({ venueId: null, lastExportAt: null, deadline: null, rounds: [] });
}

/** 受控文本输入赋值（走原生 value setter，触发 React 监听的 input 事件） */
function typeInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 受控下拉选择（select 触发 change 事件） */
function chooseSelect(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 构造一轮投稿记录（测试种子） */
function round(partial: Partial<SubmissionRound> & Pick<SubmissionRound, 'id'>): SubmissionRound {
  return { venue: 'NeurIPS', submittedAt: '2026-05-01', status: 'submitted', ...partial };
}

/** 本地时区今天（与组件 todayIso 同式） */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('SubmitPanel「投稿文书」区', () => {
  const fakeProvider = { id: 'demo', label: '演示模式' };

  beforeEach(() => {
    runAgentTurnMock.mockReset();
    resolveProviderMock.mockReset();
    resolveProviderMock.mockReturnValue({
      provider: fakeProvider,
      model: 'demo-model',
      label: '演示模式（内置示例数据）',
      real: false,
    });
    useSettingsStore.setState({ language: 'zh' });
    seedWorkspace();
  });

  it('「投稿文书」卡片生成按钮渲染；既有功能（deadline/docx/zip）零回归', () => {
    renderPanel();
    const card = [...container!.querySelectorAll('.sf-submit-card')].find((c) =>
      c.textContent?.includes('投稿文书'),
    );
    expect(card).toBeDefined();
    for (const label of ['Highlights', '利益声明', '数据可用性', '中文 Cover Letter']) {
      const b = [...card!.querySelectorAll<HTMLButtonElement>('button')].find((x) =>
        x.textContent?.includes(label),
      );
      expect(b, `按钮缺失：${label}`).toBeDefined();
      expect(b!.disabled).toBe(false);
    }
    // 既有功能仍在（零回归冒烟）
    expect(container!.textContent).toContain('投稿 Deadline');
    expect(btn('导出 Word')).toBeDefined();
    expect(btn('打包导出 zip')).toBeDefined();
  });

  it('点击 Highlights → resolveProvider + runAgentTurn 消费：prompt 含路由关键词与稿件全文', async () => {
    runAgentTurnMock.mockResolvedValue('- 要点甲');
    renderPanel();
    click(btn('Highlights'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    const opts = runAgentTurnMock.mock.calls[0]![0] as {
      provider: unknown;
      model: string;
      system: string;
      user: string;
    };
    expect(opts.provider).toBe(fakeProvider);
    expect(opts.model).toBe('demo-model');
    expect(opts.system).toBe(DOC_SYSTEM_PROMPT);
    expect(opts.user).toContain('生成 3 至 5 条 Highlights');
    expect(opts.user).toContain('\\begin{document}hi'); // 稿件全文（combinedDoc）
  });

  it('生成在途：全部文书按钮禁用、当前键显示「生成中…」、流式文本展示在区内', async () => {
    let resolveTurn!: (v: string) => void;
    runAgentTurnMock.mockImplementation(
      (opts: { onDelta?: (d: string) => void }) =>
        new Promise<string>((res) => {
          resolveTurn = res;
          opts.onDelta?.('- 流式中的第一条要点');
        }),
    );
    renderPanel();
    click(btn('利益声明'));
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    expect(btn('生成中').disabled).toBe(true);
    expect(btn('Highlights').disabled).toBe(true);
    expect(btn('数据可用性').disabled).toBe(true);
    expect(container!.textContent).toContain('流式中的第一条要点');
    await act(async () => {
      resolveTurn('利益冲突：所有作者声明无利益冲突。');
    });
    expect(btn('利益声明').disabled).toBe(false); // 完成后恢复
  });

  it('Highlights 结果逐条渲染并带字数徽标（按码点计）', async () => {
    runAgentTurnMock.mockResolvedValue(
      '- 提出三阶段写作流水线\n- 混合检索使评级提升 0.4\n- diff 审批保证作者裁决权',
    );
    renderPanel();
    click(btn('Highlights'));
    await act(async () => {
      await Promise.resolve();
    });
    const items = [...container!.querySelectorAll('.sf-submit-check-item')].map((e) => e.textContent);
    expect(items).toContain('提出三阶段写作流水线');
    expect(items).toContain('混合检索使评级提升 0.4');
    const chips = [...container!.querySelectorAll('.sf-chip')].map((e) => e.textContent);
    expect(chips).toContain('10 字'); // 「提出三阶段写作流水线」= 10 码点
  });

  it('超 85 字符的条目字数徽标转黄（warn）', async () => {
    const long = `超长要点-${'甲'.repeat(86)}`; // 5 + 86 = 91 字符 > 85
    runAgentTurnMock.mockResolvedValue(`- ${long}`);
    renderPanel();
    click(btn('Highlights'));
    await act(async () => {
      await Promise.resolve();
    });
    const over = container!.querySelector('.sf-submit-check .sf-chip.warn');
    expect(over).not.toBeNull();
    expect(over!.textContent).toBe(`${long.length} 字`);
    const dim = container!.querySelector('.sf-submit-check .sf-chip.dim');
    expect(dim).toBeNull();
  });

  it('利益声明结果以纯文本渲染（非列表）', async () => {
    runAgentTurnMock.mockResolvedValue(
      '利益冲突：所有作者声明无利益冲突。\n资助：【待作者补充：资助机构与编号】',
    );
    renderPanel();
    click(btn('利益声明'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('利益冲突：所有作者声明无利益冲突。');
    expect(container!.textContent).toContain('【待作者补充：资助机构与编号】');
  });

  it('每类结果带「复制」按钮：点击写入剪贴板并短暂显示「已复制」', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    runAgentTurnMock.mockResolvedValue('- 可复制的要点');
    renderPanel();
    click(btn('Highlights'));
    await act(async () => {
      await Promise.resolve();
    });
    click(btn('复制'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('- 可复制的要点');
    expect(container!.textContent).toContain('已复制');
  });

  it('生成失败：显示中文错误「生成失败：…」，按钮恢复可重试', async () => {
    runAgentTurnMock.mockRejectedValue(new Error('模型服务连接失败'));
    renderPanel();
    click(btn('数据可用性'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('生成失败：模型服务连接失败');
    expect(btn('数据可用性').disabled).toBe(false);
  });

  it('en 语言：按钮与状态文案走英文字典', async () => {
    useSettingsStore.setState({ language: 'en' });
    let resolveTurn!: (v: string) => void;
    runAgentTurnMock.mockReturnValue(
      new Promise<string>((res) => {
        resolveTurn = res;
      }),
    );
    renderPanel();
    expect(container!.textContent).toContain('Submission documents');
    for (const label of ['Highlights', 'Declarations', 'Data availability', 'Cover Letter']) {
      expect(btn(label)).toBeDefined();
    }
    click(btn('Cover Letter'));
    expect(btn('Generating').disabled).toBe(true);
    await act(async () => {
      resolveTurn('Dear Editor, ...');
    });
    expect(btn('Copy')).toBeDefined();
    expect(container!.textContent).toContain('Dear Editor, ...');
  });
});

describe('SubmitPanel「投稿追踪」区（多轮投稿）', () => {
  function trackCard(): Element {
    const card = [...container!.querySelectorAll('.sf-submit-card')].find(
      (c) => c.textContent?.includes('投稿追踪') || c.textContent?.includes('Submission tracking'),
    );
    if (!card) throw new Error('tracking card not found');
    return card;
  }

  function venueInput(): HTMLInputElement {
    return trackCard().querySelector<HTMLInputElement>('input[aria-label="Venue（期刊/会议）"]')!;
  }

  function dateInput(): HTMLInputElement {
    return trackCard().querySelector<HTMLInputElement>('input[aria-label="投稿日期"]')!;
  }

  function statusSelect(): HTMLSelectElement {
    const el = trackCard().querySelector<HTMLSelectElement>('select[aria-label^="状态"]');
    if (!el) throw new Error('status select not found');
    return el;
  }

  beforeEach(() => {
    runAgentTurnMock.mockReset();
    resolveProviderMock.mockReset();
    useSettingsStore.setState({ language: 'zh' });
    seedWorkspace();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('空状态：渲染追踪卡片（提示 + 统计 0 + 表单），日期默认今天，venue 空时按钮禁用', () => {
    renderPanel();
    const card = trackCard();
    expect(card.textContent).toContain('暂无投稿记录。');
    expect(card.textContent).toContain('在投 0 · 已接收 0 · 被拒 0');
    expect(dateInput().value).toBe(todayIso());
    expect(venueInput().value).toBe(''); // 未选目标 venue
    const add = [...card.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('记录新一轮投稿'),
    )!;
    expect(add).toBeDefined();
    expect(add.disabled).toBe(true);
  });

  it('venue 输入默认当前目标 venue（选择 ACL 后自动填 ACL，按钮可用）', () => {
    useSubmitStore.setState({ venueId: 'acl' });
    renderPanel();
    expect(venueInput().value).toBe('ACL');
    const add = [...trackCard().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('记录新一轮投稿'),
    )!;
    expect(add.disabled).toBe(false);
  });

  it('新增：点「记录新一轮投稿」→ addRound 落库（status 默认 submitted）、时间线渲染徽章与日期', () => {
    useSubmitStore.setState({ venueId: 'acl' });
    renderPanel();
    typeInput(venueInput(), 'EMNLP 2026');
    const add = [...trackCard().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('记录新一轮投稿'),
    )!;
    click(add);
    const rounds = useSubmitStore.getState().rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.venue).toBe('EMNLP 2026');
    expect(rounds[0]!.status).toBe('submitted');
    expect(rounds[0]!.submittedAt).toBe(todayIso());
    const card = trackCard();
    expect(card.textContent).toContain('EMNLP 2026');
    expect(card.textContent).toContain('已投稿'); // 状态徽章
    expect(card.textContent).toContain(`投 ${todayIso()}`);
    expect(card.textContent).toContain('在投 1 · 已接收 0 · 被拒 0');
    // 提交后输入框回到「跟随当前目标 venue」
    expect(venueInput().value).toBe('ACL');
  });

  it('状态切换：下拉选 accepted → updateRoundStatus 生效，统计与徽章联动', () => {
    useSubmitStore.setState({
      rounds: [round({ id: 'r1', venue: 'NeurIPS', submittedAt: '2026-05-01', status: 'under-review' })],
    });
    renderPanel();
    const select = statusSelect();
    expect(select.value).toBe('under-review');
    expect(trackCard().textContent).toContain('审稿中');
    chooseSelect(select, 'accepted');
    expect(useSubmitStore.getState().rounds[0]!.status).toBe('accepted');
    const card = trackCard();
    expect(card.textContent).toContain('已接收');
    expect(card.textContent).toContain('在投 0 · 已接收 1 · 被拒 0');
  });

  it('删除：点一轮的「删除」→ 该轮移除，其余轮保留', () => {
    useSubmitStore.setState({
      rounds: [
        round({ id: 'r1', venue: 'ACL', submittedAt: '2026-01-10' }),
        round({ id: 'r2', venue: 'EMNLP', submittedAt: '2026-04-02', status: 'rejected', respondedAt: '2026-06-01', note: '意见 3 条' }),
      ],
    });
    renderPanel();
    const items = [...trackCard().querySelectorAll('.sf-submit-rec')];
    expect(items).toHaveLength(2);
    // 最新一轮在最上（时间线倒序）：EMNLP 在前，且显示回应日期与备注
    expect(items[0]!.textContent).toContain('EMNLP');
    expect(items[0]!.textContent).toContain('复 2026-06-01');
    expect(items[0]!.textContent).toContain('意见 3 条');
    const removeBtn = items[0]!.querySelector<HTMLButtonElement>('button[aria-label="删除此轮投稿"]')!;
    expect(removeBtn).toBeDefined();
    click(removeBtn);
    const rounds = useSubmitStore.getState().rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.id).toBe('r1');
    expect(trackCard().textContent).not.toContain('EMNLP');
  });

  it('统计行：revision 算在投——在投 2 · 已接收 1 · 被拒 1', () => {
    useSubmitStore.setState({
      rounds: [
        round({ id: 'r1', status: 'major-revision' }),
        round({ id: 'r2', status: 'under-review' }),
        round({ id: 'r3', status: 'accepted' }),
        round({ id: 'r4', status: 'rejected' }),
      ],
    });
    renderPanel();
    expect(trackCard().textContent).toContain('在投 2 · 已接收 1 · 被拒 1');
    // 六个状态选项都在下拉里
    const options = [...statusSelect().querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['已投稿', '审稿中', '大修', '小修', '已接收', '已拒稿']);
  });

  it('en 语言：标题/表单/统计/状态走英文字典', () => {
    useSettingsStore.setState({ language: 'en' });
    renderPanel();
    const card = [...container!.querySelectorAll('.sf-submit-card')].find((c) =>
      c.textContent?.includes('Submission tracking'),
    )!;
    expect(card).toBeDefined();
    expect(card.textContent).toContain('active 0 · accepted 0 · rejected 0');
    expect(card.textContent).toContain('No rounds logged yet.');
    expect(card.querySelector('button')!.textContent ?? '').toBeTruthy();
    const add = [...card.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Log a new round'),
    )!;
    expect(add).toBeDefined();
    act(() => {
      useSubmitStore.setState({ rounds: [round({ id: 'r1', status: 'minor-revision' })] });
    });
    expect(trackCard().textContent).toContain('Minor revision');
  });

  it('零回归：追踪区在面板底部，既有打包自检/docx/deadline/投稿文书按钮全部不受影响', () => {
    useSubmitStore.setState({ venueId: 'acl' });
    renderPanel();
    // 追踪卡片是最后一个卡片
    const cards = [...container!.querySelectorAll('.sf-submit-card')];
    expect(cards[cards.length - 1]!.textContent).toContain('投稿追踪');
    expect(container!.textContent).toContain('投稿文书');
    expect(container!.textContent).toContain('投稿 Deadline');
    expect(container!.textContent).toContain('投稿打包自检');
    expect(btn('打包导出 zip')).toBeDefined();
    expect(btn('导出 Word')).toBeDefined();
  });
});

describe('SubmitPanel「导出 Word (.docx)」', () => {
  beforeEach(() => {
    exportDocxMock.mockReset();
    useSettingsStore.setState({ language: 'zh' });
    seedWorkspace();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('按钮渲染在打包导出区（zip 按钮旁），且不受自检清单阻断', () => {
    renderPanel();
    const docx = btn('导出 Word');
    const zip = btn('打包导出 zip');
    // 同一导出行
    expect(docx.closest('.sf-submit-export-row')).toBe(zip.closest('.sf-submit-export-row'));
    // 无 refs.bib 等 → 自检未全过、zip 禁用；docx 导出不受阻断
    expect(zip.disabled).toBe(true);
    expect(docx.disabled).toBe(false);
  });

  it('点击调用 exportDocx 一次；在途时显示「导出中…」并禁用，成功后恢复', async () => {
    let resolve!: (v: { ok: true; entry: string; docxPath: string; bytes: number }) => void;
    exportDocxMock.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderPanel();
    click(btn('导出 Word'));
    expect(exportDocxMock).toHaveBeenCalledTimes(1);
    expect(exportDocxMock).toHaveBeenCalledWith();

    const busy = btn('导出中');
    expect(busy.disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true, entry: 'main.tex', docxPath: 'main.docx', bytes: 42 });
    });
    const restored = btn('导出 Word');
    expect(restored.disabled).toBe(false);
    expect(container!.textContent).not.toContain('pandoc');
  });

  it('失败时在自检卡片下方显示中文错误', async () => {
    exportDocxMock.mockResolvedValue({
      ok: false,
      error: 'pandoc 不可用：当前平台暂不支持内置 pandoc 自动下载（macOS：brew install pandoc）',
    });
    renderPanel();
    click(btn('导出 Word'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('brew install pandoc');
    // 按钮恢复可用（可重试）
    expect(btn('导出 Word').disabled).toBe(false);
  });

  it('en 语言显示英文文案', async () => {
    useSettingsStore.setState({ language: 'en' });
    exportDocxMock.mockResolvedValue({ ok: false, error: 'pandoc is unavailable: network' });
    renderPanel();
    expect(btn('Export Word').disabled).toBe(false);
    click(btn('Export Word'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('pandoc is unavailable');
  });
});
