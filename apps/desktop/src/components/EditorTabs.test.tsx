// @vitest-environment jsdom
/**
 * EditorTabs 标签条测试：右键「添加到对话」（v7.9.1）与拖拽负载。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EditorTabs, TAB_PATHS_MIME } from './EditorTabs';
import { useWorkspaceStore } from '../state/workspaceStore';

afterEach(cleanup);

function setup(openTabs = ['main.tex', 'sections/intro.tex'], activeTab = 'main.tex') {
  useWorkspaceStore.setState({ openTabs, activeTab });
}

describe('EditorTabs 右键菜单（v7.9.1 添加到对话）', () => {
  it('右键标签弹出菜单，点「添加到对话」回调带路径并关闭菜单', () => {
    setup();
    const onAddToConversation = vi.fn();
    const { container, getAllByTitle } = render(
      <EditorTabs onAddToConversation={onAddToConversation} addToConversationLabel="添加到对话" />,
    );
    const tab = getAllByTitle('main.tex').find((el) => el.className.includes('tab '))!;
    fireEvent.contextMenu(tab);
    const menu = container.querySelector('.sf-tab-menu');
    expect(menu).not.toBeNull();
    const item = menu!.querySelector<HTMLButtonElement>('.sf-tab-menu-item');
    expect(item!.textContent).toBe('添加到对话');
    fireEvent.click(item!);
    expect(onAddToConversation).toHaveBeenCalledWith('main.tex');
    expect(container.querySelector('.sf-tab-menu')).toBeNull();
  });

  it('不传 onAddToConversation 时右键不弹菜单', () => {
    setup();
    const { container, getAllByTitle } = render(<EditorTabs />);
    const tab = getAllByTitle('main.tex').find((el) => el.className.includes('tab '))!;
    fireEvent.contextMenu(tab);
    expect(container.querySelector('.sf-tab-menu')).toBeNull();
  });

  it('拖拽负载：dragStart 写入 application/x-lemma-paths 与 text/plain', () => {
    setup();
    const { getAllByTitle } = render(<EditorTabs onAddToConversation={vi.fn()} />);
    const tab = getAllByTitle('sections/intro.tex').find((el) => el.className.includes('tab '))!;
    const setData = vi.fn();
    fireEvent.dragStart(tab, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith(TAB_PATHS_MIME, JSON.stringify(['sections/intro.tex']));
    expect(setData).toHaveBeenCalledWith('text/plain', 'sections/intro.tex');
  });
});
