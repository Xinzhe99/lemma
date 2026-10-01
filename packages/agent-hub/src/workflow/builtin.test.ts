import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOWS, getBuiltinWorkflow, parseWorkflowYaml, WORKFLOW_YAML_SOURCES } from './builtin';

describe('内置工作流 YAML', () => {
  // 当前 10 个：W2/W3/W6/W7/W10/W11/W12/W13/W14/W16
  it('10 个内置工作流全部解析成功且结构合法', () => {
    expect(BUILTIN_WORKFLOWS).toHaveLength(10);
    expect(BUILTIN_WORKFLOWS.map((w) => w.id)).toEqual([
      'w2-section-draft',
      'w3-polish',
      'w6-reviewer-sim',
      'w7-rebuttal',
      'w10-pre-submission',
      'w11-cover-letter',
      'w12-related-work',
      'w13-beamer',
      'w14-compress',
      'w16-promo',
    ]);
    for (const w of BUILTIN_WORKFLOWS) {
      expect(w.name.length).toBeGreaterThan(0);
      expect(w.description.length).toBeGreaterThan(0);
      expect(w.inputs.length).toBeGreaterThan(0);
      expect(w.steps.length).toBeGreaterThanOrEqual(2);
      expect(new Set(w.steps.map((s) => s.id)).size).toBe(w.steps.length);
      for (const s of w.steps) {
        expect(s.prompt.trim().length).toBeGreaterThan(20); // 完整可用的中文 prompt
        for (const d of s.dependsOn ?? []) {
          expect(w.steps.some((x) => x.id === d)).toBe(true);
        }
      }
    }
  });

  it('W6：三个 parallel reviewer 共同依赖 prep，meta-review 为 checkpoint，最后是修改建议', () => {
    const w6 = getBuiltinWorkflow('w6-reviewer-sim');
    expect(w6).toBeDefined();
    const reviewers = w6!.steps.filter((s) => s.parallel === true);
    expect(reviewers.map((s) => s.id)).toEqual(['reviewer-method', 'reviewer-domain', 'reviewer-stat']);
    for (const r of reviewers) {
      expect(r.dependsOn).toEqual(['prep']);
      expect(r.modelTier).toBe('flagship');
    }
    const meta = w6!.steps.find((s) => s.id === 'meta-review')!;
    expect(meta.checkpoint).toBe(true);
    expect(meta.dependsOn).toEqual(['reviewer-method', 'reviewer-domain', 'reviewer-stat']);
    const revise = w6!.steps.find((s) => s.id === 'revise')!;
    expect(revise.dependsOn).toEqual(['meta-review']);
  });

  it('声明过的输入变量都出现在 prompt 占位符中', () => {
    for (const [id, source] of Object.entries(WORKFLOW_YAML_SOURCES)) {
      const w = parseWorkflowYaml(source);
      for (const input of w.inputs) {
        expect(source).toContain(`{{${input}}}`);
      }
      void id;
    }
    // 抽查 W2
    const w2 = getBuiltinWorkflow('w2-section-draft')!;
    expect(w2.inputs).toEqual(['section', 'outline', 'notes']);
    expect(w2.steps[0].prompt).toContain('{{section}}');
  });

  it('W3 润色含审批检查点；W10 为线性依赖链', () => {
    const w3 = getBuiltinWorkflow('w3-polish')!;
    expect(w3.steps.find((s) => s.id === 'apply')!.checkpoint).toBe(true);
    const w10 = getBuiltinWorkflow('w10-pre-submission')!;
    expect(w10.steps.map((s) => s.id)).toEqual(['requirements', 'compile-check', 'audit', 'report']);
    expect(w10.steps[3].dependsOn).toEqual(['audit']);
  });

  it('W7：解析→起草→确认(checkpoint)→整合，finalize 声明写级工具', () => {
    const w7 = getBuiltinWorkflow('w7-rebuttal')!;
    expect(w7.steps.map((s) => s.id)).toEqual(['parse', 'draft', 'confirm', 'finalize']);
    expect(w7.steps.find((s) => s.id === 'confirm')!.checkpoint).toBe(true);
    const finalize = w7.steps.find((s) => s.id === 'finalize')!;
    expect(finalize.allowedTools).toContain('tex.edit');
    expect(finalize.allowedTools).toContain('citation.validate');
  });

  it('W11：cover letter 含期刊定位(带工具)与作者审阅检查点', () => {
    const w11 = getBuiltinWorkflow('w11-cover-letter')!;
    expect(w11.steps.map((s) => s.id)).toEqual(['research', 'draft', 'review', 'finalize']);
    expect(w11.steps.find((s) => s.id === 'review')!.checkpoint).toBe(true);
    expect(w11.steps[0]!.allowedTools).toContain('library.search_fulltext');
  });

  it('W12：检索→起草→确认(checkpoint)→插入，search 带库内检索、apply 带写级工具', () => {
    const w12 = getBuiltinWorkflow('w12-related-work')!;
    expect(w12.name).toBe('相关工作综述');
    expect(w12.inputs).toEqual(['topic', 'manuscript']);
    expect(w12.steps.map((s) => s.id)).toEqual(['search', 'draft', 'confirm', 'apply']);
    const search = w12.steps.find((s) => s.id === 'search')!;
    expect(search.allowedTools).toContain('library.search_fulltext');
    expect(search.allowedTools).toContain('citation.validate');
    expect(search.modelTier).toBe('cheap');
    const draft = w12.steps.find((s) => s.id === 'draft')!;
    expect(draft.dependsOn).toEqual(['search']);
    expect(draft.modelTier).toBe('flagship');
    expect(w12.steps.find((s) => s.id === 'confirm')!.checkpoint).toBe(true);
    const apply = w12.steps.find((s) => s.id === 'apply')!;
    expect(apply.dependsOn).toEqual(['confirm']);
    expect(apply.allowedTools).toContain('tex.edit');
    expect(apply.allowedTools).toContain('snapshot.create');
  });

  it('W13：大纲→Beamer 源码→自查(checkpoint)→落盘，outline 带项目上下文、apply 带写级工具', () => {
    const w13 = getBuiltinWorkflow('w13-beamer')!;
    expect(w13.name).toBe('生成演示文稿');
    expect(w13.description).toContain('Beamer slides 骨架');
    expect(w13.inputs).toEqual(['audience', 'duration']);
    expect(w13.steps.map((s) => s.id)).toEqual(['outline', 'write', 'confirm', 'apply']);

    const outline = w13.steps.find((s) => s.id === 'outline')!;
    expect(outline.allowedTools).toEqual(['project.context']);
    expect(outline.modelTier).toBe('cheap');
    expect(outline.prompt).toContain('{{audience}}');
    expect(outline.prompt).toContain('{{duration}}');

    const write = w13.steps.find((s) => s.id === 'write')!;
    expect(write.dependsOn).toEqual(['outline']);
    expect(write.modelTier).toBe('flagship');
    // Beamer 骨架硬要求写入 prompt：documentclass/主题/frame/itemize/\ref
    expect(write.prompt).toContain('\\documentclass{beamer}');
    expect(write.prompt).toContain('Madrid');
    expect(write.prompt).toContain('metropolis');
    expect(write.prompt).toContain('\\begin{frame}');
    expect(write.prompt).toContain('itemize');
    expect(write.prompt).toContain('\\ref');

    const confirm = w13.steps.find((s) => s.id === 'confirm')!;
    expect(confirm.dependsOn).toEqual(['write']);
    expect(confirm.checkpoint).toBe(true);
    expect(confirm.modelTier).toBe('cheap');
    expect(confirm.prompt).toContain('页数');
    expect(confirm.prompt).toContain('{{audience}}');
    expect(confirm.prompt).toContain('{{duration}}');

    const apply = w13.steps.find((s) => s.id === 'apply')!;
    expect(apply.dependsOn).toEqual(['confirm']);
    expect(apply.modelTier).toBe('cheap');
    expect(apply.allowedTools).toContain('tex.edit');
    expect(apply.allowedTools).toContain('snapshot.create');
    expect(apply.prompt).toContain('slides.tex');
  });

  it('W16：起草(flagship)四种宣传物料→自查(checkpoint, cheap)停检查点，两输入均入 prompt', () => {
    const w16 = getBuiltinWorkflow('w16-promo');
    expect(w16).toBeDefined();
    expect(w16!.name).toBe('发表后宣传物料');
    expect(w16!.description).toContain('论文接收后');
    expect(w16!.inputs).toEqual(['paperTitle', 'venue']);
    expect(w16!.steps.map((s) => s.id)).toEqual(['draft', 'confirm']);

    const draft = w16!.steps.find((s) => s.id === 'draft')!;
    expect(draft.modelTier).toBe('flagship');
    expect(draft.checkpoint).toBeUndefined();
    // 四种物料各有硬性小节要求，且两输入占位符进入 prompt
    expect(draft.prompt).toContain('{{paperTitle}}');
    expect(draft.prompt).toContain('{{venue}}');
    expect(draft.prompt).toContain('280 字符');
    expect(draft.prompt).toContain('3 个 # 标签');
    expect(draft.prompt).toContain('150–250 字');
    expect(draft.prompt).toContain('graphical abstract');
    expect(draft.prompt).toContain('200–300 字');
    expect(draft.prompt).toContain('markdown');

    const confirm = w16!.steps.find((s) => s.id === 'confirm')!;
    expect(confirm.dependsOn).toEqual(['draft']);
    expect(confirm.checkpoint).toBe(true);
    expect(confirm.modelTier).toBe('cheap');
    // 自查范围写入 prompt：语气事实性（不夸大、数字与稿件一致）+ 各平台字数
    expect(confirm.prompt).toContain('语气事实性');
    expect(confirm.prompt).toContain('夸大');
    expect(confirm.prompt).toContain('字数');
  });

  it('W14：分析→压缩(checkpoint)→按确认落盘，硬约束写入 prompt、apply 声明写级工具', () => {
    const w14 = getBuiltinWorkflow('w14-compress')!;
    expect(w14.name).toBe('AI 页数压缩');
    expect(w14.inputs).toEqual(['targetReduction']);
    expect(w14.steps.map((s) => s.id)).toEqual(['analyze', 'compress', 'apply']);

    const analyze = w14.steps.find((s) => s.id === 'analyze')!;
    expect(analyze.modelTier).toBe('cheap');
    expect(analyze.allowedTools).toEqual(['project.context']);
    expect(analyze.prompt).toContain('{{targetReduction}}');

    const compress = w14.steps.find((s) => s.id === 'compress')!;
    expect(compress.dependsOn).toEqual(['analyze']);
    expect(compress.modelTier).toBe('flagship');
    expect(compress.checkpoint).toBe(true); // 停在检查点等用户确认取舍
    // 硬性约束写进 prompt：引用命令不动 / 数字与结论不变 / 宁少勿错
    expect(compress.prompt).toContain('\\cite、\\ref、\\label 一律不动');
    expect(compress.prompt).toContain('数字与结论不得改变');
    expect(compress.prompt).toContain('宁少勿错');

    const apply = w14.steps.find((s) => s.id === 'apply')!;
    expect(apply.dependsOn).toEqual(['compress']);
    expect(apply.modelTier).toBe('cheap');
    expect(apply.allowedTools).toContain('tex.edit');
    expect(apply.allowedTools).toContain('snapshot.create');
  });
});

describe('parseWorkflowYaml 严格校验', () => {
  const valid = (over: Record<string, unknown> = {}) =>
    parseWorkflowYaml(
      [
        'id: x',
        'name: 示例',
        'description: 说明',
        'inputs: [a]',
        'steps:',
        '  - id: s1',
        '    prompt: 干活',
        ...Object.entries(over).map(([k, v]) => `${k}: ${v}`),
      ].join('\n'),
    );

  it('合法定义通过', () => {
    const w = valid();
    expect(w.steps[0].name).toBe('s1'); // name 缺省回落到 id
  });

  it('steps 为空报错', () => {
    expect(() =>
      parseWorkflowYaml('id: x\nname: n\ndescription: d\ninputs: []\nsteps: []'),
    ).toThrow(/steps 为空|未定义任何步骤/);
  });

  it('步骤 id 重复报错', () => {
    expect(() =>
      parseWorkflowYaml(
        ['id: x', 'name: n', 'description: d', 'inputs: []', 'steps:', '  - id: s1', '    prompt: p', '  - id: s1', '    prompt: q'].join('\n'),
      ),
    ).toThrow(/重复/);
  });

  it('dependsOn 引用不存在报错', () => {
    expect(() =>
      parseWorkflowYaml(
        ['id: x', 'name: n', 'description: d', 'inputs: []', 'steps:', '  - id: s1', '    prompt: p', '    dependsOn: [ghost]'].join('\n'),
      ),
    ).toThrow(/不存在的步骤/);
  });

  it('缺少 prompt / 非法 YAML / 非对象 报错', () => {
    expect(() => parseWorkflowYaml('id: x\nname: n\ndescription: d\ninputs: []\nsteps:\n  - id: s1\n')).toThrow(/prompt/);
    expect(() => parseWorkflowYaml('steps: [1, 2')).toThrow(/YAML 语法错误/);
    expect(() => parseWorkflowYaml('- 1\n- 2')).toThrow();
  });

  it('modelTier 非法值报错', () => {
    expect(() =>
      parseWorkflowYaml(
        ['id: x', 'name: n', 'description: d', 'inputs: []', 'steps:', '  - id: s1', '    prompt: p', '    modelTier: ultra'].join('\n'),
      ),
    ).toThrow(/modelTier/);
  });
});
