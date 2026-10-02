// @vitest-environment jsdom
/**
 * CLI Agent 桥测试（v1.5.0 A）：
 * buildCliArgs 模板解析（引号成组/占位符单元素/缺占位符）、buildCliPrompt 组装、
 * CliAgentProvider 流式回放与错误路径（非零退出/超时/中止）、settings 持久化往返。
 */

import { describe, expect, it } from 'vitest';
import { buildCliArgs, buildCliPrompt, CliAgentProvider, type ProcRunner } from './cliAgent';
import { DEFAULT_CLI_AGENT, useSettingsStore, readPersistedSettings } from './state/settingsStore';
import type { AgentMessage } from '@scholarforge/shared';
import type { ChatEvent } from '@scholarforge/agent-hub';

describe('buildCliArgs', () => {
  it('空白分隔 + {prompt} 作为单个 argv 元素（提示词含引号/空白不逃逸）', () => {
    const args = buildCliArgs('exec --json {prompt}', '改写这句 "quoted" text\n第二行');
    expect(args).toEqual(['exec', '--json', '改写这句 "quoted" text\n第二行']);
  });

  it('双引号成组（flag 值含空格）', () => {
    const args = buildCliArgs('run --model "gpt x" {prompt}', 'p');
    expect(args).toEqual(['run', '--model', 'gpt x', 'p']);
  });

  it('占位符在引号内同样替换为单元素', () => {
    const args = buildCliArgs('-p "{prompt}"', 'hello');
    expect(args).toEqual(['-p', 'hello']);
  });

  it('缺 {prompt} → null（调用方追加在末尾）', () => {
    expect(buildCliArgs('exec --quiet', 'p')).toBeNull();
  });
});

describe('buildCliPrompt', () => {
  it('system/user/assistant 组装为角色段落；tool 回执不进入', () => {
    const msgs: AgentMessage[] = [
      { id: '1', role: 'system', content: '你是学术助手', createdAt: 1 },
      { id: '2', role: 'user', content: '第一问', createdAt: 2 },
      { id: '3', role: 'assistant', content: '答', createdAt: 3 },
      { id: '4', role: 'tool', toolCallId: 'c1', content: '{"x":1}', createdAt: 4 },
      { id: '5', role: 'user', content: '第二问', createdAt: 5 },
    ];
    const p = buildCliPrompt(msgs);
    expect(p).toContain('[系统设定]\n你是学术助手');
    expect(p).toContain('[用户]\n第一问');
    expect(p).toContain('[助手]\n答');
    expect(p).not.toContain('{"x":1}');
    expect(p.endsWith('[用户]\n第二问')).toBe(true);
  });
});

function fakeRunner(result: { code: number; stdout: string; stderr: string }, seen: string[][] = []): ProcRunner {
  return {
    run: async (cmd, args) => {
      seen.push([cmd, ...args]);
      return result;
    },
  };
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('CliAgentProvider', () => {
  const cfg = { ...DEFAULT_CLI_AGENT, enabled: true, command: 'codex', argsTemplate: 'exec {prompt}' };
  const req = (msgs: AgentMessage[]) => ({ messages: msgs, model: 'codex' });

  it('成功路径：stdout 切块 text-delta + done（含 token 估算）', async () => {
    const seen: string[][] = [];
    const p = new CliAgentProvider(cfg, fakeRunner({ code: 0, stdout: 'a'.repeat(300), stderr: '' }, seen));
    const events = await collect(p.complete(req([{ id: 'u', role: 'user', content: '问', createdAt: 1 }])));
    const deltas = events.filter((e) => e.type === 'text-delta');
    expect(events.at(-1)).toMatchObject({ type: 'done', usage: { outputTokens: 75 } });
    expect(deltas.map((e) => (e as { delta: string }).delta).join('')).toBe('a'.repeat(300));
    expect(seen[0]).toEqual(['codex', 'exec', expect.any(String)]);
  });

  it('非零退出 → error 事件携带 stderr 摘要', async () => {
    const p = new CliAgentProvider(cfg, fakeRunner({ code: 1, stdout: '', stderr: 'boom' }));
    const events = await collect(p.complete(req([{ id: 'u', role: 'user', content: '问', createdAt: 1 }])));
    expect(events[0]).toMatchObject({ type: 'error', message: expect.stringContaining('boom') });
  });

  it('运行器抛错（命令不存在）→ error 事件', async () => {
    const p = new CliAgentProvider(cfg, {
      run: async () => {
        throw new Error('No such file or directory');
      },
    });
    const events = await collect(p.complete(req([{ id: 'u', role: 'user', content: '问', createdAt: 1 }])));
    expect(events[0]).toMatchObject({ type: 'error', message: expect.stringContaining('No such file') });
  });

  it('已中止的请求直接返回 error', async () => {
    const p = new CliAgentProvider(cfg, fakeRunner({ code: 0, stdout: 'x', stderr: '' }));
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(p.complete({ ...req([{ id: 'u', role: 'user', content: 'q', createdAt: 1 }]), signal: ctrl.signal }));
    expect(events[0]).toMatchObject({ type: 'error' });
  });
});

describe('settings：cliAgent / agentEngine 持久化', () => {
  it('默认 auto + DEFAULT_CLI_AGENT；setCliAgent/setAgentEngine 落 localStorage 往返', () => {
    localStorage.clear();
    useSettingsStore.setState({ agentEngine: 'auto', cliAgent: { ...DEFAULT_CLI_AGENT } });
    useSettingsStore.getState().setAgentEngine('cli');
    useSettingsStore.getState().setCliAgent({ enabled: true, command: 'claude', argsTemplate: '-p {prompt}' });
    const persisted = readPersistedSettings();
    expect(persisted?.agentEngine).toBe('cli');
    expect(persisted?.cliAgent).toEqual({
      enabled: true,
      label: DEFAULT_CLI_AGENT.label,
      command: 'claude',
      argsTemplate: '-p {prompt}',
    });
    // 坏模板（缺 {prompt}）：恢复读取时宽容回落默认模板（store 内保留原文，重启归一）
    useSettingsStore.getState().setCliAgent({ argsTemplate: 'no placeholder' });
    expect(readPersistedSettings()?.cliAgent.argsTemplate).toBe(DEFAULT_CLI_AGENT.argsTemplate);
    localStorage.setItem('sf-settings', JSON.stringify({ providers: [], cliAgent: { enabled: 1, argsTemplate: 'x' } }));
    const r2 = readPersistedSettings();
    expect(r2?.cliAgent.enabled).toBe(false);
    expect(r2?.cliAgent.argsTemplate).toBe(DEFAULT_CLI_AGENT.argsTemplate);
  });
});
