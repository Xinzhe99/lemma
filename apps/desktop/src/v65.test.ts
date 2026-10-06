// @vitest-environment jsdom
/**
 * v6.5.0 多类型附件提取：文本直读/PDF 抽文/二进制诚实降级/总量预算。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// reader 子入口 mock（PDF 路径）
import { extractAttachmentBlocks } from './aiActions';

const fakeLoadPdfText = async () => ({
  numPages: 2,
  pages: [
    { page: 1, text: 'PDF first page about attention mechanism.' },
    { page: 2, text: 'PDF second page about experiments.' },
  ],
});

function mkFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractAttachmentBlocks', () => {
  it('文本类直读并包裹分隔块', async () => {
    const r = await extractAttachmentBlocks([mkFile('notes.md', '# 要点\n方法细节…', 'text/markdown')]);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toContain('附件 notes.md');
    expect(r.blocks[0]).toContain('# 要点');
    expect(r.notes).toHaveLength(0);
  });

  it('PDF 走 loadPdfText 逐页抽取（含页码标注）', async () => {
    const r = await extractAttachmentBlocks([mkFile('paper.pdf', '%fake-bytes%', 'application/pdf')], { loadPdfText: fakeLoadPdfText });
    expect(r.blocks[0]).toContain('PDF 共 2 页');
    expect(r.blocks[0]).toContain('【第 1 页】PDF first page');
    expect(r.blocks[0]).toContain('【第 2 页】PDF second page');
  });

  it('未知二进制：不伪装可读，给转换建议', async () => {
    const r = await extractAttachmentBlocks([mkFile('model.zip', 'binary', 'application/zip')]);
    expect(r.blocks).toHaveLength(0);
    expect(r.notes[0]).toContain('model.zip');
    expect(r.notes[0]).toContain('无法直接读取');
  });

  it('超长文本截断（8k/文件）', async () => {
    const r = await extractAttachmentBlocks([mkFile('big.csv', 'x'.repeat(20000), 'text/csv')]);
    expect(r.blocks[0]!).toContain('已截断');
    expect(r.blocks[0]!.length).toBeLessThan(8400);
  });

  it('多文件总量预算（40k）生效：后续文件被略过但仍给提示', async () => {
    const files = [
      mkFile('a.log', 'a'.repeat(9000), 'text/plain'),
      mkFile('b.log', 'b'.repeat(9000), 'text/plain'),
      mkFile('c.log', 'c'.repeat(9000), 'text/plain'),
      mkFile('d.log', 'd'.repeat(9000), 'text/plain'),
      mkFile('e.log', 'e'.repeat(9000), 'text/plain'),
      mkFile('f.log', 'f'.repeat(9000), 'text/plain'),
    ];
    const r = await extractAttachmentBlocks(files);
    const total = r.blocks.join('').length;
    expect(total).toBeLessThanOrEqual(42000);
    expect(r.blocks.length).toBeLessThan(files.length);
  });
});
