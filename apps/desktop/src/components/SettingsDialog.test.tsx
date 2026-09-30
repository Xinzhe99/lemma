// @vitest-environment jsdom
/**
 * SettingsDialog 组件测试（激活器 WS-Act 集成）。测试环境说明同 ProjectSwitcher.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；另 mock providers/connectionTest
 * （不真发网络请求）。覆盖验收路径：
 *  - 快速预设：选中即填 baseUrl + 默认模型 + 名称，展示备注与「去获取 Key ↗」（target=_blank）；
 *  - 测试连接：表单当前值直接调用 testProvider（不必先保存），成功/失败结果行渲染，
 *    loading 态按钮禁用防重复；baseUrl/apiKey 缺失时按钮禁用；
 *  - 零回归：预设+Key 保存 → addProvider 落库并自动激活、表单关闭；编辑既有服务按
 *    baseUrl 反查预设回显；
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

import { SettingsDialog } from './SettingsDialog';
import { testProvider, type TestResult } from '../providers/connectionTest';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

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

/** 受控输入：原生 setter + 冒泡 input 事件（模式沿 ProjectSwitcher.test.tsx） */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 受控下拉：原生 setter + 冒泡 change 事件 */
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 打开新增表单（Providers 页签默认；按钮文案随语言） */
function openForm() {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes('新增服务') || b.textContent?.includes('Add provider'),
  );
  if (!found) throw new Error('add-provider button not found');
  click(found);
}

/** 表单文本输入，按顺序：0 名称 / 1 BaseURL / 2 API Key（密码）/ 3 模型 */
function formInput(idx: number): HTMLInputElement {
  const inputs = [...container!.querySelectorAll<HTMLInputElement>('.sf-form input.sf-input')];
  const found = inputs[idx];
  if (!found) throw new Error(`form input #${idx} not found`);
  return found;
}

function presetSelect(): HTMLSelectElement {
  const sel = container!.querySelector<HTMLSelectElement>('.sf-form select');
  if (!sel) throw new Error('preset select not found');
  return sel;
}

function statusLine(): string {
  return (container!.querySelector('[role="status"]') as HTMLElement | null)?.textContent ?? '';
}

function renderDialog() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SettingsDialog onClose={onClose} />);
  });
}

beforeEach(() => {
  localStorage.clear();
  onClose = vi.fn();
  testProviderMock.mockReset();
  useSettingsStore.setState({
    providers: [],
    activeProviderId: null,
    embeddingModel: '',
    theme: 'light',
    language: 'zh',
  });
  renderDialog();
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('SettingsDialog · 快速预设', () => {
  it('选中 DeepSeek：一键填名称/BaseURL/默认模型，展示备注与「去获取 Key ↗」外链', () => {
    openForm();
    choose(presetSelect(), 'deepseek');

    expect(formInput(0).value).toBe('DeepSeek');
    expect(formInput(1).value).toBe('https://api.deepseek.com/v1');
    expect(formInput(3).value).toBe('deepseek-chat');

    const link = container!.querySelector<HTMLAnchorElement>('.sf-form a[target="_blank"]');
    expect(link).toBeTruthy();
    expect(link!.href).toBe('https://platform.deepseek.com/api_keys');
    expect(link!.textContent).toContain('去获取 Key');
    expect(link!.rel).toContain('noreferrer');

    expect(container!.textContent).toContain('性价比高');
  });

  it('切「自定义…」不覆盖已填内容；自建预设（空 baseUrl）不清空名称/模型建议', () => {
    openForm();
    choose(presetSelect(), 'deepseek');
    choose(presetSelect(), 'custom');
    // 不回退已填充的 baseUrl，只是取消预设态（无获取 Key 链接）
    expect(formInput(1).value).toBe('https://api.deepseek.com/v1');
    expect(container!.querySelector('.sf-form a[target="_blank"]')).toBeNull();

    choose(presetSelect(), 'custom-openai-compat');
    expect(formInput(0).value).toBe('OpenAI 兼容·自建');
    expect(formInput(1).value).toBe(''); // 空 baseUrl 模板，交给用户填写
    expect(formInput(3).value).toBe('qwen3-8b');
  });
});

describe('SettingsDialog · 测试连接', () => {
  function fillDeepSeekWithKey() {
    openForm();
    choose(presetSelect(), 'deepseek');
    type(formInput(2), 'sk-abc');
  }

  it('用表单当前值调用 testProvider（未保存即可测），成功显示延迟与模型可用', async () => {
    testProviderMock.mockResolvedValue({ ok: true, step: 'chat', latencyMs: 234, model: 'deepseek-chat', reply: 'p' } as TestResult);
    fillDeepSeekWithKey();

    await act(async () => {
      click(btn('测试连接'));
    });

    expect(testProviderMock).toHaveBeenCalledTimes(1);
    expect(testProviderMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-abc',
      model: 'deepseek-chat',
    });
    expect(statusLine()).toContain('✓');
    expect(statusLine()).toContain('234ms');
    expect(statusLine()).toContain('deepseek-chat');
    expect(statusLine()).toContain('可用');
    // 未保存：providers 仍为空
    expect(useSettingsStore.getState().providers).toHaveLength(0);
  });

  it('失败态：显示 ✗ 与中文错误原因', async () => {
    testProviderMock.mockResolvedValue({ ok: false, step: 'models', error: 'API Key 无效或未授权（HTTP 401）' } as TestResult);
    fillDeepSeekWithKey();

    await act(async () => {
      click(btn('测试连接'));
    });

    expect(statusLine()).toContain('✗');
    expect(statusLine()).toContain('API Key 无效');
  });

  it('loading 态：按钮显示「测试中…」并禁用防重复点击；结束后恢复', async () => {
    let resolveTest!: (v: TestResult) => void;
    testProviderMock.mockImplementation(
      () =>
        new Promise<TestResult>((resolve) => {
          resolveTest = resolve;
        }),
    );
    fillDeepSeekWithKey();

    await act(async () => {
      click(btn('测试连接'));
    });
    const testing = btn('测试中…');
    expect(testing.disabled).toBe(true);
    expect(statusLine()).toBe('');

    await act(async () => {
      resolveTest({ ok: true, step: 'models', latencyMs: 88 } as TestResult);
      await Promise.resolve();
    });
    expect(statusLine()).toContain('✓');
    expect(btn('测试连接').disabled).toBe(false);
    expect(testProviderMock).toHaveBeenCalledTimes(1);
  });

  it('baseUrl 或 apiKey 缺失时测试按钮禁用', () => {
    openForm();
    expect(btn('测试连接').disabled).toBe(true);

    choose(presetSelect(), 'deepseek'); // 有 baseUrl 无 key
    expect(btn('测试连接').disabled).toBe(true);

    type(formInput(2), 'sk-abc');
    expect(btn('测试连接').disabled).toBe(false);
    expect(testProviderMock).not.toHaveBeenCalled();
  });
});

describe('SettingsDialog · 既有功能零回归', () => {
  it('预设 + Key → 保存：addProvider 落库并自动激活，表单关闭', () => {
    openForm();
    choose(presetSelect(), 'deepseek');
    type(formInput(2), 'sk-abc');
    click(btn('保存'));

    const s = useSettingsStore.getState();
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0]).toMatchObject({
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-abc',
      model: 'deepseek-chat',
      tier: 'cheap',
    });
    expect(s.activeProviderId).toBe(s.providers[0]!.id);
    // 表单关闭：回到「新增服务」入口，表单输入全部消失（仅剩嵌入模型输入框）
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent?.includes('新增服务'))).toBe(true);
    expect(container!.querySelector('.sf-form')).toBeNull();
    expect(container!.querySelectorAll('input.sf-input')).toHaveLength(1); // 仅嵌入模型输入框
  });

  it('编辑既有服务：按 baseUrl 反查预设回显（含获取 Key 链接），改名保存走 updateProvider', () => {
    act(() => {
      useSettingsStore.setState({
        providers: [
          {
            id: 'pv1',
            label: '我的 DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: 'sk-old',
            model: 'deepseek-reasoner',
            tier: 'cheap',
          },
        ],
        activeProviderId: 'pv1',
      });
    });

    click(btn('编辑'));
    // 预设态回显：获取 Key 链接出现，且用户改过的模型未被预设默认值覆盖
    expect(container!.querySelector('.sf-form a[target="_blank"]')?.textContent).toContain('去获取 Key');
    expect(formInput(3).value).toBe('deepseek-reasoner');

    type(formInput(0), 'DeepSeek 主力');
    click(btn('保存'));
    const s = useSettingsStore.getState();
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0]!.label).toBe('DeepSeek 主力');
    expect(s.providers[0]!.id).toBe('pv1');
    expect(s.providers[0]!.model).toBe('deepseek-reasoner');
  });
});

describe('SettingsDialog · zh/en 字典', () => {
  it('en 语言：快速预设/自定义/去获取 Key/测试连接 均为英文', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    openForm();

    const sel = presetSelect();
    expect(container!.textContent).toContain('Quick preset');
    const options = [...sel.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toContain('Pick a provider to autofill…');
    expect(options).toContain('DeepSeek');
    expect(options).toContain('Custom…');

    choose(sel, 'deepseek');
    expect(container!.querySelector('.sf-form a[target="_blank"]')!.textContent).toContain('Get key');
    expect(container!.textContent).toContain('Great value');
    expect(btn('Test connection')).toBeTruthy();
  });
});
