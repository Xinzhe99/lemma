/**
 * 阅读队列管理（v2.8.0 ①）：把文献从“堆积”变为“有优先级的队列”。
 *
 * 纯函数层：计算优先级排序 + 阅读负载统计。
 * 优先级信号（加权）：
 *  - readStatus：to-read = +3（最需要读）
 *  - 被稿件引用：citedCount × 2（引用了的更应该读）
 *  - 新入库（7 天内）：+1（新鲜度）
 *  - 用户手动标记优先（rating >= 4）：+2
 * 输出：降序列表 + 统计摘要。
 */

import type { Paper } from '@lemma/shared';

export interface QueueItem {
  paper: Paper;
  /** 优先级得分（越高越先读） */
  score: number;
  /** 得分分解（展示用） */
  reasons: string[];
  citedCount: number;
}

export interface QueueSummary {
  /** 队列总条目 */
  total: number;
  /** to-read 状态的条目 */
  unread: number;
  /** 建议今日阅读数（基于队列大小，3-5 条） */
  dailyTarget: number;
}

/** 单篇文献优先级计算 */
export function paperScore(p: Paper, citedCount: number, now = Date.now()): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (p.readStatus === 'to-read') {
    score += 3;
    reasons.push('待读');
  } else if (p.readStatus === 'reading') {
    score += 1;
    reasons.push('在读');
  }

  if (citedCount > 0) {
    score += citedCount * 2;
    reasons.push(`已被引 ${citedCount} 次`);
  }

  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  if (p.addedAt > weekAgo) {
    score += 1;
    reasons.push('近一周入库');
  }

  if (p.rating !== undefined && p.rating >= 4) {
    score += 2;
    reasons.push(`高优先级 ${'★'.repeat(p.rating)}`);
  }

  return { score, reasons };
}

/** 生成阅读队列（降序） */
export function buildQueue(papers: Paper[], citedCounts: Map<string, number>, now = Date.now()): QueueItem[] {
  const items = papers.map((p) => {
    const cc = citedCounts.get(p.citekey) ?? 0;
    const { score, reasons } = paperScore(p, cc, now);
    return { paper: p, score, reasons, citedCount: cc };
  });
  return items.filter((i) => i.score > 0).sort((a, b) => b.score - a.score);
}

/** 队列统计 */
export function queueSummary(items: QueueItem[]): QueueSummary {
  const unread = items.filter((i) => i.paper.readStatus === 'to-read').length;
  const dailyTarget = unread === 0 ? 0 : Math.min(5, Math.max(3, Math.ceil(unread / 7)));
  return { total: items.length, unread, dailyTarget };
}
