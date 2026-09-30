/**
 * 项目导出：打包为 zip（浏览器可下载），并做投稿打包清单检查（arXiv/期刊提交前自检）。
 */

import { zipSync, strToU8 } from 'fflate';

export interface PackagingCheckItem {
  item: string;
  ok: boolean;
  detail: string;
}

/** 投稿打包清单检查：入口/bib/图表引用/摘要/占位符残留 */
export function packagingChecklist(files: Record<string, string>): PackagingCheckItem[] {
  const items: PackagingCheckItem[] = [];
  const paths = Object.keys(files);
  const entry = 'main.tex' in files ? 'main.tex' : paths.find((p) => p.endsWith('.tex'));
  const texAll = paths.filter((p) => p.endsWith('.tex')).map((p) => files[p]!).join('\n');

  items.push({
    item: '编译入口存在（main.tex 或 .tex）',
    ok: !!entry,
    detail: entry ? `入口：${entry}` : '未找到任何 .tex 文件',
  });

  const hasBib = paths.some((p) => p.endsWith('.bib'));
  const usesBibliography = /\\bibliography|\\printbibliography|\\addbibresource/.test(texAll);
  items.push({
    item: '参考文献配置一致',
    ok: usesBibliography ? hasBib : true,
    detail: usesBibliography
      ? hasBib
        ? `找到 ${paths.filter((p) => p.endsWith('.bib')).join(', ')}`
        : '正文声明了参考文献但项目内没有 .bib 文件'
      : '正文未使用 BibTeX（内置 thebibliography 或无引用）',
  });

  const figRefs = [...texAll.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)].map((m) => m[1]!.trim());
  const missingFigs = figRefs.filter(
    (f) => !paths.some((p) => p.endsWith(f) || p.endsWith(`${f}.png`) || p.endsWith(`${f}.pdf`) || p.endsWith(`${f}.jpg`) || p.endsWith(`${f}.eps`)),
  );
  items.push({
    item: '图表文件齐全',
    ok: missingFigs.length === 0,
    detail: figRefs.length === 0 ? '正文未引用图片' : missingFigs.length === 0 ? `${figRefs.length} 处图片引用全部可解析` : `缺失：${missingFigs.join(', ')}`,
  });

  const hasAbstract = /\\begin\{abstract\}|\\abstract\b/.test(texAll);
  items.push({
    item: '包含摘要',
    ok: hasAbstract,
    detail: hasAbstract ? '检测到 abstract 环境' : '未检测到摘要',
  });

  const placeholders = entry ? (files[entry]!.match(/\{TITLE\}|\{AUTHORS\}|\{ABSTRACT\}|TODO|FIXME/g) ?? []) : [];
  items.push({
    item: '无模板占位符/TODO 残留',
    ok: placeholders.length === 0,
    detail: placeholders.length === 0 ? '入口文件干净' : `入口文件残留 ${placeholders.length} 处：${[...new Set(placeholders)].join(', ')}`,
  });

  const unresolvedRefs = [...texAll.matchAll(/\\ref\{([^}]+)\}/g)].map((m) => m[1]!);
  const labels = new Set([...texAll.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]!));
  const dangling = unresolvedRefs.filter((r) => !labels.has(r));
  items.push({
    item: '\\ref 引用可解析',
    ok: dangling.length === 0,
    detail: unresolvedRefs.length === 0 ? '无交叉引用' : dangling.length === 0 ? `${unresolvedRefs.length} 处引用均有对应 label` : `悬空引用：${dangling.join(', ')}`,
  });

  return items;
}

/** 把项目文本文件打包为 zip（Uint8Array，可触发浏览器下载） */
export function buildProjectZip(files: Record<string, string>, projectName = 'project'): { name: string; bytes: Uint8Array } {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = strToU8(content);
  }
  return { name: `${projectName.replace(/[^\w-]+/g, '_') || 'project'}.zip`, bytes: zipSync(entries) };
}
