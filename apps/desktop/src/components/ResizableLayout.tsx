/**
 * 经典论文 IDE 布局（v5.5.0，Overleaf/Prism 式）：
 * nav rail 固定宽 → 水平组：sidebar | 中心（编辑器 + PDF 预览并排同步）| AI 会话（最右）。
 * 中心右列内部垂直组：PDF 预览 | console（可折叠）。
 * 尺寸经 onLayout 存 localStorage（JSON 数组，百分比）。
 */

import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

const H_KEY = 'sf-layout-horizontal';
const V_KEY = 'sf-layout-vertical';
const C_KEY = 'sf-layout-center';
// v5.5.0：sidebar | 中心 | agent；中心内 编辑器 | 预览列；预览列内 预览 | console
const H_DEFAULT = [17, 60, 23];
const C_DEFAULT = [50, 50];
const V_DEFAULT = [76, 24];

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
const cSizes = readSizes(C_KEY, C_DEFAULT);

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
  preview: ReactNode;
  console: ReactNode;
  agent: ReactNode;
}

export function ResizableLayout({ navRail, sidebar, editor, preview, console, agent }: ResizableLayoutProps) {
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
        {/* 中心：编辑器 | 预览列（PDF + 编译台）——同步并排显示，不再切换 */}
        <Panel defaultSize={hSizes[1]} minSize={30} className="sf-panel">
          <PanelGroup
            direction="horizontal"
            className="sf-panel-group"
            onLayout={(sizes) => persist(C_KEY, sizes)}
          >
            <Panel defaultSize={cSizes[0]} minSize={24} className="sf-panel">
              {editor}
            </Panel>
            <PanelResizeHandle className="sf-resizer" />
            <Panel defaultSize={cSizes[1]} minSize={20} className="sf-panel">
              <PanelGroup
                direction="vertical"
                className="sf-panel-group"
                onLayout={(sizes) => persist(V_KEY, sizes)}
              >
                <Panel defaultSize={vSizes[0]} minSize={30} className="sf-panel">
                  {preview}
                </Panel>
                <PanelResizeHandle className="sf-resizer sf-resizer-h" />
                <Panel defaultSize={vSizes[1]} minSize={6} collapsible className="sf-panel">
                  {console}
                </Panel>
              </PanelGroup>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="sf-resizer" />
        {/* AI 会话固定在最右 */}
        <Panel defaultSize={hSizes[2]} minSize={16} className="sf-panel sf-chat-panel">
          {agent}
        </Panel>
      </PanelGroup>
    </div>
  );
}
