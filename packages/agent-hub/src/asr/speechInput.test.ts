// @vitest-environment jsdom
/**
 * v5.8.0 语音输入：纯函数与降级路径测试。
 * （Whisper worker 为浏览器专属，不做单测——模型加载/推理由真实环境验证）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpeechSupported, pickRecorderMime, resampleTo16k, warmAsr } from './speechInput';
import type { SpeechEvent } from './speechInput';

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

// ---------------------------------------------------------------------------
// v7.8.0：worker 单例的事件回调必须跟随最新调用方
// （此前首个调用方的 onEvent 被永久钉住：切换会话/重挂载后，新 UI 收不到 loading-model）
// ---------------------------------------------------------------------------

class FakeWorker {
  static last: FakeWorker | null = null;
  static created = 0;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown[] = [];

  constructor() {
    FakeWorker.created += 1;
    FakeWorker.last = this;
    liveWorker = this; // worker 单例跨用例存活，用模块内引用跟踪“当前那一个”
  }

  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }

  /** 模拟 worker 侧 progress 事件 */
  emitProgress(): void {
    this.onmessage?.({
      data: { type: 'progress', status: 'progress', progress: 0.5 },
    } as MessageEvent);
  }
}

/** speechInput 内部 worker 单例当前指向的实例（不随 afterEach 清空） */
let liveWorker: FakeWorker | null = null;

describe('worker 事件回调跟随最新调用方（v7.8.0）', () => {
  const g = globalThis as unknown as { Worker?: unknown; MediaRecorder?: unknown };

  afterEach(() => {
    delete g.Worker;
    delete g.MediaRecorder;
    FakeWorker.last = null;
    FakeWorker.created = 0;
    vi.restoreAllMocks();
  });

  it('第二个调用方收到 loading-model，首个回调不再被调用', () => {
    // 让 isSpeechSupported() 为真（warmAsr 的守卫）
    g.MediaRecorder = class {};
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
      configurable: true,
    });
    g.Worker = FakeWorker;

    const first = vi.fn<(e: SpeechEvent) => void>();
    warmAsr(first);
    const worker = liveWorker!;
    expect(worker.posted).toEqual([{ type: 'warm' }]);

    const second = vi.fn<(e: SpeechEvent) => void>();
    warmAsr(second); // 复用同一 worker（不重建）
    expect(liveWorker).toBe(worker);

    worker.emitProgress();
    expect(second).toHaveBeenCalledWith({ phase: 'loading-model' });
    expect(first).not.toHaveBeenCalled();
  });

  it('worker 异常后不再复用死 worker（下一次会重建，避免永久卡在「识别中」）', () => {
    g.MediaRecorder = class {};
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
      configurable: true,
    });
    g.Worker = FakeWorker;

    warmAsr(() => {});
    const before = FakeWorker.created;
    const dead = liveWorker!;
    dead.onerror?.(); // 模块 worker 加载失败 → 单例必须作废
    warmAsr(() => {});
    expect(FakeWorker.created).toBe(before + 1); // 重建新 worker
    expect(liveWorker).not.toBe(dead);
  });
});
