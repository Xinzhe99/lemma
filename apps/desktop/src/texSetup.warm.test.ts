// @vitest-environment jsdom
/**
 * v5.1.0 开箱即用闲时预热：warmCompileEngine 的四态语义与副作用。
 */
import { describe, expect, it, vi } from 'vitest';
import { warmCompileEngine, type WarmEngineDeps } from './texSetup';

function makeDeps(over: Partial<WarmEngineDeps> = {}): WarmEngineDeps {
  return {
    ensure: vi.fn(async () => ({ path: 'C:/bin/tectonic.exe', cached: false })),
    writeFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    run: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    isDesktop: () => true,
    ...over,
  };
}

describe('warmCompileEngine', () => {
  it('浏览器形态 → skipped（不动引擎）', async () => {
    const deps = makeDeps({ isDesktop: () => false });
    expect(await warmCompileEngine(deps)).toBe('skipped');
    expect(deps.ensure).not.toHaveBeenCalled();
  });

  it('引擎已 cached → cached，不跑预热编译', async () => {
    const deps = makeDeps({
      ensure: vi.fn(async () => ({ path: '/bin/tectonic', cached: true })),
    });
    expect(await warmCompileEngine(deps)).toBe('cached');
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('新装引擎 → 写最小文档并编译（预热宏包缓存），产物清理', async () => {
    const deps = makeDeps();
    expect(await warmCompileEngine(deps)).toBe('warmed');
    expect(deps.writeFile).toHaveBeenCalledWith('sf-engine-warm.tex', expect.stringContaining('documentclass'));
    expect(deps.run).toHaveBeenCalledWith('C:/bin/tectonic.exe', ['-X', 'compile', 'sf-engine-warm.tex'], '');
    expect(deps.deleteFile).toHaveBeenCalledWith('sf-engine-warm.tex');
    expect(deps.deleteFile).toHaveBeenCalledWith('sf-engine-warm.pdf');
  });

  it('引擎下载失败 → error（静默，真实编译时兜底）', async () => {
    const deps = makeDeps({ ensure: vi.fn(async () => ({ error: '网络失败' })) });
    expect(await warmCompileEngine(deps)).toBe('error');
  });

  it('预热编译抛错 → 仍报 warmed（按需拉取兜底）且清理执行', async () => {
    const deps = makeDeps({ run: vi.fn(async () => { throw new Error('compile fail'); }) });
    expect(await warmCompileEngine(deps)).toBe('warmed');
    expect(deps.deleteFile).toHaveBeenCalled();
  });
});
