// @vitest-environment jsdom
/**
 * Zotero 生态迁移测试：解析 / 集合结构 / PDF 匹配纯函数 + LibraryPanel 两个入口
 * （「Zotero JSON」导入对话框、「PDF 目录」批量关联对话框）。
 *
 * 组件区段的测试环境说明同 libraryRis.test.tsx：mock zustand 为仅依赖本包
 * react@18 的等价实现。验收路径：
 *  - 工具栏出现「Zotero JSON」与「PDF 目录」按钮，各自打开对话框；
 *  - 粘贴 Better BibTeX JSON → 查重 → importHit 入库（citekey 补齐、集合 → zotero: tag）
 *    → 结果提示「导入 N 条 / 跳过重复 M / 错误 K」；
 *  - PDF 目录：注入文件夹 → matchPdfToPaper 预览（置信度 / 无匹配）→「关联全部」
 *    逐个读 ArrayBuffer 调 attachPdf → 成功计数。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zustand', async () => {
  const { useSyncExternalStore } = await import('react');
  interface Listener {
    (state: unknown, prev: unknown): void;
  }
  function impl<S extends object>(init: (set: unknown, get: unknown) => S) {
    let state: S;
    const listeners = new Set<Listener>();
    const setState = (partial: Partial<S> | ((s: S) => Partial<S>)) => {
      const patch = typeof partial === 'function' ? (partial as (s: S) => Partial<S>)(state) : partial;
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    };
    const getState = () => state;
    const subscribe = (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    };
    state = init(setState, getState);
    const useStore = <T,>(sSelector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => sSelector(state),
        () => sSelector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

import type { Paper } from '@scholarforge/shared';
import {
  collectionNamesFor,
  collectionTree,
  extractArxivId,
  matchPdfToPaper,
  paperIdentity,
  parseZoteroJson,
  readFileArrayBuffer,
  zoteroVenueType,
  ZOTERO_TAG_PREFIX,
  type ZoteroCollection,
} from './zotero';
import { LibraryPanel } from './panels/LibraryPanel';
import { useLibraryStore } from './state/libraryStore';
import { useSettingsStore } from './state/settingsStore';
import { useUiStore } from './state/uiStore';

// ---------------------------------------------------------------------------
// 公共 fixture
// ---------------------------------------------------------------------------

function makePaper(partial: Partial<Paper> & { id: string; title: string }): Paper {
  return {
    citekey: '',
    authors: [],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 0,
    ...partial,
  };
}

const ATTENTION = makePaper({
  id: 'p1',
  title: 'Attention Is All You Need',
  citekey: 'vaswani2017attention',
  year: 2017,
});

// ---------------------------------------------------------------------------
// 纯函数：parseZoteroJson / 集合结构
// ---------------------------------------------------------------------------

describe('parseZoteroJson', () => {
  it('journalArticle：venue.type=journal、publicationTitle→venue.name、date 取前 4 位年份、creators→family/given、tags/DOI/collectionKeys 映射', () => {
    const [r] = parseZoteroJson(
      JSON.stringify([
        {
          itemType: 'journalArticle',
          title: 'Attention Is All You Need',
          creators: [
            { creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' },
            { creatorType: 'author', firstName: 'Noam', lastName: 'Shazeer' },
          ],
          date: '2017-06',
          publicationTitle: 'Advances in Neural Information Processing Systems',
          DOI: '10.5555/3294771.3295107',
          tags: [{ tag: 'transformer' }, { tag: 'attention' }],
          collections: ['COLL1', 'COLL2'],
          key: 'ITEM1',
        },
      ]),
    ).papers;
    expect(r).toBeDefined();
    expect(r!.title).toBe('Attention Is All You Need');
    expect(r!.year).toBe(2017);
    expect(r!.venue).toEqual({
      type: 'journal',
      name: 'Advances in Neural Information Processing Systems',
    });
    expect(r!.authors).toEqual([
      { family: 'Vaswani', given: 'Ashish' },
      { family: 'Shazeer', given: 'Noam' },
    ]);
    expect(r!.doi).toBe('10.5555/3294771.3295107');
    expect(r!.tags).toEqual(['transformer', 'attention']);
    expect(r!.collectionKeys).toEqual(['COLL1', 'COLL2']);
    // citekey 留空（入库时补）；readStatus 缺省 to-read
    expect(r!.citekey).toBe('');
    expect(r!.readStatus).toBe('to-read');
  });

  it('类型映射：proceedingsArticle→conference(proceedingsTitle)、thesis→thesis、preprint→preprint(repository)、book→book', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        { itemType: 'proceedingsArticle', title: 'A', date: '2020', proceedingsTitle: 'CVPR' },
        { itemType: 'thesis', title: 'B', date: '2019' },
        { itemType: 'preprint', title: 'C', date: '2023', repository: 'arXiv' },
        { itemType: 'book', title: 'D', date: '2001', publicationTitle: 'Springer' },
      ]),
    );
    expect(papers.map((p) => p.venue)).toEqual([
      { type: 'conference', name: 'CVPR' },
      { type: 'thesis', name: undefined },
      { type: 'preprint', name: 'arXiv' },
      { type: 'book', name: 'Springer' },
    ]);
  });

  it('document（misc）等未列出类型 → unknown；无名时 venue 为 undefined', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        { itemType: 'document', title: 'X', date: '2022' },
        { itemType: 'webpage', title: 'Y', date: '2022' },
      ]),
    );
    expect(papers).toHaveLength(2);
    expect(papers.every((p) => p.venue === undefined)).toBe(true);
    expect(zoteroVenueType('document')).toBe('unknown');
    expect(zoteroVenueType('journalArticle')).toBe('journal');
  });

  it('arXiv ID：extra 文本 `arXiv: <id>` 正则提取；arxivId 字段直接读取并归一化前缀', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        {
          itemType: 'preprint',
          title: 'GPT-4 Technical Report',
          date: '2023-03-15',
          extra: 'arXiv: 2303.08774\nSubmitted to arXiv',
        },
        {
          itemType: 'preprint',
          title: 'Old style',
          date: '1999',
          arxivId: 'arXiv: hep-th/9901001',
        },
      ]),
    );
    expect(papers[0]!.arxivId).toBe('2303.08774');
    expect(papers[1]!.arxivId).toBe('hep-th/9901001');
    expect(extractArxivId('nothing here')).toBeUndefined();
    expect(extractArxivId('arXiv: not-a-valid-id')).toBeUndefined();
  });

  it('机构作者：无 lastName 时用 name 字段 fallback 为 { family: name }', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        {
          itemType: 'preprint',
          title: 'GPT-4 Technical Report',
          creators: [{ creatorType: 'author', name: 'OpenAI' }],
        },
      ]),
    );
    expect(papers[0]!.authors).toEqual([{ family: 'OpenAI' }]);
  });

  it('creators 无 author 类型（全部 editor 等）时宽容取全部创作者；creatorType 混合时只取 author', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        {
          itemType: 'book',
          title: 'Book',
          creators: [{ creatorType: 'editor', firstName: 'Ed', lastName: 'Editor' }],
        },
        {
          itemType: 'journalArticle',
          title: 'Article',
          creators: [
            { creatorType: 'author', firstName: 'A', lastName: 'Auth' },
            { creatorType: 'translator', firstName: 'T', lastName: 'Trans' },
          ],
        },
      ]),
    );
    expect(papers[0]!.authors).toEqual([{ family: 'Editor', given: 'Ed' }]);
    expect(papers[1]!.authors).toEqual([{ family: 'Auth', given: 'A' }]);
  });

  it('附件与笔记条目（attachment/note/annotation）静默跳过：不进 papers、不进 errors', () => {
    const r = parseZoteroJson(
      JSON.stringify([
        { itemType: 'journalArticle', title: 'Keep' },
        { itemType: 'attachment', title: 'file.pdf', path: '/storage/x.pdf' },
        { itemType: 'note', note: 'some note' },
        { itemType: 'annotation', annotationText: 'hi', annotationType: 'highlight' },
      ]),
    );
    expect(r.papers.map((p) => p.title)).toEqual(['Keep']);
    expect(r.errors).toEqual([]);
  });

  it('尾部集合元数据条目（无 title，collections 为对象数组）提取为 collections、不计错误', () => {
    const r = parseZoteroJson(
      JSON.stringify([
        { itemType: 'journalArticle', title: 'Keep', collections: ['ABC123'] },
        { collections: [{ key: 'ABC123', name: 'LLM', parent: 'ROOT1' }, { key: 'ROOT1', name: 'AI' }] },
      ]),
    );
    expect(r.papers).toHaveLength(1);
    expect(r.errors).toEqual([]);
    expect(r.collections).toEqual([
      { key: 'ABC123', name: 'LLM', parent: 'ROOT1' },
      { key: 'ROOT1', name: 'AI' },
    ]);
  });

  it('坏条目（常规条目缺 title）计入 errors 且不中断后续解析', () => {
    const r = parseZoteroJson(
      JSON.stringify([
        { itemType: 'journalArticle', creators: [{ lastName: 'X' }], key: 'K1' },
        { itemType: 'journalArticle', title: 'Good One', date: '2024' },
      ]),
    );
    expect(r.papers.map((p) => p.title)).toEqual(['Good One']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('K1');
  });

  it('空数组 → 0 papers / 0 errors；坏 JSON → 单条错误且 papers 为空', () => {
    expect(parseZoteroJson('[]')).toEqual({ papers: [], collections: [], errors: [] });
    const bad = parseZoteroJson('[{"itemType": "journalArticle", ');
    expect(bad.papers).toEqual([]);
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('JSON 解析失败');
  });

  it('非对象条目（数字/字符串/null）计入 errors 跳过', () => {
    const r = parseZoteroJson(
      JSON.stringify([42, 'str', null, { itemType: 'journalArticle', title: 'OK' }]),
    );
    expect(r.papers.map((p) => p.title)).toEqual(['OK']);
    expect(r.errors).toHaveLength(3);
  });

  it('根节点为对象时宽容接受 { items, collections } 形态', () => {
    const r = parseZoteroJson(
      JSON.stringify({
        items: [{ itemType: 'preprint', title: 'From items', date: '2024' }],
        collections: [{ key: 'K', name: 'N' }],
      }),
    );
    expect(r.papers.map((p) => p.title)).toEqual(['From items']);
    expect(r.collections).toEqual([{ key: 'K', name: 'N' }]);
    // 单条目对象形态也宽容接受；完全不相干的对象报「无法识别」
    expect(parseZoteroJson('{"itemType": "journalArticle", "title": "Single"}').papers).toHaveLength(1);
    expect(parseZoteroJson('{"weird": 1}')).toEqual({
      papers: [],
      collections: [],
      errors: ['无法识别的 Better BibTeX JSON 结构（根节点应为条目数组或 { items, collections }）'],
    });
  });

  it('abstractNote → abstract；DOI 归一化（剥 doi.org 前缀、小写）；date 无 4 位数字 → year undefined', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        {
          itemType: 'journalArticle',
          title: 'A',
          date: 'Spring 2021?',
          abstractNote: '  An abstract.  ',
          DOI: 'https://doi.org/10.1007/ABC.def',
        },
        { itemType: 'journalArticle', title: 'B', date: 'n.d.' },
      ]),
    );
    expect(papers[0]!.abstract).toBe('An abstract.');
    expect(papers[0]!.doi).toBe('10.1007/abc.def');
    expect(papers[0]!.year).toBe(2021);
    expect(papers[1]!.year).toBeUndefined();
  });

  it('tags 宽容接受字符串数组形态；collections 宽容接受 {key} 对象形态', () => {
    const { papers } = parseZoteroJson(
      JSON.stringify([
        { itemType: 'journalArticle', title: 'T', tags: ['llm', ''], collections: [{ key: 'C1' }] },
      ]),
    );
    expect(papers[0]!.tags).toEqual(['llm']);
    expect(papers[0]!.collectionKeys).toEqual(['C1']);
  });
});

describe('collectionTree / collectionNamesFor', () => {
  const cols: ZoteroCollection[] = [
    { key: 'AI', name: 'AI' },
    { key: 'LLM', name: 'LLM', parent: 'AI' },
    { key: 'SUB', name: 'Sub', parent: 'LLM' },
    { key: 'TOP', name: 'Top' },
    { key: 'ORPHAN', name: 'Orphan', parent: 'MISSING' },
  ];

  it('按 parent 链展开缩进深度（兄弟保持原顺序；悬空 parent 按顶层）', () => {
    expect(collectionTree(cols)).toEqual([
      { key: 'AI', name: 'AI', depth: 0 },
      { key: 'LLM', name: 'LLM', depth: 1 },
      { key: 'SUB', name: 'Sub', depth: 2 },
      { key: 'TOP', name: 'Top', depth: 0 },
      { key: 'ORPHAN', name: 'Orphan', depth: 0 },
    ]);
  });

  it('环（互为 parent）不死循环，每个集合恰好出现一次', () => {
    const cyclic: ZoteroCollection[] = [
      { key: 'A', name: 'a', parent: 'B' },
      { key: 'B', name: 'b', parent: 'A' },
    ];
    const tree = collectionTree(cyclic);
    expect(tree).toHaveLength(2);
    expect(new Set(tree.map((n) => n.key))).toEqual(new Set(['A', 'B']));
  });

  it('collectionNamesFor：含沿 parent 链的祖先名称、同名去重、未知 key 跳过', () => {
    expect(collectionNamesFor(['SUB', 'LLM'], cols)).toEqual(['Sub', 'LLM', 'AI']);
    expect(collectionNamesFor(['TOP', 'AI'], cols)).toEqual(['Top', 'AI']);
    expect(collectionNamesFor(['UNKNOWN'], cols)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 纯函数：matchPdfToPaper
// ---------------------------------------------------------------------------

describe('matchPdfToPaper', () => {
  const papers: Paper[] = [
    ATTENTION,
    makePaper({ id: 'p2', title: 'Language Models are Few-Shot Learners', citekey: 'brown2020language' }),
    makePaper({ id: 'p3', title: '深度学习综述', citekey: 'zhou2017deep' }),
  ];

  it('精确标题（含 .pdf 扩展名）→ score 1', () => {
    expect(matchPdfToPaper('Attention Is All You Need.pdf', papers)).toEqual({
      paperId: 'p1',
      score: 1,
    });
  });

  it('连字符/下划线/大小写差异归一化后仍精确命中', () => {
    expect(matchPdfToPaper('attention-is_all you NEED.PDF', papers)?.paperId).toBe('p1');
    expect(matchPdfToPaper('attention-is-all-you-need.pdf', papers)?.score).toBe(1);
  });

  it('带年份后缀 → 文件名包含标题 → 0.9 命中', () => {
    expect(matchPdfToPaper('Attention Is All You Need 2017.pdf', papers)).toEqual({
      paperId: 'p1',
      score: 0.9,
    });
  });

  it('citekey 精确命中 → 0.95；citekey + 后缀 → 0.85', () => {
    expect(matchPdfToPaper('vaswani2017attention.pdf', papers)).toEqual({
      paperId: 'p1',
      score: 0.95,
    });
    expect(matchPdfToPaper('brown2020language (1).pdf', papers)).toEqual({
      paperId: 'p2',
      score: 0.85,
    });
  });

  it('多候选取最高分', () => {
    const many = [
      makePaper({ id: 'x1', title: 'Attention Is Off', citekey: 'a1' }),
      ATTENTION,
      makePaper({ id: 'x2', title: 'Something Else Entirely', citekey: 'b1' }),
    ];
    expect(matchPdfToPaper('Attention Is All You Need.pdf', many)?.paperId).toBe('p1');
  });

  it('无匹配返回 null（与全部文献低相似）', () => {
    expect(matchPdfToPaper('zzz unrelated file.pdf', papers)).toBeNull();
    expect(matchPdfToPaper('年度报告最终版.pdf', papers)).toBeNull();
  });

  it('中文标题精确/空格变体命中', () => {
    expect(matchPdfToPaper('深度学习综述.pdf', papers)).toEqual({ paperId: 'p3', score: 1 });
    expect(matchPdfToPaper('深度 学习-综述.pdf', papers)?.paperId).toBe('p3');
  });

  it('阈值可配置：调高阈值可排除 0.9 的包含式候选', () => {
    expect(matchPdfToPaper('Attention Is All You Need 2017.pdf', papers, 0.95)).toBeNull();
    expect(matchPdfToPaper('Attention Is All You Need 2017.pdf', papers, 0.9)).toEqual({
      paperId: 'p1',
      score: 0.9,
    });
  });

  it('空库 / 空文件名 / 纯扩展名 → null', () => {
    expect(matchPdfToPaper('x.pdf', [])).toBeNull();
    expect(matchPdfToPaper('', papers)).toBeNull();
    expect(matchPdfToPaper('.pdf', papers)).toBeNull();
  });

  it('文件名为标题片段（标题包含文件名）→ 0.75 仍过默认阈值', () => {
    expect(matchPdfToPaper('Attention.pdf', papers)).toEqual({ paperId: 'p1', score: 0.75 });
  });

  it('轻微拼写差异走编辑距离相似度兜底命中', () => {
    const m = matchPdfToPaper('Attention Was All You Need.pdf', papers);
    expect(m?.paperId).toBe('p1');
    expect(m!.score).toBeGreaterThanOrEqual(0.65);
  });
});

// ---------------------------------------------------------------------------
// 纯函数：paperIdentity / readFileArrayBuffer
// ---------------------------------------------------------------------------

describe('paperIdentity / readFileArrayBuffer', () => {
  it('身份键优先级：doi > arxivId > 小写标题', () => {
    expect(paperIdentity({ doi: '10.1/X ', title: 'T' })).toBe('doi:10.1/x');
    expect(paperIdentity({ arxivId: '2303.08774 ', title: 'T' })).toBe('arxiv:2303.08774');
    expect(paperIdentity({ title: '  Some Title ' })).toBe('title:some title');
  });

  it('readFileArrayBuffer 读出文件字节', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' });
    const buf = await readFileArrayBuffer(file);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

// ---------------------------------------------------------------------------
// 组件：LibraryPanel「Zotero JSON」与「PDF 目录」入口
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZOTERO_JSON = JSON.stringify([
  {
    itemType: 'journalArticle',
    title: 'Attention Is All You Need',
    creators: [{ creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' }],
    date: '2017-06',
    publicationTitle: 'Advances in Neural Information Processing Systems',
    DOI: '10.5555/3294771.3295107',
    tags: [{ tag: 'transformer' }],
    collections: ['COLL1'],
    key: 'ITEM1',
  },
  {
    itemType: 'preprint',
    title: 'GPT-4 Technical Report',
    creators: [{ creatorType: 'author', name: 'OpenAI' }],
    date: '2023-03-15',
    extra: 'arXiv: 2303.08774',
    collections: ['COLL1'],
    key: 'ITEM2',
  },
  { collections: [{ key: 'COLL1', name: 'LLM' }] },
]);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function btn(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 注入 input.files（jsdom 无法真实选取文件夹）并触发 change。 */
function pickFiles(input: HTMLInputElement, files: File[]) {
  const list = {
    length: files.length,
    ...Object.fromEntries(files.map((f, i) => [String(i), f])),
  };
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * 轮询式异步排空：jsdom 的 FileReader 完成回调走 setImmediate（check 阶段），
 * 与 setTimeout（timers 阶段）的先后受事件循环所处相位影响，单次 setTimeout(0)
 * 不保证排空——这里多轮驱动事件循环直到条件满足（FileReader → resolve → 后续
 * setState 全部落地），确定性消除 flake。
 */
async function flushUntil(cond: () => boolean, rounds = 25): Promise<void> {
  for (let i = 0; i < rounds && !cond(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  useUiStore.setState({ libraryMode: 'list', libraryDialog: null });
  useLibraryStore.setState({ papers: [], pdfAttachments: {}, indexReady: true });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(LibraryPanel));
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('LibraryPanel · Zotero JSON 导入入口', () => {
  it('工具栏渲染「Zotero JSON」按钮（RIS 之后），点击打开粘贴对话框', () => {
    const labels = [...container!.querySelectorAll<HTMLButtonElement>('.sf-lib-toolbar button')].map(
      (b) => b.textContent?.trim(),
    );
    expect(labels).toContain('Zotero JSON');
    expect(labels!.indexOf('Zotero JSON')).toBeGreaterThan(labels!.indexOf('RIS'));

    click(btn('Zotero JSON'));
    expect(container!.querySelector('.sf-lib-dialog')).toBeTruthy();
    expect(container!.querySelector('header strong')!.textContent).toBe('导入 Zotero JSON');
    expect(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')).toBeTruthy();
    // 不占用 uiStore.libraryDialog（该类型归集成者所有）
    expect(useUiStore.getState().libraryDialog).toBeNull();
  });

  it('粘贴合法 JSON → 导入 2 条：citekey 补齐、集合写入 zotero: tag、显示「导入 2 条 / 跳过重复 0 / 错误 0」', () => {
    click(btn('Zotero JSON'));
    typeInto(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!, ZOTERO_JSON);
    click(btn('导入'));

    const papers = useLibraryStore.getState().papers;
    expect(papers).toHaveLength(2);
    expect(papers.every((p) => p.citekey.length > 0)).toBe(true);
    expect(papers.some((p) => p.citekey.startsWith('vaswani:2017:'))).toBe(true);
    const gpt4 = papers.find((p) => p.title === 'GPT-4 Technical Report');
    expect(gpt4?.arxivId).toBe('2303.08774');
    expect(gpt4?.authors).toEqual([{ family: 'OpenAI' }]);
    expect(gpt4?.tags).toContain(`${ZOTERO_TAG_PREFIX}LLM`);
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe(
      '导入 2 条 / 跳过重复 0 / 错误 0',
    );
    // 导入成功后清空粘贴区
    expect(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!.value).toBe('');
  });

  it('与库内重复（同 DOI）的条目跳过计 dupes：「导入 1 条 / 跳过重复 1 / 错误 0」', () => {
    useLibraryStore.setState({
      papers: [
        makePaper({
          id: 'dup',
          citekey: 'existing',
          title: 'Attention Is All You Need',
          doi: '10.5555/3294771.3295107',
        }),
      ],
    });
    click(btn('Zotero JSON'));
    typeInto(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!, ZOTERO_JSON);
    click(btn('导入'));

    const papers = useLibraryStore.getState().papers;
    expect(papers).toHaveLength(2); // 既有 1 条 + 新增 1 条（重复的按 DOI 跳过）
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe(
      '导入 1 条 / 跳过重复 1 / 错误 0',
    );
  });

  it('同一批次内的重复条目（同 arXiv ID）也跳过', () => {
    const text = JSON.stringify([
      { itemType: 'preprint', title: 'T1', arxivId: '2303.08774' },
      { itemType: 'preprint', title: 'T1 duplicate', extra: 'arXiv: 2303.08774' },
    ]);
    click(btn('Zotero JSON'));
    typeInto(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!, text);
    click(btn('导入'));
    expect(useLibraryStore.getState().papers).toHaveLength(1);
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe(
      '导入 1 条 / 跳过重复 1 / 错误 0',
    );
  });

  it('坏 JSON → 「导入 0 条 / 跳过重复 0 / 错误 1」', () => {
    click(btn('Zotero JSON'));
    typeInto(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!, '[{"itemType": ');
    click(btn('导入'));
    expect(useLibraryStore.getState().papers).toHaveLength(0);
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe(
      '导入 0 条 / 跳过重复 0 / 错误 1',
    );
  });

  it('「关闭」按钮关闭对话框且不导入；空文本时导入按钮禁用', () => {
    click(btn('Zotero JSON'));
    expect(btn('导入').disabled).toBe(true);
    typeInto(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!, ZOTERO_JSON);
    expect(btn('导入').disabled).toBe(false);
    click(btn('关闭'));
    expect(container!.querySelector('.sf-lib-dialog')).toBeNull();
    expect(useLibraryStore.getState().papers).toHaveLength(0);
  });
});

describe('LibraryPanel · PDF 目录批量关联入口', () => {
  beforeEach(() => {
    useLibraryStore.setState({ papers: [ATTENTION] });
  });

  function openPdfDir(): HTMLInputElement {
    click(btn('PDF 目录'));
    const input = container!.querySelector<HTMLInputElement>('input[webkitdirectory]');
    if (!input) throw new Error('webkitdirectory input not found');
    return input;
  }

  it('工具栏渲染「PDF 目录」按钮，打开对话框（含 webkitdirectory multiple 的隐藏 file input）', () => {
    const input = openPdfDir();
    expect(container!.querySelector('header strong')!.textContent).toBe('批量关联 PDF 文件夹');
    expect(input.hasAttribute('multiple')).toBe(true);
    expect(useUiStore.getState().libraryDialog).toBeNull();
  });

  it('选择文件夹 → 预览列表：匹配条目显示标题 + 置信度、未匹配标记「无匹配」、统计「匹配 1 / 共 2 个 PDF」', () => {
    const input = openPdfDir();
    pickFiles(input, [
      new File([new Uint8Array([1])], 'Attention Is All You Need.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array([2])], 'zzz-unrelated.pdf', { type: 'application/pdf' }),
    ]);

    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('匹配 1 / 共 2 个 PDF');
    const rows = [...container!.querySelectorAll('.sf-lib-pdfdir li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Attention Is All You Need.pdf');
    expect(rows[0]!.textContent).toContain('Attention Is All You Need');
    expect(rows[0]!.textContent).toContain('置信度 100%');
    expect(rows[1]!.textContent).toContain('zzz-unrelated.pdf');
    expect(rows[1]!.textContent).toContain('无匹配');
  });

  it('文件夹无 PDF → 提示「所选文件夹中没有 PDF 文件」且无预览', () => {
    const input = openPdfDir();
    pickFiles(input, [new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })]);
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('所选文件夹中没有 PDF 文件');
    expect(container!.querySelector('.sf-lib-pdfdir')).toBeNull();
  });

  it('「关联全部」→ 逐个读字节调 attachPdf（仅匹配项），显示「关联成功 1 个」', async () => {
    const attachPdf = vi.fn(() => true);
    useLibraryStore.setState({ attachPdf });

    const input = openPdfDir();
    pickFiles(input, [
      new File([new Uint8Array([9, 9])], 'attention-is-all-you-need.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array([2])], 'zzz-unrelated.pdf', { type: 'application/pdf' }),
    ]);
    click(btn('关联全部'));
    await flushUntil(() => attachPdf.mock.calls.length > 0);

    expect(attachPdf).toHaveBeenCalledTimes(1);
    expect(attachPdf).toHaveBeenCalledWith('p1', expect.any(ArrayBuffer));
    await flushUntil(() => container!.querySelector('.sf-cites-msg')?.textContent !== '匹配 1 / 共 2 个 PDF');
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('关联成功 1 个');
  });

  it('attachPdf 返回 false（条目已被删）计入失败：「关联成功 0 个 / 失败 1 个」', async () => {
    const attachPdf = vi.fn(() => false);
    useLibraryStore.setState({ attachPdf });
    const input = openPdfDir();
    pickFiles(input, [
      new File([new Uint8Array([1])], 'Attention Is All You Need.pdf', { type: 'application/pdf' }),
    ]);
    click(btn('关联全部'));
    await flushUntil(() => attachPdf.mock.calls.length > 0);
    await flushUntil(() => container!.querySelector('.sf-cites-msg')?.textContent !== '匹配 1 / 共 1 个 PDF');
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('关联成功 0 个 / 失败 1 个');
  });

  it('全部无匹配时「关联全部」禁用；「关闭」按钮关闭对话框', () => {
    const input = openPdfDir();
    pickFiles(input, [new File([new Uint8Array([1])], 'zzz-unrelated.pdf', { type: 'application/pdf' })]);
    expect(btn('关联全部').disabled).toBe(true);
    click(btn('关闭'));
    expect(container!.querySelector('.sf-lib-dialog')).toBeNull();
  });
});
