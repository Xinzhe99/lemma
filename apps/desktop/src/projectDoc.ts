/**
 * 项目文档解析：入口解析、\input 递归展开、跨文件大纲、bib 引用键集合。
 * 供大纲面板 / 引用面板 / Agent Context Pack 共用。
 */

import { parseOutline, collectCitekeys, type OutlineNode } from '@lemma/editor';
import { parseBibtex, type ParseBibtexResult } from '@lemma/library';

export function resolveEntry(files: Record<string, string>): string {
  if (files['main.tex'] !== undefined) return 'main.tex';
  return Object.keys(files).find((f) => f.endsWith('.tex')) ?? '';
}

export function texFileList(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => f.endsWith('.tex'))
    .sort();
}

/**
 * 递归展开 \input/\include（防环、缺文件跳过），返回合并后的全文。
 *
 * 性能：单趟扫描——按 '\\' 逐个定位 input/include 命令，正文片段与展开结果
 * 顺序写入 parts 数组最后一次性 join。等价于原先的逐文件正则 replace，但
 * 避免了每层替换重建整段字符串：深嵌套 \input 链（书稿多级 include）下
 * 原实现是 O(深度×总字节数) 的重复拷贝，本实现为严格线性。
 */
export function combinedDoc(files: Record<string, string>): string {
  const entry = resolveEntry(files);
  if (!entry) return '';
  const visited = new Set<string>();
  const parts: string[] = [];
  const expand = (path: string): void => {
    const key = path.replace(/\.tex$/, '');
    if (visited.has(key)) return;
    const content = files[`${key}.tex`] ?? files[path];
    if (content === undefined) return;
    visited.add(key);
    let from = 0;
    let i = content.indexOf('\\');
    while (i !== -1) {
      // 与原正则 \{ 前不允许空白一致：命令词后必须紧跟 '{'
      let cmdLen = 0;
      if (content.startsWith('input', i + 1)) cmdLen = 5;
      else if (content.startsWith('include', i + 1)) cmdLen = 7;
      else {
        i = content.indexOf('\\', i + 1);
        continue;
      }
      const open = i + 1 + cmdLen;
      if (content.charCodeAt(open) !== 123 /* { */) {
        i = content.indexOf('\\', i + 1);
        continue;
      }
      // 参数名：到最近 '}' 为止的非空串（[^}]+，不含换行限制，与原正则一致）
      const close = content.indexOf('}', open + 1);
      if (close === -1 || close === open + 1) {
        i = content.indexOf('\\', i + 1);
        continue;
      }
      parts.push(content.slice(from, i));
      expand(content.slice(open + 1, close));
      from = close + 1;
      i = content.indexOf('\\', close + 1);
    }
    parts.push(content.slice(from));
  };
  expand(entry);
  return parts.join('');
}

/**
 * bib 解析结果缓存（键 = 文件全文，有界 LRU）：
 * citations 面板 / \cite 补全在每次渲染都会调用 bibCitekeys / bibEntries，
 * 若每次都全量重跑 parseBibtex，大库（500+ 条）在低端机上会拖慢每帧。
 * 两个消费函数只读取 citekey/title/year，不暴露缓存对象，语义与无缓存时一致。
 */
const BIB_CACHE_MAX = 8;
const bibCache = new Map<string, ParseBibtexResult>();

function parseBibCached(text: string): ParseBibtexResult {
  const hit = bibCache.get(text);
  if (hit !== undefined) {
    bibCache.delete(text); // LRU 触碰：移到最新位置
    bibCache.set(text, hit);
    return hit;
  }
  const parsed = parseBibtex(text);
  if (bibCache.size >= BIB_CACHE_MAX) {
    const oldest = bibCache.keys().next().value;
    if (oldest !== undefined) bibCache.delete(oldest);
  }
  bibCache.set(text, parsed);
  return parsed;
}

/** 项目内全部 .bib 文件的 citekey 集合 */
export function bibCitekeys(files: Record<string, string>): Set<string> {
  const keys = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.bib')) continue;
    for (const paper of parseBibCached(files[path]!).papers) {
      if (paper.citekey) keys.add(paper.citekey);
    }
  }
  return keys;
}

/** 从 .bib 解析出的条目（供编辑器 \cite 补全） */
export function bibEntries(files: Record<string, string>): { citekey: string; title: string; year?: number }[] {
  const out: { citekey: string; title: string; year?: number }[] = [];
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.bib')) continue;
    for (const paper of parseBibCached(files[path]!).papers) {
      out.push({ citekey: paper.citekey, title: paper.title, year: paper.year });
    }
  }
  return out;
}

export interface FileOutlineItem {
  file: string;
  node: OutlineNode;
}

/** 跨全部 .tex 文件的大纲（含所在文件，供跳转） */
export function outlineAcrossFiles(files: Record<string, string>): FileOutlineItem[] {
  const items: FileOutlineItem[] = [];
  for (const file of texFileList(files)) {
    for (const node of parseOutline(files[file]!)) items.push({ file, node });
  }
  return items;
}

/** 正文引用的 citekey（按出现顺序去重） */
export function citedKeys(files: Record<string, string>): string[] {
  return collectCitekeys(combinedDoc(files));
}
