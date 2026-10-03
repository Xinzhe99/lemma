// @vitest-environment jsdom
/**
 * Agent 记忆系统测试：持久化往返/坏数据回退、recordApproval 双路径（采纳/拒绝/部分采纳）、
 * deriveStyleNote 各启发（更短 / 连接词 / 引用数字变化 / 无差异）、上限淘汰、
 * buildMemoryInjection 开关与空态、统计摘要正确性、summarizeIfNeeded 长会话压缩，
 * 以及 agentTools.buildContextPackMd 的注入点联通。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@lemma/shared';
import {
  AGENT_MEMORY_STORAGE_KEY,
  PARTIAL_NOTE,
  PATTERNS_CAP,
  REJECT_NO_GAIN_NOTE,
  STATS_WINDOW,
  STYLE_NOTES_CAP,
  buildMemoryInjection,
  deriveStyleNote,
  memoryStats,
  readPersistedAgentMemory,
  recordApproval,
  summarizeIfNeeded,
  useAgentMemoryStore,
  type ApprovedPattern,
} from './agentMemory';

const OK_PROPOSAL = {
  label: 'AI 润色',
  via: 'demo',
  before: 'This is a somewhat wordy sentence that keeps rambling on and on needlessly.',
  after: 'This is a concise sentence.',
};

/** 无风格差异的提案（数字变化 → derive null） */
const NO_GAIN_PROPOSAL = {
  label: 'AI 改稿',
  via: 'demo',
  before: 'accuracy is 92 percent',
  after: 'accuracy is 95 percent',
};

function resetMemory(overrides: Partial<ReturnType<typeof useAgentMemoryStore.getState>> = {}) {
  useAgentMemoryStore.setState({
    styleNotes: [],
    approvedPatterns: [],
    ignoredSuggestions: [],
    enabled: true,
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetMemory();
});

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

describe('agentMemory 持久化', () => {
  it('未持久化时为空记忆且 enabled 默认 true', () => {
    const s = useAgentMemoryStore.getState();
    expect(s.styleNotes).toEqual([]);
    expect(s.approvedPatterns).toEqual([]);
    expect(s.ignoredSuggestions).toEqual([]);
    expect(s.enabled).toBe(true);
    expect(readPersistedAgentMemory().styleNotes).toEqual([]);
  });

  it('操作后写入 sf-agent-memory 并可整体往返', async () => {
    useAgentMemoryStore.getState().addStyleNote('偏好第一人称复数');
    recordApproval(OK_PROPOSAL, true);
    recordApproval(OK_PROPOSAL, false);
    useAgentMemoryStore.getState().toggleIgnored('某建议');

    const persisted = readPersistedAgentMemory();
    // 手工添加 + 自动归纳（采纳 OK_PROPOSAL 命中「更简洁」启发）
    expect(persisted.styleNotes).toEqual(['偏好第一人称复数', '偏好更简洁的表达']);
    expect(persisted.approvedPatterns).toHaveLength(1);
    expect(persisted.approvedPatterns[0]).toMatchObject({
      label: 'AI 润色',
      via: 'demo',
      acceptedCount: 1,
      rejectedCount: 1,
    });
    expect(persisted.ignoredSuggestions).toEqual(['某建议']);
    expect(persisted.enabled).toBe(true);

    // 模块重新加载：从 localStorage 恢复
    vi.resetModules();
    const mod = await import('./agentMemory');
    expect(mod.useAgentMemoryStore.getState().styleNotes).toEqual(['偏好第一人称复数', '偏好更简洁的表达']);
    expect(mod.useAgentMemoryStore.getState().approvedPatterns[0]!.acceptedCount).toBe(1);
  });

  it('坏数据回退：垃圾 JSON / 类型错字段逐条丢弃，enabled 仅显式 false 才关闭', async () => {
    localStorage.setItem(AGENT_MEMORY_STORAGE_KEY, '{not json');
    vi.resetModules();
    const bad = await import('./agentMemory');
    expect(bad.useAgentMemoryStore.getState().styleNotes).toEqual([]);
    expect(bad.useAgentMemoryStore.getState().approvedPatterns).toEqual([]);
    expect(bad.useAgentMemoryStore.getState().enabled).toBe(true);

    localStorage.setItem(
      AGENT_MEMORY_STORAGE_KEY,
      JSON.stringify({
        styleNotes: ['ok', 42, '', 'ok'],
        approvedPatterns: [
          { ts: 1, label: 'L', via: 'v', acceptedCount: 2, rejectedCount: 0 },
          { ts: 'x', label: 'bad' },
          'junk',
        ],
        ignoredSuggestions: ['ig'],
        enabled: false,
      }),
    );
    vi.resetModules();
    const mixed = await import('./agentMemory');
    const s = mixed.useAgentMemoryStore.getState();
    expect(s.styleNotes).toEqual(['ok']); // 非字符串 / 空 / 重复被剔除
    expect(s.approvedPatterns).toHaveLength(1);
    expect(s.approvedPatterns[0]).toMatchObject({ label: 'L', acceptedCount: 2 });
    expect(s.ignoredSuggestions).toEqual(['ig']);
    expect(s.enabled).toBe(false);
  });

  it('超上限数据加载时被裁剪：styleNotes ≤30、patterns ≤200 且保留较新者', async () => {
    localStorage.setItem(
      AGENT_MEMORY_STORAGE_KEY,
      JSON.stringify({
        styleNotes: Array.from({ length: 50 }, (_, i) => `note-${i}`),
        approvedPatterns: Array.from({ length: 250 }, (_, i) => ({
          ts: i,
          label: `L${i}`,
          via: 'v',
          acceptedCount: 1,
          rejectedCount: 0,
        })),
      }),
    );
    vi.resetModules();
    const mod = await import('./agentMemory');
    const s = mod.useAgentMemoryStore.getState();
    expect(s.styleNotes).toHaveLength(STYLE_NOTES_CAP);
    expect(s.styleNotes[0]).toBe('note-20'); // 保留最后 30 条
    expect(s.approvedPatterns).toHaveLength(PATTERNS_CAP);
    expect(s.approvedPatterns.some((p) => p.label === 'L249')).toBe(true); // ts 最大者保留
    expect(s.approvedPatterns.some((p) => p.label === 'L0')).toBe(false);
  });

  it('运行中追加超上限即淘汰：styleNotes 30 条、patterns 200 条', () => {
    for (let i = 0; i < STYLE_NOTES_CAP + 5; i++) {
      useAgentMemoryStore.getState().addStyleNote(`偏好 ${i}`);
    }
    expect(useAgentMemoryStore.getState().styleNotes).toHaveLength(STYLE_NOTES_CAP);
    expect(useAgentMemoryStore.getState().styleNotes[0]).toBe('偏好 5');

    resetMemory();
    for (let i = 0; i < PATTERNS_CAP + 5; i++) {
      recordApproval({ ...OK_PROPOSAL, label: `提案 ${i}` }, true);
    }
    expect(useAgentMemoryStore.getState().approvedPatterns).toHaveLength(PATTERNS_CAP);
    expect(useAgentMemoryStore.getState().approvedPatterns.some((p) => p.label === '提案 0')).toBe(false);
    expect(useAgentMemoryStore.getState().approvedPatterns.some((p) => p.label === '提案 204')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordApproval 双路径
// ---------------------------------------------------------------------------

describe('recordApproval 双路径', () => {
  it('采纳：新建 pattern 计数 + 可归纳时自动追加 styleNote', () => {
    recordApproval(OK_PROPOSAL, true);
    const s = useAgentMemoryStore.getState();
    expect(s.approvedPatterns).toHaveLength(1);
    expect(s.approvedPatterns[0]).toMatchObject({ acceptedCount: 1, rejectedCount: 0 });
    expect(s.styleNotes).toContain('偏好更简洁的表达');
    expect(s.approvedPatterns[0]!.note).toBe('偏好更简洁的表达');
  });

  it('拒绝：rejectedCount 递增；无可归纳差异时 note 为拒绝原因', () => {
    recordApproval(NO_GAIN_PROPOSAL, false);
    const s = useAgentMemoryStore.getState();
    expect(s.approvedPatterns[0]).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
    expect(s.approvedPatterns[0]!.note).toBe(REJECT_NO_GAIN_NOTE);
    expect(s.styleNotes).toEqual([]);
  });

  it('同（label, via）upsert 聚合计数；不同 label 各自成条', () => {
    recordApproval(OK_PROPOSAL, true);
    recordApproval(OK_PROPOSAL, true);
    recordApproval(NO_GAIN_PROPOSAL, false);
    const patterns = useAgentMemoryStore.getState().approvedPatterns;
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toMatchObject({ label: 'AI 润色', acceptedCount: 2, rejectedCount: 0 });
    expect(patterns[1]).toMatchObject({ label: 'AI 改稿', acceptedCount: 0, rejectedCount: 1 });
  });

  it('部分采纳：note 归纳为保守倾向，且不把风格 note 写入偏好列表', () => {
    recordApproval(OK_PROPOSAL, true, 1);
    const s = useAgentMemoryStore.getState();
    expect(s.approvedPatterns[0]!.note).toBe(PARTIAL_NOTE);
    expect(s.approvedPatterns[0]!.acceptedCount).toBe(1);
    expect(s.styleNotes).toEqual([]); // 部分采纳不足以确认偏好
  });

  it('拒绝但差异可归纳：不写偏好、不清空既有 note（用户否决该方向，不可记为偏好）', () => {
    recordApproval(OK_PROPOSAL, true); // note = 偏好更简洁的表达
    recordApproval(OK_PROPOSAL, false); // derive 命中但被拒绝
    const s = useAgentMemoryStore.getState();
    expect(s.styleNotes).toEqual(['偏好更简洁的表达']);
    expect(s.approvedPatterns[0]!.note).toBe('偏好更简洁的表达');
    expect(s.approvedPatterns[0]!.rejectedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deriveStyleNote 启发
// ---------------------------------------------------------------------------

describe('deriveStyleNote 纯函数', () => {
  it('after 显著更短（≥15% 压缩）→ 偏好更简洁的表达', () => {
    const before = 'a'.repeat(100);
    expect(deriveStyleNote(before, 'a'.repeat(85))).toBe('偏好更简洁的表达');
  });

  it('未达 15% 压缩或原文过短 → null', () => {
    expect(deriveStyleNote('a'.repeat(100), 'a'.repeat(86))).toBeNull(); // 86 > floor(85)
    expect(deriveStyleNote('short', 'sho')).toBeNull(); // 原文 < 20 字符
  });

  it('新引入连接词 → 偏好 X 类连接词', () => {
    expect(deriveStyleNote('The result holds.', 'Notably, the result holds.')).toBe('偏好 Notably 类连接词');
    expect(deriveStyleNote('We test it.', 'Specifically, we test it.')).toBe('偏好 Specifically 类连接词');
  });

  it('连接词未新增 / 变少 → null', () => {
    expect(deriveStyleNote('Notably, it works.', 'Notably, it works well today.')).toBeNull();
    expect(deriveStyleNote('However, it fails. However, it works.', 'However, it fails. However, it works well.')).toBeNull();
  });

  it('引用或数字变化 → 内容编辑，返回 null', () => {
    expect(deriveStyleNote('see \\cite{a} for detail please', 'see \\cite{b} for detail')).toBeNull();
    expect(deriveStyleNote('accuracy is 92 percent here', 'accuracy is 93 percent here')).toBeNull();
    expect(deriveStyleNote('no cite', 'adds \\cite{x}')).toBeNull();
  });

  it('完全相同 / 空串 → null', () => {
    expect(deriveStyleNote('same text', 'same text')).toBeNull();
    expect(deriveStyleNote('', 'x'.repeat(40))).toBeNull();
    expect(deriveStyleNote('x'.repeat(40), '')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 统计与注入
// ---------------------------------------------------------------------------

function pattern(p: Partial<ApprovedPattern> & Pick<ApprovedPattern, 'ts'>): ApprovedPattern {
  return { label: 'L', via: 'v', acceptedCount: 0, rejectedCount: 0, ...p };
}

describe('memoryStats / buildMemoryInjection', () => {
  it('8 采 3 拒：采纳率 73%，注入含统计摘要与最高频拒绝原因', () => {
    resetMemory({
      styleNotes: ['偏好更简洁的表达'],
      approvedPatterns: [
        pattern({ ts: 2, label: '润色', acceptedCount: 8, rejectedCount: 3, note: REJECT_NO_GAIN_NOTE }),
      ],
    });
    const stats = memoryStats(useAgentMemoryStore.getState().approvedPatterns);
    expect(stats.total).toBe(11);
    expect(stats.accepted).toBe(8);
    expect(stats.rejected).toBe(3);
    expect(stats.rate).toBeCloseTo(8 / 11, 5);

    const md = buildMemoryInjection();
    expect(md).toContain('偏好更简洁的表达');
    expect(md).toContain('近期 AI 修改采纳率 73%（8 采纳 / 3 拒绝）');
    expect(md).toContain(`最高频拒绝原因：${REJECT_NO_GAIN_NOTE}`);
  });

  it('部分采纳 → partialHint + 保守倾向行', () => {
    resetMemory({
      approvedPatterns: [pattern({ ts: 1, acceptedCount: 2, rejectedCount: 0, note: PARTIAL_NOTE })],
    });
    const stats = memoryStats(useAgentMemoryStore.getState().approvedPatterns);
    expect(stats.partialHint).toBe(true);
    expect(stats.topRejectReason).toBe(PARTIAL_NOTE);
    expect(buildMemoryInjection()).toContain('部分采纳提示：用户倾向保守');
  });

  it('窗口按 ts 从新到旧封顶 20 条事件（pattern 内先计 accepted）', () => {
    resetMemory({
      approvedPatterns: [
        pattern({ ts: 1, acceptedCount: 15, rejectedCount: 0 }), // 旧：15 条
        pattern({ ts: 2, acceptedCount: 5, rejectedCount: 10, note: REJECT_NO_GAIN_NOTE }), // 新：15 条
      ],
    });
    const stats = memoryStats(useAgentMemoryStore.getState().approvedPatterns, STATS_WINDOW);
    // 新 pattern 全计入（5+10=15），旧 pattern 只剩 5 个名额给 accepted → 10 采 / 10 拒
    expect(stats.total).toBe(STATS_WINDOW);
    expect(stats.accepted).toBe(10);
    expect(stats.rejected).toBe(10);
    expect(stats.rate).toBeCloseTo(0.5, 5);
  });

  it('enabled=false 或空记忆 → 注入为空串', () => {
    expect(buildMemoryInjection()).toBe(''); // 空记忆
    resetMemory({
      styleNotes: ['偏好更简洁的表达'],
      approvedPatterns: [pattern({ ts: 1, acceptedCount: 1 })],
    });
    expect(buildMemoryInjection()).not.toBe('');
    useAgentMemoryStore.getState().setEnabled(false);
    expect(buildMemoryInjection()).toBe('');
    useAgentMemoryStore.getState().setEnabled(true);
  });

  it('被忽略的偏好不注入；恢复后重新注入', () => {
    resetMemory({ styleNotes: ['偏好 A', '偏好 B'] });
    useAgentMemoryStore.getState().toggleIgnored('偏好 A');
    const md = buildMemoryInjection();
    expect(md).toContain('偏好 B');
    expect(md).not.toContain('偏好 A');
    useAgentMemoryStore.getState().toggleIgnored('偏好 A');
    expect(buildMemoryInjection()).toContain('偏好 A');
  });

  it('仅有统计无偏好 / 仅有偏好无统计时各自渲染对应段落', () => {
    resetMemory({ approvedPatterns: [pattern({ ts: 1, acceptedCount: 3, rejectedCount: 1 })] });
    const md = buildMemoryInjection();
    expect(md).not.toContain('用户风格偏好');
    expect(md).toContain('采纳率 75%（3 采纳 / 1 拒绝）');

    resetMemory({ styleNotes: ['只用主动语态'] });
    const md2 = buildMemoryInjection();
    expect(md2).toContain('只用主动语态');
    expect(md2).not.toContain('采纳率');
  });
});

// ---------------------------------------------------------------------------
// Context Pack 注入点联通（agentTools.buildContextPackMd）
// ---------------------------------------------------------------------------

describe('Context Pack 注入点', () => {
  // 动态 import 整个 agentTools 注册表：全量并发（150+ 文件）下 worker 争用会超过
  // 默认 5s（单跑 <1s）——给显式预算，避免套件规模增长后 CI 假红
  it('buildContextPackMd 的「项目记忆」段包含记忆注入', { timeout: 20000 }, async () => {
    // 前面持久化用例调用了 vi.resetModules：此处对同一注册表做动态导入，
    // 保证 agentTools 与本用例操作的是同一个 agentMemory 实例
    vi.resetModules();
    localStorage.clear();
    const memory = await import('./agentMemory');
    const { useWorkspaceStore } = await import('./workspaceStore');
    useWorkspaceStore.setState({
      files: { 'main.tex': '\\section{引言}\n一些内容\n' },
      openTabs: [],
      activeTab: null,
    });
    const { buildContextPackMd } = await import('../agentTools');
    const md = await buildContextPackMd('');
    expect(md).toContain('## 项目记忆');
    expect(md).toContain('演示项目约定');

    memory.useAgentMemoryStore.setState({
      styleNotes: ['偏好更简洁的表达'],
      approvedPatterns: [
        { ts: 1, label: 'L', via: 'v', acceptedCount: 8, rejectedCount: 3, note: REJECT_NO_GAIN_NOTE },
      ],
      ignoredSuggestions: [],
      enabled: true,
    });
    const md2 = await buildContextPackMd('');
    expect(md2).toContain('偏好更简洁的表达');
    expect(md2).toContain('近期 AI 修改采纳率 73%（8 采纳 / 3 拒绝）');
    expect(md2).toContain(`最高频拒绝原因：${REJECT_NO_GAIN_NOTE}`);
  });
});

// ---------------------------------------------------------------------------
// 会话摘要压缩
// ---------------------------------------------------------------------------

function msg(id: string, role: AgentMessage['role'], content: string): AgentMessage {
  return { id, role, content, createdAt: Number(id.split('-')[1]) };
}

describe('summarizeIfNeeded', () => {
  it('未超限：原样返回且无 summary', () => {
    const messages = [msg('m-1', 'user', 'hello'), msg('m-2', 'assistant', 'hi')];
    const r = summarizeIfNeeded(messages, 1000);
    expect(r.keep).toBe(messages);
    expect(r.summary).toBeUndefined();
  });

  it('恰好等于上限也不压缩（边界）', () => {
    const messages = [msg('m-1', 'user', 'a'.repeat(50)), msg('m-2', 'assistant', 'b'.repeat(50))];
    expect(summarizeIfNeeded(messages, 100)).toEqual({ keep: messages });
  });

  it('超限：保留首 2 条 + 最近 30%，中间段生成结构性摘要', () => {
    const messages: AgentMessage[] = [msg('m-0', 'system', 'sys prompt')];
    for (let i = 1; i <= 11; i++) {
      messages.push(
        msg(
          `m-${i}`,
          i % 2 === 0 ? 'user' : 'assistant',
          `第 ${i} 条消息首行\n${'x'.repeat(1100)}`,
        ),
      );
    }
    // 12 条 × ~1115 字符 ≈ 13k > 12000；tailCount = ceil(12*0.3) = 4 → 中间 = m-2..m-7（6 条）
    const r = summarizeIfNeeded(messages);
    expect(r.keep).toHaveLength(6);
    expect(r.keep[0]!.id).toBe('m-0');
    expect(r.keep[1]!.id).toBe('m-1');
    expect(r.keep.slice(2).map((m) => m.id)).toEqual(['m-8', 'm-9', 'm-10', 'm-11']);
    expect(r.summary).toBeDefined();
    expect(r.summary).toContain('【会话历史摘要】');
    expect(r.summary).toContain('结构性摘要');
    expect(r.summary).toContain('待接 provider');
    expect(r.summary).toContain('user 3 · assistant 3');
    expect(r.summary).toContain('[user] 第 2 条消息首行');
  });

  it('消息过少（首尾重叠）→ 原样返回不压缩', () => {
    const messages = [
      msg('m-1', 'user', 'a'.repeat(5000)),
      msg('m-2', 'assistant', 'b'.repeat(5000)),
      msg('m-3', 'user', 'c'.repeat(5000)),
    ];
    const r = summarizeIfNeeded(messages);
    expect(r.keep).toBe(messages);
    expect(r.summary).toBeUndefined();
  });

  it('首行超长截断加省略号；中间段超 20 行折叠为「其余 N 条略」', () => {
    const messages: AgentMessage[] = [
      msg('m-0', 'system', 'sys'),
      msg('m-1', 'user', 'q'),
    ];
    for (let i = 2; i < 40; i++) {
      messages.push(msg(`m-${i}`, 'assistant', `${'长'.repeat(120)}\n${'y'.repeat(400)}`));
    }
    const r = summarizeIfNeeded(messages); // 40 条 ≈ 21k 字符
    expect(r.keep).toHaveLength(2 + Math.ceil(messages.length * 0.3));
    expect(r.summary).toContain('…');
    expect(r.summary).toMatch(/其余 \d+ 条略/);
    const longLine = r.summary!.split('\n').find((l) => l.startsWith('- [assistant]'));
    expect(longLine!.length).toBeLessThanOrEqual('- [assistant] '.length + 80 + 1);
  });

  it('空消息列表原样返回', () => {
    expect(summarizeIfNeeded([])).toEqual({ keep: [] });
  });
});
