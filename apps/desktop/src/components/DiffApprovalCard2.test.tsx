// @vitest-environment jsdom
/**
 * 测试环境说明同 PlanCard.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现
 * （语义与真实 zustand 一致），避免根 react@19 与 apps/desktop react@18 混渲染。
 * DiffApprovalCard2 为自包含组件：proposal 以字面量构造，onAccept/onReject/
 * onRequestExplanation 用 spy 回调断言（含 applyHunks 重组文本的精确比对）。
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
    const useStore = <T,>(selector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => selector(state),
        () => selector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init: unknown) =>
    typeof init === 'function'
      ? impl(init as never)
      : (curried: unknown) => impl(curried as never);
  return { create };
});

import { DiffApprovalCard2 } from './DiffApprovalCard2';
import { useSettingsStore } from '../state/settingsStore';
import type { EditProposal } from '../state/proposalStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 两处修改（第 2 / 7 行），中间 4 行未变——2 hunks、无折叠 */
const PROPOSAL: EditProposal = {
  file: 'paper/main.tex',
  before: '\\section{Intro}\nold A\nk1\nk2\nk3\nk4\nold B\n',
  after: '\\section{Intro}\nnew A\nk1\nk2\nk3\nk4\nnew B\n',
  kind: 'polish',
  label: 'AI 润色',
  via: 'gpt-test',
};

/** 混搭采纳（只收 h1）的期望输出 */
const ONLY_H1 = '\\section{Intro}\nnew A\nk1\nk2\nk3\nk4\nold B\n';

interface Callbacks {
  onAccept?: (after: string, acceptedHunks: string[] | 'all') => void;
  onReject?: () => void;
  onRequestExplanation?: () => void;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderCard(
  proposal: EditProposal = PROPOSAL,
  cb: Callbacks = {},
  opts: { lang?: 'zh' | 'en'; explanation?: string } = {},
): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <DiffApprovalCard2
        proposal={proposal}
        explanation={opts.explanation}
        onAccept={cb.onAccept ?? (() => {})}
        onReject={cb.onReject ?? (() => {})}
        onRequestExplanation={cb.onRequestExplanation}
        lang={opts.lang}
      />,
    );
  });
}

function text(): string {
  return container?.textContent ?? '';
}

function query<K extends HTMLElement>(sel: string): K {
  const el = container!.querySelector<K>(sel);
  expect(el, `未找到 ${sel}`).toBeTruthy();
  return el as K;
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  useSettingsStore.setState({ language: 'zh' });
});

function unmountCard(): void {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
}

afterEach(() => {
  unmountCard();
});

describe('DiffApprovalCard2 · 审计与视图', () => {
  it('审计信息行：label / via / file / 行数统计 / ±徽标 / hunk 数', () => {
    renderCard(PROPOSAL);
    expect(text()).toContain('AI 润色');
    expect(text()).toContain('gpt-test');
    expect(query('.sf-approval-file').textContent).toBe('paper/main.tex');
    expect(query('.sf-approval-linestat').textContent).toBe('7 行 → 7 行');
    expect(query('.sf-approval-badge--add').textContent).toBe('+2');
    expect(query('.sf-approval-badge--del').textContent).toBe('-2');
    expect(text()).toContain('2 hunk');
  });

  it('携带 token 的提案显示等待裁决 chip', () => {
    renderCard({ ...PROPOSAL, token: 'tok-1' });
    expect(query('.sf-approval-head .sf-chip.warn').textContent).toBe('等待裁决');
  });

  it('默认统一视图：增删行着色标记、行号双列正确', () => {
    renderCard(PROPOSAL);
    expect(query('.sf-approval-card').dataset.view).toBe('unified');
    const delRow = query('.sf-approval-row[data-kind="del"]');
    expect(delRow.textContent).toContain('- old A');
    expect(delRow.children[0].textContent).toBe('2'); // 旧行号
    expect(delRow.children[1].textContent).toBe(''); // del 行无新行号
    const addRow = query('.sf-approval-row[data-kind="add"]');
    expect(addRow.textContent).toContain('+ new A');
    expect(addRow.children[1].textContent).toBe('2'); // 新行号
    // 空隙未变行两侧行号同进
    const ctxRow = query('.sf-approval-row[data-kind="ctx"]');
    expect(ctxRow.children[0].textContent).toBe(ctxRow.children[1].textContent);
  });

  it('切换并排视图：pair 行四列、左删右增同格行', () => {
    renderCard(PROPOSAL);
    click(query('[data-view-btn="split"]'));
    expect(query('.sf-approval-card').dataset.view).toBe('split');
    expect(query('[data-view-btn="split"]').getAttribute('aria-pressed')).toBe('true');
    const pair = query('.sf-approval-pair[data-kind="pair"]');
    expect(pair.children).toHaveLength(4);
    expect(pair.children[0].textContent).toBe('2'); // 左旧行号
    expect(pair.children[1].textContent).toBe('old A'); // 左删除格
    expect(pair.children[2].textContent).toBe('2'); // 右新行号
    expect(pair.children[3].textContent).toBe('new A'); // 右新增格
    // 未变空隙行左右两侧同文本
    const gapPair = query('.sf-approval-pair[data-kind="ctx"]');
    expect(gapPair.children[1].textContent).toBe(gapPair.children[3].textContent);
  });

  it('视图切换回统一后保持勾选状态', () => {
    renderCard(PROPOSAL);
    click(query('[data-view-btn="split"]'));
    const box = query<HTMLInputElement>('.sf-approval-hunk-head[data-hunk-id="h2"] input');
    click(box);
    click(query('[data-view-btn="unified"]'));
    expect(query<HTMLInputElement>('.sf-approval-hunk-head[data-hunk-id="h2"] input').checked).toBe(false);
    expect(query('.sf-approval-accept').textContent).toContain('1/2');
  });

  it('长空隙折叠：两端各 2 行 + 折叠标记', () => {
    const before = 'a\nb\n' + Array.from({ length: 8 }, (_, i) => `k${i}\n`).join('') + 'z\n';
    const after = 'A\nb\n' + Array.from({ length: 8 }, (_, i) => `k${i}\n`).join('') + 'Z\n';
    renderCard({ ...PROPOSAL, before, after });
    const fold = query('.sf-approval-fold');
    // 空隙 = b + k0..k7 共 9 行，两端各留 2（b/k0 与 k6/k7），折叠 5 行
    expect(fold.textContent).toContain('5 行未改动');
    // 两端各保留 2 行（b/k0 与 k6/k7），中段（k1..k5）被折叠
    const rowTexts = Array.from(container!.querySelectorAll('.sf-approval-row')).map((r) => r.textContent ?? '');
    expect(rowTexts.some((t) => t.includes('b'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('k0'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('k6'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('k7'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('k1'))).toBe(false);
    expect(rowTexts.some((t) => t.includes('k3'))).toBe(false);
  });
});

describe('DiffApprovalCard2 · hunk 级采纳', () => {
  it('hunk 头：默认全勾选、@@ 行号头与 ±徽标', () => {
    renderCard(PROPOSAL);
    const boxes = Array.from(container!.querySelectorAll<HTMLInputElement>('.sf-approval-hunk-check input'));
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(query('.sf-approval-hunk-head[data-hunk-id="h1"] .sf-approval-hunk-header').textContent).toBe('@@ -2,1 +2,1 @@');
    expect(query('.sf-approval-hunk-head[data-hunk-id="h2"] .sf-approval-hunk-header').textContent).toBe('@@ -7,1 +7,1 @@');
    const badges = query('.sf-approval-hunk-head[data-hunk-id="h1"]');
    expect(badges.querySelector('.sf-approval-badge--add')?.textContent).toBe('+1');
    expect(badges.querySelector('.sf-approval-badge--del')?.textContent).toBe('-1');
  });

  it('全选采纳：onAccept 收到 after 与 "all" 优化路径', () => {
    const onAccept = vi.fn();
    renderCard(PROPOSAL, { onAccept });
    expect(query('.sf-approval-accept').textContent).toContain('2/2');
    click(query('.sf-approval-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(PROPOSAL.after, 'all');
  });

  it('混搭：取消 h2 后采纳，onAccept 收到重组文本与接受集', () => {
    const onAccept = vi.fn();
    renderCard(PROPOSAL, { onAccept });
    click(query<HTMLInputElement>('.sf-approval-hunk-head[data-hunk-id="h2"] input'));
    expect(query('.sf-approval-accept').textContent).toContain('1/2');
    click(query('.sf-approval-accept'));
    expect(onAccept).toHaveBeenCalledWith(ONLY_H1, ['h1']);
  });

  it('纯插入 hunk（末尾追加草稿）：全选走 all，取消后按钮禁用', () => {
    const before = '\\section{A}\ntext\n';
    const after = '\\section{A}\ntext\n\\section{Discussion}\nnew draft\n';
    const onAccept = vi.fn();
    renderCard({ ...PROPOSAL, before, after, kind: 'draft-section' }, { onAccept });
    expect(query('.sf-approval-hunk-header').textContent).toBe('@@ -2,0 +3,2 @@');
    click(query('.sf-approval-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(after, 'all');
    click(query<HTMLInputElement>('.sf-approval-hunk-head[data-hunk-id="h1"] input'));
    expect((query('.sf-approval-accept') as HTMLButtonElement).disabled).toBe(true);
  });

  it('全不选时采纳按钮禁用', () => {
    renderCard(PROPOSAL);
    click(query<HTMLInputElement>('.sf-approval-hunk-head[data-hunk-id="h1"] input'));
    click(query<HTMLInputElement>('.sf-approval-hunk-head[data-hunk-id="h2"] input'));
    expect(query('.sf-approval-accept').textContent).toContain('0/2');
    expect((query('.sf-approval-accept') as HTMLButtonElement).disabled).toBe(true);
  });

  it('全部拒绝：仅触发 onReject', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard(PROPOSAL, { onAccept, onReject });
    click(query('.sf-approval-reject'));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('DiffApprovalCard2 · 变更解释与语言', () => {
  it('explanation 存在：折叠展示且无请求按钮', () => {
    renderCard(PROPOSAL, {}, { explanation: '将主动语态改为被动语态以符合期刊风格。' });
    const details = query<HTMLDetailsElement>('.sf-approval-explain');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(true);
    expect(details.querySelector('summary')?.textContent).toBe('变更解释');
    expect(query('.sf-approval-explain-body').textContent).toBe('将主动语态改为被动语态以符合期刊风格。');
    expect(container!.querySelector('.sf-approval-why')).toBeNull();
  });

  it('无 explanation：点击【为什么这样改？】回调一次并进入已请求态', () => {
    const onRequestExplanation = vi.fn();
    renderCard(PROPOSAL, { onRequestExplanation });
    const why = query('.sf-approval-why');
    expect(why.textContent).toBe('为什么这样改？');
    click(why);
    expect(onRequestExplanation).toHaveBeenCalledTimes(1);
    const asked = query('.sf-approval-why');
    expect(asked.textContent).toBe('解释生成中…');
    expect((asked as HTMLButtonElement).disabled).toBe(true);
  });

  it('lang=en：按钮与视图文案为英文', () => {
    renderCard(PROPOSAL, {}, { lang: 'en' });
    expect(query('.sf-approval-accept').textContent).toBe('Accept selected (2/2 hunks)');
    expect(query('.sf-approval-reject').textContent).toBe('Reject all');
    expect(query('[data-view-btn="unified"]').textContent).toBe('Unified');
    expect(query('[data-view-btn="split"]').textContent).toBe('Split');
    expect(query('.sf-approval-linestat').textContent).toBe('7 → 7 lines');
  });

  it('缺省语言跟随设置 store（en 设置 → 英文文案）', () => {
    useSettingsStore.setState({ language: 'en' });
    renderCard(PROPOSAL);
    expect(query('.sf-approval-reject').textContent).toBe('Reject all');
  });
});
