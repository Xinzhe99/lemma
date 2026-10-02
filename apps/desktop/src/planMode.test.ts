/**
 * 计划模式纯函数层单测：parsePlan 宽容解析（围栏/平衡扫描/降级/坏 JSON）、
 * buildPlanPrompt 结构与路由关键词、buildStepPrompt 概览/前步摘要预算。
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_STEPS,
  PRIOR_OUTPUTS_BUDGET,
  buildPlanPrompt,
  buildStepPrompt,
  parsePlan,
  type Plan,
} from './planMode';

const PLAN_JSON = JSON.stringify({
  goal: '压缩论文到 9 页以内',
  steps: [
    { id: 's1', title: '检索文献库定位可压缩段落', detail: '用 library.search_fulltext 找重复论述', usesTools: ['library.search_fulltext'] },
    { id: 's2', title: '生成删减 diff', usesTools: ['tex.edit'] },
    { id: 's3', title: '编译验证页数', usesTools: ['tex.compile'] },
  ],
});

describe('parsePlan（宽容解析）', () => {
  it('解析 ```json 围栏计划：字段完整保留（goal/steps/id/title/detail/usesTools）', () => {
    const plan = parsePlan(`前置说明一句。\n\n\`\`\`json\n${PLAN_JSON}\n\`\`\`\n\n后置说明。`);
    expect(plan).not.toBeNull();
    expect(plan!.goal).toBe('压缩论文到 9 页以内');
    expect(plan!.steps).toHaveLength(3);
    expect(plan!.steps[0]).toEqual({
      id: 's1',
      title: '检索文献库定位可压缩段落',
      detail: '用 library.search_fulltext 找重复论述',
      usesTools: ['library.search_fulltext'],
    });
    expect(plan!.steps[2]!.title).toBe('编译验证页数');
  });

  it('无围栏时平衡扫描首个 { 到配对 }（正文里嵌着花括号也能解析）', () => {
    const plan = parsePlan(`我来规划：\n${PLAN_JSON}\n以上共 3 步。`);
    expect(plan).not.toBeNull();
    expect(plan!.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    // 字符串字面量内的花括号不破坏平衡
    const withBrace = parsePlan('{"goal": "修 {括号} 问题", "steps": [{"id": "s1", "title": "定位"}]}');
    expect(withBrace).toEqual({ goal: '修 {括号} 问题', steps: [{ id: 's1', title: '定位', detail: undefined }] });
  });

  it('坏 JSON / 无 JSON / 结构不符（缺 goal、steps 非数组）返回 null', () => {
    expect(parsePlan('```json\n{"goal": "x", "steps": [}\n```')).toBeNull(); // 围栏内坏 JSON
    expect(parsePlan('普通回答，没有任何结构。')).toBeNull();
    expect(parsePlan('{"steps": [{"title": "t"}]}')).toBeNull(); // 缺 goal
    expect(parsePlan('{"goal": "g", "steps": "not-array"}')).toBeNull(); // steps 非数组
    expect(parsePlan('{"goal": "g", "steps": []}')).toBeNull(); // 空步骤
    expect(parsePlan('{"goal": "", "steps": [{"title": "t"}]}')).toBeNull(); // 空 goal
  });

  it('未闭合 JSON / 只有数组顶层的 JSON 返回 null', () => {
    expect(parsePlan('{"goal": "g", "steps": [{"title": "t"}]')).toBeNull(); // 未闭合
    expect(parsePlan('```json\n[1,2,3]\n```')).toBeNull(); // 数组顶层
  });

  it('缺 title 的步骤被丢弃；丢完（至少 1 步不满足）返回 null', () => {
    const plan = parsePlan('{"goal": "g", "steps": [{"id": "s1"}, {"title": "有效步骤"}, 42]}');
    expect(plan).toEqual({ goal: 'g', steps: [{ id: 's1', title: '有效步骤', detail: undefined }] });
    expect(parsePlan('{"goal": "g", "steps": [{"id": "s1"}, 42]}')).toBeNull();
  });

  it('缺 id 的步骤按位置补 s1..sn；重复 id 追加序号去重', () => {
    const plan = parsePlan('{"goal": "g", "steps": [{"title": "a"}, {"title": "b"}, {"id": "s1", "title": "c"}]}');
    expect(plan!.steps.map((s) => s.id)).toEqual(['s1', 's2', 's1#3']);
  });

  it(`超过 ${MAX_PLAN_STEPS} 步截断到上限（降级而非拒绝）`, () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({ id: `s${i + 1}`, title: `步骤${i + 1}` }));
    const plan = parsePlan(JSON.stringify({ goal: 'g', steps }));
    expect(plan!.steps).toHaveLength(MAX_PLAN_STEPS);
    expect(plan!.steps[MAX_PLAN_STEPS - 1]!.title).toBe(`步骤${MAX_PLAN_STEPS}`);
  });

  it('字段类型降级：detail 非字符串丢弃、usesTools 过滤非字符串项、空数组省略', () => {
    const plan = parsePlan(
      '{"goal": "g", "steps": [{"id": "s1", "title": "t", "detail": 42, "usesTools": ["tex.edit", 7, ""]}]}',
    );
    expect(plan!.steps[0]!.detail).toBeUndefined();
    expect(plan!.steps[0]!.usesTools).toEqual(['tex.edit']);
    const plan2 = parsePlan('{"goal": "g", "steps": [{"id": "s1", "title": "t", "usesTools": []}]}');
    expect(plan2!.steps[0]!.usesTools).toBeUndefined();
  });

  it('goal/title 两端空白被裁剪（不因首尾空格渲染出空标题）', () => {
    const plan = parsePlan('{"goal": "  目标  ", "steps": [{"id": "s1", "title": "  标题  "}]}');
    expect(plan!.goal).toBe('目标');
    expect(plan!.steps[0]!.title).toBe('标题');
  });
});

describe('buildPlanPrompt（规划轮 prompt）', () => {
  it('首句含演示路由关键词「输出执行计划」，注入用户任务与上下文', () => {
    const p = buildPlanPrompt('帮我把论文压到 9 页', '## 大纲\n- 引言');
    expect(p.startsWith('请为以下任务输出执行计划')).toBe(true);
    expect(p).toContain('输出执行计划');
    expect(p).toContain('帮我把论文压到 9 页');
    expect(p).toContain('## 项目上下文');
    expect(p).toContain('## 大纲\n- 引言');
  });

  it('包含 json 围栏格式约定（goal/steps/id s1..sn）与保守分解、写文件单列约束', () => {
    const p = buildPlanPrompt('任务', '上下文');
    expect(p).toContain('```json');
    expect(p).toContain('"goal"');
    expect(p).toContain('"steps"');
    expect(p).toContain('s1');
    expect(p).toContain('保守分解');
    expect(p).toContain('写文件类步骤单列');
    expect(p).toContain('diff 审批卡');
  });

  it('上下文为空时给出占位，prompt 仍完整（不出现 undefined）', () => {
    const p = buildPlanPrompt('任务', '');
    expect(p).toContain('（无）');
    expect(p).not.toContain('undefined');
  });
});

describe('buildStepPrompt（单步执行 prompt）', () => {
  const plan: Plan = {
    goal: '压缩论文到 9 页以内',
    steps: [
      { id: 's1', title: '检索文献库', detail: '找重复论述' },
      { id: 's2', title: '生成删减 diff', detail: '只删冗余', usesTools: ['tex.edit'] },
      { id: 's3', title: '编译验证' },
    ],
  };

  it('首句含演示路由关键词「逐步骤说明」与本步 id；注入 goal、清单概览与本步详情', () => {
    const p = buildStepPrompt(plan, plan.steps[1]!, {});
    expect(p).toContain('逐步骤说明');
    expect(p).toContain('（s2）');
    expect(p).toContain('压缩论文到 9 页以内');
    expect(p).toContain('s1：检索文献库');
    expect(p).toContain('s3：编译验证');
    expect(p).toContain('- 步骤：s2 生成删减 diff');
    expect(p).toContain('- 说明：只删冗余');
    expect(p).toContain('- 预计工具：tex.edit');
    expect(p).toContain('只完成本步');
  });

  it('前步产出按计划顺序注入；后步产出（s3）不进入摘要', () => {
    const p = buildStepPrompt(
      plan,
      plan.steps[1]!,
      { s1: '找到 3 处重复', s3: '后面的产出不应出现' },
    );
    expect(p).toContain('【s1 检索文献库 的产出】');
    expect(p).toContain('找到 3 处重复');
    expect(p).not.toContain('后面的产出不应出现');
  });

  it('首步执行时摘要为占位；概览带状态标记与「← 本步」指针', () => {
    const p = buildStepPrompt(plan, plan.steps[0]!, {}, { s1: 'running' });
    expect(p).toContain('（本步为首步，无前步产出）');
    expect(p).toContain('◐ s1：检索文献库 ← 本步');
    expect(p).toContain('○ s2：生成删减 diff');
  });

  it(`前步产出总量截断到 ${PRIOR_OUTPUTS_BUDGET} 字（超出标注已截断）`, () => {
    const long = 'x'.repeat(2000);
    const p = buildStepPrompt(plan, plan.steps[2]!, { s1: long, s2: long });
    const section = p.slice(p.indexOf('## 前步产出摘要'));
    const body = section.slice(section.indexOf('【s1'), p.indexOf('## 执行要求'));
    expect(body.length).toBeLessThanOrEqual(PRIOR_OUTPUTS_BUDGET + 200); // 含标题与截断标记的余量
    expect(p).toContain('…（已截断）');
    expect(p).not.toContain('【s2 生成删减 diff 的产出】'); // 预算耗尽后不再拼后一步
  });
});
