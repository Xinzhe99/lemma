import { describe, expect, it } from 'vitest';
import { listTemplates, scaffoldProject } from './templates';

const EXPECTED_IDS = [
  'generic-article',
  'generic-report',
  'conference-ieee-like',
  'conference-acm-like',
  'journal-twocolumn',
  'preprint-ml-like',
  'preprint-arxiv-like',
  'journal-elsevier-like',
  'journal-math-like',
  'journal-springer-like',
  'survey-article',
  'thesis-phd-like',
  'chinese-ctex',
  'chinese-journal',
  'presentation-beamer',
  'presentation-beamer-dark',
  'letter-cover',
  'report-technical',
  'poster-a0',
  'lecture-notes',
];

const CATEGORIES = ['conference', 'journal', 'thesis', 'chinese', 'generic', 'preprint', 'presentation', 'report', 'other'];
const ENGINES = ['tectonic', 'latexmk', 'mock'];

describe('listTemplates', () => {
  it('返回全部 20 个内置模板且字段完整', () => {
    const list = listTemplates();
    expect(list.map((t) => t.id).sort()).toEqual([...EXPECTED_IDS].sort());
    for (const t of list) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.venue.length).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(t.category);
      expect(ENGINES).toContain(t.engine);
      expect(t.entry).toBe('main.tex');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('返回的是描述符拷贝（不泄漏内部注册表对象）', () => {
    const a = listTemplates();
    a[0].name = '被篡改';
    expect(listTemplates()[0].name).not.toBe('被篡改');
  });
});

describe('scaffoldProject', () => {
  it('每个模板：入口与 refs.bib 存在、README 生成、占位符全部替换', () => {
    for (const t of listTemplates()) {
      const files = scaffoldProject(t.id, { title: `T-${t.id}`, authors: 'A; B' });
      const entry = files[t.entry];
      expect(typeof entry).toBe('string');
      expect(typeof files['refs.bib']).toBe('string');
      expect(typeof files['README.md']).toBe('string');
      for (const [path, content] of Object.entries(files)) {
        if (typeof content !== 'string') continue;
        expect(content).not.toMatch(/\{(TITLE|AUTHORS|DATE|VENUE|ABSTRACT)\}/);
        void path;
      }
      // bib 含 3 条示例条目
      expect((files['refs.bib'] as string).split('@').length - 1).toBe(3);
    }
  });

  it('占位符替换为用户变量', () => {
    const files = scaffoldProject('generic-article', { title: 'A Study of X', authors: 'Alice; Bob' });
    const main = files['main.tex'] as string;
    expect(main).toContain('A Study of X');
    expect(main).toContain('Alice; Bob');
    expect(main).not.toContain('{TITLE}');
    expect(main).not.toContain('{AUTHORS}');
    // 未提供的变量使用默认值
    expect(main).toMatch(/Submitted to: TBD/);
    expect(main).toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/);
  });

  it('README 说明编译方式', () => {
    const readme = scaffoldProject('generic-article', { title: 'T', authors: 'A' })['README.md'] as string;
    expect(readme).toContain('如何编译');
    expect(readme).toContain('tectonic -X compile main.tex');
    expect(readme).toContain('latexmk');
  });

  it('chinese-ctex：ctex 文类 + xelatex 语义说明', () => {
    const files = scaffoldProject('chinese-ctex', { title: '中文题目', authors: '张三' });
    const main = files['main.tex'] as string;
    expect(main).toContain('ctexart');
    expect(main).toContain('中文题目');
    const readme = files['README.md'] as string;
    expect(readme).toContain('xelatex');
    // 中文模板的默认摘要为中文
    expect(main).toContain('（待填写');
  });

  it('conference-ieee-like：双栏自写样式，不含真实 IEEE/ACM cls', () => {
    const main = scaffoldProject('conference-ieee-like', { title: 'T', authors: 'A' })['main.tex'] as string;
    expect(main).toContain('twocolumn');
    expect(main).not.toContain('IEEEtran');
    expect(main).not.toContain('acmart');
    expect(main).not.toContain('\\usepackage{IEEEtran}');
  });

  it('preprint-ml-like：单栏 + 预印本页脚', () => {
    const main = scaffoldProject('preprint-ml-like', { title: 'T', authors: 'A' })['main.tex'] as string;
    expect(main).toContain('margin=1in');
    expect(main).toContain('Preprint');
    expect(main).not.toContain('twocolumn');
  });

  it('未知模板抛出中文错误', () => {
    expect(() => scaffoldProject('nope', { title: 'T', authors: 'A' })).toThrow(/未找到模板/);
  });
});

// ---------------------------------------------------------------------------
// 模板可编译性回归（v7.8.0）：此前 9 个模板的 \documentclass 漏写类名，
// 生成的工程连第一行都过不去（\documentclass[11pt] 会把 \usepackage 当类名）。
// ---------------------------------------------------------------------------

/** A0 横向（118.9cm × 84.1cm）扣掉 geometry margin=1.2cm 后的版心 */
const A0_LANDSCAPE_TEXT_WIDTH_CM = 118.9 - 2 * 1.2;

describe('模板可编译性回归', () => {
  it('每个模板入口都有合法的 \\documentclass{类名}', () => {
    for (const t of listTemplates()) {
      const main = scaffoldProject(t.id, { title: 'T', authors: 'A' })[t.entry] as string;
      const line = main.split('\n').find((l) => l.includes('\\documentclass')) ?? '';
      // 漏写类名（\documentclass[11pt] 后直接换行）不匹配；类名必须紧跟可选参数
      expect(line, `${t.id} 的 \\documentclass 缺少类名`).toMatch(
        /^\\documentclass(\[[^\]]*\])?\{[A-Za-z]+\}\s*$/,
      );
    }
  });

  it('含中文正文的模板必须加载 ctex（回归：article + 中文在真实引擎下中文静默丢字，PDF 近乎空白）', () => {
    for (const t of listTemplates()) {
      const main = scaffoldProject(t.id, { title: 'T', authors: 'A' })[t.entry] as string;
      // 去掉注释行后判断正文是否含中文
      const body = main
        .split('\n')
        .filter((l) => !l.trim().startsWith('%'))
        .join('\n');
      if (!/[\u4e00-\u9fff]/.test(body)) continue;
      const cjkCapable =
        /\\documentclass\[[^\]]*\]\{ctex[^}]*\}/.test(main) || /\\usepackage\[[^\]]*\]\{ctex\}/.test(main);
      expect(cjkCapable, `${t.id} 中文正文但未加载 ctex（真实引擎下中文会丢字）`).toBe(true);
    }
  });

  it('模板不使用单反斜杠 \\[ 当作换行（会打开行间数学模式）', () => {
    for (const t of listTemplates()) {
      const main = scaffoldProject(t.id, { title: 'T', authors: 'A' })[t.entry] as string;
      expect(main, `${t.id} 含 \\[<长度>] 形式的伪换行`).not.toMatch(/(?<!\\)\\\[\d+pt\]/);
    }
  });

  it('模板产物不含制表符（回归：letter-cover 曾把 \\t 写成真实制表符，\\textbf 退化成 extbf）', () => {
    for (const t of listTemplates()) {
      const files = scaffoldProject(t.id, { title: 'T', authors: 'A' });
      for (const [path, content] of Object.entries(files)) {
        if (typeof content !== 'string') continue;
        expect(content.includes('\t'), `${t.id}/${path} 含制表符`).toBe(false);
      }
    }
  });

  it('poster-a0：标题与三栏宽度不超过 A0 横向版心', () => {
    const main = scaffoldProject('poster-a0', { title: 'T', authors: 'A' })['main.tex'] as string;
    const widths = [...main.matchAll(/text width=(\d+(?:\.\d+)?)cm/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(4); // 标题 + 三栏
    expect(widths[0]).toBeLessThanOrEqual(A0_LANDSCAPE_TEXT_WIDTH_CM);
    const columns = widths.slice(1).reduce((a, b) => a + b, 0) + 2 * 0.8; // 栏间距 8mm ×2
    expect(columns).toBeLessThanOrEqual(A0_LANDSCAPE_TEXT_WIDTH_CM);
    const heights = [...main.matchAll(/minimum height=(\d+(?:\.\d+)?)cm/g)].map((m) => Number(m[1]));
    expect(heights[0]! + 0.8 + heights[1]!).toBeLessThanOrEqual(84.1 - 2 * 1.2); // 标题 + 间距 + 栏高
  });

  it('模板中 \\cite 的键都能在 refs.bib 或 thebibliography 中找到', () => {
    for (const t of listTemplates()) {
      const files = scaffoldProject(t.id, { title: 'T', authors: 'A' });
      const main = files[t.entry] as string;
      const cited = [...main.matchAll(/\\cite[a-zA-Z]*\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g)]
        .flatMap((m) => m[1]!.split(',').map((k) => k.trim()))
        .filter(Boolean);
      const defined = new Set([
        ...[...Object.values(files).filter((c): c is string => typeof c === 'string')].flatMap((c) =>
          [...c.matchAll(/^@\w+\{([^,\s]+),/gm)].map((m) => m[1]!),
        ),
        ...[...main.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]*)\}/g)].map((m) => m[1]!.trim()),
      ]);
      for (const key of cited) expect(defined.has(key), `${t.id} 引用了不存在的键 ${key}`).toBe(true);
    }
  });
});

