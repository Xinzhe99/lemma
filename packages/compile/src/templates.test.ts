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
