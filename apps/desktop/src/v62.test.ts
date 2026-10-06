// @vitest-environment jsdom
/**
 * v6.2.0 AI 扎实轮：工具轮次收尾 + Provider 错误友好化。
 */
import { describe, expect, it, vi } from 'vitest';
import { friendlyProviderError } from './aiActions';
import { runAgentTurn } from './agentTools';

/** 伪 provider：脚本化事件序列（可注入多轮工具调用） */
function scriptedProvider(rounds: Array<Array<{ type: string; delta?: string; call?: unknown }>>) {
  let i = 0;
  return {
    label: 'scripted',
    async *complete() {
      const events = rounds[Math.min(i, rounds.length - 1)]!;
      i += 1;
      for (const ev of events) {
        if (ev.type === 'text-delta') yield { type: 'text-delta', delta: ev.delta } as never;
        else if (ev.type === 'tool-call') yield { type: 'tool-call', call: ev.call } as never;
      }
    },
  } as never;
}

describe('runAgentTurn 轮次上限收尾', () => {
  it('每轮都要求工具且达到上限 → 回复带明确的收尾说明（不静默空返回）', async () => {
    const call = { id: 'c1', tool: 'project.context', args: {} };
    const provider = scriptedProvider(
      Array.from({ length: 60 }, (_, k) => [
        { type: 'text-delta', delta: k === 0 ? '开始处理…' : '' },
        { type: 'tool-call', call },
      ]),
    );
    const out = await runAgentTurn({
      provider,
      model: 'm',
      system: 's',
      history: [],
      user: '做个大任务',
      maxToolRounds: 5,
    });
    expect(out).toContain('开始处理…');
    expect(out).toContain('已连续调用 5 轮工具仍未收尾');
    expect(out).toContain('继续');
  });

  it('无工具调用时正常返回文本（不误加上限提示）', async () => {
    const provider = scriptedProvider([[{ type: 'text-delta', delta: '直接回答' }]]);
    const out = await runAgentTurn({ provider, model: 'm', system: 's', history: [], user: 'hi', maxToolRounds: 5 });
    expect(out).toBe('直接回答');
    expect(out).not.toContain('上限');
  });
});

describe('friendlyProviderError', () => {
  it('401 → API Key 指引', () => {
    expect(friendlyProviderError(new Error('HTTP 401 Unauthorized'))).toContain('API Key 无效');
  });
  it('429 → 限流/额度指引', () => {
    expect(friendlyProviderError(new Error('429 rate limit exceeded'))).toContain('频繁');
  });
  it('404/model_not_found → 模型名指引', () => {
    expect(friendlyProviderError(new Error('model_not_found: no such model'))).toContain('模型名');
  });
  it('网络/超时 → 网络指引', () => {
    expect(friendlyProviderError(new Error('fetch failed: network error'))).toContain('网络');
  });
  it('未知错误原样保留', () => {
    expect(friendlyProviderError(new Error('奇怪的错误'))).toBe('奇怪的错误');
  });
  it('非 Error 对象不炸', () => {
    expect(friendlyProviderError('字符串错误')).toBe('字符串错误');
  });
});

void vi;
