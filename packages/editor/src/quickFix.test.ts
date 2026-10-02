// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { checkText, spellcheckExtension } from './spellcheck';
import { thesaurusExtension } from './thesaurus';
import {
  applyQuickFix,
  buildFixOptions,
  clearIgnoredWords,
  getIgnoredWords,
  ignoreWord,
  isWordIgnored,
  quickFixExtension,
  quickFixPanelAt,
} from './quickFix';

let view: EditorView | null = null;
beforeEach(() => {
  clearIgnoredWords(); // 会话级忽略集合是模块单例，逐用例隔离
});
afterEach(() => {
  view?.destroy();
  view = null;
});

/** 便捷：以最小 issue 形态调 buildFixOptions */
function options(suggestion: string, word = 'xxx'): string[] {
  return buildFixOptions({ word, suggestion, kind: 'misspelling' });
}

// ---------------------------------------------------------------------------
// buildFixOptions：候选解析（纯函数）
// ---------------------------------------------------------------------------

describe('buildFixOptions：候选解析', () => {
  it('单一候选直通（拼写表形态 suggestion）', () => {
    expect(options('receive', 'recieve')).toEqual(['receive']);
    expect(options('most people', 'most of people')).toEqual(['most people']);
  });

  it('斜杠分隔多候选：带空格 / 紧写均可，短语候选保留词序', () => {
    expect(options('critical / essential', 'very important')).toEqual(['critical', 'essential']);
    expect(options('favorable/solid/satisfactory', 'good')).toEqual([
      'favorable',
      'solid',
      'satisfactory',
    ]);
    expect(options('can / be able to', 'can be able to')).toEqual(['can', 'be able to']);
  });

  it('逗号类分隔：半角逗号 / 全角逗号 / 顿号', () => {
    expect(options('favorable, solid，satisfactory、robust', 'good')).toEqual([
      'favorable',
      'solid',
      'satisfactory',
      'robust',
    ]);
  });

  it('含说明性文字的 suggestion（中文 hint 混合）：只提取拉丁词候选', () => {
    expect(options('改为 receive 更好', 'recieve')).toEqual(['receive']);
    expect(options('increasingly（渐增地）', 'more and more')).toEqual(['increasingly']);
  });

  it('模板占位（… / ...）非具体候选：所在 token 整体跳过', () => {
    expect(options('as … advances / with advances in', 'with the development of')).toEqual([
      'with advances in',
    ]);
    expect(options('these two / these several / …', 'this two')).toEqual([
      'these two',
      'these several',
    ]);
    expect(options('first... or second', 'x')).toEqual([]); // ASCII 省略号占位同样整体跳过
  });

  it('空候选：空串 / 纯占位 / 纯中文说明均返回 []', () => {
    expect(options('', 'recieve')).toEqual([]);
    expect(options('…', 'this two')).toEqual([]);
    expect(options('请人工修改后再替换', 'x')).toEqual([]);
  });

  it('与原词相同（大小写归一）或彼此重复的候选排除', () => {
    expect(options('receive / Receive', 'recieve')).toEqual(['receive']);
    expect(options('discuss / address', 'discuss')).toEqual(['address']); // 原词自指不产出
  });
});

// ---------------------------------------------------------------------------
// 忽略集合（会话级）
// ---------------------------------------------------------------------------

describe('忽略集合（会话级）', () => {
  it('ignoreWord / getIgnoredWords / isWordIgnored：大小写与多空白归一', () => {
    ignoreWord('Recieve');
    expect(isWordIgnored('recieve')).toBe(true);
    expect(isWordIgnored('RECIEVE')).toBe(true);
    expect(isWordIgnored('seperate')).toBe(false);
    expect(getIgnoredWords()).toContain('recieve');
    ignoreWord('based  in'); // 多空白归一
    expect(isWordIgnored('based in')).toBe(true);
    expect(getIgnoredWords().length).toBe(2);
  });

  it('clearIgnoredWords 清空', () => {
    ignoreWord('teh');
    clearIgnoredWords();
    expect(getIgnoredWords()).toEqual([]);
    expect(isWordIgnored('teh')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 浮层与扩展（jsdom 挂载）
// ---------------------------------------------------------------------------

describe('quickFixPanelAt：浮层构建', () => {
  it('命中位置返回浮层：原词 + 候选按钮 + 忽略按钮；未命中/右边界外返回 null', () => {
    view = new EditorView({
      doc: 'We recieve the data.',
      parent: document.body,
      extensions: [quickFixExtension()],
    });
    const panel = quickFixPanelAt(view, 4); // recieve span 内
    expect(panel).not.toBeNull();
    const labels = Array.from(panel!.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels).toEqual(['receive', '忽略此词']);
    expect(panel!.querySelector('strong')!.textContent).toBe('recieve');
    expect(quickFixPanelAt(view, 0)).toBeNull(); // 'We ' 无命中
    expect(quickFixPanelAt(view, 10)).not.toBeNull(); // span 右边界仍命中（与 spellHover 同判定）
  });

  it('多候选 issue：每个候选一个按钮（very important → critical / essential）', () => {
    view = new EditorView({
      doc: 'This step is very important.',
      parent: document.body,
      extensions: [quickFixExtension()],
    });
    const panel = quickFixPanelAt(view, 15);
    const labels = Array.from(panel!.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels).toEqual(['critical', 'essential', '忽略此词']);
  });

  it('被忽略词不弹浮层（spellcheck 波浪线不受影响——诚实边界：忽略只作用于本层）', () => {
    view = new EditorView({
      doc: 'We recieve teh data.',
      parent: document.body,
      extensions: [spellcheckExtension(true), quickFixExtension()],
    });
    ignoreWord('recieve');
    expect(quickFixPanelAt(view, 4)).toBeNull(); // 已忽略
    expect(quickFixPanelAt(view, 12)).not.toBeNull(); // teh 仍可修复
    expect(view.dom.querySelectorAll('.sf-spell').length).toBe(2); // 下划线归 spellcheck，仍在
  });
});

describe('点击候选：Transaction 替换与装饰联动', () => {
  it('点击候选按钮替换该词，spellcheck 装饰随 doc 更新消失', () => {
    view = new EditorView({
      doc: 'We recieve teh data.',
      parent: document.body,
      extensions: [spellcheckExtension(true), quickFixExtension()],
    });
    expect(view.dom.querySelectorAll('.sf-spell').length).toBe(2); // recieve + teh
    const panel = quickFixPanelAt(view, 4);
    const btn = Array.from(panel!.querySelectorAll('button')).find((b) => b.textContent === 'receive');
    btn!.click();
    expect(view.state.doc.toString()).toBe('We receive teh data.');
    expect(view.dom.querySelectorAll('.sf-spell').length).toBe(1); // recieve 线消失，teh 仍在
    expect(view.dom.querySelectorAll('.sf-spell')[0]!.textContent).toBe('teh');
  });

  it('多候选按钮各点各的：点 essential 得 essential', () => {
    view = new EditorView({
      doc: 'This step is very important.',
      parent: document.body,
      extensions: [spellcheckExtension(true), quickFixExtension()],
    });
    expect(view.dom.querySelectorAll('.sf-spell-ch').length).toBe(1);
    const panel = quickFixPanelAt(view, 15);
    const btn = Array.from(panel!.querySelectorAll('button')).find(
      (b) => b.textContent === 'essential',
    );
    btn!.click();
    expect(view.state.doc.toString()).toBe('This step is essential.');
    expect(view.dom.querySelectorAll('.sf-spell-ch').length).toBe(0);
  });

  it('候选随原词大小写：Seperate → Separate 按钮与插入一致', () => {
    view = new EditorView({
      doc: 'Seperate them',
      parent: document.body,
      extensions: [spellcheckExtension(true), quickFixExtension()],
    });
    const panel = quickFixPanelAt(view, 2);
    const labels = Array.from(panel!.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels).toEqual(['Separate', '忽略此词']);
    Array.from(panel!.querySelectorAll('button'))
      .find((b) => b.textContent === 'Separate')!
      .click();
    expect(view.state.doc.toString()).toBe('Separate them');
  });

  it('点击【忽略此词】：入会话级忽略集合，该词浮层不再弹出', () => {
    view = new EditorView({
      doc: 'We recieve teh data.',
      parent: document.body,
      extensions: [spellcheckExtension(true), quickFixExtension()],
    });
    const panel = quickFixPanelAt(view, 4);
    Array.from(panel!.querySelectorAll('button'))
      .find((b) => b.textContent === '忽略此词')!
      .click();
    expect(getIgnoredWords()).toContain('recieve');
    expect(quickFixPanelAt(view, 4)).toBeNull();
    expect(view.state.doc.toString()).toBe('We recieve teh data.'); // 忽略不改文档
  });

  it('quickFixExtension 与 thesaurus / spellcheck hover 同装不冲突（扩展可组合）', () => {
    expect(() => {
      view = new EditorView({
        doc: 'very important recieve',
        parent: document.body,
        extensions: [spellcheckExtension(true), thesaurusExtension(), quickFixExtension()],
      });
    }).not.toThrow();
    expect(view!.dom.querySelectorAll('.sf-spell-ch').length).toBe(1);
    const panel = quickFixPanelAt(view!, 2);
    expect(Array.from(panel!.querySelectorAll('button')).map((b) => b.textContent ?? '')).toEqual([
      'critical',
      'essential',
      '忽略此词',
    ]);
  });
});

describe('applyQuickFix：替换应用函数', () => {
  it('直接调用：命中替换返回 true；目标词已不存在返回 false 且不动文档', () => {
    view = new EditorView({
      doc: 'We recieve teh data.',
      parent: document.body,
      extensions: [spellcheckExtension(true)],
    });
    const issue = checkText('We recieve teh data.').find((i) => i.word === 'recieve')!;
    expect(applyQuickFix(view, issue, 'receive')).toBe(true);
    expect(view.state.doc.toString()).toBe('We receive teh data.');
    expect(applyQuickFix(view, issue, 'receive')).toBe(false); // recieve 已修掉
    expect(view.state.doc.toString()).toBe('We receive teh data.');
  });

  it('hover 期间文档漂移：按词形回退定位首处命中', () => {
    view = new EditorView({
      doc: 'recieve data',
      parent: document.body,
      extensions: [spellcheckExtension(true)],
    });
    const stale = { word: 'recieve', from: 0, to: 8 }; // 旧 span
    view.dispatch({ changes: { from: 0, insert: 'see ' } }); // 偏移整体 +4
    expect(applyQuickFix(view, stale, 'receive')).toBe(true);
    expect(view.state.doc.toString()).toBe('see receive data');
  });
});
