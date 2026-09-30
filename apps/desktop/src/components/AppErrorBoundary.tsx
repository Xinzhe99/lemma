/**
 * 根级错误边界（P0）：捕获子树渲染期异常，展示品牌错误卡而非白屏。
 * - 「重试」：重置内部错误 state，重新挂载子树（异常被修复后即可恢复）；
 * - 「复制错误详情」：把 error.message + error.stack 写入剪贴板，便于用户回报问题；
 * - 亮色主题：直接使用现有 CSS 变量（--bg-0/--fg-0 等）内联样式，不依赖外部类名。
 */

import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const S: Record<'page' | 'card' | 'brand' | 'headline' | 'summary' | 'actions' | 'btn' | 'primary', CSSProperties> = {
  page: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-0)',
    color: 'var(--fg-0)',
    fontFamily: 'inherit',
    zIndex: 1000,
  },
  card: {
    width: 520,
    maxWidth: '92vw',
    padding: '28px 32px',
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-pop, 0 8px 30px rgba(0, 0, 0, 0.08))',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  brand: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: 0.2,
    color: 'var(--fg-0)',
  },
  headline: {
    margin: 0,
    fontSize: 13,
    color: 'var(--fg-1)',
  },
  summary: {
    margin: 0,
    padding: '10px 12px',
    maxHeight: 180,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 12,
    lineHeight: 1.6,
    color: 'var(--err, #c0392b)',
    background: 'var(--bg-0)',
    border: '1px solid var(--border)',
    borderRadius: 8,
  },
  actions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
  btn: {
    border: '1px solid var(--border-strong, var(--border))',
    background: 'var(--bg-2, transparent)',
    color: 'var(--fg-0)',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 13,
    cursor: 'pointer',
  },
  primary: {
    background: 'var(--btn-bg, var(--fg-0))',
    borderColor: 'var(--btn-bg, var(--fg-0))',
    color: 'var(--btn-fg, var(--bg-0))',
  },
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // React 开发态已把异常打印到 console；这里补充组件栈便于定位崩溃来源
    console.error('[AppErrorBoundary]', error.message, info.componentStack);
  }

  private readonly retry = (): void => {
    // 重置内部 state：React 会重新挂载整个子树
    this.setState({ error: null });
  };

  private readonly copyDetails = (): void => {
    const { error } = this.state;
    if (!error) return;
    const text = `${error.name}: ${error.message}\n${error.stack ?? '(no stack)'}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => this.fallbackCopy(text));
    } else {
      this.fallbackCopy(text);
    }
  };

  /** 剪贴板 API 不可用时的降级：隐藏 textarea + execCommand */
  private fallbackCopy(text: string): void {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    } catch {
      // 剪贴板完全不可用时静默放弃：错误卡仍然可见，用户可手动复制摘要
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={S.brand}>ScholarForge</div>
          <p style={S.headline}>应用遇到了未捕获的错误 —— 你可以重试，或复制错误详情用于回报。</p>
          <pre style={S.summary}>{error.message}</pre>
          <div style={S.actions}>
            <button type="button" style={S.btn} onClick={this.copyDetails}>
              复制错误详情
            </button>
            <button type="button" style={{ ...S.btn, ...S.primary }} onClick={this.retry}>
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }
}
