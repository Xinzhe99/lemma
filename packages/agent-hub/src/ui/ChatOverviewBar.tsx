/**
 * 消息定位条（v7.7.2，ZCode 式 minimap）：会话消息多之后快速回看/跳转。
 * 窄条按比例绘制每条消息的刻度（按角色着色：user=强调色、assistant=中性、
 * tool=弱化、error=警示），半透明视口块指示当前可视范围；点击/拖拽跳到
 * 对应位置。纯前端几何，无外部依赖（编辑器类 minimap 的经典做法）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AgentMessage } from '@lemma/shared';

/** 刻度 y 坐标（纯函数，供测试）：消息在滚动内容中的偏移 → 条内坐标 */
export function markerTop(msgOffsetTop: number, scrollHeight: number, barHeight: number): number {
  if (scrollHeight <= 0) return 0;
  return Math.max(0, Math.min(barHeight - 3, (msgOffsetTop / scrollHeight) * (barHeight - 3)));
}

/** 视口块几何（纯函数，供测试） */
export function viewportBand(scrollTop: number, clientHeight: number, scrollHeight: number, barHeight: number): { top: number; height: number } {
  if (scrollHeight <= 0) return { top: 0, height: barHeight };
  const top = (scrollTop / scrollHeight) * barHeight;
  const height = Math.max(14, (clientHeight / scrollHeight) * barHeight);
  return { top: Math.max(0, Math.min(barHeight - height, top)), height };
}

function roleColor(role: AgentMessage['role'], content: string): string {
  if (role === 'user') return 'var(--accent)';
  if (role === 'tool') return 'var(--border-strong)';
  // assistant：含未决审批/错误提示时用警示色（帮助快速定位出问题的一轮）
  if (content.includes('[调用异常]') || content.includes('⚠️')) return 'var(--warn)';
  return 'var(--fg-2)';
}

/** 门控父组件（无 hooks，元素树就地展开安全）：少于 minMessages 不渲染 */
export function ChatOverviewBar({
  messages,
  minMessages = 6,
}: {
  /** scroller 由组件自行定位（自身节点的前一个兄弟 = .sf-ah-msgs），无需外部 ref */
  messages: AgentMessage[];
  minMessages?: number;
}) {
  if (messages.length < minMessages) return null;
  return <OverviewBarInner messages={messages} />;
}

/** 内层（真实 hooks）：定位 scroller = 自身根节点的前一个兄弟 */
function OverviewBarInner({ messages }: { messages: AgentMessage[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<{
    markers: Array<{ top: number; color: string; title: string }>;
    band: { top: number; height: number };
    height: number;
  }>({ markers: [], band: { top: 0, height: 14 }, height: 0 });
  const dragging = useRef(false);

  const scroller = useCallback((): HTMLDivElement | null => {
    const prev = rootRef.current?.previousElementSibling;
    return prev instanceof HTMLDivElement && prev.classList.contains('sf-ah-msgs') ? prev : null;
  }, []);

  const measure = useCallback(() => {
    const el = scroller();
    if (!el) return;
    const height = el.clientHeight;
    if (height <= 0) return;
    const rows = el.querySelectorAll<HTMLElement>('.sf-ah-msg-row');
    const markers: Array<{ top: number; color: string; title: string }> = [];
    rows.forEach((row) => {
      const cls = row.className;
      const role: AgentMessage['role'] = cls.includes('--user')
        ? 'user'
        : cls.includes('--tool')
          ? 'tool'
          : 'assistant';
      const text = row.textContent?.trim().slice(0, 40) ?? '';
      markers.push({
        top: markerTop(row.offsetTop, el.scrollHeight, height),
        color: roleColor(role, text),
        title: text,
      });
    });
    setGeometry({
      markers,
      band: viewportBand(el.scrollTop, el.clientHeight, el.scrollHeight, height),
      height,
    });
  }, [scroller]);

  // 内容/几何变化重算刻度；滚动只更新视口块（高频，直接量测开销可忽略）
  useEffect(() => {
    measure();
    const el = scroller();
    if (!el) return;
    const onScroll = () => {
      const height = el.clientHeight;
      if (height <= 0) return;
      setGeometry((g) => ({ ...g, band: viewportBand(el.scrollTop, el.clientHeight, el.scrollHeight, height) }));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 消息行高度变化（流式增量、图片加载）也重算
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [scroller, measure, messages.length]);

  /** 点击/拖拽 → 滚动到对应比例位置 */
  const seekFromEvent = useCallback(
    (clientY: number) => {
      const el = scroller();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    },
    [scroller],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromEvent(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekFromEvent(e.clientY);
  };
  const stop = () => {
    dragging.current = false;
  };

  const barStyle: CSSProperties = {
    flex: 'none',
    width: 16,
    alignSelf: 'stretch',
    position: 'relative',
    cursor: 'pointer',
    background: 'transparent',
    borderLeft: '1px solid var(--border)',
    touchAction: 'none',
  };

  return (
    <div
      ref={rootRef}
      className="sf-ah-overview"
      style={barStyle}
      role="scrollbar"
      aria-orientation="vertical"
      aria-label="会话消息定位条"
      aria-valuenow={Math.round(geometry.band.top)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {/* 视口指示块 */}
      <div
        style={{
          position: 'absolute',
          left: 2,
          right: 2,
          top: geometry.band.top,
          height: geometry.band.height,
          borderRadius: 3,
          background: 'var(--border-strong)',
          opacity: 0.35,
          pointerEvents: 'none',
        }}
      />
      {/* 消息刻度 */}
      {geometry.markers.map((m, i) => (
        <div
          key={i}
          title={m.title}
          style={{
            position: 'absolute',
            left: 4,
            right: 4,
            top: m.top,
            height: 2,
            borderRadius: 1,
            background: m.color,
            opacity: 0.75,
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  );
}
