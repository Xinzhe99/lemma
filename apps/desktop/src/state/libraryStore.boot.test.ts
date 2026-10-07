// @vitest-environment jsdom
/**
 * 启动顺序回归（v7.8.0 数据丢失修复）：
 * libraryStore 模块加载即自举 hydrateAttachments()，而 initLibrary() 由 App 的 effect
 * 稍后才调用。若持久化订阅无条件把「当前内存 papers」写回 IndexedDB，则「附件 hydrate」
 * 这条只改 pdfAttachments 的 setState 会用尚未读回的空 papers 覆盖整库（sf-library 已被
 * 启动迁移搬进 IndexedDB，localStorage 副本不在 → 模块加载默认值为空数组）。
 * 本文件用 vi.resetModules() 复刻真实启动次序（先 import 模块 → 再 initLibrary）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p-old',
    citekey: 'old2020',
    title: 'Old Paper',
    authors: [{ family: 'Old', given: 'A' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...overrides,
  };
}

/** 冲刷异步队列（hydrate 附件 / 迁移 / 落盘队列均跨微任务与宏任务）。 */
async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('启动顺序：附件 hydrate 不得覆盖持久库', () => {
  it('模块加载期 hydrate 先于 initLibrary 完成时，IndexedDB 里的库不被清空', async () => {
    expect.assertions(4);
    const db = await import('../storage/db');
    db.__resetStorageForTests();
    const kv = await import('../storage/kvStore');
    kv.__resetKvStoreForTests();

    // 上一会话的持久状态：库只在 IndexedDB（localStorage 已被迁移搬空）+ 一条 PDF 附件
    await db.kvSet('sf-library', { papers: [makePaper()], seeded: true });
    await db.attachmentPut({
      paperId: 'p-old',
      data: new Blob([new Uint8Array([1, 2, 3])]),
      name: 'old2020.pdf',
      savedAt: 1,
    });

    // 模块加载即自举（与 App 启动同序）：hydrate 附件先跑，initLibrary 稍后（effect）才跑
    const lib = await import('./libraryStore');
    await flush();

    const persisted = (await db.kvGet('sf-library')) as { papers: Paper[]; seeded: boolean };
    expect(persisted.papers.map((p) => p.id)).toEqual(['p-old']); // 启动期写入不得清库
    expect(lib.useLibraryStore.getState().papers).toEqual([]); // initLibrary 前内存仍为空

    await lib.initLibrary();

    expect(lib.useLibraryStore.getState().papers.map((p) => p.id)).toEqual(['p-old']);
    expect(lib.useLibraryStore.getState().pdfAttachments['p-old']).toBeDefined(); // 附件也 hydrate 到位
  });

  it('启动后真实删库仍会落盘（空库 + seeded 标记），落盘策略未被过度收紧', async () => {
    expect.assertions(2);
    const db = await import('../storage/db');
    db.__resetStorageForTests();
    const kv = await import('../storage/kvStore');
    kv.__resetKvStoreForTests();
    await db.kvSet('sf-library', { papers: [makePaper()], seeded: true });

    const lib = await import('./libraryStore');
    await lib.initLibrary();

    lib.useLibraryStore.getState().removePapers(['p-old']);
    await flush();

    const persisted = (await db.kvGet('sf-library')) as { papers: Paper[]; seeded: boolean };
    expect(persisted.papers).toEqual([]);
    expect(persisted.seeded).toBe(true);
  });

  it('全新环境（无持久数据）首次启动仍注入种子文献并落盘', async () => {
    expect.assertions(2);
    const db = await import('../storage/db');
    db.__resetStorageForTests();
    const kv = await import('../storage/kvStore');
    kv.__resetKvStoreForTests();

    const lib = await import('./libraryStore');
    await lib.initLibrary();
    await flush();

    expect(lib.useLibraryStore.getState().papers).toHaveLength(3);
    const persisted = (await db.kvGet('sf-library')) as { papers: Paper[]; seeded: boolean };
    expect(persisted.papers).toHaveLength(3);
  });
});
