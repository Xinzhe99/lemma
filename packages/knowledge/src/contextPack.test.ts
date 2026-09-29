import { describe, expect, it } from 'vitest';
import type { CitedChunk } from './contextPack';
import { buildContextPack, renderContextPackMd } from './contextPack';
import { extractCitations } from './integrity';

const glossary = [
  { id: 'g1', term: 'Convolutional Neural Network', abbr: 'CNN', translation: '卷积神经网络' },
  { id: 'g2', term: 'Mean Squared Error', abbr: 'MSE', translation: '均方误差' },
];

const relatedChunks: CitedChunk[] = [
  {
    id: 'chk1',
    paperId: 'paper-a',
    citekey: 'vaswani2017',
    heading: '3 Attention',
    page: 3,
    score: 0.92,
    text: 'We compute the attention function on packed sequences using matrix multiplication of queries and keys.',
  },
  { id: 'chk2', paperId: 'paper-b', heading: 'Results', page: 9, score: 0.61, text: 'The BLEU scores improve consistently.' },
];

describe('buildContextPack', () => {
  it('缺省字段归一化（glossary/projectMemory 为空数组）', () => {
    const pack = buildContextPack({});
    expect(pack.glossary).toEqual([]);
    expect(pack.projectMemory).toEqual([]);
    expect(pack.relatedChunks).toEqual([]);
    expect(pack.outline).toBeUndefined();
  });

  it('字段原样透传', () => {
    const pack = buildContextPack({
      outline: '# 大纲',
      glossary,
      relatedChunks,
      venueRequirements: '8 页内',
      projectMemory: ['决定用 A 而非 B'],
      budgetUsd: 1.5,
    });
    expect(pack.outline).toBe('# 大纲');
    expect(pack.glossary).toHaveLength(2);
    expect(pack.budgetUsd).toBe(1.5);
  });
});

describe('renderContextPackMd', () => {
  const md = renderContextPackMd(
    buildContextPack({
      outline: '1. Introduction\n2. Method',
      glossary,
      style: {
        sentenceLenMean: 28.4,
        sentenceLenP90: 41,
        passiveRatio: 0.42,
        hedgingDensity: 9.2,
        notes: ['平均句长偏长（28.4 词），建议拆分长句。'],
      },
      relatedChunks,
      venueRequirements: 'NeurIPS：9 页正文，双栏，匿名提交',
      projectMemory: ['我们决定用 A 而非 B，因为延迟更低', '审稿人 2 反对“显然”这类措辞'],
      budgetUsd: 0.8,
    }),
  );

  it('包含全部固定章节', () => {
    for (const h of ['## 稿件结构', '## 术语表', '## 作者风格约束', '## 相关文献', '## 期刊要求', '## 项目记忆']) {
      expect(md).toContain(h);
    }
    expect(md.startsWith('# Context Pack')).toBe(true);
  });

  it('术语表为三列表格，含译名', () => {
    expect(md).toContain('| 术语 | 缩写 | 锁定译名 |');
    expect(md).toContain('| Convolutional Neural Network | CNN | 卷积神经网络 |');
    expect(md).toContain('| Mean Squared Error | MSE | 均方误差 |');
  });

  it('文献条目含 [citekey p.page] 引用格式，且可被引用守卫解析', () => {
    expect(md).toContain('[vaswani2017 p.3]');
    expect(md).toContain('3 Attention');
    const cites = extractCitations(md);
    expect(cites).toContainEqual({ citekey: 'vaswani2017', page: 3 });
    expect(cites).toContainEqual({ citekey: 'paper-b', page: 9 });
  });

  it('风格与项目记忆、预算', () => {
    expect(md).toContain('平均句长：28.4 词');
    expect(md).toContain('被动语态比例：42.0%');
    expect(md).toContain('- 我们决定用 A 而非 B，因为延迟更低');
    expect(md).toContain('$0.80');
  });

  it('空数据时渲染占位而非缺节', () => {
    const empty = renderContextPackMd(buildContextPack({}));
    expect(empty).toContain('（未提供大纲）');
    expect(empty).toContain('（暂无锁定术语）');
    expect(empty).toContain('（未检索到相关文献片段）');
    expect(empty).toContain('（暂无）');
  });
});
