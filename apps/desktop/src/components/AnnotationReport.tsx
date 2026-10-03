/**
 * HTML 审阅报告的下载触发与可选预览（批注/标注协作闭环 UI 侧）。
 * 报告生成为纯函数 buildAnnotationReportHtml（reviewPackage.ts，可独立测试）；
 * 本文件只做两件事：
 *  - downloadAnnotationReport：pkg → 自包含 HTML → Blob 下载（sf-review-{项目名}-{日期}.html）；
 *  - AnnotationReportPreview（可选）：iframe srcDoc 沙箱内预览同一份 HTML，无脚本执行面。
 */

import { useMemo } from 'react';
import {
  buildAnnotationReportHtml,
  reviewDownloadName,
  type ReviewPackage,
} from '../reviewPackage';

export interface DownloadReportOptions {
  /** 文件名前缀（缺省 sf-review；NotesPanel 仅标注报告用 sf-annotations） */
  prefix?: string;
}

/** 生成并下载 HTML 审阅报告（单文件自包含，导师浏览器打开即可看/打印） */
export function downloadAnnotationReport(pkg: ReviewPackage, options?: DownloadReportOptions): void {
  const html = buildAnnotationReportHtml(pkg);
  const filename = reviewDownloadName(pkg.projectName, 'html', options?.prefix);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 可选预览：沙箱 iframe 渲染报告（sandbox 空串 = 不允许脚本/表单/跳转，纯静态查看） */
export function AnnotationReportPreview({ pkg }: { pkg: ReviewPackage }) {
  const html = useMemo(() => buildAnnotationReportHtml(pkg), [pkg]);
  return (
    <iframe
      title="Lemma 审阅报告预览"
      srcDoc={html}
      sandbox=""
      style={{ width: '100%', height: 360, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: '#fff' }}
    />
  );
}
