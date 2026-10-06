// @vitest-environment jsdom
/**
 * v6.7.0：TTS 可朗读化（latexToSpeakable）测试。
 */
import { describe, expect, it } from 'vitest';
import { latexToSpeakable, ttsSupported } from './tts';

describe('latexToSpeakable', () => {
  it('剥命令保留参数文本、去注释/环境/引用键', () => {
    const tex = [
      '\\section{Introduction}',
      '% internal note',
      'We propose \\textbf{fast} method~\\cite{vaswani2017attention}.',
      '\\begin{equation}',
      'E = mc^2',
      '\\end{equation}',
      'See Figure~\\ref{fig:1}.',
    ].join('\n');
    const out = latexToSpeakable(tex);
    expect(out).toContain('Introduction');
    expect(out).toContain('fast');
    expect(out).toContain('E = mc^2');
    expect(out).toContain('We propose');
    expect(out).not.toContain('cite');
    expect(out).not.toContain('vaswani');
    expect(out).not.toContain('%');
    expect(out).not.toContain('begin');
    expect(out).not.toContain('{');
  });

  it('纯文本保持原样（仅压缩空白）', () => {
    expect(latexToSpeakable('Hello   world.')).toBe('Hello world.');
  });

  it('jsdom 无 speechSynthesis → 支持检测为 false（诚实）', () => {
    expect(ttsSupported()).toBe(false);
  });
});
