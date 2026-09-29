/**
 * 项目文档解析：入口解析、\input 递归展开、跨文件大纲、bib 引用键集合。
 * 供大纲面板 / 引用面板 / Agent Context Pack 共用。
 */

import { parseOutline, collectCitekeys, type OutlineNode } from '@scholarforge/editor';
import { parseBibtex } from '@scholarforge/library';

export function resolveEntry(files: Record<string, string>): string {
  if (files['main.tex'] !== undefined) return 'main.tex';
  return Object.keys(files).find((f) => f.endsWith('.tex')) ?? '';
}

export function texFileList(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => f.endsWith('.tex'))
    .sort();
}

/** 递归展开 \input/\include（防环、缺文件跳过），返回合并后的全文 */
export function combinedDoc(files: Record<string, string>): string {
  const entry = resolveEntry(files);
  if (!entry) return '';
  const visited = new Set<string>();
  const expand = (path: string): string => {
    const key = path.replace(/\.tex$/, '');
    if (visited.has(key)) return '';
    const content = files[`${key}.tex`] ?? files[path];
    if (content === undefined) return '';
    visited.add(key);
    return content.replace(/\\(?:input|include)\{([^}]+)\}/g, (_m, name: string) => expand(String(name)));
  };
  return expand(entry);
}

/** 项目内全部 .bib 文件的 citekey 集合 */
export function bibCitekeys(files: Record<string, string>): Set<string> {
  const keys = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.bib')) continue;
    const parsed = parseBibtex(files[path]!);
    for (const paper of parsed.papers) {
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
    for (const paper of parseBibtex(files[path]!).papers) {
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
