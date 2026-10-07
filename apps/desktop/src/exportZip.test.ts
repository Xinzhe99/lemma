// @vitest-environment jsdom
/**
 * exportProjectZip（v7.8.0 回归）：figures/ 空串占位（图片在磁盘的标记）不得
 * 把读回的真实图片字节挡在 zip 之外——此前 zip 里图片是 0 字节。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

const readBase64 = vi.hoisted(() => vi.fn());
const listFiles = vi.hoisted(() => vi.fn());

vi.mock('./platform/tauri', () => ({
  tauriReadBase64: readBase64,
  tauriProcRun: vi.fn(),
  tauriWriteFileBase64: vi.fn(),
}));

vi.mock('./platform/types', () => ({
  getPlatform: () => ({
    kind: 'tauri',
    fs: {
      list: listFiles,
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => undefined),
      deleteFile: vi.fn(async () => undefined),
    },
    secrets: { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) },
  }),
}));

import { exportProjectZip } from './exportZip';
import { useWorkspaceStore } from './state/workspaceStore';

/** 迷你 PNG 头 + 尾，仅用于断言「字节原样进包」 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** jsdom 的 Blob 没有 arrayBuffer()：用子类截获构造入参（zip 字节就是第一个 part） */
const zipParts: ArrayBuffer[] = [];
class CaptureBlob extends Blob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    if (parts?.[0]) zipParts.push(parts[0] as ArrayBuffer);
  }
}

const anchorClicks: HTMLAnchorElement[] = [];

beforeEach(() => {
  zipParts.length = 0;
  anchorClicks.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('Blob', CaptureBlob);
  listFiles.mockResolvedValue(['main.tex', 'figures/plot.png']);
  readBase64.mockResolvedValue(PNG_BYTES);
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:test'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push(this);
  });
  useWorkspaceStore.setState({
    projectName: 'demo',
    entry: 'main.tex',
    files: {
      'main.tex': '\\includegraphics{figures/plot.png}',
      'figures/plot.png': '', // initWorkspace 的二进制占位标记
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exportProjectZip（figures 二进制附件）', () => {
  it('占位条目不让位：zip 内 figures/plot.png 为真实字节而非 0 字节', async () => {
    await exportProjectZip();
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0]!.download).toBe('demo.zip');
    expect(zipParts).toHaveLength(1);
    const zip = unzipSync(new Uint8Array(zipParts[0]!));
    expect(new TextDecoder().decode(zip['main.tex']!)).toContain('includegraphics');
    expect(Array.from(zip['figures/plot.png']!)).toEqual(Array.from(PNG_BYTES));
  });

  it('图片读取失败时不产出 0 字节残缺条目（宁可缺失也不要假文件）', async () => {
    readBase64.mockRejectedValue(new Error('ENOENT'));
    await exportProjectZip();
    const zip = unzipSync(new Uint8Array(zipParts[0]!));
    expect(zip['figures/plot.png']).toBeUndefined();
    expect(zip['main.tex']).toBeDefined();
  });

  it('空项目不产出下载', async () => {
    useWorkspaceStore.setState({ files: {} });
    await exportProjectZip();
    expect(anchorClicks).toHaveLength(0);
    expect(zipParts).toHaveLength(0);
  });
});
