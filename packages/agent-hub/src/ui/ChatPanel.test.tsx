// @vitest-environment jsdom
/**
 * ChatPanel 升级测试：markdown 渲染集成 / slash 菜单开合与导航选中 /
 * @ 引用菜单 / 复制 / 重新生成 / 编辑重发回调 / ↑ 历史回填 / 基础收发回归。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';
import type { AgentSession } from '../store';

afterEach(cleanup);

function makeSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    title: '测试会话',
    providerId: 'echo',
    status: 'idle',
    messages: [
      { id: 'u1', role: 'user', content: '第一问', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '答一', createdAt: 2 },
      { id: 'u2', role: 'user', content: '第二问', createdAt: 3 },
      {
        id: 'a2',
        role: 'assistant',
        content: '## 答\n\n| a | b |\n| - | - |\n| 1 | 2 |',
        createdAt: 4,
      },
    ],
    ...over,
  };
}

const SLASH_ITEMS = [
  { id: 'w2-section-draft', label: '/章节起草', hint: '起草一节' },
  { id: 'w3-polish', label: '/润色', hint: '润色当前文件' },
];

function setup(over: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onSend = vi.fn();
  const utils = render(
    <ChatPanel session={makeSession()} onSend={onSend} slashItems={SLASH_ITEMS} {...over} />,
  );
  const textarea = utils.container.querySelector('.sf-ah-input textarea') as HTMLTextAreaElement;
  return { ...utils, textarea, onSend };
}

describe('消息渲染', () => {
  it('assistant 消息走 markdown 富渲染（标题 / 表格）', () => {
    const { container } = setup();
    const blocks = container.querySelectorAll('.sf-ah-msg--assistant .sf-ah-md');
    expect(blocks).toHaveLength(2);
    const rich = blocks[blocks.length - 1]!;
    expect(rich.querySelector('h2')?.textContent).toBe('答');
    expect(rich.querySelector('table')?.querySelectorAll('td')).toHaveLength(2);
  });

  it('user 消息保持纯文本（** 不解析为粗体）', () => {
    const { container } = render(
      <ChatPanel
        session={makeSession({
          messages: [{ id: 'u1', role: 'user', content: '**不是md**', createdAt: 1 }],
        })}
      />,
    );
    const user = container.querySelector('.sf-ah-msg--user');
    expect(user?.textContent).toContain('**不是md**');
    expect(user?.querySelector('strong')).toBeNull();
  });

  it('md 引用 chip 点击触发 onCitekeyClick（宿主接线点）', () => {
    const onCitekeyClick = vi.fn();
    const { container } = render(
      <ChatPanel
        session={makeSession({
          messages: [{ id: 'a1', role: 'assistant', content: '参见 `[vaswani2017attention]`', createdAt: 1 }],
        })}
        onCitekeyClick={onCitekeyClick}
      />,
    );
    fireEvent.click(container.querySelector('button.sf-ah-md-cite')!);
    expect(onCitekeyClick).toHaveBeenCalledWith('vaswani2017attention');
  });
});

describe('slash 命令菜单', () => {
  it('输入 / 打开菜单：注入项 + 内置 /清空（需宿主 onClearSession）', () => {
    const { container, textarea } = setup({ onClearSession: vi.fn() });
    expect(container.querySelector('.sf-ah-menu--slash')).toBeNull();
    fireEvent.change(textarea, { target: { value: '/' } });
    const menu = container.querySelector('.sf-ah-menu--slash');
    expect(menu).toBeTruthy();
    const labels = Array.from(menu!.querySelectorAll('.sf-ah-menu-label')).map((e) => e.textContent);
    expect(labels).toContain('/章节起草');
    expect(labels).toContain('/润色');
    expect(labels).toContain('/清空');
  });

  it('查询过滤：/章节 只剩匹配项', () => {
    const { container, textarea } = setup({ onClearSession: vi.fn() });
    fireEvent.change(textarea, { target: { value: '/章节' } });
    const items = container.querySelectorAll('.sf-ah-menu--slash .sf-ah-menu-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('/章节起草');
  });

  it('↑↓ 导航切换高亮项', () => {
    const { container, textarea } = setup({ onClearSession: vi.fn() });
    fireEvent.change(textarea, { target: { value: '/' } });
    const options = () => container.querySelectorAll('[role="option"]');
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(options()[0]!.getAttribute('aria-selected')).toBe('false');
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('Enter 选中注入项 → onSlashWorkflow(id) 且输入清空', () => {
    const onSlashWorkflow = vi.fn();
    const { textarea } = setup({ onSlashWorkflow });
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSlashWorkflow).toHaveBeenCalledWith('w2-section-draft');
    expect(textarea.value).toBe('');
  });

  it('Enter 选中内置 /清空 → onClearSession 且不触发工作流', () => {
    const onClearSession = vi.fn();
    const onSlashWorkflow = vi.fn();
    const { container, textarea } = setup({ onClearSession, onSlashWorkflow });
    fireEvent.change(textarea, { target: { value: '/' } });
    const clearBtn = Array.from(container.querySelectorAll('[role="option"]')).find((b) =>
      b.textContent?.includes('/清空'),
    )!;
    fireEvent.click(clearBtn);
    expect(onClearSession).toHaveBeenCalledTimes(1);
    expect(onSlashWorkflow).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');
  });

  it('Esc 关闭菜单，随后 Enter 走普通发送', () => {
    const { container, textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '/' } });
    expect(container.querySelector('.sf-ah-menu--slash')).toBeTruthy();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(container.querySelector('.sf-ah-menu--slash')).toBeNull();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('/');
  });
});

describe('@ 引用菜单', () => {
  const MENTIONS = [
    { id: 'p1', label: 'vaswani2017attention', type: 'paper' as const },
    { id: 'f1', label: 'main.tex', type: 'file' as const },
  ];

  it('输入 @xxx 弹出文献/文件混合菜单，Enter 插入 label', () => {
    const { container, textarea } = setup({ mentionItems: MENTIONS });
    fireEvent.change(textarea, { target: { value: '对比 @vas' } });
    const menu = container.querySelector('.sf-ah-menu--mention');
    expect(menu).toBeTruthy();
    // 'vas' 只匹配文献项
    expect(menu!.querySelectorAll('.sf-ah-menu-item')).toHaveLength(1);
    expect(menu!.querySelector('.sf-ah-menu-badge--paper')?.textContent).toBe('文献');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('对比 vaswani2017attention ');
  });

  it('无 mentionItems 时该特性静默关闭', () => {
    const { container, textarea } = setup();
    fireEvent.change(textarea, { target: { value: '@' } });
    expect(container.querySelector('.sf-ah-menu')).toBeNull();
  });
});

describe('消息操作条', () => {
  it('复制：点击写入剪贴板并显示已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = setup();
    const copyBtn = Array.from(container.querySelectorAll('button.sf-ah-act')).find((b) =>
      b.textContent === '复制',
    )!;
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith('第一问');
  });

  it('重新生成仅出现在最后一条 assistant 上，点击触发 onRegenerate', () => {
    const onRegenerate = vi.fn();
    const { container } = setup({ onRegenerate });
    const regen = Array.from(container.querySelectorAll('button.sf-ah-act')).filter((b) =>
      b.textContent === '重新生成',
    );
    expect(regen).toHaveLength(1);
    fireEvent.click(regen[0]!);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('编辑重发：仅最后一条 user；点击变 textarea，Enter 上抛 onEditResend', () => {
    const onEditResend = vi.fn();
    const { container } = setup({ onEditResend });
    const editBtns = Array.from(container.querySelectorAll('button.sf-ah-act')).filter((b) =>
      b.textContent === '编辑重发',
    );
    expect(editBtns).toHaveLength(1);
    fireEvent.click(editBtns[0]!);
    const editor = container.querySelector('.sf-ah-edit textarea') as HTMLTextAreaElement;
    expect(editor.value).toBe('第二问');
    fireEvent.change(editor, { target: { value: '改后的问题' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onEditResend).toHaveBeenCalledWith('改后的问题');
    expect(container.querySelector('.sf-ah-edit')).toBeNull();
  });

  it('编辑中 Esc 取消，消息还原展示', () => {
    const onEditResend = vi.fn();
    const { container } = setup({ onEditResend });
    const editBtn = Array.from(container.querySelectorAll('button.sf-ah-act')).find((b) =>
      b.textContent === '编辑重发',
    )!;
    fireEvent.click(editBtn);
    const editor = container.querySelector('.sf-ah-edit textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(container.querySelector('.sf-ah-edit')).toBeNull();
    expect(onEditResend).not.toHaveBeenCalled();
  });
});

describe('历史回填与收发回归', () => {
  it('空输入按 ↑ 回填上一条 user 消息', () => {
    const { textarea } = setup();
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea.value).toBe('第二问');
  });

  it('Enter 发送并清空输入；Shift+Enter 不发送', () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: '你好' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('你好');
    expect(textarea.value).toBe('');
    fireEvent.change(textarea, { target: { value: '第二句' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe('第二句');
  });
});

// ---------------------------------------------------------------------------
// v1.2.0：③ 自定义提示词 insert 项 / ② latex 插入按钮透传
// ---------------------------------------------------------------------------

describe('自定义提示词（insert 项）与 latex 插入透传', () => {
  it('选中 insert 项 → 正文填入输入框（可改后发送），不触发 onSlashWorkflow', () => {
    const onSlashWorkflow = vi.fn();
    const onSend = vi.fn();
    const { container } = render(
      <ChatPanel
        session={makeSession()}
        onSend={onSend}
        onSlashWorkflow={onSlashWorkflow}
        slashItems={[
          { id: 'up:1', label: '/检查时态', hint: '…', insert: '请检查全文时态一致性' },
        ]}
      />,
    );
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '/检查' } });
    const items = container.querySelectorAll('.sf-ah-menu--slash .sf-ah-menu-item');
    expect(items).toHaveLength(1);
    fireEvent.click(items[0]!);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('请检查全文时态一致性');
    expect(onSlashWorkflow).not.toHaveBeenCalled();
    // 修改后发送
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '请检查全文时态一致性，逐段给 diff' } });
    fireEvent.keyDown(container.querySelector('textarea')!, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('请检查全文时态一致性，逐段给 diff');
  });

  it('onInsertLatex 透传：assistant 消息中 latex 围栏渲染插入按钮并回调', () => {
    const onInsertLatex = vi.fn();
    const session = makeSession({
      messages: [
        { id: 'u1', role: 'user', content: 'q', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: '```latex\n\section{M}\n```', createdAt: 2 },
      ],
    });
    const { container } = render(
      <ChatPanel session={session} onInsertLatex={onInsertLatex} insertLatexLabel="插入到稿件" />,
    );
    const btn = container.querySelector<HTMLButtonElement>('.sf-ah-md-insert-btn');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('插入到稿件');
    fireEvent.click(btn!);
    expect(onInsertLatex).toHaveBeenCalledWith('\section{M}');
  });
});
