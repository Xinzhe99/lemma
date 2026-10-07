/**
 * reviewsImport 纯函数测试：审稿人分段（多格式）、编号拆条、小节头 type 映射、
 * 无编号段落降级、噪音剔除、页眉页脚去重、编号重整、多文件合并、W7 输入格式、
 * docx 提取（zipSync 造 fixture）、错误分支。
 */
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  extractDocxText,
  parseReviewsFiles,
  parseReviewsText,
  reviewerNumberFromFileName,
  renumberReviews,
  reviewsToWorkflowInput,
} from './reviewsImport';

/** 取第 n 位审稿人的第 k 条（1 基） */
function item(reviews: ReturnType<typeof parseReviewsText>, n: number, k: number): string {
  return reviews[n - 1]!.items[k - 1]!.text;
}

describe('parseReviewsText · 审稿人分段', () => {
  it('空输入与纯空白返回 []', () => {
    expect(parseReviewsText('')).toEqual([]);
    expect(parseReviewsText('   \n \t \n')).toEqual([]);
  });

  it('纯编辑信套话（噪音）后无内容返回 []', () => {
    expect(
      parseReviewsText('Dear Author,\nThank you for submitting your manuscript.\nSincerely,\nThe Editors'),
    ).toEqual([]);
  });

  it('英文多审稿人常见格式（Reviewer #1 / Reviewer 2: / === Reviewer 3 ===）', () => {
    const text = [
      'Reviewer #1',
      '1. Intro too long.',
      'Reviewer 2:',
      '1) Missing baselines.',
      '=== Reviewer 3 ===',
      '(1) Figure 3 unreadable.',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r.map((x) => x.reviewer)).toEqual(['Reviewer 1', 'Reviewer 2', 'Reviewer 3']);
    expect(item(r, 1, 1)).toBe('Intro too long.');
    expect(item(r, 2, 1)).toBe('Missing baselines.');
    expect(item(r, 3, 1)).toBe('Figure 3 unreadable.');
  });

  it('中文审稿人分段（审稿人1： / 审稿人 2 意见：）', () => {
    const text = ['审稿人1：', '1、创新性不足。', '审稿人 2 意见：', '2、实验不充分。'].join('\n');
    const r = parseReviewsText(text);
    expect(r.map((x) => x.reviewer)).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(item(r, 1, 1)).toBe('创新性不足。');
    expect(item(r, 2, 1)).toBe('实验不充分。');
  });

  it('R1: / R2: 前缀分段，但 R1.1 条目编号不会被误判为审稿人', () => {
    const text = ['R1: Weak methods.', 'R1.1 No comparison.', 'R2: Writing issues.'].join('\n');
    const r = parseReviewsText(text);
    // R1: 是分隔头，其正文 "Weak methods." 成为首条；R1.1 是条目
    expect(r).toHaveLength(2);
    expect(item(r, 1, 1)).toBe('Weak methods.');
    expect(item(r, 1, 2)).toBe('No comparison.');
    expect(item(r, 2, 1)).toBe('Writing issues.');
  });

  it('无分隔符时整体作为一个 Reviewer 1', () => {
    const r = parseReviewsText('1. Weak motivation.\n2. No ablation.');
    expect(r).toHaveLength(1);
    expect(r[0]!.reviewer).toBe('Reviewer 1');
    expect(r[0]!.items.map((i) => i.id)).toEqual(['R1.1', 'R1.2']);
  });

  it('叙述行 "Reviewer 2 said…" 不触发分段', () => {
    const r = parseReviewsText('The paper is fine.\nReviewer 2 said the figures are poor.');
    expect(r).toHaveLength(1);
    expect(r[0]!.items).toHaveLength(1);
  });
});

describe('parseReviewsText · 逐条拆分', () => {
  it('编号形态：1. / 1) / (1) / R1.1 / W1.2 / Comment 1: / 意见1：', () => {
    const text = [
      'Reviewer 1',
      '1. First point.',
      '2) Second point.',
      '(3) Third point.',
      'R1.4 Fourth.',
      'W1.5 Fifth.',
      'Comment 6: Sixth.',
      '意见7：第七条。',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(7);
    expect(r[0]!.items.map((i) => i.id)).toEqual([
      'R1.1',
      'R1.2',
      'R1.3',
      'R1.4',
      'R1.5',
      'R1.6',
      'R1.7',
    ]);
    expect(item(r, 1, 4)).toBe('Fourth.');
    expect(item(r, 1, 7)).toBe('第七条。');
  });

  it('编号条目的续行软换行合并，且不会被小数（1.5 spacing）误拆', () => {
    const text = ['1. The evaluation is weak:', 'only one dataset is used.', '1.5 line spacing is odd.'].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(1);
    expect(r[0]!.items[0]!.text).toContain('only one dataset is used.');
    expect(r[0]!.items[0]!.text).toContain('1.5 line spacing is odd.');
  });

  it('小节头切换 type：Weaknesses→weakness / Questions→question / Minor→minor / Comments→comment', () => {
    const text = [
      'Reviewer 1',
      'Summary:',
      'The paper studies X.',
      'Weaknesses:',
      '1. No baselines.',
      'Questions:',
      '1. Why dataset Y?',
      'Minor:',
      '1. Typos in Sec 2.',
      'Comments:',
      '1. Overall fine.',
    ].join('\n');
    const r = parseReviewsText(text);
    const byText = Object.fromEntries(r[0]!.items.map((i) => [i.text, i.type]));
    expect(byText['The paper studies X.']).toBe('comment'); // Summary 落在 comment 小节
    expect(byText['No baselines.']).toBe('weakness');
    expect(byText['Why dataset Y?']).toBe('question');
    expect(byText['Typos in Sec 2.']).toBe('minor');
    expect(byText['Overall fine.']).toBe('comment');
  });

  it('小节头本身不产生条目（含 ## Weaknesses / **缺点** / 中文小节头）', () => {
    const text = [
      'Reviewer 1',
      '## Weaknesses',
      '1、方法没有对比。',
      '**缺点**',
      '1、创新性不足。',
      '**问题**',
      '1、数据来源？',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items.map((i) => i.type)).toEqual(['weakness', 'weakness', 'question']);
    expect(r[0]!.items.map((i) => i.text)).toEqual(['方法没有对比。', '创新性不足。', '数据来源？']);
  });

  it('中文数字编号（一、/ 二：）也算条目编号', () => {
    const r = parseReviewsText('一、总体评价：本文扎实。\n二、实验需要补充消融。');
    expect(r[0]!.items.map((i) => i.text)).toEqual(['总体评价：本文扎实。', '实验需要补充消融。']);
    expect(r[0]!.items.map((i) => i.id)).toEqual(['R1.1', 'R1.2']);
  });

  it('行内式小节头（Weaknesses: 1) xxx）同时切换 type 并保留条目', () => {
    const text = ['Weaknesses: 1) Few experiments.', 'Questions: 2) Why Z?'].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(2);
    expect(r[0]!.items[0]!.type).toBe('weakness');
    expect(r[0]!.items[1]!.type).toBe('question');
  });

  it('无编号降级：空行分界的语义段落成条，连续短行合并为一段', () => {
    const text = [
      'Reviewer 1',
      'The motivation is unclear',
      'and the contribution is thin.',
      '',
      'Experiments only cover',
      'one small dataset.',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(2);
    expect(r[0]!.items[0]!.text).toBe('The motivation is unclear and the contribution is thin.');
    expect(r[0]!.items[1]!.text).toBe('Experiments only cover one small dataset.');
  });

  it('列表符号行（- / •）各成一条，其后无符号行并入该条', () => {
    const text = ['Reviewer 1', '- first bullet', '  continued', '• second bullet'].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items.map((i) => i.text)).toEqual(['first bullet continued', 'second bullet']);
  });
});

describe('parseReviewsText · 噪音与去重', () => {
  it('剔除编辑信套话（Dear Author / 感谢投稿 / 此致敬礼），保留正文', () => {
    const text = [
      'Dear Author,',
      'Thank you for submitting your manuscript to JSB.',
      '尊敬的作者：感谢您投稿。',
      'Reviewer 1',
      '1. Good work but weak experiments.',
      'Sincerely,',
      'The Editors',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(1);
    expect(r[0]!.items[0]!.text).toContain('weak experiments');
    expect(r[0]!.raw).not.toContain('Dear Author');
  });

  it('页眉页脚重复行（数字归一后相同，出现 ≥3 次）整类去重', () => {
    const text = [
      'Manuscript M-2024-77 · Page 1 of 6',
      'Reviewer 1',
      '1. First.',
      'Manuscript M-2024-77 · Page 2 of 6',
      '2. Second.',
      'Manuscript M-2024-77 · Page 3 of 6',
      '3. Third.',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(3);
    expect(r[0]!.raw).not.toContain('Page 1 of 6');
  });

  it('短行（<6 字符）与只出现一次的行不受去重影响', () => {
    const text = ['Reviewer 1', '1. OK.', '2. Fine too.'].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(2);
  });
});

describe('parseReviewsText · 编号重整', () => {
  it('原文编号乱序/重复时输出仍为 R{n}.1..k 连续编号', () => {
    const text = ['Reviewer 1', '3. Third labelled first.', '1. First labelled second.', '7. Seven.'].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items.map((i) => i.id)).toEqual(['R1.1', 'R1.2', 'R1.3']);
  });

  it('显式分隔头编号重复（两个 Reviewer 1）时按顺序重编号', () => {
    const text = ['Reviewer 1', '1. A.', 'Reviewer 1', '1. B.'].join('\n');
    const r = parseReviewsText(text);
    expect(r.map((x) => x.reviewer)).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(r[1]!.items[0]!.id).toBe('R2.1');
  });

  it('保留原文编号缺口（Reviewer 1 + Reviewer 3 不压缩）', () => {
    const text = ['Reviewer 1', '1. A.', 'Reviewer 3', '1. B.'].join('\n');
    const r = parseReviewsText(text);
    expect(r.map((x) => x.reviewer)).toEqual(['Reviewer 1', 'Reviewer 3']);
    expect(r[1]!.items[0]!.id).toBe('R3.1');
  });
});

describe('parseReviewsText · 中文与混合', () => {
  it('纯中文审稿意见：中文编号、中文小节头、全角符号', () => {
    const text = [
      '审稿人1',
      '一、总体评价：本文研究了……', // 无匹配小节头 → 段落条目
      '主要问题：',
      '1、实验对比不足。',
      '2、创新点描述不清。',
      '小修：',
      '（1）图3字体过小。',
    ].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items).toHaveLength(4);
    const minor = r[0]!.items.find((i) => i.text.includes('图3'))!;
    expect(minor.type).toBe('minor');
    expect(minor.id).toBe('R1.4');
  });

  it('混合中英：英文小节头 + 中文条目正文', () => {
    const text = ['Reviewer 2', 'Weaknesses:', '1. 对比实验缺少 SOTA 方法。', 'Questions:', '1. 为何不报告 std?'].join('\n');
    const r = parseReviewsText(text);
    expect(r[0]!.items[0]!.type).toBe('weakness');
    expect(r[0]!.items[1]!.type).toBe('question');
    expect(r[0]!.items[1]!.text).toContain('std?');
  });
});

describe('reviewsToWorkflowInput', () => {
  it('拼成【Reviewer N】+ R{n}.{k}: 一行一条，审稿人之间空行分隔', () => {
    const reviews = parseReviewsText(
      ['Reviewer 1', '1. First.', '2. Second.', 'Reviewer 2', '1. Other.'].join('\n'),
    );
    const out = reviewsToWorkflowInput(reviews);
    expect(out).toBe(
      ['【Reviewer 1】', 'R1.1: First.', 'R1.2: Second.', '', '【Reviewer 2】', 'R2.1: Other.'].join('\n'),
    );
  });

  it('条目内换行折叠为空格；空条目/空审稿人/空数组返回空串', () => {
    const reviews = parseReviewsText('1. Multi\nline item.');
    expect(reviewsToWorkflowInput(reviews)).toBe('【Reviewer 1】\nR1.1: Multi line item.');
    expect(reviewsToWorkflowInput([])).toBe('');
    expect(reviewsToWorkflowInput([{ reviewer: 'Reviewer 9', items: [], raw: '' }])).toBe('');
    expect(
      reviewsToWorkflowInput([
        { reviewer: 'Reviewer 1', items: [{ id: 'R1.1', text: '   ' }], raw: '' },
      ]),
    ).toBe('');
  });
});

describe('多文件合并与重编号', () => {
  it('renumberReviews 按顺序重编（名字与条目 id 一并重整）', () => {
    const reviews = parseReviewsText(['Reviewer 5', '1. A.', 'Reviewer 9', '1. B.', '2. C.'].join('\n'));
    const out = renumberReviews(reviews);
    expect(out.map((r) => r.reviewer)).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(out[1]!.items.map((i) => i.id)).toEqual(['R2.1', 'R2.2']);
  });

  it('reviewerNumberFromFileName 识别 reviewer2.txt / R3.pdf / 审稿人_4.docx', () => {
    expect(reviewerNumberFromFileName('reviewer2.txt')).toBe(2);
    expect(reviewerNumberFromFileName('Reviewer_3.docx')).toBe(3);
    expect(reviewerNumberFromFileName('r5.pdf')).toBe(5);
    expect(reviewerNumberFromFileName('审稿人4.pdf')).toBe(4);
    expect(reviewerNumberFromFileName('reviews.pdf')).toBeNull();
    expect(reviewerNumberFromFileName('2024-10-reviews.pdf')).toBeNull();
  });

  it('词中的 r+数字不算审稿人编号（v7.8.0 修复：chapter2 / paper2_comments 曾被当成审稿人 2）', () => {
    expect(reviewerNumberFromFileName('chapter2.txt')).toBeNull();
    expect(reviewerNumberFromFileName('paper2_comments.docx')).toBeNull();
    expect(reviewerNumberFromFileName('author2_response.pdf')).toBeNull();
    // R1 形式的独立缩写仍识别
    expect(reviewerNumberFromFileName('R2.pdf')).toBe(2);
    expect(reviewerNumberFromFileName('referee report 3.docx')).toBeNull(); // 数字未紧跟标识词

    // 端到端：文件名不再把整份意见挂到错误的审稿人名下
    const out = parseReviewsFiles([{ name: 'chapter2.txt', text: '1. Weak motivation.' }]);
    expect(out.map((r) => r.reviewer)).toEqual(['Reviewer 1']);
    expect(out[0]!.items[0]!.id).toBe('R1.1');
  });

  it('一人一文件：单审稿人文件按文件名数字命名并重整条目编号', () => {
    const out = parseReviewsFiles([
      { name: 'reviewer1.txt', text: '1. A1.\n2. A2.' },
      { name: 'reviewer2.txt', text: '1. B1.' },
    ]);
    expect(out.map((r) => r.reviewer)).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(out[1]!.items[0]!.id).toBe('R2.1');
    expect(out[0]!.items.map((i) => i.text)).toEqual(['A1.', 'A2.']);
  });

  it('无名文件冲突时按文件顺序重编号；文件内多审稿人保持原编号', () => {
    const out = parseReviewsFiles([
      { name: 'a.txt', text: '1. A.' },
      { name: 'b.txt', text: '1. B.' }, // 两个都默认 Reviewer 1 → 冲突重编
    ]);
    expect(out.map((r) => r.reviewer)).toEqual(['Reviewer 1', 'Reviewer 2']);

    const multi = parseReviewsFiles([
      { name: 'all.txt', text: 'Reviewer 2\n1. X.\nReviewer 3\n1. Y.' },
      { name: 'reviewer4.txt', text: '1. Z.' },
    ]);
    expect(multi.map((r) => r.reviewer)).toEqual(['Reviewer 2', 'Reviewer 3', 'Reviewer 4']);
  });

  it('空文本文件被跳过', () => {
    expect(parseReviewsFiles([{ name: 'a.txt', text: '' }])).toEqual([]);
  });
});

describe('extractDocxText（最小 docx 提取器）', () => {
  /** 构造最小 docx zip fixture（只需 word/document.xml 即可提取） */
  function makeDocx(paragraphs: string[]): ArrayBuffer {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs
        .map(
          (p) =>
            `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`,
        )
        .join('') +
      '</w:body></w:document>';
    const zipped = zipSync({ 'word/document.xml': strToU8(xml) });
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  }

  it('提取段落文本，段落间换行', () => {
    const text = extractDocxText(makeDocx(['Reviewer 1', '1. Intro too long.', '2. No baselines.']));
    expect(text.split('\n')).toEqual(['Reviewer 1', '1. Intro too long.', '2. No baselines.']);
  });

  it('<w:br/> 换行、<w:tab/> 制表、XML 实体解码', () => {
    const xml =
      '<w:document xmlns:w="http://x"><w:body>' +
      '<w:p><w:r><w:t>A &amp; B &lt;C&gt;</w:t></w:r><w:br/><w:r><w:t>line2</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>col1</w:t><w:tab/><w:t>col2</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const zipped = zipSync({ 'word/document.xml': strToU8(xml) });
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    const text = extractDocxText(buf);
    expect(text).toBe('A & B <C>\nline2\ncol1\tcol2');
  });

  it('提取结果可直接进入 parseReviewsText 拆条', () => {
    const text = extractDocxText(makeDocx(['Reviewer 2', 'Weaknesses:', '1. 没有对比实验。']));
    const r = parseReviewsText(text);
    expect(r[0]!.reviewer).toBe('Reviewer 2');
    expect(r[0]!.items[0]!.type).toBe('weakness');
    expect(r[0]!.items[0]!.text).toBe('没有对比实验。');
  });

  it('非 zip 内容抛中文错误', () => {
    const garbage = strToU8('this is definitely not a zip file');
    const buf = garbage.buffer.slice(garbage.byteOffset, garbage.byteOffset + garbage.byteLength) as ArrayBuffer;
    expect(() => extractDocxText(buf)).toThrow(/docx/);
  });

  it('zip 内缺 word/document.xml 抛中文错误', () => {
    const zipped = zipSync({ 'hello.txt': strToU8('hi') });
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    expect(() => extractDocxText(buf)).toThrow(/word\/document\.xml/);
  });
});
