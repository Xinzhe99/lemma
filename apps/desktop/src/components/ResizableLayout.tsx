/**
 * 三栏可拖拽布局（v5.0.0 Codex 式）：nav rail 固定宽，其余用 react-resizable-panels。
 * 水平组：sidebar 18% | chat（AI 会话，中央主区）| viewer 42%；
 * viewer 内垂直组：查看器（PDF 默认 / LaTeX）| console 22%（可折叠）。
 * 尺寸经 onLayout 存 localStorage（JSON 数组，百分比）。
 */

import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

const H_KEY = 'sf-layout-horizontal';
const V_KEY = 'sf-layout-vertical';
const H_DEFAULT = [18, 40, 42];
const V_DEFAULT = [78, 22];

// defaultSize 需在多次渲染间保持稳定，故模块级读取一次
function readSizes(key: string, fallback: number[]): number[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.length === fallback.length && v.every((n) => typeof n === 'number' && n > 0)) {
        return v;
      }
    }
  } catch {
    /* 忽略损坏的布局记录 */
  }
  return fallback;
}

const hSizes = readSizes(H_KEY, H_DEFAULT);
const vSizes = readSizes(V_KEY, V_DEFAULT);

function persist(key: string, sizes: number[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(sizes));
  } catch {
    /* 忽略写入失败 */
  }
}

export interface ResizableLayoutProps {
  navRail: ReactNode;
  sidebar: ReactNode;
  editor: ReactNode;
  console: ReactNode;
  agent: ReactNode;
}

export function ResizableLayout({ navRail, sidebar, editor, console, agent }: ResizableLayoutProps) {
  return (
    <div className="sf-layout">
      {navRail}
      <PanelGroup
        direction="horizontal"
        className="sf-panel-group"
        onLayout={(sizes) => persist(H_KEY, sizes)}
      >
        <Panel defaultSize={hSizes[0]} minSize={12} className="sf-panel">
          {sidebar}
        </Panel>
        <PanelResizeHandle className="sf-resizer" />
        {/* v5.0.0：中央 = AI 会话区（agent）；右侧 = 查看器（editor prop）+ 编译台 */}
        <Panel defaultSize={hSizes[1]} minSize={24} className="sf-panel sf-chat-panel">
          {agent}
        </Panel>
        <PanelResizeHandle className="sf-resizer" />
        <Panel defaultSize={hSizes[2]} minSize={24} className="sf-panel">
          <PanelGroup
            direction="vertical"
            className="sf-panel-group"
            onLayout={(sizes) => persist(V_KEY, sizes)}
          >
            <Panel defaultSize={vSizes[0]} minSize={30} className="sf-panel">
              {editor}
            </Panel>
            <PanelResizeHandle className="sf-resizer sf-resizer-h" />
            <Panel defaultSize={vSizes[1]} minSize={6} collapsible className="sf-panel">
              {console}
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
