// @vitest-environment jsdom
/**
 * v5.8.0 语音输入：纯函数与降级路径测试。
 * （Whisper worker 为浏览器专属，不做单测——模型加载/推理由真实环境验证）
 */
import { describe, expect, it } from 'vitest';
import { isSpeechSupported, pickRecorderMime, resampleTo16k } from './speechInput';

describe('resampleTo16k', () => {
  it('已是 16k → 原样返回', () => {
    const input = new Float32Array([1, 2, 3]);
    expect(resampleTo16k(input, 16000)).toBe(input);
  });

  it('48k → 16k 三分之一长度，值对齐采样点', () => {
    // 48k 采样 3 个点 [1, 4, 7] → 16k 取第 0、(约)1.x 点
    const out = resampleTo16k(new Float32Array([1, 4, 7]), 48000);
    expect(out.length).toBe(1);
    expect(out[0]).toBeCloseTo(1, 5);
  });

  it('32k → 16k 线性插值', () => {
    // 32k: [0, 2, 4, 6] → 16k 每 2 个取 1：[0, 4]
    const out = resampleTo16k(new Float32Array([0, 2, 4, 6]), 32000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(4, 5);
  });
});

describe('能力检测', () => {
  it('jsdom 无 MediaRecorder → 不支持（诚实降级）', () => {
    expect(isSpeechSupported()).toBe(false);
    expect(pickRecorderMime()).toBe(null);
  });
});
