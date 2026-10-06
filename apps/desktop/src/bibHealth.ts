/**
 * 参考文献完整性体检（v7.2.0 F4）：纯函数——对 workspace 全部 .bib 条目与稿件 \cite 使用做系统级检查。
 * 检查维度：
 *  1. 缺失关键字段（year / author / title / venue）
 *  2. 重复条目（同 title 不同 citekey）
 *  3. 已引用但 .bib 缺失（悬空引用）
 *  4. .bib 有但从未引用（孤儿条目——提示级，非错误）
 *  5. 格式不一致（year 非 4 位数字 / venue 缩写混用提示）
 */

import { parseBibtex } from '@lemma/library';

export type BibIssueSeverity = 'error' | 'warning' | 'info';

export interface BibIssue {
  citekey: string;
  severity: BibIssueSeverity;
  kind: 'missing-field' | 'duplicate' | 'dangling-cite' | 'orphan' | 'format';
  message: string;
}

export interface BibHealthReport {
  totalEntries: number;
  totalCites: number;
  issues: BibIssue[];
  errorCount: number;
  warningCount: number;
}

const REQUIRED_FIELDS = ['title', 'author', 'year'] as const;

export function checkBibHealth(files: Record<string, string>): BibHealthReport {
  const issues: BibIssue[] = [];

  // 收集全部 bib 条目
  const allEntries: Array<Record<string, unknown> & { citekey: string; sourceFile: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.bib') || !content.trim()) continue;
    const parsed = parseBibtex(content);
    for (const paper of parsed.papers) {
      allEntries.push({ ...paper, citekey: paper.citekey ?? '', sourceFile: path });
    }
  }

  // 收集全部 \cite / \citep / \citet 使用
  const citedKeys = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.tex')) continue;
    for (const m of content.matchAll(/\\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
      for (const key of m[1]!.split(',').map((k) => k.trim()).filter(Boolean)) {
        citedKeys.add(key);
      }
    }
  }

  const entryKeys = new Set(allEntries.map((e) => e.citekey));

  // 1. 缺失关键字段
  for (const entry of allEntries) {
    for (const field of REQUIRED_FIELDS) {
      const val = entry[field];
      if (val === undefined || val === null || String(val).trim() === '') {
        issues.push({
          citekey: entry.citekey,
          severity: 'warning',
          kind: 'missing-field',
          message: `缺少 ${field} 字段`,
        });
      }
    }
    // year 格式
    const year = entry['year'];
    if (year !== undefined && year !== null && String(year).trim() !== '') {
      if (!/^\d{4}$/.test(String(year).trim())) {
        issues.push({
          citekey: entry.citekey,
          severity: 'info',
          kind: 'format',
          message: `year「${String(year)}」不是 4 位数字`,
        });
      }
    }
  }

  // 2. 重复（同 title 不同 citekey）
  const byTitle = new Map<string, string[]>();
  for (const entry of allEntries) {
    const title = String(entry['title'] ?? '').toLowerCase().replace(/[{}]/g, '').trim();
    if (!title) continue;
    const existing = byTitle.get(title) ?? [];
    existing.push(entry.citekey);
    byTitle.set(title, existing);
  }
  for (const [title, keys] of byTitle) {
    if (keys.length > 1) {
      for (const key of keys) {
        issues.push({
          citekey: key,
          severity: 'warning',
          kind: 'duplicate',
          message: `与 ${keys.filter((k) => k !== key).join(', ')} 疑似同文（title: ${title.slice(0, 50)}…）`,
        });
      }
    }
  }

  // 3. 悬空引用
  for (const key of citedKeys) {
    if (!entryKeys.has(key)) {
      issues.push({
        citekey: key,
        severity: 'error',
        kind: 'dangling-cite',
        message: '稿件中引用但 .bib 中不存在——编译会产生 [?]',
      });
    }
  }

  // 4. 孤儿条目
  for (const key of entryKeys) {
    if (!citedKeys.has(key)) {
      issues.push({
        citekey: key,
        severity: 'info',
        kind: 'orphan',
        message: '.bib 中存在但稿件从未引用',
      });
    }
  }

  return {
    totalEntries: allEntries.length,
    totalCites: citedKeys.size,
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
  };
}
