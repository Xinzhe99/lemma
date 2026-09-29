/**
 * 平台抽象层：桌面壳（Tauri）与浏览器形态共用同一套 FS / Secrets 接口。
 * 路径为项目内扁平虚拟路径（如 "main.tex"、"sections/intro.tex"），不带盘符与项目根前缀。
 */

import { browserPlatform } from './browser';
import { createTauriPlatform } from './tauri';

export interface ProjectFs {
  readFile(path: string): Promise<string | Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface Secrets {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface Platform {
  fs: ProjectFs;
  secrets: Secrets;
  readonly kind: 'browser' | 'tauri';
}

let cached: Platform | null = null;

/** 单例入口：Tauri 环境走约定桥，否则回落浏览器实现。 */
export function getPlatform(): Platform {
  if (!cached) cached = createTauriPlatform() ?? browserPlatform;
  return cached;
}
