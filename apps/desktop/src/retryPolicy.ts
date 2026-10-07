/**
 * 瞬态错误自动重试（v7.4.0 A，借鉴 agent-foundation ModelRecoveryPolicy）：
 * - 指数退避重试：1s → 2s → 4s → 8s，最多 maxRetries 次连续恢复
 * - 只重试瞬态错误（超时/连接/408/429/5xx），永久错误不重试
 * - 完整响应重置失败计数；重试耗尽返回恢复建议
 */

export interface RetryConfig {
  /** 最大连续重试次数（默认 3） */
  maxRetries: number;
  /** 初始退避毫秒（默认 1000） */
  initialDelayMs: number;
  /** 最大退避毫秒（默认 8000） */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * 判定错误是否为瞬态（可重试）：
 * - HTTP 408（请求超时）、429（限流）、500/502/503/504/529（服务端临时故障）
 * - 网络错误（连接重置/超时/拒绝——无法连接）
 * - 中止（AbortError）不在此判定——由调用方处理
 *
 * 永久错误不重试：401/403/404（鉴权/权限/不存在）、配额耗尽（quota/billing）内容过滤、证书验证失败
 */
export function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // 永久错误先行排除
  if (lower.includes('401') || lower.includes('unauthorized')) return false;
  if (lower.includes('403') || lower.includes('forbidden')) return false;
  if (lower.includes('404') || lower.includes('not found')) return false;
  if (lower.includes('quota') || lower.includes('billing')) return false;
  if (lower.includes('content_policy') || lower.includes('content filter')) return false;
  if (lower.includes('certificate') || lower.includes('tls')) return false;
  if (lower.includes('invalid api key') || lower.includes('incorrect api key')) return false;
  if (lower.includes('model_not_found') || lower.includes('does not exist')) return false;
  if (lower.includes('参数 json 不完整')) return false;

  // 瞬态错误
  if (lower.includes('408') || lower.includes('request timeout')) return true;
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) return true;
  if (lower.includes('500') || lower.includes('internal server')) return true;
  if (lower.includes('502') || lower.includes('bad gateway')) return true;
  if (lower.includes('503') || lower.includes('service unavailable') || lower.includes('overloaded')) return true;
  if (lower.includes('504') || lower.includes('gateway timeout')) return true;
  if (lower.includes('529')) return true;
  if (lower.includes('timeout') || lower.includes('timed out')) return true;
  if (lower.includes('connection reset') || lower.includes('connection was reset') || lower.includes('connection refused') || lower.includes('connection closed')) return true;
  if (lower.includes('network error') || lower.includes('fetch failed')) return true;
  if (lower.includes('econnreset') || lower.includes('econnrefused') || lower.includes('enotfound')) return true;
  if (lower.includes('socket hang up') || lower.includes('epipe')) return true;

  return false;
}

/**
 * 计算第 n 次重试的退避延迟（带 ±50% 抖动，与 agent-foundation 一致）
 */
export function backoffDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const base = Math.min(
    config.initialDelayMs * Math.pow(2, attempt),
    config.maxDelayMs,
  );
  const jitter = base * (0.5 + Math.random() * 0.5); // 50%~100% 抖动
  return Math.round(jitter);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 带瞬态重试的执行包装：
 * - fn 抛出瞬态错误 → 退避后重试
 * - 永久错误或重试耗尽 → 重新抛出原始错误
 * - onRetry 回调用于通知用户（可选）
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: {
    config?: Partial<RetryConfig>;
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...opts.config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw new Error('已中止');
    }
    try {
      const result = await fn();
      return result; // 成功（完整响应重置隐含——循环退出）
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (attempt === config.maxRetries) break;
      if (!isTransientError(error)) break;
      const delay = backoffDelay(attempt, config);
      opts.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
      if (opts.signal?.aborted) {
        throw new Error('已中止');
      }
    }
  }
  throw lastError;
}
