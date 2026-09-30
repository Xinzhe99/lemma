/**
 * WF-1 期刊推荐（S5）：纯函数打分——
 *   score = min(库内 venue 频次, 上限) × 0.2 + 摘要与档案 scope 词表命中数 × 0.25
 * 只依据本地数据（文献库 venue + 稿件摘要），不联网；设计文档 4.6 的
 * OpenAlex 期刊画像（影响因子/审稿周期）属终态增强，不在此范围。
 */

import { findVenueProfile, normalizeVenueText, VENUE_PROFILES, type VenueProfile } from './venues';

export interface VenueRecommendation {
  venue: VenueProfile;
  reason: string;
  score: number;
}

/** 推荐只需 venue.name；文献库完整 Paper（venue: Venue）天然可赋值 */
export type PaperVenueRef = { venue?: { name?: string } };

export type RecommendLang = 'zh' | 'en';

/** 频次权重与上限（库内 5+ 篇封顶，避免大户场所垄断） */
const FREQ_WEIGHT = 0.2;
const FREQ_CAP = 5;
/** 每个命中的 scope 关键词权重 */
const SCOPE_WEIGHT = 0.25;

function scoreOf(freq: number, scopeHits: number): number {
  return Number((Math.min(freq, FREQ_CAP) * FREQ_WEIGHT + scopeHits * SCOPE_WEIGHT).toFixed(2));
}

function buildReason(freq: number, scopeHits: string[], lang: RecommendLang): string {
  const shown = scopeHits.slice(0, 4);
  if (lang === 'en') {
    const parts: string[] = [];
    parts.push(freq > 0 ? `${freq} of your library papers were published here` : 'no library papers here yet');
    parts.push(
      scopeHits.length > 0
        ? `abstract matches ${scopeHits.length} scope keyword(s): ${shown.join(', ')}`
        : 'abstract does not overlap the scope vocabulary',
    );
    return parts.join('; ') + '.';
  }
  const parts: string[] = [];
  parts.push(freq > 0 ? `库内 ${freq} 篇文献发表于此` : '库内暂无发表记录');
  parts.push(
    scopeHits.length > 0
      ? `摘要命中 scope 关键词 ${scopeHits.length} 个（${shown.join('、')}）`
      : '摘要与 scope 词表暂无重叠',
  );
  return parts.join('；') + '。';
}

/**
 * 推荐目标期刊/会议：
 * - papers：文献库条目（只读 venue.name；库内发表去向是强信号）；
 * - abstractText：稿件摘要（与档案 scope 词表做归一化子串匹配，中英文均可）；
 * - 返回按分数降序的 top-3（零分场所不返回）。
 */
export function recommendVenues(
  papers: ReadonlyArray<PaperVenueRef>,
  abstractText: string,
  lang: RecommendLang = 'zh',
  profiles: readonly VenueProfile[] = VENUE_PROFILES,
): VenueRecommendation[] {
  const abstractNorm = normalizeVenueText(abstractText.toLowerCase());

  const freqByVenue = new Map<VenueProfile, number>();
  for (const paper of papers) {
    const name = paper.venue?.name;
    if (!name) continue;
    const hit = findVenueProfile(name, profiles);
    if (!hit) continue;
    freqByVenue.set(hit, (freqByVenue.get(hit) ?? 0) + 1);
  }

  const result: VenueRecommendation[] = [];
  for (const venue of profiles) {
    const scopeHits = venue.scope.filter((kw) => {
      const k = normalizeVenueText(kw);
      return k.length > 0 && abstractNorm.includes(k);
    });
    const freq = freqByVenue.get(venue) ?? 0;
    if (freq === 0 && scopeHits.length === 0) continue;
    result.push({
      venue,
      score: scoreOf(freq, scopeHits.length),
      reason: buildReason(freq, scopeHits, lang),
    });
  }

  result.sort((a, b) => b.score - a.score || a.venue.id.localeCompare(b.venue.id));
  return result.slice(0, 3);
}

/** 从项目 tex 源码中抽取摘要（\begin{abstract}...\end{abstract}，无则空串） */
export function extractAbstractFromTex(files: Record<string, string>): string {
  const texAll = Object.entries(files)
    .filter(([path]) => path.endsWith('.tex'))
    .map(([, content]) => content)
    .join('\n');
  const m = texAll.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  if (!m) return '';
  return m[1]!
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
