/**
 * 项目 zip 导入（Overleaf 导出 / 普通 LaTeX 项目压缩包）。
 * 纯文本文件进入虚拟工作区，二进制（图片等）跳过并在结果中说明。
 */

import { unzipSync, strFromU8 } from 'fflate';

export interface ParsedProjectZip {
  /** 建议的编译入口（相对路径） */
  entry: string;
  /** 文本文件映射（仅白名单扩展名） */
  files: Record<string, string>;
  /** 被跳过的二进制文件（提示用） */
  skippedBinary: string[];
}

const TEXT_EXT = /\.(tex|bib|md|txt|cls|sty|bst|cfg|def|fd|dtx|ltx)$/i;

/** 解析项目 zip：识别入口（main.tex 优先，其次含 \documentclass 的 .tex），收集文本文件。 */
export function parseProjectZip(bytes: Uint8Array): ParsedProjectZip {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (cause) {
    throw new Error('无法解压 zip 文件（可能已损坏或不是 zip 格式）', { cause });
  }

  const files: Record<string, string> = {};
  const skippedBinary: string[] = [];
  const texWithClass: string[] = [];
  const texFiles: string[] = [];

  for (const [rawPath, data] of Object.entries(entries)) {
    // Windows zip 可能以反斜杠分隔
    const path = rawPath.replace(/\\/g, '/');
    const base = path.split('/').pop() ?? '';
    if (!base || base.startsWith('.') || path.includes('__MACOSX/') || path.endsWith('/')) continue;

    if (!TEXT_EXT.test(base)) {
      skippedBinary.push(path);
      continue;
    }
    const text = strFromU8(data);
    files[path] = text;
    if (base.toLowerCase() === 'main.tex') continue; // 入口候选单独记录
    if (base.endsWith('.tex') || base.toLowerCase().endsWith('.ltx')) {
      texFiles.push(path);
      if (/\\documentclass/.test(text)) texWithClass.push(path);
    }
  }

  const hasMain = 'main.tex' in files;
  const entry =
    hasMain ? 'main.tex'
    : texWithClass.length > 0 ? texWithClass.sort(shortestFirst)[0]!
    : texFiles.sort(shortestFirst)[0] ?? '';

  if (!entry) {
    throw new Error('zip 中未找到 .tex 文件——请确认这是 LaTeX 项目压缩包（Overleaf: Menu → Source → Download Source）');
  }

  return { entry, files, skippedBinary };
}

function shortestFirst(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}
