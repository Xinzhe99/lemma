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
    // D8：their 受「后接 be 动词」守卫，正当物主用法不再标注；守卫命中时大小写规则不变
    expect(checkText('Their results are solid.')).toEqual([]);
    const confCap = checkText('Their is a flaw.')[0]!;
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
  it('单词易混对：kind=confusable 且带中文 hint（D8：affect 需 the/this/an + affect + of 才标）', () => {
    const issues = checkText('The affect of noise is large.');
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

  it('无守卫条目（always）保持全标：短语与无语境即可判错的词', () => {
    expect(words('we discuss about the results')).toEqual(['discuss about']);
    expect(words('many researches show this')).toEqual(['researches']);
    expect(words('in the other hand, it works')).toEqual(['in the other hand']);
    expect(words('the data is clean')).toEqual(['data is']);
  });

  it("eg/ie 缩写命中，规范 e.g./i.e. 不误报；it's 不误报为 its", () => {
    expect(words('See eg Figure 3, ie the plot')).toEqual(['eg', 'ie']);
    expect(checkText('See e.g. Figure 3, i.e. the plot.')).toEqual([]);
    expect(words("it's fine")).toEqual([]);
    expect(words('its value')).toEqual([]); // D8：its 受「后接 a/an/the/being」守卫，正当物主用法不标
  });
});

describe('checkText：易混词上下文守卫（D8：正当用法不再一片黄线）', () => {
  it('their：仅后接 be 动词才标（their is → there is）', () => {
    expect(words('Their is a problem here.')).toEqual(['Their']);
    expect(words('their are two cases')).toEqual(['their']);
    expect(words('their been several attempts')).toEqual(['their']);
    expect(words('Their results are solid.')).toEqual([]);
    expect(words('We used their dataset.')).toEqual([]);
    expect(words('theirs is fine')).toEqual([]); // 「theirs is」场景明确不做
  });

  it('then：仅前接比较级标记才标（more then → more than）', () => {
    expect(words('more then 3 samples')).toEqual(['then']);
    expect(words('better then the baseline')).toEqual(['then']);
    expect(words('and then we compare')).toEqual([]);
    expect(words('We first preprocess, then train.')).toEqual([]); // 前邻是标点/非比较级
  });

  it('its：仅后接 a/an/the/being 才标（its a → it\'s a）', () => {
    expect(words('its a mistake')).toEqual(['its']);
    expect(words('its the main cause')).toEqual(['its']);
    expect(words('its result is robust')).toEqual([]);
    expect(words('its application scope')).toEqual([]); // 'application' 不因首字母 a 误配守卫词 'a'
  });

  it('affect：前接 the/this/an 且后接 of 才标（the affect of → the effect of）', () => {
    expect(words('The affect of noise is large.')).toEqual(['affect']);
    expect(words('this affect of scaling')).toEqual(['affect']);
    expect(words('The affect is large.')).toEqual([]); // 缺后接 of
    expect(words('may affect the result')).toEqual([]); // 动词用法
  });

  it('less：仅后接复数可数提示词才标（less items → fewer items）', () => {
    expect(words('less items were kept')).toEqual(['less']);
    expect(words('with less users involved')).toEqual(['less']);
    expect(words('less water is needed')).toEqual([]); // 不可数
    expect(words('less data was retained')).toEqual([]);
  });

  it('between：仅后接数字或 each 才标轻提示', () => {
    expect(words('between each iteration')).toEqual(['between']);
    expect(words('between 3 groups')).toEqual(['between']);
    expect(words('between the two methods')).toEqual([]);
  });

  it('loose：仅后接 to 才标（loose to → lose to）', () => {
    expect(words('will loose to the baseline')).toEqual(['loose']);
    expect(words('loose weight quickly')).toEqual([]);
    expect(words('a loose fit is acceptable')).toEqual([]); // 形容词本义
  });

  it('amount：仅 amount of 可数复数才标（the amount of people → the number of）', () => {
    expect(words('the amount of people')).toEqual(['amount']);
    expect(words('the amount of items')).toEqual(['amount']);
    expect(words('the amount of memory')).toEqual([]); // 不可数
  });

  it('扩展守卫条目：principle/farther 按惯用搭配标，本义不标', () => {
    expect(words('the principle investigator')).toEqual(['principle']);
    expect(words('principle component analysis')).toEqual(['principle']);
    expect(words('the principle of relativity')).toEqual([]);
    expect(words('needs farther analysis')).toEqual(['farther']);
    expect(words('the farther sample site')).toEqual([]); // 物理距离本义
  });

  it('守卫词大小写不敏感、多空格容忍', () => {
    expect(words('Their  IS a flaw')).toEqual(['Their']);
    expect(words('MORE   then expected')).toEqual(['then']);
    expect(words('the   affect   of noise')).toEqual(['affect']);
    expect(words('less    items')).toEqual(['less']);
  });

  it('守卫不满足的正当用法整体零标注（hover/装饰自然不出现）', () => {
    expect(checkText('Their model then uses its attention, affecting less memory between runs.')).toEqual([]);
  });
});


describe('spellcheckExtension：编辑器标注', () => {
  it('enabled=true：sf-spell / sf-spell-conf 标注落盘，注释与命令不标注', () => {
    view = new EditorView({
      // D8：their 须后接 be 动词才标（\cmd 参数内的 their is 命中守卫）
      doc: 'recieve teh data\n% seperate hidden\n\\cmd{their is} ok',
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
