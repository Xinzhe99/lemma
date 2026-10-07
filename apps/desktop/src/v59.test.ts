// @vitest-environment jsdom
/**
 * v5.9.0：Zotero 本地同步 + 会话产物清单。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

vi.mock('./platform/tauri', () => ({
  createTauriPlatform: () => null,
  tauriProcRun: vi.fn(),
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
}));

import { probeZotero, syncZotero } from './zoteroSync';
import { useAgentHubStore } from '@lemma/agent-hub';
import { useLibraryStore, resetLibraryCaches } from './state/libraryStore';
import { tauriProcRun } from './platform/tauri';

const BIB = `@article{zotero2024new,
  title = {Synced From Zotero},
  author = {Wang, Wu},
  year = {2024},
  abstract = {A paper imported via Better BibTeX local endpoint.},
}`;

function makePaper(over: Partial<Paper> = {}): Paper {
  return {
    id: 'p1',
    citekey: 'existing2023',
    title: 'Existing',
    authors: [{ family: 'Li', given: 'Si' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLibraryCaches();
  useLibraryStore.setState({ papers: [makePaper()], pdfAttachments: {} });
});

describe('Zotero 本地同步', () => {
  it('端点不可用（fetch 与 curl 均失败）→ ok:false 带安装指引', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('conn refused'); }));
    (tauriProcRun as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('curl fail'));
    expect(await probeZotero()).toBe(false);
    const r = await syncZotero();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Zotero');
    vi.unstubAllGlobals();
  });

  it('fetch 成功 → 解析入库（新增 1，既有 citekey 去重）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => BIB }) as unknown as Response));
    const r = await syncZotero();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.added).toBe(1);
      expect(r.via).toBe('fetch');
    }
    const keys = useLibraryStore.getState().papers.map((p) => p.citekey);
    expect(keys).toContain('zotero2024new');
    expect(keys).toContain('existing2023');
    vi.unstubAllGlobals();
  });

  it('fetch 被 CORS 拦 → 回落 curl 成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('CORS blocked'); }));
    (tauriProcRun as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, stdout: BIB, stderr: '' });
    const r = await syncZotero();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.via).toBe('curl');
    expect(useLibraryStore.getState().papers.some((p) => p.citekey === 'zotero2024new')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('再次同步同一库 → 增量语义（0 新增，不重复）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => BIB }) as unknown as Response));
    await syncZotero();
    const r2 = await syncZotero();
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.added).toBe(0);
    expect(useLibraryStore.getState().papers.filter((p) => p.citekey === 'zotero2024new')).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('会话产物（recordArtifact）', () => {
  it('记录 edit/create；同文件只留最新；持久化序列化保留字段', async () => {
    const { serializeSessionsForPersist } = await import('@lemma/agent-hub');
    const sid = useAgentHubStore.getState().newSession('host', 'proj');
    const st = useAgentHubStore.getState();
    st.recordArtifact(sid, 'main.tex', 'edit');
    st.recordArtifact(sid, 'response-letter.tex', 'create');
    st.recordArtifact(sid, 'main.tex', 'edit'); // 覆盖旧记录
    const s = useAgentHubStore.getState().sessions.find((x) => x.id === sid)!;
    expect(s.artifacts).toHaveLength(2);
    expect(s.artifacts!.find((a) => a.file === 'main.tex')!.kind).toBe('edit');
    expect(s.artifacts!.find((a) => a.file === 'response-letter.tex')!.kind).toBe('create');
    // 序列化（持久化路径）保留 artifacts
    const saved = serializeSessionsForPersist(useAgentHubStore.getState().sessions);
    expect(saved.find((x) => x.id === sid)!.artifacts).toHaveLength(2);
    useAgentHubStore.getState().deleteSession(sid);
  });

  it('不存在的会话 → 不产生带 artifacts 的会话', () => {
    useAgentHubStore.getState().recordArtifact('nope', 'x.tex', 'create');
    const withArtifacts = useAgentHubStore.getState().sessions.filter((x) => x.artifacts?.length);
    expect(withArtifacts.filter((x) => x.artifacts!.some((a) => a.file === 'x.tex'))).toHaveLength(0);
  });
});
