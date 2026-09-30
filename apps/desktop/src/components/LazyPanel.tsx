/**
 * 动态面板加载器：React.lazy + import.meta.glob + Suspense/ErrorBoundary。
 * 面板文件由并行工作流提供（panels/NotesPanel.tsx、panels/SubmitPanel.tsx），当前可能不存在：
 * glob 无匹配时返回空对象 → 构建不报错；运行时加载失败渲染「面板加载失败」占位卡，不崩溃。
 * 面板落地后无需改代码：glob 自动发现，构建即按需分包。
 */

import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { useT } from '../i18n';

/** 约定导出名与文件名一致（NotesPanel.tsx → export NotesPanel） */
type LazyPanelFile = 'NotesPanel' | 'SubmitPanel';

const panelModules = import.meta.glob<Record<string, unknown>>('../panels/{NotesPanel,SubmitPanel}.tsx');

const lazyCache = new Map<LazyPanelFile, React.LazyExoticComponent<ComponentType>>();

function getLazyPanel(file: LazyPanelFile) {
  let comp = lazyCache.get(file);
  if (!comp) {
    comp = lazy(async () => {
      const loader = panelModules[`../panels/${file}.tsx`];
      if (!loader) throw new Error(`panel module not available: panels/${file}.tsx`);
      const mod = await loader();
      const exported = mod[file];
      if (typeof exported !== 'function' && typeof exported !== 'object') {
        throw new Error(`panel export "${file}" not found in panels/${file}.tsx`);
      }
      return { default: exported as ComponentType };
    });
    lazyCache.set(file, comp);
  }
  return comp;
}

class PanelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** 加载失败/面板缺失时的占位卡 */
function PanelFallbackCard({ label }: { label: string }) {
  const t = useT();
  return (
    <div className="sf-panel-fallback" role="alert">
      <strong>
        {t('panel.loadFailed')} · {label}
      </strong>
      <p>{t('panel.loadFailedDesc')}</p>
    </div>
  );
}

export function LazyPanel({ file, labelKey }: { file: LazyPanelFile; labelKey: string }) {
  const t = useT();
  const Panel = getLazyPanel(file);
  return (
    <PanelErrorBoundary fallback={<PanelFallbackCard label={t(labelKey)} />}>
      <Suspense fallback={<p className="placeholder sf-panel-loading">{t('panel.loading')}</p>}>
        <Panel />
      </Suspense>
    </PanelErrorBoundary>
  );
}
