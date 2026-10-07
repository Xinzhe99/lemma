// @vitest-environment jsdom
/**
 * AgentPanel 激活引导卡测试（激活器 WS-Act，仅覆盖本增量）。测试环境说明同
 * CommentsPanel.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现；
 * 另 mock providers/connectionTest（不真发网络请求）。覆盖验收路径：
 *  - providers 为空 → 顶部渲染引导卡（标题/30 秒徽标/预设下拉默认 DeepSeek/Key 输入/
 *    去获取 Key 外链）；
 *  - providers 非空 → 引导卡不渲染（既有面板行为零回归：不出现「尚未激活」）；
 *  - 快速配置闭环：贴 Key → 测试连接（mock 成功回显延迟/模型）→ 保存并激活 →
 *    addProvider+setActive 落库（字段来自预设）且引导卡消失；
 *  - zh/en 字典。
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

vi.mock('../providers/connectionTest', () => ({
  testProvider: vi.fn(),
}));

import { AgentPanel } from './AgentPanel';
import { testProvider, type TestResult } from '../providers/connectionTest';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const testProviderMock = vi.mocked(testProvider);

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

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<AgentPanel />);
  });
}

const EXISTING_PROVIDER = {
  id: 'pv1',
  label: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-existing',
  model: 'deepseek-chat',
  tier: 'cheap' as const,
};

beforeEach(() => {
  localStorage.clear();
  testProviderMock.mockReset();
  useSettingsStore.setState({
    providers: [],
    activeProviderId: null,
    embeddingModel: '',
    theme: 'light',
    language: 'zh',
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('AgentPanel 激活引导卡 · 渲染条件', () => {
  it('providers 为空：顶部渲染引导卡（标题 + 30 秒徽标 + 默认 DeepSeek 预设 + 获取 Key 外链）', () => {
    renderPanel();

    const card = container!.querySelector('.sf-agent-activate');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('AI 功能尚未激活');
    expect(card!.textContent).toContain('30 秒配置');
    expect(card!.textContent).toContain('性价比高');

    const select = card!.querySelector('select')!;
    expect(select.value).toBe('deepseek'); // 预选推荐档，用户只需贴 Key
    // v7.6.0：外链改经 openExternal（WebView 内 target=_blank 打不开系统浏览器）
    const link = card!.querySelector<HTMLAnchorElement>('a[href="https://platform.deepseek.com/api_keys"]');
    expect(link).toBeTruthy();
    expect(link!.textContent).toContain('去获取 Key');

    expect(btn('保存并激活').disabled).toBe(true); // 未填 Key 不可保存
  });

  it('providers 非空：引导卡不渲染（零回归）', () => {
    act(() => {
      useSettingsStore.setState({ providers: [EXISTING_PROVIDER], activeProviderId: 'pv1' });
    });
    renderPanel();

    expect(container!.querySelector('.sf-agent-activate')).toBeNull();
    expect(container!.textContent).not.toContain('AI 功能尚未激活');
  });
});

describe('AgentPanel 激活引导卡 · 快速配置闭环', () => {
  function cardInput(): HTMLInputElement {
    const input = container!.querySelector<HTMLInputElement>('.sf-agent-activate input[type="password"]');
    if (!input) throw new Error('api key input not found');
    return input;
  }

  it('贴 Key → 测试连接（mock 成功回显）→ 保存并激活：落库、自动激活、引导卡消失', async () => {
    testProviderMock.mockResolvedValue({ ok: true, step: 'chat', latencyMs: 87, model: 'deepseek-chat', reply: 'p' } as TestResult);
    renderPanel();

    type(cardInput(), 'sk-new');
    await act(async () => {
      click(btn('测试连接'));
    });

    expect(testProviderMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-new',
      model: 'deepseek-chat',
    });
    const status = container!.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain('✓');
    expect(status.textContent).toContain('87ms');
    expect(status.textContent).toContain('deepseek-chat');

    click(btn('保存并激活'));

    const s = useSettingsStore.getState();
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0]).toMatchObject({
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-new',
      model: 'deepseek-chat',
      tier: 'cheap',
    });
    expect(s.activeProviderId).toBe(s.providers[0]!.id);
    // 保存成功 → 横幅消失
    expect(container!.querySelector('.sf-agent-activate')).toBeNull();
  });

  it('测试失败态：显示 ✗ 与中文错误；预设可切换并带出对应获取 Key 链接', async () => {
    testProviderMock.mockResolvedValue({ ok: false, step: 'models', error: 'BaseURL 不对（HTTP 404，检查是否含 /v1 或地址拼写）' } as TestResult);
    renderPanel();

    choose(container!.querySelector('.sf-agent-activate select')!, 'zhipu-glm');
    const link = container!.querySelector<HTMLAnchorElement>('.sf-agent-activate a[href*="bigmodel.cn"]');
    expect(link).toBeTruthy();

    type(cardInput(), 'sk-glm');
    await act(async () => {
      click(btn('测试连接'));
    });

    const status = container!.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain('✗');
    expect(status.textContent).toContain('BaseURL 不对');
    expect(container!.querySelector('.sf-agent-activate')).toBeTruthy(); // 未保存，引导卡保留
    expect(useSettingsStore.getState().providers).toHaveLength(0);
  });
});

describe('AgentPanel 激活引导卡 · zh/en 字典', () => {
  it('en 语言：引导卡文案为英文', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    renderPanel();

    const card = container!.querySelector('.sf-agent-activate')!;
    expect(card.textContent).toContain('AI features not activated yet');
    expect(card.textContent).toContain('30-second setup');
    expect(card.textContent).toContain('Save & activate');
    expect(card.textContent).toContain('Get key');
  });
});
