// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { checkText, CONFUSABLES, MISSPELLINGS, spellcheckExtension } from './spellcheck';

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

/** 便捷：取命中词列表 */
function words(text: string): string[] {
  return checkText(text).map((i) => i.word);
}

describe('词表规模与自洽', () => {
  it('MISSPELLINGS ≥ 60 对，且包含需求指定的核心条目', () => {
    expect(Object.keys(MISSPELLINGS).length).toBeGreaterThanOrEqual(60);
    const samples: Record<string, string> = {
      recieve: 'receive',
      seperate: 'separate',
      occured: 'occurred',
      wich: 'which',
      teh: 'the',
      adress: 'address',
      enviroment: 'environment',
      independant: 'independent',
      arguement: 'argument',
      beleive: 'believe',
      calender: 'calendar',
      comittee: 'committee',
      consistant: 'consistent',
      definately: 'definitely',
      dissapoint: 'disappoint',
      embarass: 'embarrass',
      existance: 'existence',
      occurence: 'occurrence',
      personnal: 'personal',
      posession: 'possession',
      prefered: 'preferred',
      priviledge: 'privilege',
      publically: 'publicly',
      recomend: 'recommend',
      refered: 'referred',
      reponse: 'response',
      resistent: 'resistant',
      succesful: 'successful',
      supress: 'suppress',
      targer: 'target',
      threshhold: 'threshold',
      untill: 'until',
      wether: 'whether',
    };
    for (const [wrong, right] of Object.entries(samples)) {
      expect(MISSPELLINGS[wrong]).toBe(right);
    }
  });

  it('CONFUSABLES ≥ 20 组，wrong/right/hint 齐备且 hint 为中文提示', () => {
    expect(CONFUSABLES.length).toBeGreaterThanOrEqual(20);
    for (const c of CONFUSABLES) {
      expect(c.wrong.length).toBeGreaterThan(0);
      expect(c.right.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeGreaterThan(0);
    }
  });

  it('两表 wrong 形互不重复、不与正确形冲突', () => {
    const missKeys = Object.keys(MISSPELLINGS);
    expect(new Set(missKeys).size).toBe(missKeys.length); // MISSPELLINGS 键唯一（对象字面量天然去重，防御）
    const confWrongs = CONFUSABLES.map((c) => c.wrong.toLowerCase());
    expect(new Set(confWrongs).size).toBe(confWrongs.length);
    // 易混 wrong 不应同时是拼写表的 wrong（避免同词双报）
    for (const w of confWrongs) expect(MISSPELLINGS[w]).toBeUndefined();
    // 拼写 wrong 不应等于任何正确形（自相矛盾的词表）
    const rights = new Set(Object.values(MISSPELLINGS).map((v) => v.toLowerCase()));
    for (const k of missKeys) expect(rights.has(k)).toBe(false);
  });
});

describe('checkText：拼写表命中', () => {
  it('整词命中：span / word / suggestion / kind 正确，无 hint', () => {
    const issues = checkText('We recieve the data.');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      from: 3,
      to: 10,
      word: 'recieve',
      suggestion: 'receive',
      kind: 'misspelling',
    });
    expect(issues[0]!.hint).toBeUndefined();
  });

  it('多处命中按 from 升序输出', () => {
    const issues = checkText('teh model was seperate, and it occured.');
    expect(issues.map((i) => i.word)).toEqual(['teh', 'seperate', 'occured']);
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i]!.from).toBeGreaterThan(issues[i - 1]!.from);
    }
  });

  it('词边界：子串不误报（receiver/addressed/independently 均不命中）', () => {
    expect(checkText('The receiver addressed it independently.')).toEqual([]);
    expect(words('recieves recieving')).toEqual([]); // 屈折形不做整词命中
  });

  it('数字/下划线邻接不算词边界', () => {
    expect(words('Teh2 teh')).toEqual(['teh']);
  });

  it('标点紧邻时 span 精确（括号/逗号/分号不计入）', () => {
    const issues = checkText('(seperate);');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ from: 1, to: 9, word: 'seperate' });
  });
});

describe('checkText：大小写', () => {
  it('大小写不敏感，word 保留原文，suggestion 随原文大小写', () => {
    const cap = checkText('Recieve it.')[0]!;
    expect(cap).toMatchObject({ word: 'Recieve', suggestion: 'Receive' });
    const upper = checkText('SEPERATE them')[0]!;
    expect(upper).toMatchObject({ word: 'SEPERATE', suggestion: 'SEPARATE' });
    const confCap = checkText('Their results')[0]!;
    expect(confCap).toMatchObject({ word: 'Their', suggestion: 'There', kind: 'confusable' });
  });
});

describe('checkText：注释与命令跳过', () => {
  it('行注释 % 之后全部跳过', () => {
    expect(checkText('% recieve teh data')).toEqual([]);
    const issues = checkText('keep teh model % but recieve here');
    expect(issues.map((i) => i.word)).toEqual(['teh']);
  });

  it('转义 \\% 不开启注释，其后仍检查', () => {
    expect(words('100\\% accurate seperate trials')).toEqual(['seperate']);
  });

  it('反斜杠命令整体跳过（\\textbf 内参数仍检查）', () => {
    const issues = checkText('\\textbf{seperate}');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.from).toBe('\\textbf{'.length); // 指向 { 内首字符
    expect(words('\\seperate')).toEqual([]);
  });

  it('\\cite / \\ref 参数键名不触发（词表不会命中 citekey）', () => {
    expect(checkText('As shown in \\cite{smith2024} and \\ref{fig:results}.')).toEqual([]);
  });
});

describe('checkText：偏移与多行', () => {
  it('跨行文本 span 偏移与 indexOf 一致', () => {
    const text = '\\section{Intro}\nWe recieve the data\n结果 teh 如下';
    const issues = checkText(text);
    expect(issues.map((i) => i.word)).toEqual(['recieve', 'teh']);
    expect(issues[0]!.from).toBe(text.indexOf('recieve'));
    expect(issues[0]!.to).toBe(text.indexOf('recieve') + 'recieve'.length);
    expect(issues[1]!.from).toBe(text.indexOf('teh'));
  });

  it('中英混排：中文标点是合法词边界，span 定位正确', () => {
    const text = '实验结果 seperate，如下';
    const issues = checkText(text);
    expect(issues).toHaveLength(1);
    expect(text.slice(issues[0]!.from, issues[0]!.to)).toBe('seperate');
  });

  it('无命中/空文本返回空数组', () => {
    expect(checkText('')).toEqual([]);
    expect(checkText('This manuscript reads well; the separate trials agree.')).toEqual([]);
  });
});

describe('checkText：易混词', () => {
  it('单词易混对：kind=confusable 且带中文 hint', () => {
    const issues = checkText('The affect is large.');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ word: 'affect', suggestion: 'effect', kind: 'confusable' });
    expect(issues[0]!.hint).toContain('人工判断');
  });

  it('多词短语易混对：整短语命中，短语内多空白容忍，based on 不误报', () => {
    const issues = checkText('This is based in prior work.');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ word: 'based in', suggestion: 'based on' });
    expect(words('The result consist in three parts.')).toEqual(['consist in']);
    expect(words('based  in the literature')).toEqual(['based  in']); // 短语内多空格仍命中（span 含原文）
    expect(checkText('This is based on prior work.')).toEqual([]);
  });

  it("eg/ie 缩写命中，规范 e.g./i.e. 不误报；it's 不误报为 its", () => {
    expect(words('See eg Figure 3, ie the plot')).toEqual(['eg', 'ie']);
    expect(checkText('See e.g. Figure 3, i.e. the plot.')).toEqual([]);
    expect(words("it's fine")).toEqual([]);
    expect(words('its value')).toEqual(['its']);
  });
});

describe('spellcheckExtension：编辑器标注', () => {
  it('enabled=true：sf-spell / sf-spell-conf 标注落盘，注释与命令不标注', () => {
    view = new EditorView({
      doc: 'recieve teh data\n% seperate hidden\n\\cmd{their} ok',
      parent: document.body,
      extensions: [spellcheckExtension(true)],
    });
    const miss = view.dom.querySelectorAll('.sf-spell');
    const conf = view.dom.querySelectorAll('.sf-spell-conf');
    expect(miss.length).toBe(2); // recieve + teh
    expect(conf.length).toBe(1); // \cmd 参数外的 their（命令本体掩蔽）
    expect(miss[0]!.textContent).toBe('recieve');
    expect(conf[0]!.textContent).toBe('their');
  });

  it('enabled=false：无任何标注', () => {
    view = new EditorView({
      doc: 'recieve teh',
      parent: document.body,
      extensions: [spellcheckExtension(false)],
    });
    expect(view.dom.querySelectorAll('.sf-spell, .sf-spell-conf').length).toBe(0);
  });

  it('编辑后标注随文档更新', () => {
    view = new EditorView({
      doc: 'clean text',
      parent: document.body,
      extensions: [spellcheckExtension(true)],
    });
    expect(view.dom.querySelectorAll('.sf-spell').length).toBe(0);
    view.dispatch({ changes: { from: 0, insert: 'adress ' } });
    expect(view.dom.querySelectorAll('.sf-spell').length).toBe(1);
  });
});
