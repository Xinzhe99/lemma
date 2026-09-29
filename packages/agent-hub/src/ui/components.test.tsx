// @vitest-environment jsdom
/**
 * UI 组件测试：直接调用函数组件并对返回的元素树做结构断言。
 * 说明：当前安装树上 agent-hub 解析到嵌套的 react 18，而根目录 react/react-dom 为 19，
 * 跨副本无法用 @testing-library/react 渲染；故以元素树遍历覆盖渲染逻辑（纯展示组件不含 hooks）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { WorkflowStepDef } from '@scholarforge/shared';
import { MessageList, ToolCallCard } from './ChatPanel';
import { CostBadge, formatCost } from './CostBadge';
import { PatchView } from './DiffApprovalCard';
import { WorkflowRunView } from './WorkflowRunView';
import type { AgentSession } from '../store';

/** 深度遍历元素树（函数组件就地调用以展开其渲染结果；仅适用于无 hooks 的展示组件） */
function collect(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
    } else if (typeof n === 'object' && n !== null && 'props' in n) {
      const el = n as unknown as { type: unknown; props: Record<string, unknown> };
      if (typeof el.type === 'function') {
        walk((el.type as (p: unknown) => ReactNode)(el.props));
        return;
      }
      out.push(n as ReactElement);
      walk(el.props.children as ReactNode);
    }
  };
  walk(node);
  return out;
}

function textOf(node: ReactNode): string {
  let text = '';
  const walk = (n: ReactNode): void => {
    if (typeof n === 'string' || typeof n === 'number') text += n;
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && n !== null && 'props' in n) {
      const el = n as unknown as { type: unknown; props: Record<string, unknown> };
      if (typeof el.type === 'function') {
        walk((el.type as (p: unknown) => ReactNode)(el.props));
      } else {
        walk(el.props.children as ReactNode);
      }
    }
  };
  walk(node);
  return text;
}

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    title: '测试会话',
    providerId: 'echo',
    status: 'idle',
    messages: [
      { id: 'm1', role: 'user', content: '帮我检索文献', createdAt: 1 },
      {
        id: 'm2',
        role: 'assistant',
        content: '好的',
        toolCalls: [{ id: 'c1', tool: 'library.search', args: { query: 'diffusion' } }],
        createdAt: 2,
      },
      { id: 'm3', role: 'tool', toolCallId: 'c1', content: '{"count":3}', createdAt: 3 },
    ],
    ...over,
  };
}

describe('MessageList / ToolCallCard', () => {
  it('渲染消息角色样式、工具调用卡片与折叠结果', () => {
    const els = collect(MessageList({ session: session() }));
    expect(textOf(els.find((e) => e.props.className === 'sf-ah-msg sf-ah-msg--user'))).toContain('帮我检索文献');
    expect(textOf(els.find((e) => e.props.className === 'sf-ah-toolcard-head'))).toContain('library.search');
    expect(textOf(els.find((e) => e.props.className === 'sf-ah-toolcard-args'))).toContain('"query"');
    // 工具结果折叠在 details 中
    expect(els.some((e) => e.type === 'details')).toBe(true);
    expect(textOf(els.find((e) => e.type === 'details'))).toContain('{"count":3}');
  });

  it('streaming 时最后一条 assistant 消息显示流式光标', () => {
    const ending = (status: AgentSession['status']): AgentSession => ({
      ...session({ status }),
      messages: [
        { id: 'u', role: 'user', content: '继续写', createdAt: 1 },
        { id: 'a', role: 'assistant', content: '正在', createdAt: 2 },
      ],
    });
    const streaming = collect(MessageList({ session: ending('streaming') }));
    expect(streaming.some((e) => e.props.className === 'sf-ah-cursor')).toBe(true);
    const idle = collect(MessageList({ session: ending('idle') }));
    expect(idle.some((e) => e.props.className === 'sf-ah-cursor')).toBe(false);
  });

  it('ToolCallCard：无对应结果时不渲染 details', () => {
    const els = collect(
      ToolCallCard({ call: { id: 'c9', tool: 'tex.compile', args: {} } }),
    );
    expect(textOf(els[0])).toContain('tex.compile');
    expect(els.some((e) => e.type === 'details')).toBe(false);
  });
});

describe('PatchView', () => {
  it('按行前缀高亮增删', () => {
    const els = collect(PatchView({ patch: '--- a/main.tex\n+++ b/main.tex\n-旧句子\n+新句子\n 保留行' }));
    const byClass = (cls: string) => textOf(els.find((e) => e.props.className?.includes(cls)));
    expect(byClass('sf-ah-diff-line--del')).toContain('旧句子');
    expect(byClass('sf-ah-diff-line--add')).toContain('新句子');
    expect(textOf(els.find((e) => e.type === 'pre'))).toContain('保留行');
  });
});

describe('WorkflowRunView', () => {
  const steps: WorkflowStepDef[] = [
    { id: 'prep', name: '组装上下文', prompt: 'p' },
    { id: 'r1', name: '审稿人一', prompt: 'p', parallel: true },
    { id: 'meta', name: '汇总', prompt: 'p', checkpoint: true },
  ];

  it('状态灯、状态文案与 checkpoint 继续按钮回调', () => {
    const onContinue = vi.fn();
    const els = collect(
      WorkflowRunView({ steps, statuses: { prep: 'done', r1: 'running', meta: 'checkpoint' }, onContinue }),
    );
    for (const dot of ['sf-ah-dot--done', 'sf-ah-dot--running', 'sf-ah-dot--checkpoint']) {
      expect(els.some((e) => typeof e.props.className === 'string' && e.props.className.includes(dot))).toBe(true);
    }
    const texts = els.filter((e) => e.props.className === 'sf-ah-flow-status').map((e) => textOf(e));
    expect(texts).toContain('已完成');
    expect(texts).toContain('进行中');
    expect(texts).toContain('等待确认');

    const continueBtn = els.find((e) => e.type === 'button' && textOf(e.props.children) === '继续');
    expect(continueBtn).toBeTruthy();
    (continueBtn!.props as { onClick: () => void }).onClick();
    expect(onContinue).toHaveBeenCalledWith('meta');
  });

  it('未提供状态的步骤按 pending 展示且无继续按钮', () => {
    const els = collect(WorkflowRunView({ steps }));
    expect(els.some((e) => typeof e.props.className === 'string' && e.props.className.includes('sf-ah-dot--pending'))).toBe(true);
    expect(els.some((e) => e.type === 'button')).toBe(false);
  });
});

describe('CostBadge', () => {
  it('成本格式化', () => {
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(0.012345)).toBe('$0.0123');
    expect(formatCost(0.000123)).toBe('$0.000123');
    expect(formatCost(undefined)).toBe('--');
    expect(textOf(collect(CostBadge({ costUsd: 0.0123 }))[0])).toBe('成本 $0.0123');
    expect(textOf(collect(CostBadge({}))[0])).toContain('--');
  });
});
