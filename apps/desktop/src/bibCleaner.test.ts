/**
 * bibCleaner 测试：三类 issue 各形态 + 去重手术（保留字段多者 / 平手首条 /
 * 文本完整性）+ diffLineStats + 坏 bib 容错。覆盖验收：
 *  - duplicate：同 DOI / 同 arXiv ID / 标题归一化相同 → error + 合并建议；
 *  - missing-field：@article 缺 journal / 缺 year、缺 author、有 10.x DOI 缺 title；
 *  - inconsistent：同 DOI 大小写混用、citekey 风格混杂（并存超 3 条才提示）；
 *  - applyBibFixes：保留字段最多者、平手保留首个、整条删除且其余条目完好、
 *    无重复原样返回、坏 bib 不抛。
 */
import { describe, expect, it } from 'vitest';
import { analyzeBib, applyBibFixes, diffLineStats, type BibIssue } from './bibCleaner';

/** 便捷：按 kind 过滤 */
function issuesOf(bib: string, kind: BibIssue['kind']): BibIssue[] {
  return analyzeBib(bib).filter((i) => i.kind === kind);
}

const ARTICLE_FULL = `@article{key2017full,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish},
  journal = {Advances in Neural Information Processing Systems},
  year = {2017},
  doi = {10.5555/3294771.3295107}
}`;

// ---------------------------------------------------------------------------
// duplicate（error）
// ---------------------------------------------------------------------------

describe('analyzeBib · 重复检测', () => {
  it('同 DOI 两条 → 一个 error，keys 覆盖两条，suggestion 为合并建议', () => {
    const bib = `@article{a2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish},
  journal = {NeurIPS},
  year = {2017},
  doi = {10.5555/3294771.3295107}
}

@article{b2017dup,
  title = {Attention Is All You Need},
  author = {Vaswani, A.},
  journal = {NeurIPS},
  year = {2017},
  doi = {10.5555/3294771.3295107}
}`;
    const dups = issuesOf(bib, 'duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.severity).toBe('error');
    expect(dups[0]!.keys).toEqual(['a2017', 'b2017dup']);
    expect(dups[0]!.suggestion).toBe('合并为一条（建议保留字段更全的 key）');
    expect(dups[0]!.message).toContain('DOI');
  });

  it('DOI 的 doi.org 前缀剥除后再比较：裸 DOI 与 URL 形式判为同一条', () => {
    const bib = `@article{a, title = {T1 Long Title Here}, author = {X}, journal = {J}, year = {2020}, doi = {10.1234/abc.def}}
@article{b, title = {T2 Long Title Here}, author = {Y}, journal = {J}, year = {2020}, doi = {https://doi.org/10.1234/abc.def}}`;
    const dups = issuesOf(bib, 'duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.message).toContain('10.1234/abc.def');
  });

  it('同 arXiv ID（eprint + archivePrefix）两条 → error 且注明 arXiv 依据', () => {
    const bib = `@misc{arx1,
  title = {GPT-4 Technical Report},
  author = {{OpenAI}},
  year = {2023},
  eprint = {2303.08774},
  archivePrefix = {arXiv}
}

@misc{arx2,
  title = {GPT-4 Technical Report (Draft)},
  author = {{OpenAI}},
  year = {2023},
  eprint = {2303.08774},
  archivePrefix = {arXiv},
  primaryClass = {cs.CL}
}`;
    const dups = issuesOf(bib, 'duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.keys).toEqual(['arx1', 'arx2']);
    expect(dups[0]!.message).toContain('arXiv');
    expect(dups[0]!.message).toContain('2303.08774');
  });

  it('标题归一化相同（大小写 / 标点 / 空白差异）→ duplicate；无 DOI / arXiv 也能命中', () => {
    const bib = `@inproceedings{one,
  title = {Attention Is All You Need!},
  author = {Vaswani, Ashish},
  booktitle = {NeurIPS},
  year = {2017}
}

@inproceedings{two,
  title = "attention is all   you need",
  author = {V, A},
  booktitle = {NeurIPS},
  year = {2017}
}`;
    const dups = issuesOf(bib, 'duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.keys).toEqual(['one', 'two']);
    expect(dups[0]!.message).toContain('标题');
  });

  it('同组 DOI 与标题同时相同只报一次（不双报）', () => {
    const bib = `@article{p, title = {Same Long Title Here}, author = {A}, journal = {J}, year = {2020}, doi = {10.1/s}}
@article{q, title = {Same Long Title Here}, author = {B}, journal = {J}, year = {2020}, doi = {10.1/s}}`;
    expect(issuesOf(bib, 'duplicate')).toHaveLength(1);
  });

  it('标题互不相同且无标识符重叠 → 无 duplicate', () => {
    const bib = `@article{p, title = {First Long Title Here}, author = {A}, journal = {J}, year = {2020}, doi = {10.1/a}}
@article{q, title = {Second Long Title Here}, author = {B}, journal = {J}, year = {2020}, doi = {10.1/b}}`;
    expect(issuesOf(bib, 'duplicate')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// missing-field（warning）
// ---------------------------------------------------------------------------

describe('analyzeBib · 缺字段检测', () => {
  it('@article 缺 journal 与缺 year 分别各报一条 warning', () => {
    const bib = `@article{nojournal,
  title = {Some Long Enough Title},
  author = {Someone, A.},
  year = {2021}
}

@article{noyear,
  title = {Another Long Enough Title},
  author = {Someone, B.},
  journal = {Journal of Things}
}`;
    const missing = issuesOf(bib, 'missing-field');
    const messages = missing.map((m) => m.message);
    expect(missing.every((m) => m.severity === 'warning')).toBe(true);
    expect(messages.some((m) => m.includes('nojournal') && m.includes('journal'))).toBe(true);
    expect(messages.some((m) => m.includes('noyear') && m.includes('year'))).toBe(true);
    expect(missing.find((m) => m.message.includes('journal 字段'))!.keys).toEqual(['nojournal']);
    expect(missing.find((m) => m.message.includes('year 字段'))!.keys).toEqual(['noyear']);
  });

  it('条目缺 author → warning（@article 有 journal/year 也不豁免）', () => {
    const bib = `@article{noauthor,
  title = {Title Without An Author Field},
  journal = {Journal of Things},
  year = {2021}
}`;
    const missing = issuesOf(bib, 'missing-field');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain('author');
    expect(missing[0]!.keys).toEqual(['noauthor']);
  });

  it('有形如 10.xxxx 的 doi 但缺 title → warning 且 message 含该 DOI', () => {
    const bib = `@misc{dotitle,
  author = {Someone, A.},
  year = {2021},
  doi = {10.5555/12345678}
}`;
    const missing = issuesOf(bib, 'missing-field');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain('10.5555/12345678');
    expect(missing[0]!.message).toContain('title');
  });

  it('doi 值不像 10.xxxx（自由文本 doi）不触发缺 title 检查', () => {
    const bib = `@misc{weirddoi,
  author = {Someone, A.},
  year = {2021},
  doi = {not-a-doi}
}`;
    expect(issuesOf(bib, 'missing-field')).toHaveLength(0);
  });

  it('字段齐全的条目零缺字段 issue（完整 @article 样例）', () => {
    expect(issuesOf(ARTICLE_FULL, 'missing-field')).toHaveLength(0);
    expect(analyzeBib(ARTICLE_FULL)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// inconsistent（warning）
// ---------------------------------------------------------------------------

describe('analyzeBib · 不一致检测', () => {
  it('同一 DOI 大小写混用 → inconsistent warning，且不算 duplicate（判重区分大小写）', () => {
    const bib = `@article{c1, title = {Title Number One Long Enough}, author = {A}, journal = {J}, year = {2020}, doi = {10.1234/AbC.dE}}
@article{c2, title = {Title Number Two Long Enough}, author = {B}, journal = {J}, year = {2020}, doi = {10.1234/abc.DE}}`;
    const inconsistent = issuesOf(bib, 'inconsistent');
    expect(inconsistent).toHaveLength(1);
    expect(inconsistent[0]!.severity).toBe('warning');
    expect(inconsistent[0]!.message).toContain('10.1234/AbC.dE');
    expect(inconsistent[0]!.message).toContain('10.1234/abc.DE');
    expect(issuesOf(bib, 'duplicate')).toHaveLength(0);
  });

  it('citekey 风格混杂：camel 与 colon 并存且总数 > 3 → 提示', () => {
    const bib = [
      '@article{vaswani2017attention, title = {T1 Long Title Here}, author = {A}, journal = {J}, year = {2017}}',
      '@article{brown2020language, title = {T2 Long Title Here}, author = {B}, journal = {J}, year = {2020}}',
      '@article{smith2022method, title = {T3 Long Title Here}, author = {C}, journal = {J}, year = {2022}}',
      '@article{jones:2019:study, title = {T4 Long Title Here}, author = {D}, journal = {J}, year = {2019}}',
      '@article{lee:2021:survey, title = {T5 Long Title Here}, author = {E}, journal = {J}, year = {2021}}',
    ].join('\n\n');
    const inconsistent = issuesOf(bib, 'inconsistent');
    expect(inconsistent).toHaveLength(1);
    expect(inconsistent[0]!.message).toContain('camel');
    expect(inconsistent[0]!.message).toContain('colon');
    expect(inconsistent[0]!.keys).toContain('vaswani2017attention');
    expect(inconsistent[0]!.keys).toContain('lee:2021:survey');
  });

  it('混杂但总条目 ≤ 3 不提示（小文件不告警）', () => {
    const bib = [
      '@article{vaswani2017attention, title = {T1 Long Title Here}, author = {A}, journal = {J}, year = {2017}}',
      '@article{jones:2019:study, title = {T2 Long Title Here}, author = {D}, journal = {J}, year = {2019}}',
      '@article{brown2020language, title = {T3 Long Title Here}, author = {B}, journal = {J}, year = {2020}}',
    ].join('\n\n');
    expect(issuesOf(bib, 'inconsistent')).toHaveLength(0);
  });

  it('单一风格（全 camel，5 条）不提示', () => {
    const bib = Array.from({ length: 5 }, (_, i) =>
      `@article{k${i}2020x, title = {Title Number ${i} Long}, author = {A}, journal = {J}, year = {2020}}`,
    ).join('\n\n');
    expect(issuesOf(bib, 'inconsistent')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 容错与空态
// ---------------------------------------------------------------------------

describe('analyzeBib · 容错', () => {
  it('坏 bib（未闭合条目 / 乱码 @ / 无 citekey）不抛出，返回能定位部分的分析', () => {
    const bib = `garbage without any entry
@article{broken,
  title = {Unclosed Entry Title Long},
  author = {A},
@@ @@
@{nonsense}
@article{goodone, title = {A Good Entry With Title}, author = {B}, journal = {J}, year = {2020}}`;
    expect(() => analyzeBib(bib)).not.toThrow();
    // goodone 正常参与分析（缺 author 的坏块不影响）
    expect(analyzeBib(bib).some((i) => i.keys.includes('goodone'))).toBe(false);
  });

  it('空字符串与纯注释文本 → 空数组', () => {
    expect(analyzeBib('')).toEqual([]);
    expect(analyzeBib('% just a comment\n\nnothing here')).toEqual([]);
  });

  it('@string / @comment / @preamble 块不作为条目参与（不报缺 author）', () => {
    const bib = `@string{acm = {Association for Computing Machinery}}
@comment{this is ignored}
@preamble{"\\usepackage{}"}
@article{real1, title = {Real Long Title One}, author = {A}, journal = {J}, year = {2020}}`;
    const missing = issuesOf(bib, 'missing-field');
    expect(missing).toHaveLength(0);
  });

  it('圆括号定界条目（@article(...)）同样可分析', () => {
    const bib = `@article(paren1,
  title = {Parenthesized Long Title},
  author = {A},
  journal = {J (Journal)},
  year = {2020},
  doi = {10.1/x}
)

@article(paren2,
  title = {Parenthesized Long Title},
  author = {B},
  journal = {J (Journal)},
  year = {2020},
  doi = {10.1/x}
)`;
    const dups = issuesOf(bib, 'duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.keys).toEqual(['paren1', 'paren2']);
  });
});

// ---------------------------------------------------------------------------
// applyBibFixes（去重手术）
// ---------------------------------------------------------------------------

describe('applyBibFixes · 去重手术', () => {
  const BIB = `@article{thin,
  title = {Attention Is All You Need},
  author = {V, A},
  doi = {10.5555/3294771.3295107}
}

@article{full,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  journal = {NeurIPS},
  year = {2017},
  pages = {5998--6008},
  doi = {10.5555/3294771.3295107}
}

@article{keepme,
  title = {An Unrelated Study},
  author = {Other, Author},
  journal = {Journal of Things},
  year = {2021}
}`;

  it('保留字段数最多的条目，删除其余；removed 列出被删 key', () => {
    const { text, removed } = applyBibFixes(BIB, 'dedupe-keep-fuller');
    expect(removed).toEqual(['thin']);
    expect(text).toContain('@article{full,');
    expect(text).not.toContain('thin');
    // 无关条目原样保留
    expect(text).toContain('@article{keepme,');
    expect(text).toContain('An Unrelated Study');
  });

  it('删除后条目间空行不翻倍（保留一个空行分隔）', () => {
    const { text } = applyBibFixes(BIB, 'dedupe-keep-fuller');
    expect(text).not.toMatch(/\n\n\n/);
    expect(text.trim().split('\n\n')).toHaveLength(2); // full 与 keepme 两块
  });

  it('平手（字段数相同）保留首个', () => {
    const bib = `@article{first,
  title = {Same Long Title Here},
  author = {A},
  journal = {J},
  year = {2020}
}

@article{second,
  title = {Same Long Title Here},
  author = {B},
  journal = {J2},
  year = {2021}
}`;
    const { text, removed } = applyBibFixes(bib, 'dedupe-keep-fuller');
    expect(removed).toEqual(['second']);
    expect(text).toContain('@article{first,');
    expect(text).not.toContain('second');
  });

  it('文件头部条目被删时结果不以空行开头', () => {
    const bib = `@article{dupA, title = {Head Long Title Here}, author = {A}, journal = {J}, year = {2020}, doi = {10.1/z}}

@article{dupB, title = {Head Long Title Here}, author = {B}, journal = {J}, year = {2020}, doi = {10.1/z}, pages = {1--2}}

@article{tail, title = {Tail Long Title Here}, author = {C}, journal = {J}, year = {2022}}`;
    const { text, removed } = applyBibFixes(bib, 'dedupe-keep-fuller');
    expect(removed).toEqual(['dupA']);
    expect(text.startsWith('@article{dupB,')).toBe(true);
  });

  it('无重复 → 原文原样返回、removed 为空', () => {
    const clean = `${ARTICLE_FULL}\n\n@article{other, title = {Another Title Long}, author = {B}, journal = {J2}, year = {2019}}`;
    const { text, removed } = applyBibFixes(clean, 'dedupe-keep-fuller');
    expect(removed).toEqual([]);
    expect(text).toBe(clean);
  });

  it('三组不同依据的重复可一次全部清除（DOI / arXiv / 标题）', () => {
    const bib = `@article{d1, title = {Doi Title Long Enough}, author = {A}, journal = {J}, year = {2020}, doi = {10.9/q}}
@article{d2, title = {Doi Title Second Variant}, author = {B}, journal = {J}, year = {2020}, doi = {10.9/q}, pages = {1}}

@misc{x1, title = {Arxiv Title Long Enough}, author = {C}, year = {2023}, eprint = {2303.08774}, archivePrefix = {arXiv}}
@misc{x2, title = {Arxiv Title Second Variant}, author = {D}, year = {2023}, eprint = {2303.08774}, archivePrefix = {arXiv}, primaryClass = {cs.CL}}

@book{t1, title = {Title Only Long Enough}, author = {E}, publisher = {P}, year = {2018}}
@book{t2, title = {Title Only Long Enough!!}, author = {F}, publisher = {P}, year = {2018}, edition = {2}}`;
    const { text, removed } = applyBibFixes(bib, 'dedupe-keep-fuller');
    expect(removed).toEqual(['d1', 'x1', 't1']);
    for (const key of ['d2', 'x2', 't2']) expect(text).toContain(`{${key},`);
    for (const key of removed) expect(text).not.toContain(`{${key},`);
  });

  it('大小写不一致的 DOI 不是判重依据（去重不动它）', () => {
    const bib = `@article{u1, title = {Case Title Long Enough}, author = {A}, journal = {J}, year = {2020}, doi = {10.7/Aa}}
@article{u2, title = {Case Title Second Variant}, author = {B}, journal = {J}, year = {2020}, doi = {10.7/aa}}`;
    const { text, removed } = applyBibFixes(bib, 'dedupe-keep-fuller');
    expect(removed).toEqual([]);
    expect(text).toBe(bib);
  });

  it('坏 bib 不抛出（未闭合块原样保留）', () => {
    const bib = `@article{broken,
  title = {Unclosed Things},
  author = {A}
@article{ok, title = {Closed Things Long}, author = {B}, journal = {J}, year = {2020}}`;
    expect(() => applyBibFixes(bib, 'dedupe-keep-fuller')).not.toThrow();
    expect(applyBibFixes(bib, 'dedupe-keep-fuller').text).toBe(bib);
  });
});

// ---------------------------------------------------------------------------
// diffLineStats
// ---------------------------------------------------------------------------

describe('diffLineStats · 行级统计', () => {
  it('纯删除：removed = 删除行数、added = 0', () => {
    const oldText = 'a\nb\nc\nd';
    const newText = 'a\nc\nd';
    expect(diffLineStats(oldText, newText)).toEqual({ added: 0, removed: 1 });
  });

  it('重复行按多重集计数（同名行删两条计 2）', () => {
    const oldText = 'x\nx\nx\ny';
    const newText = 'x\ny';
    expect(diffLineStats(oldText, newText)).toEqual({ added: 0, removed: 2 });
  });

  it('增删并存与全等', () => {
    expect(diffLineStats('a\nb', 'a\nc')).toEqual({ added: 1, removed: 1 });
    expect(diffLineStats('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });
});
