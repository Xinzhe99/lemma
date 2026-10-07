/**
 * v7.4.0（借鉴 agent-foundation）：
 *  A. isTransientError 瞬态判定 / backoffDelay / withTransientRetry
 *  C. 会话 token 预算
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTransientError, backoffDelay, withTransientRetry, DEFAULT_RETRY_CONFIG } from './retryPolicy';
import { useSettingsStore } from './state/settingsStore';
import { useAgentHubStore } from '@lemma/agent-hub';

describe('isTransientError（瞬态判定）', () => {
  const transient = [
    'HTTP 429 Too Many Requests',
    'HTTP 503 Service Unavailable',
    'HTTP 502 Bad Gateway',
    'HTTP 500 Internal Server Error',
    'timeout: request timed out',
    'Connection was reset',
    'fetch failed: network error',
    'ECONNRESET',
    'overloaded',
  ];
  const permanent = [
    'HTTP 401 Unauthorized',
    'HTTP 403 Forbidden',
    'HTTP 404 Not Found',
    'Invalid API key',
    'quota exceeded',
    'billing: insufficient credits',
    'content_policy_violation',
    'certificate verify failed',
    'model_not_found',
    '工具参数 JSON 不完整',
  ];

  it('瞬态错误返回 true', () => {
    for (const msg of transient) {
      const result = isTransientError(new Error(msg));
      if (!result) {
        throw new Error(`Transient check failed for: ${msg}`);
      }
      expect(result).toBe(true);
    }
  });

  it('永久错误返回 false', () => {
    for (const msg of permanent) {
      expect(isTransientError(new Error(msg))).toBe(false);
    }
  });

  it('非 Error 对象不炸', () => {
    expect(isTransientError('some string')).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('指数增长且有上界', () => {
    for (let i = 0; i < 10; i++) {
      const d = backoffDelay(i);
      expect(d).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs);
      expect(d).toBeGreaterThan(0);
    }
  });
});

describe('withTransientRetry', () => {
  it('首次成功不重试', async () => {
    const fn = vi.fn(async () => 'ok');
    const r = await withTransientRetry(fn);
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('瞬态错误重试后成功', async () => {
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call < 3) throw new Error('HTTP 503 Service Unavailable');
      return 'ok';
    });
    const onRetry = vi.fn();
    const r = await withTransientRetry(fn, { config: { initialDelayMs: 1, maxDelayMs: 2 }, onRetry });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('永久错误不重试', async () => {
    const fn = vi.fn(async () => {
      throw new Error('HTTP 401 Unauthorized');
    });
    await expect(withTransientRetry(fn, { config: { initialDelayMs: 1 } })).rejects.toThrow('401');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('重试耗尽抛最后错误', async () => {
    const fn = vi.fn(async () => {
      throw new Error('HTTP 503 Service Unavailable');
    });
    await expect(
      withTransientRetry(fn, { config: { maxRetries: 2, initialDelayMs: 1 } }),
    ).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 重试
  });

  it('signal 已中止直接抛', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fn = vi.fn(async () => 'ok');
    await expect(withTransientRetry(fn, { signal: ctrl.signal })).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('会话 token 预算（v7.4.0 C）', () => {
  beforeEach(() => {
    useAgentHubStore.setState({ sessions: [], activeSessionId: null });
  });

  it('settingsStore 默认为 0（不限）', () => {
    expect(useSettingsStore.getState().sessionBudgetTokens).toBe(0);
  });

  it('sessionBudgetTokens 可设置', () => {
    useSettingsStore.setState({ sessionBudgetTokens: 50000 });
    expect(useSettingsStore.getState().sessionBudgetTokens).toBe(50000);
    useSettingsStore.setState({ sessionBudgetTokens: 0 });
  });
});
