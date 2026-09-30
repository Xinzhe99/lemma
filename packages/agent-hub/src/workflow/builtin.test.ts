import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOWS, getBuiltinWorkflow, parseWorkflowYaml, WORKFLOW_YAML_SOURCES } from './builtin';

describe('内置工作流 YAML', () => {
  it('7 个内置工作流全部解析成功且结构合法', () => {
    expect(BUILTIN_WORKFLOWS).toHaveLength(7);
    expect(BUILTIN_WORKFLOWS.map((w) => w.id)).toEqual([
      'w2-section-draft',
      'w3-polish',
      'w6-reviewer-sim',
      'w7-rebuttal',
      'w10-pre-submission',
      'w11-cover-letter',
      'w12-related-work',
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
