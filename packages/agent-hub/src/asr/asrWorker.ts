/**
 * Whisper ASR Web Worker（v5.8.0 语音转文字）：
 * transformers.js + Whisper（ONNX WASM）纯本地推理——开源（MIT）、离线可用
 * （首次使用下载模型 ~40-80MB，经浏览器 Cache 缓存；HF 不可达时自动切 hf-mirror）。
 * 独立 worker：推理不冻结 UI；动态 import 使 transformers/onnxruntime 全部落入
 * 懒加载分包，主 bundle 零成本。
 */

type WorkerRequest =
  | { type: 'transcribe'; audio: Float32Array; language: 'auto' | 'zh' | 'en' }
  | { type: 'warm' };

type ProgressInfo = { status: string; progress?: number; file?: string };

let pipeline: unknown | null = null;
let loading: Promise<unknown> | null = null;

function postProgress(p: ProgressInfo): void {
  self.postMessage({ type: 'progress', ...p });
}

async function loadTransformers() {
  // 先试官方 CDN，失败切国内镜像（hf-mirror.com）
  const { env, pipeline } = await import('@huggingface/transformers');
  const loadFrom = async (host: string) => {
    env.remoteHost = host;
    return pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
      dtype: 'q8',
      progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
        if (p && typeof p.status === 'string') {
          postProgress({ status: p.status, progress: p.progress, file: p.file });
        }
      },
    });
  };
  try {
    return await loadFrom('https://huggingface.co');
  } catch {
    postProgress({ status: 'switching-mirror' });
    return await loadFrom('https://hf-mirror.com');
  }
}

function ensurePipeline(): Promise<unknown> {
  if (pipeline) return Promise.resolve(pipeline);
  if (!loading) {
    loading = loadTransformers()
      .then((p) => {
        pipeline = p;
        return p;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'warm') {
    await ensurePipeline().catch((err) => {
      self.postMessage({ type: 'error', message: `模型加载失败：${String(err)}` });
    });
    return;
  }
  if (msg.type === 'transcribe') {
    try {
      const p = (await ensurePipeline()) as {
        (audio: Float32Array, opts: Record<string, unknown>): Promise<{ text: string }>;
      };
      const opts: Record<string, unknown> = { task: 'transcribe' };
      if (msg.language !== 'auto') opts.language = msg.language;
      const out = await p(msg.audio, opts);
      self.postMessage({ type: 'result', text: (out?.text ?? '').trim() });
    } catch (err) {
      self.postMessage({ type: 'error', message: `识别失败：${String(err)}` });
    }
  }
};
