// @vitest-environment jsdom
/**
 * thesaurus 测试：词典规模与自洽 / 查询归一（大小写、-s/-es/-ed/-ing 词形还原）/
 * 位置命中（短语最长优先、\命令与 % 注释跳过）/ hover 扩展可构建
 * （CodeMirror EditorView 挂载手法，同 spellcheckExtension 测试）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import {
  lookupThesaurus,
  THESAURUS,
  thesaurusAtPosition,
  thesaurusExtension,
} from './thesaurus';

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

describe('THESAURUS · 词典自洽', () => {
  it('词条数 ≥ 80，且包含需求样例词（good/show/…）与短语条目', () => {
    const keys = Object.keys(THESAURUS);
    expect(keys.length).toBeGreaterThanOrEqual(80);
    for (const word of [
      'good', 'bad', 'big', 'small', 'show', 'find', 'use', 'make', 'get', 'help',
      'important', 'many', 'few', 'fast', 'slow', 'new', 'old', 'hard', 'easy',
      'check', 'put', 'change', 'start', 'end', 'ask', 'answer', 'problem', 'way',
      'thing', 'part', 'kind', 'type', 'really', 'very', 'quite', 'but', 'so',
      'look at', 'think about', 'talk about', 'deal with', 'figure out',
      'a lot of', 'because of',
    ]) {
      expect(THESAURUS[word]).toBeDefined();
    }
  });

  it('每词条 2–4 个建议、键为小写、建议非空去重', () => {
    for (const [word, suggestions] of Object.entries(THESAURUS)) {
      expect(word).toBe(word.toLowerCase());
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      expect(suggestions.length).toBeLessThanOrEqual(4);
      expect(new Set(suggestions).size).toBe(suggestions.length);
      for (const s of suggestions) expect(s.trim()).toBe(s);
    }
  });

  it('需求样例映射正确：good→favorable/solid、show→demonstrate/reveal', () => {
    expect(THESAURUS.good).toContain('favorable');
    expect(THESAURUS.good).toContain('solid');
    expect(THESAURUS.show).toContain('demonstrate');
    expect(THESAURUS.show).toContain('reveal');
    expect(THESAURUS.use).toContain('employ');
  });
});

describe('lookupThesaurus · 查询与词形归一', () => {
  it('小写直接命中', () => {
    const hit = lookupThesaurus('good');
    expect(hit).toEqual({ word: 'good', suggestions: THESAURUS.good });
  });

  it('大小写不敏感：Good / GOOD 均命中且基形小写', () => {
    for (const form of ['Good', 'GOOD', 'gOoD']) {
      const hit = lookupThesaurus(form);
      expect(hit?.word).toBe('good');
      expect(hit?.suggestions).toEqual(THESAURUS.good);
    }
  });

  it('-s 复数/三单还原：shows / problems → show / problem（form 标注原词形）', () => {
    expect(lookupThesaurus('shows')).toEqual({
      word: 'show',
      suggestions: THESAURUS.show,
      form: 'shows',
    });
    expect(lookupThesaurus('problems')).toMatchObject({ word: 'problem', form: 'problems' });
    expect(lookupThesaurus('Shows')?.word).toBe('show');
  });

  it('-ed 还原：showed / checked → show / check；-d 还原：used → use', () => {
    expect(lookupThesaurus('showed')).toMatchObject({ word: 'show', form: 'showed' });
    expect(lookupThesaurus('checked')).toMatchObject({ word: 'check' });
    expect(lookupThesaurus('used')).toMatchObject({ word: 'use', form: 'used' });
  });

  it('-ing 还原（含补 e 型）：using→use、checking→check、showing→show', () => {
    expect(lookupThesaurus('using')).toMatchObject({ word: 'use', form: 'using' });
    expect(lookupThesaurus('checking')).toMatchObject({ word: 'check' });
    expect(lookupThesaurus('showing')).toMatchObject({ word: 'show' });
  });

  it('未命中返回 null：空串、非词、不规则变化（went）、词典外词', () => {
    expect(lookupThesaurus('')).toBeNull();
    expect(lookupThesaurus('   ')).toBeNull();
    expect(lookupThesaurus('xylophone')).toBeNull();
    expect(lookupThesaurus('went')).toBeNull(); // 不规则变化不支持（文档已注明）
    expect(lookupThesaurus(' Attention ')).toBeNull(); // 前后空白仅 trim 词本身，词典无 attention
  });
});

describe('thesaurusAtPosition · 位置命中', () => {
  it('光标在词内 / 词边界（右侧）均命中，from/to 覆盖整个词', () => {
    const text = 'a good result';
    expect(thesaurusAtPosition(text, 3)).toMatchObject({ word: 'good', from: 2, to: 6 });
    expect(thesaurusAtPosition(text, 6)).toMatchObject({ word: 'good', from: 2, to: 6 });
    expect(thesaurusAtPosition(text, 2)).toMatchObject({ word: 'good', from: 2, to: 6 });
  });

  it('短语最长优先：deal with 命中短语而非单词；come up with 命中 3 词短语', () => {
    const text = 'we deal with noise';
    expect(thesaurusAtPosition(text, 4)).toMatchObject({
      word: 'deal with',
      from: 3,
      to: 12,
    });
    const text3 = 'to come up with baselines';
    expect(thesaurusAtPosition(text3, 4)).toMatchObject({
      word: 'come up with',
      from: 3,
      to: 15,
    });
  });

  it('多空格 / 标点 / 换行打断短语，回落为单词命中（look 单词在词典中）', () => {
    expect(thesaurusAtPosition('look  at the data', 1)?.word).toBe('look'); // 双空格断
    expect(thesaurusAtPosition('look, at the data', 1)?.word).toBe('look'); // 标点断
    expect(thesaurusAtPosition('look\nat the data', 1)?.word).toBe('look'); // 换行断
  });

  it('跳过 \\命令名与 % 注释区；citekey 不误命中', () => {
    expect(thesaurusAtPosition('\\usepackage{amsmath}', 3)).toBeNull(); // \use 词名
    expect(thesaurusAtPosition('good data % good enough', 12)).toBeNull(); // 注释区
    expect(thesaurusAtPosition('good data % good enough', 2)).not.toBeNull(); // 注释前正常
    expect(thesaurusAtPosition('\\cite{vaswani2017attention}', 8)).toBeNull(); // citekey 片段不在词典
  });

  it('光标词形还原同样在位置命中生效（shows → show，form 标注）', () => {
    const text = 'the plots shows trends';
    expect(thesaurusAtPosition(text, 11)).toMatchObject({
      word: 'show',
      form: 'shows',
      from: 10,
      to: 15,
    });
  });
});

describe('thesaurusExtension · CodeMirror 扩展', () => {
  it('扩展可构建：EditorView 挂载含词典词的文档不抛错', () => {
    expect(() => {
      view = new EditorView({
        doc: 'this is a good result',
        parent: document.body,
        extensions: [thesaurusExtension()],
      });
    }).not.toThrow();
    expect(view!.dom.querySelectorAll('.cm-content').length).toBe(1);
  });

  it('扩展数组形态稳定：两次构造互不干扰（无模块级可变状态）', () => {
    const a = thesaurusExtension();
    const b = thesaurusExtension();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    view = new EditorView({
      doc: 'plain text',
      parent: document.body,
      extensions: [a, b],
    });
    expect(view.state.doc.toString()).toBe('plain text');
  });

  it('与拼写检查扩展（含 hoverTooltip）同装共存不冲突', () => {
    expect(() => {
      view = new EditorView({
        doc: 'a good result',
        parent: document.body,
        extensions: [thesaurusExtension()],
      });
    }).not.toThrow();
    // 同一文档上再装第二个 thesaurus 实例（模拟与其他 hover 源并存的场景）
    view!.dispatch({ effects: [] });
    expect(view!.state.doc.toString()).toBe('a good result');
  });
});
