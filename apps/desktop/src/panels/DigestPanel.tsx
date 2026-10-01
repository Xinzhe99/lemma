/**
 * arXiv 每日晨报面板（设计 D-6「每天打开」习惯闭环）：
 *  - 挂载即 loadCachedDigest 显示上次结果（离线可见），随后自动静默 fetchDigest 刷新
 *    （失败不打扰，仅顶部小字提示；无订阅时不发起请求）；
 *  - 订阅管理：列表 + 添加输入框（label + query）+ 删除；空订阅时给引导文案与两个
 *    示例订阅一键添加；
 *  - 「近三日新论文」按发表日期降序分组：标题（arXiv 链接）、作者前 3、分类 chips、
 *    摘要折叠（details）；每条【加入文献库】映射 PaperSearchHit → importHit 一键入库，
 *    成功后按钮变「已入库」（以库内 arxivId 对账，重启面板仍正确）。
 *
 * 复用说明（波次 2 Dashboard）：本面板无 props，Dashboard 可直接 `<DigestPanel />`
 * 整体渲染，或复用 `useDigestStore` 的 items/subscriptions + `groupDigestByDate`
 * 自行组装展示块。样式复用 sf-btn / sf-chip / placeholder 等既有类，交互测试挂钩
 * 使用 sf-digest-* 语义类名（不新增 CSS 文件）。
 */

import { useEffect, useMemo, useState } from 'react';
import type { PaperAuthor } from '@scholarforge/shared';
import type { PaperSearchHit } from '@scholarforge/library';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useLibraryStore } from '../state/libraryStore';
import {
  groupDigestByDate,
  localDateKey,
  useDigestStore,
  type DigestPaper,
  type DigestSubscription,
} from '../state/digestStore';

// ---------------------------------------------------------------------------
// 双语文案（组件内本地字典，不进全局 i18n）
// ---------------------------------------------------------------------------

interface DigestDict {
  title: string;
  subtitle: string;
  refresh: string;
  loading: string;
  fetchedAt(time: string): string;
  subsTitle: string;
  labelPlaceholder: string;
  queryPlaceholder: string;
  add: string;
  needQuery: string;
  remove: string;
  emptyHint: string;
  exampleHint: string;
  today(date: string): string;
  noPapers: string;
  importBtn: string;
  imported: string;
  abstract: string;
  etAl: string;
}

const DICT: Record<Language, DigestDict> = {
  zh: {
    title: '每日晨报',
    subtitle: 'arXiv 近三日新论文',
    refresh: '刷新',
    loading: '正在拉取晨报…',
    fetchedAt: (time) => `上次更新 ${time}`,
    subsTitle: '我的订阅',
    labelPlaceholder: '标签（如：大语言模型）',
    queryPlaceholder: '关键词（如：llm reasoning，空格分隔多个词）',
    add: '添加',
    needQuery: '请先填写关键词',
    remove: '删除',
    emptyHint: '添加你的研究方向关键词，每天打开即见新论文',
    exampleHint: '试试这些示例：',
    today: (date) => `今天 · ${date}`,
    noPapers: '近三日暂无新论文，明天再来看看',
    importBtn: '加入文献库',
    imported: '已入库',
    abstract: '摘要',
    etAl: ' 等',
  },
  en: {
    title: 'Daily digest',
    subtitle: 'New arXiv papers in the last 3 days',
    refresh: 'Refresh',
    loading: 'Fetching digest…',
    fetchedAt: (time) => `Updated ${time}`,
    subsTitle: 'My subscriptions',
    labelPlaceholder: 'Label (e.g.: LLM)',
    queryPlaceholder: 'Keywords (e.g.: llm reasoning, space-separated)',
    add: 'Add',
    needQuery: 'Keywords required',
    remove: 'Remove',
    emptyHint: 'Add keywords for your research direction — new papers greet you every day',
    exampleHint: 'Try an example:',
    today: (date) => `Today · ${date}`,
    noPapers: 'No new papers in the last 3 days — check back tomorrow',
    importBtn: 'Add to library',
    imported: 'In library',
    abstract: 'Abstract',
    etAl: ' et al.',
  },
};

/** 空订阅引导的两个示例订阅（一键添加）。 */
const EXAMPLE_SUBSCRIPTIONS: Array<Pick<DigestSubscription, 'label' | 'query'>> = [
  { label: '大语言模型', query: 'llm reasoning' },
  { label: '计算机视觉', query: 'diffusion model' },
];

/** 作者显示行：前 3 位（given family），超出显示「等 / et al.」。 */
function authorLine(authors: PaperAuthor[], max: number, etAl: string): string {
  const names = authors
    .map((a) => [a.given, a.family].filter(Boolean).join(' '))
    .filter(Boolean);
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown}${etAl}` : shown;
}

/** 晨报条目 → PaperSearchHit（importHit 的入参形状）。 */
function toSearchHit(p: DigestPaper): PaperSearchHit {
  const year = Number(p.publishedAt.slice(0, 4));
  return {
    source: 'arxiv',
    title: p.title,
    authors: p.authors,
    year: Number.isFinite(year) ? year : undefined,
    venue: { type: 'preprint', name: 'arXiv' },
    abstract: p.abstract,
    arxivId: p.arxivId,
    tags: p.categories,
  };
}

export function DigestPanel() {
  const language = useSettingsStore((s) => s.language);
  const d = DICT[language];

  const subscriptions = useDigestStore((s) => s.subscriptions);
  const items = useDigestStore((s) => s.items);
  const lastFetchedAt = useDigestStore((s) => s.lastFetchedAt);
  const loading = useDigestStore((s) => s.loading);
  const error = useDigestStore((s) => s.error);
  const addSubscription = useDigestStore((s) => s.addSubscription);
  const removeSubscription = useDigestStore((s) => s.removeSubscription);
  const loadCachedDigest = useDigestStore((s) => s.loadCachedDigest);
  const fetchDigest = useDigestStore((s) => s.fetchDigest);

  const papers = useLibraryStore((s) => s.papers);

  const [labelInput, setLabelInput] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [addHint, setAddHint] = useState<string | null>(null);
  /** 本次会话内已入库的条目键（arxivId 优先，无 id 用标题） */
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());

  // 挂载即：读缓存显示（离线可见）→ 有订阅则静默刷新（失败不打扰）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadCachedDigest();
      if (cancelled) return;
      if (useDigestStore.getState().subscriptions.length === 0) return;
      await fetchDigest();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCachedDigest, fetchDigest]);

  /** 库内已有的 arXiv 条目集合（「已入库」状态跨会话正确）。 */
  const libraryArxivIds = useMemo(
    () => new Set(papers.map((p) => p.arxivId).filter((id): id is string => !!id)),
    [papers],
  );
  const libraryTitles = useMemo(
    () => new Set(papers.map((p) => p.title.toLowerCase())),
    [papers],
  );

  const isImported = (p: DigestPaper): boolean => {
    const key = p.arxivId ?? p.title.toLowerCase();
    return importedKeys.has(key) || (p.arxivId ? libraryArxivIds.has(p.arxivId) : libraryTitles.has(p.title.toLowerCase()));
  };

  const importPaper = (p: DigestPaper) => {
    if (isImported(p)) return;
    useLibraryStore.getState().importHit(toSearchHit(p));
    setImportedKeys((prev) => {
      const next = new Set(prev);
      next.add(p.arxivId ?? p.title.toLowerCase());
      return next;
    });
  };

  const groups = useMemo(() => groupDigestByDate(items), [items]);
  const todayKey = localDateKey(new Date());

  const submitAdd = () => {
    if (addSubscription(labelInput, queryInput)) {
      setLabelInput('');
      setQueryInput('');
      setAddHint(null);
      // 添加首个/新订阅后立即静默拉取一次，让新用户当场看到结果
      void fetchDigest();
    } else {
      setAddHint(d.needQuery);
    }
  };

  const addExample = (label: string, query: string) => {
    addSubscription(label, query);
    void fetchDigest();
  };

  const fetchedAtText =
    lastFetchedAt !== null
      ? d.fetchedAt(
          new Date(lastFetchedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
            hour12: false,
          }),
        )
      : null;

  return (
    <div className="sf-digest">
      <div
        className="sf-digest-head"
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}
      >
        <h3 className="sf-digest-title">
          {d.title}
          <span className="sf-digest-subtitle" style={{ marginLeft: 6, fontSize: '0.85em', opacity: 0.75 }}>
            {d.subtitle}
          </span>
        </h3>
        <span style={{ flex: 1 }} />
        {fetchedAtText && (
          <span className="sf-digest-meta sf-digest-fetchedat" style={{ fontSize: '0.8em', opacity: 0.75 }}>
            {fetchedAtText}
          </span>
        )}
        <button type="button" className="sf-btn sf-digest-refresh" onClick={() => void fetchDigest()}>
          {d.refresh}
        </button>
      </div>

      {/* 拉取失败：顶部小字提示（不打扰；下方缓存内容继续可见） */}
      {error && !loading && (
        <p className="sf-digest-error" style={{ margin: '4px 0', fontSize: '0.8em', opacity: 0.8 }}>
          {error}
        </p>
      )}
      {loading && (
        <p className="sf-digest-loading" style={{ margin: '4px 0', fontSize: '0.8em', opacity: 0.75 }}>
          {d.loading}
        </p>
      )}

      {/* 订阅管理 */}
      <section className="sf-digest-subs" style={{ marginTop: 8 }}>
        <h4 style={{ margin: '6px 0' }}>{d.subsTitle}</h4>
        {subscriptions.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {subscriptions.map((sub) => (
              <li
                key={sub.id}
                className="sf-digest-sub"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
              >
                <span className="sf-digest-sub-label">{sub.label}</span>
                <code className="sf-digest-sub-query" style={{ opacity: 0.75 }}>
                  {sub.query}
                </code>
                <button
                  type="button"
                  className="sf-btn sf-digest-sub-del"
                  title={d.remove}
                  onClick={() => removeSubscription(sub.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="sf-digest-add" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <input
            className="sf-digest-input-label"
            style={{ width: 130, padding: '3px 6px' }}
            placeholder={d.labelPlaceholder}
            value={labelInput}
            spellCheck={false}
            aria-label={d.labelPlaceholder}
            onChange={(e) => setLabelInput(e.target.value)}
          />
          <input
            className="sf-digest-input-query"
            style={{ flex: 1, minWidth: 140, padding: '3px 6px' }}
            placeholder={d.queryPlaceholder}
            value={queryInput}
            spellCheck={false}
            aria-label={d.queryPlaceholder}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAdd();
            }}
          />
          <button type="button" className="sf-btn sf-digest-add-btn" onClick={submitAdd}>
            {d.add}
          </button>
        </div>
        {addHint && (
          <p className="sf-digest-add-hint" style={{ margin: '4px 0', fontSize: '0.8em', opacity: 0.75 }}>
            {addHint}
          </p>
        )}

        {subscriptions.length === 0 && (
          <div className="sf-digest-empty" style={{ marginTop: 10 }}>
            <p className="placeholder" style={{ margin: '4px 0' }}>
              {d.emptyHint}
            </p>
            <p style={{ margin: '4px 0', fontSize: '0.85em', opacity: 0.75 }}>{d.exampleHint}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {EXAMPLE_SUBSCRIPTIONS.map((ex) => (
                <button
                  key={ex.query}
                  type="button"
                  className="sf-btn sf-digest-example"
                  onClick={() => addExample(ex.label, ex.query)}
                >
                  {ex.label} · {ex.query}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 近三日新论文：按日期降序分组 */}
      <section className="sf-digest-days" style={{ marginTop: 12 }}>
        {groups.map((group) => (
          <div key={group.date} className="sf-digest-day" style={{ marginTop: 10 }}>
            <h4 className="sf-digest-day-head" style={{ margin: '6px 0' }}>
              {group.date === todayKey ? d.today(group.date) : group.date}
              <span style={{ marginLeft: 6, fontSize: '0.8em', opacity: 0.65 }}>{group.items.length}</span>
            </h4>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {group.items.map((p) => {
                const imported = isImported(p);
                return (
                  <li
                    key={p.arxivId ?? p.title}
                    className="sf-digest-item"
                    style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}
                  >
                    <div
                      className="sf-digest-item-head"
                      style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
                    >
                      {p.arxivId ? (
                        <a
                          className="sf-digest-item-title"
                          href={`https://arxiv.org/abs/${p.arxivId}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ flex: 1 }}
                        >
                          {p.title}
                        </a>
                      ) : (
                        <span className="sf-digest-item-title" style={{ flex: 1 }}>
                          {p.title}
                        </span>
                      )}
                      <button
                        type="button"
                        className="sf-btn sf-digest-import"
                        disabled={imported}
                        onClick={() => importPaper(p)}
                      >
                        {imported ? d.imported : d.importBtn}
                      </button>
                    </div>
                    {p.authors.length > 0 && (
                      <p className="sf-digest-item-authors" style={{ margin: '2px 0', fontSize: '0.85em' }}>
                        {authorLine(p.authors, 3, d.etAl)}
                      </p>
                    )}
                    {p.categories.length > 0 && (
                      <div
                        className="sf-digest-item-chips"
                        style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '2px 0' }}
                      >
                        {p.categories.map((c) => (
                          <span key={c} className="sf-chip dim">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.abstract && (
                      <details className="sf-digest-abstract">
                        <summary style={{ cursor: 'pointer', fontSize: '0.85em' }}>{d.abstract}</summary>
                        <p style={{ margin: '4px 0', fontSize: '0.85em', lineHeight: 1.5 }}>{p.abstract}</p>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {groups.length === 0 && !loading && subscriptions.length > 0 && (
          <p className="sf-digest-nopapers placeholder" style={{ margin: '8px 0' }}>
            {d.noPapers}
          </p>
        )}
      </section>
    </div>
  );
}
