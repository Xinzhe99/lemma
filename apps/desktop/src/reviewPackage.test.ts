/**
 * reviewPackage 纯函数测试（协作闭环：批注/标注导出与往返）。
 * 覆盖验收路径：
 *  - build：schema/version/projectName/exportedAt 组装、标注组排序与空组过滤、浅拷贝不共享引用；
 *  - validate：build 产物通过；坏 schema / 坏 version / 非对象 / 缺字段 / 逐条坏数据（中文报错）；
 *  - apply：全量导入（id 重新生成、author/line/file/resolved/replies 保留、标注按 fileKey 合并）、
 *    按 id 去重跳过已有、空文本批注不计、统计正确；
 *  - buildAnnotationReportHtml：自包含骨架（doctype/meta charset/内联 style）、两区标题、
 *    空区整节跳过、HTML 转义（<script> 注入）、标题=项目名+导出时间、注释头打印提示；
 *  - reviewDownloadName：sf-review-{projectName}-{YYYYMMDD}.{ext} 与非法字符清洗。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Annotation } from '@lemma/shared';
import {
  applyReviewPackage,
  buildAnnotationReportHtml,
  buildReviewPackage,
  reviewDownloadName,
  validateReviewPackage,
  type ReviewPackage,
} from './reviewPackage';
import { useCommentsStore, type ManuscriptComment } from './state/commentsStore';
import { useAnnotationStore } from './state/annotationStore';

// —— 测试数据工厂 ——

function comment(over: Partial<ManuscriptComment> = {}): ManuscriptComment {
  return {
    id: over.id ?? 'c-1',
    file: over.file ?? 'main.tex',
    line: over.line ?? 5,
    author: over.author ?? '导师',
    text: over.text ?? '这段论证需要补基线对比',
    resolved: over.resolved ?? false,
    createdAt: over.createdAt ?? 1700000000000,
    replies: over.replies ?? [{ author: '作者', text: '已在第二稿补充', createdAt: 1700000001000 }],
  };
}

function annotation(over: Partial<Annotation> = {}): Annotation {
  return {
    id: over.id ?? 'a-1',
    paperId: over.paperId ?? 'p-1',
    page: over.page ?? 3,
    kind: over.kind ?? 'highlight',
    semantic: over.semantic ?? 'method',
    quotedText: over.quotedText ?? 'We propose a new baseline.',
    text: over.text ?? '可对比我们的方法',
    createdAt: over.createdAt ?? 1700000000000,
    ...over,
  };
}

function pkgOf(over: Partial<ReviewPackage> = {}): ReviewPackage {
  return {
    schema: 'sf-review',
    version: 1,
    projectName: over.projectName ?? 'demo-paper',
    exportedAt: over.exportedAt ?? '2026-01-01T08:30:00.000Z',
    comments: over.comments ?? [comment()],
    annotations: over.annotations ?? [{ fileKey: 'pdf:ref.pdf', items: [annotation()] }],
  };
}

beforeEach(() => {
  useCommentsStore.setState({ comments: [] });
  useAnnotationStore.setState({ byFile: {} });
});

afterEach(() => {
  useCommentsStore.setState({ comments: [] });
  useAnnotationStore.setState({ byFile: {} });
});

// ---------------------------------------------------------------------------
// buildReviewPackage
// ---------------------------------------------------------------------------

describe('buildReviewPackage', () => {
  it('组装完整结构：schema/version/projectName/exportedAt(ISO)、批注与标注入包', () => {
    const pkg = buildReviewPackage({
      projectName: 'thesis-2026',
      comments: [comment({ id: 'c-9', text: '术语不一致' })],
      annotations: { 'pdf:b.pdf': [annotation({ id: 'a-b' })], 'pdf:a.pdf': [annotation({ id: 'a-a' })] },
    });
    expect(pkg.schema).toBe('sf-review');
    expect(pkg.version).toBe(1);
    expect(pkg.projectName).toBe('thesis-2026');
    expect(pkg.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(pkg.comments).toHaveLength(1);
    expect(pkg.comments[0]!.text).toBe('术语不一致');
    expect(pkg.annotations.map((g) => g.fileKey)).toEqual(['pdf:a.pdf', 'pdf:b.pdf']); // fileKey 排序
  });

  it('浅拷贝不共享引用：导出后改动输入数组/标注数组不影响包内容；空标注组不导出', () => {
    const comments = [comment({ id: 'c-1' })];
    const items = [annotation({ id: 'a-1' })];
    const pkg = buildReviewPackage({
      projectName: 'p',
      comments,
      annotations: { 'pdf:x.pdf': items, 'pdf:empty.pdf': [] },
    });
    comments.push(comment({ id: 'c-2' }));
    items.push(annotation({ id: 'a-2' }));
    expect(pkg.comments).toHaveLength(1);
    expect(pkg.annotations).toHaveLength(1); // 空组被过滤
    expect(pkg.annotations[0]!.items).toHaveLength(1);
    expect(pkg.annotations[0]!.fileKey).toBe('pdf:x.pdf');
  });
});

// ---------------------------------------------------------------------------
// validateReviewPackage
// ---------------------------------------------------------------------------

describe('validateReviewPackage', () => {
  it('build 的产物可通过校验（往返闭环的基线）', () => {
    const pkg = buildReviewPackage({
      projectName: 'demo-paper',
      comments: [comment()],
      annotations: { 'pdf:ref.pdf': [annotation()] },
    });
    const res = validateReviewPackage(JSON.parse(JSON.stringify(pkg)));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pkg.projectName).toBe('demo-paper');
      expect(res.pkg.comments[0]!.replies).toHaveLength(1);
    }
  });

  it('非 JSON 对象（数组/数字/null）拒绝并中文报错', () => {
    for (const bad of [[1, 2], 42, null, 'sf-review']) {
      const res = validateReviewPackage(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('不是 JSON 对象');
    }
  });

  it('坏 schema 拒绝', () => {
    const res = validateReviewPackage({ ...pkgOf(), schema: 'other-package' });
    expect(res).toEqual({ ok: false, error: 'schema 不符：期望 "sf-review"' });
  });

  it('坏 version 拒绝（数字 2 与字符串 "1" 都不行）', () => {
    const v2 = validateReviewPackage({ ...pkgOf(), version: 2 });
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.error).toContain('version 不符：期望 1，实际 2');
    const vs = validateReviewPackage({ ...pkgOf(), version: '1' });
    expect(vs.ok).toBe(false);
    if (!vs.ok) expect(vs.error).toContain('version 不符');
  });

  it('缺 projectName / 缺 exportedAt（或空串）拒绝', () => {
    const noName = validateReviewPackage({ ...pkgOf(), projectName: undefined });
    expect(noName).toEqual({ ok: false, error: '缺少核心字段：projectName' });
    const noTime = validateReviewPackage({ ...pkgOf(), exportedAt: '' });
    expect(noTime.ok).toBe(false);
    if (!noTime.ok) expect(noTime.error).toContain('exportedAt');
  });

  it('缺 comments / 缺 annotations 拒绝', () => {
    const noComments = validateReviewPackage({ ...pkgOf(), comments: undefined });
    expect(noComments).toEqual({ ok: false, error: '缺少核心字段：comments（批注数组）' });
    const noAnnotations = validateReviewPackage({ ...pkgOf(), annotations: undefined });
    expect(noAnnotations).toEqual({ ok: false, error: '缺少核心字段：annotations（标注数组）' });
  });

  it('comments 逐条坏数据中文报错（缺 text / line 非数字 / replies 元素坏）', () => {
    const badText = validateReviewPackage(pkgOf({ comments: [{ ...comment(), text: 123 as unknown as string }] }));
    expect(badText.ok).toBe(false);
    if (!badText.ok) expect(badText.error).toContain('comments[0].text');

    const badLine = validateReviewPackage(pkgOf({ comments: [{ ...comment(), line: '5' as unknown as number }] }));
    expect(badLine.ok).toBe(false);
    if (!badLine.ok) expect(badLine.error).toContain('comments[0].line');

    const badReply = validateReviewPackage(
      pkgOf({ comments: [{ ...comment(), replies: [{ author: 'a', text: 1 as unknown as string, createdAt: 1 }] }] }),
    );
    expect(badReply.ok).toBe(false);
    if (!badReply.ok) expect(badReply.error).toContain('comments[0].replies[0].text');
  });

  it('annotations 逐组/逐条坏数据中文报错（fileKey 缺 / items 非数组 / kind 非法 / semantic 非法 / bbox 坏）', () => {
    const noKey = validateReviewPackage(pkgOf({ annotations: [{ fileKey: '', items: [annotation()] }] }));
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error).toContain('annotations[0].fileKey');

    const noItems = validateReviewPackage(pkgOf({ annotations: [{ fileKey: 'pdf:a.pdf', items: null as unknown as Annotation[] }] }));
    expect(noItems.ok).toBe(false);
    if (!noItems.ok) expect(noItems.error).toContain('annotations[0].items');

    const badKind = validateReviewPackage(
      pkgOf({ annotations: [{ fileKey: 'pdf:a.pdf', items: [annotation({ kind: 'strike' as Annotation['kind'] })] }] }),
    );
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.error).toContain('kind');

    const badSem = validateReviewPackage(
      pkgOf({ annotations: [{ fileKey: 'pdf:a.pdf', items: [annotation({ semantic: 'other' as Annotation['semantic'] })] }] }),
    );
    expect(badSem.ok).toBe(false);
    if (!badSem.ok) expect(badSem.error).toContain('semantic');

    const badBbox = validateReviewPackage(
      pkgOf({ annotations: [{ fileKey: 'pdf:a.pdf', items: [annotation({ bbox: [1, 2, 3] as unknown as [number, number, number, number] })] }] }),
    );
    expect(badBbox.ok).toBe(false);
    if (!badBbox.ok) expect(badBbox.error).toContain('bbox');
  });
});

// ---------------------------------------------------------------------------
// applyReviewPackage
// ---------------------------------------------------------------------------

describe('applyReviewPackage', () => {
  it('全量导入：批注落库（file/line/author/text 保留、id 重新生成、回复保留），标注按 fileKey 落库（id 保留），统计正确', () => {
    const src = comment({ id: 'c-src', resolved: false, text: '需要补实验' });
    const ann = annotation({ id: 'a-src', semantic: 'finding' });
    const stats = applyReviewPackage(pkgOf({ comments: [src], annotations: [{ fileKey: 'pdf:ref.pdf', items: [ann] }] }));

    expect(stats).toEqual({ commentsAdded: 1, annotationsAdded: 1, annotationsSkipped: 0 });

    const stored = useCommentsStore.getState().comments;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).not.toBe('c-src'); // id 重新生成防碰撞
    expect(stored[0]!.file).toBe('main.tex');
    expect(stored[0]!.line).toBe(5);
    expect(stored[0]!.author).toBe('导师');
    expect(stored[0]!.text).toBe('需要补实验');
    expect(stored[0]!.replies).toHaveLength(1);
    expect(stored[0]!.replies[0]!.text).toBe('已在第二稿补充');

    const byFile = useAnnotationStore.getState().byFile;
    expect(byFile['pdf:ref.pdf']).toHaveLength(1);
    expect(byFile['pdf:ref.pdf']![0]!.id).toBe('a-src'); // 标注保留原 id（往返去重依据）
    expect(byFile['pdf:ref.pdf']![0]!.semantic).toBe('finding');
  });

  it('resolved 状态保留：未解决导入后仍 false，已解决导入后仍 true', () => {
    applyReviewPackage(
      pkgOf({
        comments: [comment({ id: 'c-open', text: '未解决项', resolved: false }), comment({ id: 'c-done', text: '已解决项', resolved: true })],
        annotations: [],
      }),
    );
    const stored = useCommentsStore.getState().comments;
    expect(stored.find((c) => c.text === '未解决项')!.resolved).toBe(false);
    expect(stored.find((c) => c.text === '已解决项')!.resolved).toBe(true);
  });

  it('按 id 去重：已存在的标注跳过且原内容不被覆盖，统计 skipped；新标注正常合入同一 fileKey', () => {
    useAnnotationStore.setState({
      byFile: { 'pdf:ref.pdf': [annotation({ id: 'a-exist', text: '本机已有备注', quotedText: '本机引文' })] },
    });
    const stats = applyReviewPackage(
      pkgOf({
        comments: [],
        annotations: [
          { fileKey: 'pdf:ref.pdf', items: [annotation({ id: 'a-exist', text: '包内备注' }), annotation({ id: 'a-new' })] },
        ],
      }),
    );
    expect(stats).toEqual({ commentsAdded: 0, annotationsAdded: 1, annotationsSkipped: 1 });

    const list = useAnnotationStore.getState().byFile['pdf:ref.pdf']!;
    expect(list).toHaveLength(2);
    expect(list.find((a) => a.id === 'a-exist')!.text).toBe('本机已有备注'); // 已有不覆盖
    expect(list.find((a) => a.id === 'a-new')).toBeTruthy();
  });

  it('同一包重复导入：标注全部去重（skipped=K），批注按约定重新入库（id 再生成）', () => {
    const pkg = pkgOf({
      comments: [comment({ id: 'c-1' })],
      annotations: [{ fileKey: 'pdf:a.pdf', items: [annotation({ id: 'a-1' }), annotation({ id: 'a-2' })] }],
    });
    const first = applyReviewPackage(pkg);
    expect(first).toEqual({ commentsAdded: 1, annotationsAdded: 2, annotationsSkipped: 0 });

    const second = applyReviewPackage(pkg);
    expect(second).toEqual({ commentsAdded: 1, annotationsAdded: 0, annotationsSkipped: 2 });
    expect(useAnnotationStore.getState().byFile['pdf:a.pdf']).toHaveLength(2);
    expect(useCommentsStore.getState().comments).toHaveLength(2); // 批注按约定逐条 addComment
    expect(new Set(useCommentsStore.getState().comments.map((c) => c.id)).size).toBe(2); // id 无碰撞
  });

  it('空文本批注被 store 拒绝：不计入 commentsAdded；空包统计全 0', () => {
    const stats = applyReviewPackage(pkgOf({ comments: [comment({ text: '   ' })], annotations: [] }));
    expect(stats.commentsAdded).toBe(0);
    expect(useCommentsStore.getState().comments).toHaveLength(0);

    const empty = applyReviewPackage(pkgOf({ comments: [], annotations: [] }));
    expect(empty).toEqual({ commentsAdded: 0, annotationsAdded: 0, annotationsSkipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildAnnotationReportHtml
// ---------------------------------------------------------------------------

describe('buildAnnotationReportHtml', () => {
  it('自包含单文件骨架：doctype、meta charset、内联 <style>、无外部资源引用', () => {
    const html = buildAnnotationReportHtml(pkgOf());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/src\s*=|href\s*=/); // 无外部资源（script/图片/链接）
    expect(html).not.toContain('<script'); // 报告本身无脚本
  });

  it('两区标题：稿件批注表 + PDF 标注表（含表头列名）', () => {
    const html = buildAnnotationReportHtml(pkgOf());
    expect(html).toContain('稿件批注');
    expect(html).toContain('PDF 标注');
    for (const th of ['文件', '作者', '内容', '状态', '引文摘录', '备注']) expect(html).toContain(`<th>${th}</th>`);
  });

  it('HTML 转义：批注/回复/引文中的 <script> 注入被转义，输出无原始标签', () => {
    const html = buildAnnotationReportHtml(
      pkgOf({
        projectName: '<b>proj</b>',
        comments: [
          comment({ text: '<script>alert(1)</script>', replies: [{ author: '作者', text: '<img src=x onerror=alert(2)>', createdAt: 1 }] }),
        ],
        annotations: [{ fileKey: 'pdf:x.pdf', items: [annotation({ quotedText: `"><script>alert(3)</script>` })] }],
      }),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;proj&lt;/b&gt;');
  });

  it('空区跳过：无批注时不渲染稿件批注区；无标注时不渲染 PDF 标注区；双空只剩头部与提示', () => {
    const noComments = buildAnnotationReportHtml(pkgOf({ comments: [] }));
    expect(noComments).not.toContain('稿件批注');
    expect(noComments).toContain('PDF 标注');

    const noAnnotations = buildAnnotationReportHtml(pkgOf({ annotations: [] }));
    expect(noAnnotations).toContain('稿件批注');
    expect(noAnnotations).not.toContain('PDF 标注');

    const both = buildAnnotationReportHtml(pkgOf({ comments: [], annotations: [] }));
    expect(both).not.toContain('稿件批注');
    expect(both).not.toContain('PDF 标注');
    expect(both).toContain('审阅报告'); // 标题仍在
  });

  it('标题=项目名+导出时间；注释头注明由 Lemma 生成并可 Ctrl+P 打印为 PDF', () => {
    const html = buildAnnotationReportHtml(pkgOf({ projectName: 'thesis-2026', exportedAt: '2026-01-01T08:30:00.000Z' }));
    expect(html).toContain('<title>thesis-2026 · 审阅报告</title>');
    expect(html).toContain('<h1>thesis-2026 · 审阅报告</h1>');
    expect(html).toContain('导出时间：');
    expect(html).toContain('由 Lemma 生成，浏览器打开后可 Ctrl+P 打印为 PDF'); // HTML 注释头
    expect(html).toContain('Ctrl+P 打印为 PDF</p>'); // 可见页脚提示
  });

  it('批注表行内容：文件/行/作者/内容/状态（已解决）+ 回复缩进行', () => {
    const html = buildAnnotationReportHtml(
      pkgOf({
        comments: [
          comment({ file: 'sections/intro.tex', line: 42, author: '王导师', text: '这里要引用最新工作', resolved: true }),
        ],
      }),
    );
    expect(html).toContain('sections/intro.tex');
    expect(html).toContain('>42<');
    expect(html).toContain('王导师');
    expect(html).toContain('这里要引用最新工作');
    expect(html).toContain('已解决');
    expect(html).toContain('&#8627; 作者：已在第二稿补充'); // 回复缩进行（↳ 转义）
  });

  it('标注表行内容：文件（pdf: 前缀剥离）/页/语义色点（内联 background）/引文/备注；无语义用灰点+类型名', () => {
    const html = buildAnnotationReportHtml(
      pkgOf({
        annotations: [
          {
            fileKey: 'pdf:ref.pdf',
            items: [
              annotation({ page: 7, semantic: 'question', quotedText: 'Why not compare?', text: '追问' }),
              annotation({ id: 'a-note', kind: 'note', semantic: undefined, quotedText: undefined, text: '页面排版问题' }),
            ],
          },
        ],
      }),
    );
    expect(html).toContain('ref.pdf');
    expect(html).not.toContain('pdf:ref.pdf'); // 前缀剥离
    expect(html).toContain('>7<');
    expect(html).toContain('background:#d97706'); // question 语义色点
    expect(html).toContain('疑问');
    expect(html).toContain('Why not compare?');
    expect(html).toContain('追问');
    expect(html).toContain('background:#9ca3af'); // 无语义灰点
    expect(html).toContain('备注'); // note 类型名
    expect(html).toContain('页面排版问题');
  });
});

// ---------------------------------------------------------------------------
// reviewDownloadName
// ---------------------------------------------------------------------------

describe('reviewDownloadName', () => {
  it('sf-review-{projectName}-{YYYYMMDD}.{ext}；非法字符清洗、空名回退、可自定义前缀', () => {
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${today.getFullYear()}${p(today.getMonth() + 1)}${p(today.getDate())}`;

    expect(reviewDownloadName('demo paper', 'json')).toBe(`sf-review-demo-paper-${stamp}.json`);
    expect(reviewDownloadName('a/b\\c:*?"<>|d', 'html')).toBe(`sf-review-a-b-c-d-${stamp}.html`);
    expect(reviewDownloadName('   ', 'json')).toBe(`sf-review-project-${stamp}.json`);
    expect(reviewDownloadName('x', 'html', 'sf-annotations')).toBe(`sf-annotations-x-${stamp}.html`);
  });
});
