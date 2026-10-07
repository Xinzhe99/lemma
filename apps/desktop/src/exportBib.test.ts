// @vitest-environment jsdom
/**
 * exportLibraryBib（v7.8.0 回归）：
 *  - citedOnly 导出认 natbib 两段可选参数引用 `\citep[see][p. 3]{key}`（此前整条漏掉）；
 *  - 稿件一处引用都没有时不再把整个文献库当「被引文献」写出（返回 false）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

import { exportLibraryBib } from './exportBib';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';

function makePaper(overrides: Partial<Paper> & Pick<Paper, 'id' | 'citekey' | 'title'>): Paper {
  return {
    authors: [{ family: 'Doe', given: 'Jane' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...overrides,
  };
}

const PAPERS: Paper[] = [
  makePaper({ id: 'a', citekey: 'vaswani2017attention', title: 'Attention Is All You Need', year: 2017 }),
  makePaper({ id: 'b', citekey: 'brown2020language', title: 'Language Models are Few-Shot Learners', year: 2020 }),
];

/** jsdom 的 Blob 没有 text()：用子类截获构造入参（bib 文本就是第一个 part） */
const blobTexts: string[] = [];
class CaptureBlob extends Blob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    if (typeof parts?.[0] === 'string') blobTexts.push(parts[0]);
  }
}

const anchorClicks: HTMLAnchorElement[] = [];

beforeEach(() => {
  blobTexts.length = 0;
  anchorClicks.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('Blob', CaptureBlob);
  useLibraryStore.setState({ papers: PAPERS });
  useWorkspaceStore.setState({ projectName: 'demo', files: {} });
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:test'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exportLibraryBib · citedOnly', () => {
  it('两段可选参数的 \\citep[see][p. 3]{key} 也算被引 → 条目进 cited-refs.bib', () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': 'As shown in \\citep[see][p. 3]{vaswani2017attention}, attention works.' },
    });
    expect(exportLibraryBib(true)).toBe(true);
    expect(anchorClicks[0]!.download).toBe('cited-refs.bib');
    const bib = blobTexts[0]!;
    expect(bib).toContain('@article{vaswani2017attention');
    expect(bib).not.toContain('brown2020language');
  });

  it('稿件无任何 \\cite → 不下载整库（返回 false，无 blob）', () => {
    useWorkspaceStore.setState({ files: { 'main.tex': 'No citations yet.' } });
    expect(exportLibraryBib(true)).toBe(false);
    expect(blobTexts).toHaveLength(0);
    expect(anchorClicks).toHaveLength(0);
  });

  it('全库导出（citedOnly=false）仍导出全部条目', () => {
    useWorkspaceStore.setState({ files: { 'main.tex': 'No citations yet.' } });
    expect(exportLibraryBib(false)).toBe(true);
    expect(anchorClicks[0]!.download).toBe('library.bib');
    const bib = blobTexts[0]!;
    expect(bib).toContain('vaswani2017attention');
    expect(bib).toContain('brown2020language');
  });

  it('空文献库不产出文件', () => {
    useLibraryStore.setState({ papers: [] });
    expect(exportLibraryBib(false)).toBe(false);
    expect(blobTexts).toHaveLength(0);
  });
});
