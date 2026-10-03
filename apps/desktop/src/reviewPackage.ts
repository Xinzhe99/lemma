/**
 * 批注/标注的导出与往返（协作闭环延伸到软件外）：
 *  - buildReviewPackage：稿件批注（commentsStore）+ PDF 标注（annotationStore.byFile）
 *    → 统一审阅包结构（schema/version/projectName/exportedAt/comments/annotations）；
 *  - validateReviewPackage：未知 JSON → 逐项结构校验（沿 backup.ts 的模式与严格度），
 *    坏数据中文报错，坏包整体拒绝；
 *  - applyReviewPackage：合法包合入本机 stores——批注逐条 addComment（id 重新生成防碰撞、
 *    author/line/file/resolved/回复保留），标注逐 fileKey 按 id 去重合并（跳过已有），返回统计；
 *  - buildAnnotationReportHtml：审阅包 → 自包含单文件 HTML（内联 CSS、无外部资源、亮色可打印），
 *    导师不装 Lemma 也能用浏览器打开（Ctrl+P 打印为 PDF）。
 *
 * build/validate/HTML 均为纯函数（浅拷贝输入，不改调用方数据），可独立测试；
 * apply 是唯一有副作用的一步（写回两个 store）。
 */

import { createId } from '@lemma/shared';
import type { Annotation, HighlightSemantic } from '@lemma/shared';
import { useCommentsStore, type ManuscriptComment } from './state/commentsStore';
import { useAnnotationStore } from './state/annotationStore';

export const REVIEW_SCHEMA = 'sf-review';
export const REVIEW_VERSION = 1;

/** 审阅包：与软件外协作的最小交换格式（json 可直接邮件/IM 发送） */
export interface ReviewPackageAnnotationGroup {
  fileKey: string;
  items: Annotation[];
}

export interface ReviewPackage {
  schema: typeof REVIEW_SCHEMA;
  version: typeof REVIEW_VERSION;
  projectName: string;
  exportedAt: string;
  comments: ManuscriptComment[];
  annotations: ReviewPackageAnnotationGroup[];
}

export interface BuildReviewPackageInput {
  projectName: string;
  comments: ManuscriptComment[];
  /** annotationStore.byFile 快照（Record<fileKey, Annotation[]>） */
  annotations: Record<string, Annotation[]>;
}

/** 导入统计（applyReviewPackage 返回，面板据此提示「已导入 N 条批注 / M 条标注（跳过重复 K）」） */
export interface ApplyReviewPackageStats {
  commentsAdded: number;
  annotationsAdded: number;
  annotationsSkipped: number;
}

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

/**
 * 组装审阅包。exportedAt 为 ISO 时间串；批注数组与各标注组均为浅拷贝，
 * 组装结果与传入数组不共享顶层引用（导出后改动互不影响）；
 * 标注组按 fileKey 字典序排序（输出稳定），空标注组不导出。
 */
export function buildReviewPackage(input: BuildReviewPackageInput): ReviewPackage {
  return {
    schema: REVIEW_SCHEMA,
    version: REVIEW_VERSION,
    projectName: input.projectName,
    exportedAt: new Date().toISOString(),
    comments: [...input.comments],
    annotations: Object.entries(input.annotations)
      .filter(([, items]) => Array.isArray(items) && items.length > 0)
      .map(([fileKey, items]) => ({ fileKey, items: [...items] }))
      .sort((a, b) => a.fileKey.localeCompare(b.fileKey)),
  };
}

// ---------------------------------------------------------------------------
// 校验（沿 backup.ts 的模式与严格度：逐项校验 + 中文报错）
// ---------------------------------------------------------------------------

export type ValidateReviewPackageResult =
  | { ok: true; pkg: ReviewPackage }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fieldError(path: string, expect: string): string {
  return `批注包结构非法：${path} 缺失或不是${expect}`;
}

const ANNOTATION_KINDS = ['highlight', 'note', 'area'] as const;
const HIGHLIGHT_SEMANTICS = ['method', 'finding', 'question', 'citation'] as const;

function validateComment(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return fieldError(path, '对象');
  if (typeof v.id !== 'string') return fieldError(`${path}.id`, '字符串');
  if (typeof v.file !== 'string' || !v.file) return fieldError(`${path}.file`, '字符串');
  if (typeof v.line !== 'number') return fieldError(`${path}.line`, '数字');
  if (typeof v.author !== 'string') return fieldError(`${path}.author`, '字符串');
  if (typeof v.text !== 'string') return fieldError(`${path}.text`, '字符串');
  if (typeof v.resolved !== 'boolean') return fieldError(`${path}.resolved`, '布尔值');
  if (typeof v.createdAt !== 'number') return fieldError(`${path}.createdAt`, '数字');
  if (!Array.isArray(v.replies)) return fieldError(`${path}.replies`, '数组');
  for (let i = 0; i < v.replies.length; i++) {
    const r: unknown = v.replies[i];
    if (!isPlainObject(r)) return fieldError(`${path}.replies[${i}]`, '对象');
    if (typeof r.author !== 'string') return fieldError(`${path}.replies[${i}].author`, '字符串');
    if (typeof r.text !== 'string') return fieldError(`${path}.replies[${i}].text`, '字符串');
    if (typeof r.createdAt !== 'number') return fieldError(`${path}.replies[${i}].createdAt`, '数字');
  }
  return null;
}

function validateAnnotation(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return fieldError(path, '对象');
  if (typeof v.id !== 'string' || !v.id) return fieldError(`${path}.id`, '字符串');
  if (typeof v.paperId !== 'string') return fieldError(`${path}.paperId`, '字符串');
  if (typeof v.page !== 'number') return fieldError(`${path}.page`, '数字');
  if (typeof v.kind !== 'string' || !ANNOTATION_KINDS.includes(v.kind as (typeof ANNOTATION_KINDS)[number])) {
    return `批注包结构非法：${path}.kind 必须是 highlight/note/area 之一`;
  }
  if (v.semantic !== undefined) {
    if (
      typeof v.semantic !== 'string' ||
      !HIGHLIGHT_SEMANTICS.includes(v.semantic as (typeof HIGHLIGHT_SEMANTICS)[number])
    ) {
      return `批注包结构非法：${path}.semantic 必须是 method/finding/question/citation 之一`;
    }
  }
  if (v.bbox !== undefined) {
    if (!Array.isArray(v.bbox) || v.bbox.length !== 4 || v.bbox.some((n) => typeof n !== 'number')) {
      return fieldError(`${path}.bbox`, '四个数字的数组');
    }
  }
  if (v.quotedText !== undefined && typeof v.quotedText !== 'string') {
    return fieldError(`${path}.quotedText`, '字符串');
  }
  if (v.text !== undefined && typeof v.text !== 'string') {
    return fieldError(`${path}.text`, '字符串');
  }
  if (typeof v.createdAt !== 'number') return fieldError(`${path}.createdAt`, '数字');
  return null;
}

/**
 * 校验审阅包 JSON（已 parse 的值）：
 * 1) 顶层必须是对象且 schema === 'sf-review'；
 * 2) version 必须为 1（数字）；
 * 3) projectName / exportedAt 必须是字符串（exportedAt 非空）；
 * 4) comments 必须是数组且逐条校验（id/file/line/author/text/resolved/createdAt/replies）；
 * 5) annotations 必须是数组且逐组校验（fileKey + items），items 逐条校验
 *    （id/paperId/page/kind/createdAt 必填；semantic/bbox/quotedText/text 可选但形状必须正确）。
 */
export function validateReviewPackage(json: unknown): ValidateReviewPackageResult {
  if (!isPlainObject(json)) return { ok: false, error: '批注包不是 JSON 对象' };
  if (json.schema !== REVIEW_SCHEMA) {
    return { ok: false, error: `schema 不符：期望 "${REVIEW_SCHEMA}"` };
  }
  if (json.version !== REVIEW_VERSION) {
    return { ok: false, error: `version 不符：期望 ${REVIEW_VERSION}，实际 ${String(json.version)}` };
  }
  if (typeof json.projectName !== 'string') {
    return { ok: false, error: '缺少核心字段：projectName' };
  }
  if (typeof json.exportedAt !== 'string' || !json.exportedAt) {
    return { ok: false, error: 'exportedAt 缺失或不是字符串' };
  }
  if (!Array.isArray(json.comments)) {
    return { ok: false, error: '缺少核心字段：comments（批注数组）' };
  }
  for (let i = 0; i < json.comments.length; i++) {
    const err = validateComment(json.comments[i], `comments[${i}]`);
    if (err) return { ok: false, error: err };
  }
  if (!Array.isArray(json.annotations)) {
    return { ok: false, error: '缺少核心字段：annotations（标注数组）' };
  }
  for (let i = 0; i < json.annotations.length; i++) {
    const g: unknown = json.annotations[i];
    if (!isPlainObject(g)) return { ok: false, error: fieldError(`annotations[${i}]`, '对象') };
    if (typeof g.fileKey !== 'string' || !g.fileKey) {
      return { ok: false, error: fieldError(`annotations[${i}].fileKey`, '字符串') };
    }
    if (!Array.isArray(g.items)) {
      return { ok: false, error: fieldError(`annotations[${i}].items`, '数组') };
    }
    for (let j = 0; j < g.items.length; j++) {
      const err = validateAnnotation(g.items[j], `annotations[${i}].items[${j}]`);
      if (err) return { ok: false, error: err };
    }
  }
  return { ok: true, pkg: json as unknown as ReviewPackage };
}

// ---------------------------------------------------------------------------
// 应用（合入本机 stores；调用前应先经 validateReviewPackage）
// ---------------------------------------------------------------------------

/**
 * 合法审阅包合入本机 stores：
 *  - comments：逐条 addComment（file/line/text/author 保留；id 重新生成防碰撞；
 *    resolved 为 true 时补 toggleResolved；replies 逐条 addReply），空文本条目被跳过；
 *  - annotations：逐 fileKey 合并进 annotationStore（保留原 id 支持往返去重，
 *    与已有同 id 的跳过），组内同 id 重复也只落一条。
 * 返回统计 { commentsAdded, annotationsAdded, annotationsSkipped }。
 */
export function applyReviewPackage(pkg: ReviewPackage): ApplyReviewPackageStats {
  const stats: ApplyReviewPackageStats = { commentsAdded: 0, annotationsAdded: 0, annotationsSkipped: 0 };
  const { addComment, toggleResolved, addReply } = useCommentsStore.getState();
  for (const c of pkg.comments) {
    const created = addComment(c.file, c.line, c.text, c.author);
    if (!created) continue;
    if (c.resolved) toggleResolved(created.id);
    for (const r of c.replies) addReply(created.id, r.text, r.author);
    stats.commentsAdded += 1;
  }
  const { add } = useAnnotationStore.getState();
  for (const group of pkg.annotations) {
    for (const a of group.items) {
      const existing = useAnnotationStore.getState().byFile[group.fileKey] ?? [];
      if (existing.some((x) => x.id === a.id)) {
        stats.annotationsSkipped += 1;
        continue;
      }
      add(group.fileKey, { ...a, id: a.id || createId() });
      stats.annotationsAdded += 1;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// 自包含 HTML 审阅报告（纯函数；内联 CSS、无外部资源、亮色可打印）
// ---------------------------------------------------------------------------

/** HTML 转义：& < > " '（批注/标注是用户输入，全部过 escape 再入模板） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 语义色点（与阅读器四色语义对应；无语义的 note/area 用灰点 + 类型名） */
const SEMANTIC_DOT: Record<HighlightSemantic, { color: string; label: string }> = {
  method: { color: '#2563eb', label: '方法' },
  finding: { color: '#16a34a', label: '发现' },
  question: { color: '#d97706', label: '疑问' },
  citation: { color: '#9333ea', label: '引用' },
};

const KIND_LABEL: Record<Annotation['kind'], string> = {
  highlight: '高亮',
  note: '备注',
  area: '区域',
};

function dotHtml(color: string): string {
  return `<span class="dot" style="background:${color}"></span>`;
}

/** ISO → 本地可读时间（YYYY-MM-DD HH:mm）；非法值原样返回 */
function formatExportedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const REPORT_CSS = `*{box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif;color:#1f2937;background:#fff;margin:24px auto;max-width:960px;padding:0 20px 40px;line-height:1.6}
h1{font-size:20px;margin:0 0 6px}
h2{font-size:16px;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
.meta{color:#6b7280;font-size:12px;margin:0}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f9fafb;font-weight:600;white-space:nowrap}
td.nw{white-space:nowrap}
td.pre{white-space:pre-wrap;min-width:220px}
tr.reply td{border:none;border-left:2px solid #e5e7eb;background:#fafafa;color:#4b5563;font-size:12px;padding:4px 10px 4px 28px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle;border:1px solid rgba(0,0,0,.18)}
.ok{color:#15803d;font-weight:600}
.open{color:#b45309;font-weight:600}
.hint{margin-top:36px;color:#9ca3af;font-size:11px;text-align:center}
@media print{body{margin:0;max-width:none;padding:0}}`;

/** 稿件批注表（文件/行/作者/内容/状态 + 回复缩进行）；空批注返回空串（整区跳过） */
function commentsSectionHtml(comments: ManuscriptComment[]): string {
  if (comments.length === 0) return '';
  const sorted = [...comments].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.createdAt - b.createdAt,
  );
  const rows: string[] = [];
  for (const c of sorted) {
    rows.push(
      `<tr><td class="nw"><code>${escapeHtml(c.file)}</code></td><td class="nw">${c.line}</td><td class="nw">${escapeHtml(c.author)}</td><td class="pre">${escapeHtml(c.text)}</td><td class="nw">${c.resolved ? '<span class="ok">已解决</span>' : '<span class="open">未解决</span>'}</td></tr>`,
    );
    for (const r of c.replies) {
      rows.push(
        `<tr class="reply"><td colspan="5">&#8627; ${escapeHtml(r.author)}：${escapeHtml(r.text)}</td></tr>`,
      );
    }
  }
  return `<section id="sf-comments"><h2>稿件批注（${sorted.length}）</h2><table><thead><tr><th>文件</th><th>行</th><th>作者</th><th>内容</th><th>状态</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
}

/** PDF 标注表（文件/页/语义色点/引文摘录/备注）；空标注返回空串（整区跳过） */
function annotationsSectionHtml(annotations: ReviewPackageAnnotationGroup[]): string {
  const total = annotations.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return '';
  const rows: string[] = [];
  for (const g of [...annotations].sort((a, b) => a.fileKey.localeCompare(b.fileKey))) {
    const file = escapeHtml(g.fileKey.replace(/^pdf:/, ''));
    const items = [...g.items].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    for (const a of items) {
      const sem = a.semantic ? SEMANTIC_DOT[a.semantic] : undefined;
      const semCell = sem
        ? `${dotHtml(sem.color)}${sem.label}`
        : `${dotHtml('#9ca3af')}${KIND_LABEL[a.kind]}`;
      rows.push(
        `<tr><td class="nw"><code>${file}</code></td><td class="nw">${a.page}</td><td class="nw">${semCell}</td><td class="pre">${escapeHtml(a.quotedText ?? '')}</td><td class="pre">${escapeHtml(a.text ?? '')}</td></tr>`,
      );
    }
  }
  return `<section id="sf-annotations"><h2>PDF 标注（${total}）</h2><table><thead><tr><th>文件</th><th>页</th><th>语义</th><th>引文摘录</th><th>备注</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
}

/**
 * 审阅包 → 自包含单文件 HTML 报告：
 *  - 内联 CSS、无外部资源、<meta charset="utf-8">、亮色可打印；
 *  - 标题 = 项目名 + 导出时间；两部分：稿件批注表 / PDF 标注表（空区整节跳过）；
 *  - 所有用户输入（批注/回复/引文/备注/项目名）经 HTML 转义，防注入。
 */
export function buildAnnotationReportHtml(pkg: ReviewPackage): string {
  const title = escapeHtml(pkg.projectName || '未命名项目');
  const exported = formatExportedAt(pkg.exportedAt);
  const totalAnnotations = pkg.annotations.reduce((n, g) => n + g.items.length, 0);
  // 摘要行只列非空部分（空区整节跳过时，摘要也不出现该词）
  const parts = ['导出时间：' + escapeHtml(exported)];
  if (pkg.comments.length > 0) parts.push(`稿件批注 ${pkg.comments.length} 条`);
  if (totalAnnotations > 0) parts.push(`PDF 标注 ${totalAnnotations} 条`);
  return `<!DOCTYPE html>
<!-- 由 Lemma 生成，浏览器打开后可 Ctrl+P 打印为 PDF -->
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 审阅报告</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header>
<h1>${title} · 审阅报告</h1>
<p class="meta">${parts.join(' · ')}</p>
</header>
${commentsSectionHtml(pkg.comments)}
${annotationsSectionHtml(pkg.annotations)}
<p class="hint">由 Lemma 生成 · 浏览器打开后可 Ctrl+P 打印为 PDF</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 导出文件名（sf-review-{projectName}-{YYYYMMDD}.{ext}）
// ---------------------------------------------------------------------------

/** 项目名转文件名安全段（路径分隔符/空白/非法字符折叠为 -；空名回退 project） */
function safeNamePart(projectName: string): string {
  const safe = projectName
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe.length > 0 ? safe : 'project';
}

/** 下载文件名日期戳（YYYYMMDD） */
function dateStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 审阅包下载文件名：{prefix}-{projectName}-{YYYYMMDD}.{ext}（prefix 缺省 sf-review） */
export function reviewDownloadName(
  projectName: string,
  ext: 'json' | 'html',
  prefix = 'sf-review',
): string {
  return `${prefix}-${safeNamePart(projectName)}-${dateStamp()}.${ext}`;
}
