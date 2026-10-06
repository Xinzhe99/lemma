/**
 * 语音输入控制器（v5.8.0，主线程侧）：
 * MediaRecorder 录音 → 解码重采样 16k → worker 内 Whisper 本地转写。
 * 状态机 idle → recording → transcribing → idle；错误经 onEvent 上抛 UI。
 */

export type SpeechPhase = 'idle' | 'recording' | 'transcribing' | 'loading-model';
export type SpeechEvent =
  | { phase: SpeechPhase; elapsedMs?: number }
  | { phase: 'idle'; text: string }
  | { phase: 'error'; message: string };

type WorkerEvent =
  | { type: 'progress'; status: string; progress?: number; file?: string }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };

let worker: Worker | null = null;
let pendingResolve: ((text: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

function ensureWorker(onEvent: (e: SpeechEvent) => void): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      if (msg.status === 'progress' && typeof msg.progress === 'number') {
        onEvent({ phase: 'loading-model' });
      } else if (msg.status === 'ready' || msg.status === 'done') {
        // 模型就绪：等 transcribe 结果，不改 UI 状态
      }
    } else if (msg.type === 'result') {
      pendingResolve?.(msg.text);
      flush();
    } else if (msg.type === 'error') {
      pendingReject?.(new Error(msg.message));
      flush();
    }
  };
  worker.onerror = () => {
    pendingReject?.(new Error('语音识别 worker 异常'));
    flush();
  };
  return worker;
}

function flush(): void {
  pendingResolve = null;
  pendingReject = null;
}

/** 浏览器能力检测（jsdom / 不支持 MediaRecorder 的环境诚实降级） */
export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** 选一个当前环境支持的录音 mime（webm 优先，Safari 回落 mp4） */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

/** 任意采样率 Float32 → 16kHz 单声道（Whisper 输入约定）；线性插值重采样 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = input[i0]! + (input[i1]! - input[i0]!) * frac;
  }
  return out;
}

/** 解码 blob → 16k 单声道 PCM */
async function blobToPcm16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const channel = decoded.getChannelData(0);
    return resampleTo16k(channel, decoded.sampleRate);
  } finally {
    void ctx.close();
  }
}

export interface SpeechSession {
  stop(): Promise<string>;
  cancel(): void;
}

/** 开始录音；返回会话句柄（stop = 停止 + 转写，resolve 文本） */
export async function startSpeechSession(
  language: 'auto' | 'zh' | 'en',
  onEvent: (e: SpeechEvent) => void,
): Promise<SpeechSession> {
  if (!isSpeechSupported()) throw new Error('当前环境不支持录音（需要 MediaRecorder）');
  const mime = pickRecorderMime();
  if (!mime) throw new Error('未找到可用的音频编码格式');

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  return {
    stop() {
      return new Promise<string>((resolve, reject) => {
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          onEvent({ phase: 'transcribing' });
          try {
            const pcm = await blobToPcm16k(new Blob(chunks, { type: mime }));
            if (pcm.length < 1600) {
              // <0.1s：几乎肯定是误触
              onEvent({ phase: 'error', message: '录音太短' });
              resolve('');
              return;
            }
            const w = ensureWorker(onEvent);
            pendingResolve = resolve;
            pendingReject = reject;
            w.postMessage({ type: 'transcribe', audio: pcm, language }, [pcm.buffer]);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        };
        recorder.stop();
      });
    },
    cancel() {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/** 预热模型（首次下载大文件；App 空闲时调用可选） */
export function warmAsr(onEvent: (e: SpeechEvent) => void): void {
  if (!isSpeechSupported()) return;
  void ensureWorker(onEvent).postMessage({ type: 'warm' });
}
