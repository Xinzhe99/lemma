/**
 * 项目 zip 导出（v2.1.2）：独立入口——不需要过 Submit 检查单。
 * 包含全部文本文件 + figures/ 下的二进制图片（桌面形态从数据目录读取）。
 * 复用 compile 包的 buildProjectZip（与 SubmitPanel 同一打包逻辑）。
 */

import { buildProjectZip } from '@lemma/compile';
import { useWorkspaceStore } from './state/workspaceStore';
import { getPlatform } from './platform/types';
import { tauriReadBase64 } from './platform/tauri';

/** 读取 figures/ 下的全部二进制文件（桌面形态） */
async function readFigures(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  try {
    const fs = getPlatform().fs;
    const all = await fs.list();
    const paths = all.filter((p) => p.startsWith('figures/'));
    for (const p of paths) {
      try {
        const bytes = await tauriReadBase64(p);
        out[p] = bytes;
      } catch {
        // 单文件读取失败不阻塞
      }
    }
  } catch {
    // 浏览器形态：跳过
  }
  return out;
}

/** 导出当前项目为 zip 并触发浏览器下载 */
export async function exportProjectZip(): Promise<void> {
  const ws = useWorkspaceStore.getState();
  if (Object.keys(ws.files).length === 0) return;
  const figures = await readFigures();
  // v7.8.0 修复：figures/ 空串是「图片在磁盘」的占位标记，不是文本内容——
  // buildProjectZip 以文本条目优先，占位会把下面读回的真实图片字节挡掉，
  // 导出的投稿包里图片变成 0 字节（对端编译缺图）。占位条目不进文本映射。
  const textFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(ws.files)) {
    if (content === '' && path.startsWith('figures/')) continue;
    textFiles[path] = content;
  }
  const { name, bytes } = buildProjectZip(textFiles, ws.projectName || 'project', figures);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
