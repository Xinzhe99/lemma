/**
 * AI 动作层增量单测：一键修编译错误（fixCompileErrors）。
 * 覆盖验收路径：
 *  - parseCompileErrors：诊断行解析（file:line / 无行号）、warning 与杂音忽略、文件去重有序；
 *  - buildFixCompileErrorsContext / buildFixCompileErrorsPrompt：诊断注入、文件上下文注入
 *    （错误行 ±12 窗口、入口/活动 .tex 补充、.tex 扩展名回退）、超 30 条截断标注；
 *  - fixCompileErrors：无 error 诊断时直接返回 note（不发起会话）；
 *  - 演示分支（未配置模型）：prompt 进入会话，关键词「修复以下 LaTeX 编译错误」命中；
 *  - 真实分支（mock fetch SSE）：请求体携带 ENABLED_TOOLS（含 tex.edit → diff 审批闭环），
 *    流式回复落进会话。
 * 全程不依赖真实网络：fetch 以 SSE ReadableStream stub。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIX_L,
  buildFixCompileErrorsContext,
  buildFixCompileErrorsPrompt,
  fixCompileErrors,
  parseCompileErrors,
  pickFix,
} from './aiActions';
import { useAgentHubStore } from '@scholarforge/agent-hub';
import { useSettingsStore } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { useProposalStore } from './state/proposalStore';

// 与 compileAction.logDiagnostics 写入格式一致（真实引擎与模拟引擎共用）
const LOG_ERROR_LINE = '  [error] main.tex:12 Undefined control sequence.';

function seedProject(): void {
  useWorkspaceStore.setState({
    projectName: 'test',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n',
      'sections/intro.tex': 'line1\nline2\nline3\nbroken here\nline5\n',
    },
    openTabs: ['sections/intro.tex'],
    activeTab: 'sections/intro.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
}

describe('parseCompileErrors（compileLog 诊断行解析）', () => {
  it('解析 error 行的 file:line 与 message，无行号行也接受', () => {
    const d = parseCompileErrors([
      '▶ 开始编译 main.tex（模拟引擎）',
      LOG_ERROR_LINE,
      '  [warning] main.tex:3 Something minor.',
      '  [error] sections/intro.tex Citation `x` undefined',
      '▣ 模拟引擎 · 1 趟 · 40ms · 失败',
    ]);
    expect(d.errors).toEqual([
      { file: 'main.tex', line: 12, message: 'Undefined control sequence.' },
      { file: 'sections/intro.tex', line: null, message: 'Citation `x` undefined' },
    ]);
    expect(d.files).toEqual(['main.tex', 'sections/intro.tex']);
  });

  it('非诊断行与 warning 行全部忽略（一键修复只针对 error）', () => {
    const d = parseCompileErrors([
      '▶ 开始编译 main.tex（模拟引擎）',
      '  [warning] refs.bib:1 minor',
      '    ↳ 修复提示：补全引用',
      '▣ 模拟引擎 · 1 趟 · 40ms · 成功',
    ]);
    expect(d.errors).toEqual([]);
    expect(d.files).toEqual([]);
  });

  it('行号为纯数字才解析（防 file:col 误判），空日志返回空清单', () => {
    const d = parseCompileErrors(['  [error] main.tex:abc weird message', '']);
    expect(d.errors).toEqual([{ file: 'main.tex:abc', line: null, message: 'weird message' }]);
    expect(parseCompileErrors([])).toEqual({ errors: [], files: [] });
  });
});

describe('buildFixCompileErrorsContext（相关文件上下文注入）', () => {
  const digest = {
    errors: [
      { file: 'main.tex', line: 2, message: 'e1' },
      { file: 'sections/intro', line: null, message: 'e2' }, // 无扩展名：应回退解析
    ],
    files: ['main.tex', 'sections/intro'],
  };

  it('错误文件按行号窗口输出带行号片段，无行号文件取开头', () => {
    const files: Record<string, string> = {
      'main.tex': ['a', 'b', 'c'].join('\n'),
      'sections/intro.tex': ['x1', 'x2'].join('\n'),
    };
    const ctx = buildFixCompileErrorsContext(digest, files, { entry: 'main.tex', active: null });
    expect(ctx).toContain('### main.tex');
    expect(ctx).toContain('2: b');
    expect(ctx).toContain('### sections/intro.tex'); // .tex 扩展名回退命中
    expect(ctx).toContain('（第 1–2 行）');
  });

  it('入口与活动 .tex 不在错误清单时补充（看到导言区），已含则不重复', () => {
    const files: Record<string, string> = {
      'main.tex': 'preamble\n',
      'sections/intro.tex': 'intro body\n',
      'sections/method.tex': 'method body\n',
    };
    const ctx = buildFixCompileErrorsContext(digest, files, {
      entry: 'main.tex',
      active: 'sections/method.tex',
    });
    expect(ctx).toContain('### sections/method.tex'); // 活动 .tex 补充
    expect(ctx.indexOf('### main.tex')).toBe(0); // 错误文件优先
    expect(ctx.match(/### main\.tex/g)).toHaveLength(1); // 同文件不重复
    // 活动 .tex 非 .tex 后缀时不补充
    const ctx2 = buildFixCompileErrorsContext(
      { errors: [], files: [] },
      files,
      { entry: 'main.tex', active: 'refs.bib' },
    );
    expect(ctx2).not.toContain('refs.bib');
  });

  it('工作区不存在的错误文件跳过（不产出空片段）', () => {
    const ctx = buildFixCompileErrorsContext(
      { errors: [{ file: 'ghost.tex', line: 3, message: 'e' }], files: ['ghost.tex'] },
      { 'main.tex': 'only\n' },
      { entry: 'main.tex', active: null },
    );
    expect(ctx).not.toContain('ghost.tex');
    expect(ctx).toContain('### main.tex');
  });

  it('同文件多个相邻错误合并为一个窗口，不相邻分段', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i + 1}`);
    const ctx = buildFixCompileErrorsContext(
      {
        errors: [
          { file: 'main.tex', line: 20, message: 'a' },
          { file: 'main.tex', line: 25, message: 'b' },
          { file: 'main.tex', line: 90, message: 'c' },
        ],
        files: ['main.tex'],
      },
      { 'main.tex': lines.join('\n') },
      { entry: null, active: null },
    );
    expect(ctx).toContain('（第 8–37 行）'); // 20±12 与 25±12 合并
    expect(ctx).toContain('（第 78–100 行）'); // 独立窗口
    expect(ctx.match(/（第/g)).toHaveLength(2);
  });
});

describe('buildFixCompileErrorsPrompt（prompt 组装）', () => {
  it('首句含演示路由关键词，注入错误清单与文件上下文', () => {
    const digest = parseCompileErrors([LOG_ERROR_LINE, '  [error] sections/intro.tex broken']);
    const prompt = buildFixCompileErrorsPrompt(
      digest,
      {
        'main.tex': '\\documentclass{article}\n\\begin{document}\n\\badcommand\n\\end{document}\n',
        'sections/intro.tex': 'intro\n',
      },
      { entry: 'main.tex', active: 'sections/intro.tex' },
    );
    expect(prompt.startsWith('请修复以下 LaTeX 编译错误')).toBe(true);
    expect(prompt).toContain('1. main.tex:12 — Undefined control sequence.');
    expect(prompt).toContain('2. sections/intro.tex — broken');
    expect(prompt).toContain('## 相关文件上下文');
    expect(prompt).toContain('### main.tex');
    expect(prompt).toContain('tex.edit');
    expect(prompt).toContain('tex.compile');
  });

  it('错误超过 30 条时截断并标注总数', () => {
    const errors = Array.from({ length: 40 }, (_, i) => `  [error] main.tex:${i + 1} e${i}`);
    const digest = parseCompileErrors(errors);
    const prompt = buildFixCompileErrorsPrompt(digest, { 'main.tex': 'x\n' }, { entry: 'main.tex', active: null });
    expect(prompt).toContain('30. main.tex:30 — e29');
    expect(prompt).not.toContain('31. main.tex:31');
    expect(prompt).toContain('共 40 条，仅列出前 30 条');
  });

  it('上下文全空时给出占位说明（模型仍可依日志工作）', () => {
    const digest = parseCompileErrors(['  [error] ghost.tex:1 missing']);
    const prompt = buildFixCompileErrorsPrompt(digest, { 'refs.bib': '@x{y,}\n' }, { entry: null, active: null });
    expect(prompt).toContain('（出错文件不在当前工作区）');
  });
});

describe('fixCompileErrors（无错误 / 演示 / 真实三分支）', () => {
  afterEach(() => {
    useSettingsStore.setState({ providers: [], activeProviderId: null, language: 'zh' });
    useProposalStore.getState().setNote(null);
    vi.unstubAllGlobals();
  });

  it('无 error 诊断时直接返回 note，不创建会话', async () => {
    seedProject();
    useWorkspaceStore.setState({ compileLog: ['  [warning] main.tex:1 minor', '▣ 成功'] });
    const before = useAgentHubStore.getState().sessions.length;
    await fixCompileErrors();
    expect(useProposalStore.getState().note).toBe(FIX_L.zh.noErrors);
    expect(useAgentHubStore.getState().sessions.length).toBe(before);
  });

  it('en 语言时 note 为英文', async () => {
    seedProject();
    useSettingsStore.setState({ language: 'en' });
    useWorkspaceStore.setState({ compileLog: [] });
    await fixCompileErrors();
    expect(useProposalStore.getState().note).toBe(FIX_L.en.noErrors);
    expect(pickFix('en').noErrors).toBe(FIX_L.en.noErrors);
  });

  it('演示分支（未配置模型）：prompt 进入会话且含路由关键词，回复为演示脚本', async () => {
    seedProject();
    useSettingsStore.setState({ providers: [], activeProviderId: null });
    useWorkspaceStore.setState({ compileLog: [LOG_ERROR_LINE] });
    await fixCompileErrors();
    const s = useAgentHubStore.getState().sessions[0]!;
    const userMsg = [...s.messages].reverse().find((m) => m.role === 'user')!;
    expect(userMsg.content.startsWith('请修复以下 LaTeX 编译错误')).toBe(true);
    expect(userMsg.content).toContain('main.tex:12 — Undefined control sequence.');
    const assistant = [...s.messages].reverse().find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('演示');
  });

  it('真实分支（mock fetch SSE）：请求携带 ENABLED_TOOLS（含 tex.edit），流式回复落进会话', async () => {
    seedProject();
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          label: '测试服务',
          baseUrl: 'https://api.test/v1',
          apiKey: 'sk-test',
          model: 'test-model',
          tier: 'flagship',
        },
      ],
      activeProviderId: 'p1',
    });
    useWorkspaceStore.setState({ compileLog: [LOG_ERROR_LINE] });

    const bodies: string[] = [];
    const sse = [
      'data: {"choices":[{"delta":{"content":"已定位到 \\\\badcommand。"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fixCompileErrors();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(bodies[0]!) as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
    // 工具启用：ENABLED_TOOLS 注入请求（tex.edit 在列 → 落 diff 审批卡）
    const toolNames = (body.tools ?? []).map((t) => t.function.name);
    expect(toolNames).toContain('tex.edit');
    expect(toolNames).toContain('tex.compile');
    // 最后一条 user 消息即修复 prompt（诊断注入）
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')!;
    expect(lastUser.content).toContain('修复以下 LaTeX 编译错误');
    expect(lastUser.content).toContain('Undefined control sequence.');
    // 流式回复进入会话
    const s = useAgentHubStore.getState().sessions[0]!;
    const assistant = [...s.messages].reverse().find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('已定位到');
  });
});
