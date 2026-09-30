/**
 * WF-3 A2：parseChecklistReport 纯函数单测（node 环境即可，组件本身不渲染）。
 * 覆盖：总体结论三态宽容解析、✅/❌/⚠️ 与 [通过]/[未通过] 双标记形态、
 * 「→ 建议」修复行、续行 detail、未结构化降级。
 */
import { describe, expect, it } from 'vitest';
import { classifyVerdict, parseChecklistReport } from './ChecklistReport';

const MD_EMOJI = `# 投稿前自检报告

总体结论：修复后可提交

## 逐项清单

✅ 编译通过（tectonic，0 error / 2 warning）
❌ 页数超出限制：正文 11 页 > 要求 9 页
   定位：main.tex 第 3-4 节
→ 建议：压缩图 3 与图 4 为双栏并列，预计省 1.5 页
⚠️ 匿名化：致谢中含基金号，可能泄露身份
→ 建议：投稿版删除致谢或改为匿名表述
✅ 引用格式与 bib 字段完整`;

const MD_BRACKET = `预提交检查

Overall: pass

- [通过] Data statement 已包含
- [未通过] AI 使用披露缺失
  建议：按期刊政策补 disclosure 语句
- [需人工判断] 图 3 分辨率约 260dpi，期刊要求 300dpi 但打印可读
  -> 与编辑部确认矢量图是否豁免`;

const MD_RAW = `这是一段自由文本总结，没有清单标记，
也没有结论行。模型自由发挥了一段话。`;

describe('classifyVerdict（结论文本三态）', () => {
  it('通过类', () => {
    expect(classifyVerdict('可提交')).toBe('pass');
    expect(classifyVerdict('通过')).toBe('pass');
    expect(classifyVerdict('pass')).toBe('pass');
  });
  it('未通过类（含「暂不可提交」这类含「可提交」字样的表述）', () => {
    expect(classifyVerdict('暂不可提交')).toBe('fail');
    expect(classifyVerdict('未通过')).toBe('fail');
    expect(classifyVerdict('fail')).toBe('fail');
  });
  it('需人工类（含「修复后可提交」）', () => {
    expect(classifyVerdict('修复后可提交')).toBe('manual');
    expect(classifyVerdict('需人工判断')).toBe('manual');
    expect(classifyVerdict('conditional')).toBe('manual');
  });
  it('无法判定', () => {
    expect(classifyVerdict('没什么可说的')).toBeNull();
    expect(classifyVerdict('')).toBeNull();
  });
});

describe('parseChecklistReport（emoji 标记形态）', () => {
  const data = parseChecklistReport(MD_EMOJI);

  it('总体结论三态宽容解析（「总体结论：修复后可提交」→ manual）', () => {
    expect(data.verdict).toBe('manual');
    expect(data.verdictText).toBe('修复后可提交');
  });

  it('逐项条目：状态 + 内容', () => {
    expect(data.items).toHaveLength(4);
    expect(data.items[0]).toMatchObject({ status: 'pass', title: '编译通过（tectonic，0 error / 2 warning）' });
    expect(data.items[1]).toMatchObject({ status: 'fail' });
    expect(data.items[1]!.title).toContain('页数超出限制');
    expect(data.items[2]).toMatchObject({ status: 'manual' });
  });

  it('续行归入 detail，「→ 建议」归入 suggestion', () => {
    const fail = data.items[1]!;
    expect(fail.detail).toContain('main.tex');
    expect(fail.suggestion).toContain('双栏并列');
    const manual = data.items[2]!;
    expect(manual.suggestion).toContain('匿名表述');
    expect(manual.detail).toBeUndefined();
  });

  it('结构化成功', () => {
    expect(data.structured).toBe(true);
  });
});

describe('parseChecklistReport（[通过]/[未通过] 括号形态 + 英文结论）', () => {
  const data = parseChecklistReport(MD_BRACKET);

  it('英文结论行', () => {
    expect(data.verdict).toBe('pass');
    expect(data.verdictText).toBe('pass');
  });

  it('括号标记 + 「建议：」「->」建议行', () => {
    expect(data.items.map((i) => i.status)).toEqual(['pass', 'fail', 'manual']);
    expect(data.items[0]!.title).toBe('Data statement 已包含');
    expect(data.items[1]!.suggestion).toContain('disclosure');
    expect(data.items[2]!.suggestion).toContain('矢量图');
    expect(data.items[2]!.title).toContain('260dpi');
    expect(data.items[2]!.detail).toBeUndefined();
  });
});

describe('降级：无法结构化', () => {
  it('无结论无条目 → structured=false，原文保留在调用方', () => {
    const data = parseChecklistReport(MD_RAW);
    expect(data.structured).toBe(false);
    expect(data.verdict).toBeNull();
    expect(data.items).toEqual([]);
  });

  it('空串安全', () => {
    const data = parseChecklistReport('');
    expect(data.structured).toBe(false);
    expect(data.items).toEqual([]);
  });

  it('仅有结论无条目仍算结构化', () => {
    const data = parseChecklistReport('总体：通过\n一切正常。');
    expect(data.structured).toBe(true);
    expect(data.verdict).toBe('pass');
    expect(data.items).toEqual([]);
  });
});
