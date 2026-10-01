/**
 * submissionDocs 纯函数测试（投稿文书生成器）：
 * - buildDocPrompt：四类 prompt 首句含各自的演示路由关键词、含稿件全文、
 *   互不含对方路由关键词（依赖碰撞设计）、空稿/超长稿的占位与截断；
 * - parseHighlights：-/* 列表、数字序号（1. / 1、 / 1)）、噪声行过滤
 *   （演示声明 / Markdown 标题 / 代码围栏 / 栏目标题）、无标记自由文本、折行并入；
 * - charCount：Unicode 码点计数（中日韩 / emoji 代理对）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildDocPrompt,
  charCount,
  DOC_KINDS,
  DOC_LABELS,
  DOC_SYSTEM_PROMPT,
  HIGHLIGHTS_CHAR_LIMIT,
  MAX_MANUSCRIPT_CHARS,
  parseHighlights,
  type DocKind,
} from './submissionDocs';

const MANUSCRIPT = '\\documentclass{article}\n\\begin{document}\n演示稿件正文。\n\\end{document}\n';

/** 各类演示路由关键词（demo.ts 由集成者维护；prompt 首句必须命中） */
const ROUTE_KEYWORDS: Record<DocKind, string> = {
  highlights: '生成 3 至 5 条 Highlights',
  declarations: '起草利益声明',
  dataAvailability: '起草数据可用性',
  coverLetterZh: '起草中文投稿信',
};

describe('buildDocPrompt', () => {
  it('DOC_LABELS/DOC_KINDS：四类齐全，zh/en 标签非空且顺序固定', () => {
    expect([...DOC_KINDS]).toEqual(['highlights', 'declarations', 'dataAvailability', 'coverLetterZh']);
    for (const kind of DOC_KINDS) {
      expect(DOC_LABELS[kind].zh.trim().length).toBeGreaterThan(0);
      expect(DOC_LABELS[kind].en.trim().length).toBeGreaterThan(0);
    }
  });

  it('每类 prompt 首行含自己的演示路由关键词，且附上稿件全文', () => {
    for (const kind of DOC_KINDS) {
      const p = buildDocPrompt(kind, MANUSCRIPT);
      expect(p.split('\n')[0]).toContain(ROUTE_KEYWORDS[kind]); // 首行即命中路由
      expect(p).toContain('## 稿件全文');
      expect(p).toContain('演示稿件正文。');
    }
  });

  it('互不包含其它类的路由关键词（依赖碰撞设计）', () => {
    for (const kind of DOC_KINDS) {
      const p = buildDocPrompt(kind, MANUSCRIPT);
      for (const other of DOC_KINDS) {
        if (other === kind) continue;
        expect(p.includes(ROUTE_KEYWORDS[other])).toBe(false);
      }
    }
  });

  it('highlights：条数与 85 字符上限写入指令', () => {
    const p = buildDocPrompt('highlights', MANUSCRIPT);
    expect(p).toContain('3 至 5 条');
    expect(p).toContain('85 字符');
    expect(p).toContain('- ');
  });

  it('declarations：覆盖利益冲突 / 资助 / 作者贡献（CRediT）框架', () => {
    const p = buildDocPrompt('declarations', MANUSCRIPT);
    expect(p).toContain('利益冲突');
    expect(p).toContain('资助');
    expect(p).toContain('作者贡献');
    expect(p).toContain('CRediT');
    expect(p).toContain('【待作者补充'); // 未知事实一律占位
  });

  it('dataAvailability：要求用户补数据链接占位、禁止编造 URL/DOI', () => {
    const p = buildDocPrompt('dataAvailability', MANUSCRIPT);
    expect(p).toContain('【待作者补充：数据仓库链接】');
    expect(p).toContain('禁止编造');
  });

  it('coverLetterZh：面向编辑的中文投稿信要素齐备', () => {
    const p = buildDocPrompt('coverLetterZh', MANUSCRIPT);
    expect(p).toContain('期刊编辑部');
    expect(p).toContain('原创性');
    expect(p).toContain('称呼');
  });

  it('空稿件：正文占位说明，不抛错', () => {
    const p = buildDocPrompt('highlights', '');
    expect(p).toContain('稿件为空');
    expect(p).toContain('【待作者补充');
  });

  it('超长稿件：截断到上限并注明（按码点计）', () => {
    const long = '字'.repeat(MAX_MANUSCRIPT_CHARS + 500);
    const p = buildDocPrompt('coverLetterZh', long);
    expect(p).toContain('已截断');
    expect(p).toContain(`前 ${MAX_MANUSCRIPT_CHARS} 字符`);
    expect(charCount(p)).toBeLessThan(charCount(long)); // 确实没有全文塞入
  });

  it('DOC_SYSTEM_PROMPT：约束纯文本输出与禁止编造', () => {
    expect(DOC_SYSTEM_PROMPT).toContain('投稿文书');
    expect(DOC_SYSTEM_PROMPT).toContain('禁止编造');
  });
});

describe('parseHighlights 宽容解析', () => {
  it('「- 」与「* 」bullet 列表 → 剥标记取条目', () => {
    const out = parseHighlights('- 第一条要点\n* 第二条要点\n- 第三条要点');
    expect(out).toEqual(['第一条要点', '第二条要点', '第三条要点']);
  });

  it('数字序号 1. / 2、 / 3) 均可解析', () => {
    const out = parseHighlights('1. 首条\n2、次条\n3) 末条');
    expect(out).toEqual(['首条', '次条', '末条']);
  });

  it('过滤演示声明（> 行）、Markdown 标题、代码围栏与栏目标题行', () => {
    const text = [
      '> ⚠️ 演示数据（内置示例，配置模型服务后为真实 AI 生成）',
      '',
      '## Highlights',
      'Highlights',
      '- 建议统一混合检索，评级提升 0.4',
      '```latex',
      '\\documentclass{beamer}',
      '```',
      '- diff 审批机制保证作者裁决权',
    ].join('\n');
    expect(parseHighlights(text)).toEqual([
      '建议统一混合检索，评级提升 0.4',
      'diff 审批机制保证作者裁决权',
    ]);
  });

  it('markdown 粗体包裹的标记（**1.**）也能剥掉', () => {
    expect(parseHighlights('**1.** 粗体序号条目')).toEqual(['粗体序号条目']);
  });

  it('无任何列表标记：按非空行原样返回（自由格式仍逐行呈现）', () => {
    const out = parseHighlights('第一条\n\n第二条\n第三条');
    expect(out).toEqual(['第一条', '第二条', '第三条']);
  });

  it('见标记后的折行续文并入上一条，不单列', () => {
    const out = parseHighlights('- 首条要点\n  续行内容\n- 次条要点');
    expect(out).toEqual(['首条要点 续行内容', '次条要点']);
  });

  it('空串 / 纯噪声 → 空数组', () => {
    expect(parseHighlights('')).toEqual([]);
    expect(parseHighlights('> 演示声明\n\n## 标题')).toEqual([]);
  });
});

describe('charCount 与字数上限常量', () => {
  it('HIGHLIGHTS_CHAR_LIMIT 为 85（投稿系统通行上限）', () => {
    expect(HIGHLIGHTS_CHAR_LIMIT).toBe(85);
  });

  it('按 Unicode 码点计：中文一字一计、emoji 代理对不重复计', () => {
    expect(charCount('abc')).toBe(3);
    expect(charCount('混合检索评级提升')).toBe(8);
    expect(charCount('a😀b')).toBe(3); // emoji 占 2 个 UTF-16 单元、1 个码点
    expect(charCount('😀')).toBe(1);
  });
});
