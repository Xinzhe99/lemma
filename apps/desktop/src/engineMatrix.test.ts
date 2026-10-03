/**
 * 引擎矩阵测试（v2.0.0）：selectEngine 的偏好锁定/回落/auto 优先级、
 * engineArgs 参数正确性、多趟判断。
 */

import { describe, expect, it } from 'vitest';
import { engineArgs, engineNeedsMultiplePasses, selectEngine, type EngineKind } from './engineMatrix';

const ok = (k: EngineKind) => ({ [k]: { ok: true } });

describe('selectEngine', () => {
  it('auto：按优先级 tectonic > lualatex > xelatex > pdflatex > latexmk > builtin', () => {
    expect(selectEngine({ ...ok('tectonic'), ...ok('pdflatex') }, 'auto', false)?.kind).toBe('tectonic');
    expect(selectEngine({ ...ok('lualatex'), ...ok('pdflatex') }, 'auto', false)?.kind).toBe('lualatex');
    expect(selectEngine({ ...ok('xelatex'), ...ok('pdflatex') }, 'auto', false)?.kind).toBe('xelatex');
    expect(selectEngine(ok('pdflatex'), 'auto', false)?.kind).toBe('pdflatex');
    expect(selectEngine(ok('latexmk'), 'auto', false)?.kind).toBe('latexmk');
    expect(selectEngine({}, 'auto', true)?.kind).toBe('builtin-tectonic');
  });

  it('用户偏好锁定：可用直接选', () => {
    expect(selectEngine({ ...ok('tectonic'), ...ok('lualatex') }, 'lualatex', false)).toEqual({
      kind: 'lualatex',
      fellBack: false,
    });
  });

  it('用户偏好不可用：回落 auto（fellBack=true）', () => {
    const r = selectEngine({ ...ok('tectonic') }, 'lualatex', false);
    expect(r).toEqual({ kind: 'tectonic', fellBack: true });
  });

  it('全不可用返回 null', () => {
    expect(selectEngine({}, 'auto', false)).toBeNull();
  });
});

describe('engineArgs', () => {
  it('tectonic/builtin：-X compile + --synctex', () => {
    expect(engineArgs('tectonic', 'main.tex')).toEqual(['-X', 'compile', 'main.tex', '--synctex']);
    expect(engineArgs('builtin-tectonic', 'paper.tex')).toEqual(['-X', 'compile', 'paper.tex', '--synctex']);
  });

  it('lualatex/xelatex/pdflatex：--synctex=1 + nonstopmode', () => {
    for (const k of ['lualatex', 'xelatex', 'pdflatex'] as const) {
      const args = engineArgs(k, 'main.tex');
      expect(args).toContain('--synctex=1');
      expect(args).toContain('--interaction=nonstopmode');
      expect(args).toContain('main.tex');
    }
  });

  it('latexmk：-pdf + -interaction + -synctex=1', () => {
    const args = engineArgs('latexmk', 'main.tex');
    expect(args).toContain('-pdf');
    expect(args).toContain('-synctex=1');
    expect(args).toContain('main.tex');
  });
});

describe('engineNeedsMultiplePasses', () => {
  it('裸引擎需多趟；tectonic/latexmk 自动处理', () => {
    expect(engineNeedsMultiplePasses('pdflatex')).toBe(true);
    expect(engineNeedsMultiplePasses('xelatex')).toBe(true);
    expect(engineNeedsMultiplePasses('lualatex')).toBe(true);
    expect(engineNeedsMultiplePasses('tectonic')).toBe(false);
    expect(engineNeedsMultiplePasses('latexmk')).toBe(false);
    expect(engineNeedsMultiplePasses('builtin-tectonic')).toBe(false);
  });
});
