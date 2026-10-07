/**
 * 首启引导卡（编辑器空态）：全新安装没有项目时，编辑器区不再默默显示「打开文件开始编辑」，
 * 而是一张引导卡——主按钮「新建项目」（名称 + 本地文件夹的正式对话框）、
 * 次按钮「先看看演示项目」（演示项目保留为显式入口，不再默认载入）。
 */

import { useT } from '../i18n';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';

export function FirstProjectGuide() {
  const t = useT();
  return (
    <div className="sf-first-project" data-testid="first-project-guide">
      <h2 className="sf-first-project-title">{t('empty.firstProject.title')}</h2>
      <p className="sf-first-project-desc">{t('empty.firstProject.desc')}</p>
      <div className="sf-first-project-actions">
        <button
          type="button"
          className="sf-btn primary"
          data-testid="first-project-create"
          onClick={() => useUiStore.getState().setNewProjectDialogOpen(true)}
        >
          {t('empty.firstProject.create')}
        </button>
        <button
          type="button"
          className="sf-btn"
          data-testid="first-project-demo"
          onClick={() => useWorkspaceStore.getState().loadDemoProject()}
        >
          {t('empty.firstProject.demo')}
        </button>
      </div>
    </div>
  );
}
