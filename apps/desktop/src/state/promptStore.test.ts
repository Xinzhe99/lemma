// @vitest-environment jsdom
/**
 * 自定义提示词库测试（v1.2.0 ③）：
 * CRUD（新增置顶/更新重排/删除）+ localStorage 持久化往返 + 宽容恢复
 * + promptsToSlashItems 斜杠菜单映射。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  usePromptStore,
  loadPersistedPrompts,
  promptsToSlashItems,
  PROMPTS_STORAGE_KEY,
  PROMPTS_LIMIT,
  PROMPT_TITLE_MAX,
  __resetPromptStoreForTests,
} from './promptStore';

beforeEach(() => {
  localStorage.clear();
  __resetPromptStoreForTests();
});

describe('promptStore CRUD', () => {
  it('addPrompt：置顶插入、标题去空白、返回 id', () => {
    const id1 = usePromptStore.getState().addPrompt('  检查时态  ', '请检查时态');
    const id2 = usePromptStore.getState().addPrompt('润色引言', '请润色引言');
    const list = usePromptStore.getState().prompts;
    expect(list.map((p) => p.title)).toEqual(['润色引言', '检查时态']); // 新的在前
    expect(id1).toBeTruthy();
    expect(id2).not.toBe(id1);
  });

  it('updatePrompt：改标题/正文 + updatedAt 重排到顶；空标题不覆盖', async () => {
    const id1 = usePromptStore.getState().addPrompt('甲', 'body-a');
    usePromptStore.getState().addPrompt('乙', 'body-b');
    await new Promise((r) => setTimeout(r, 2));
    usePromptStore.getState().updatePrompt(id1, { title: '甲改', body: 'body-a2' });
    const list = usePromptStore.getState().prompts;
    expect(list[0].title).toBe('甲改'); // 更新后重排到顶
    expect(list[0].body).toBe('body-a2');
    usePromptStore.getState().updatePrompt(id1, { title: '   ' });
    expect(usePromptStore.getState().prompts[0].title).toBe('甲改'); // 空标题不覆盖
  });

  it('deletePrompt：移除指定项', () => {
    const id1 = usePromptStore.getState().addPrompt('甲', 'a');
    usePromptStore.getState().addPrompt('乙', 'b');
    usePromptStore.getState().deletePrompt(id1);
    expect(usePromptStore.getState().prompts.map((p) => p.title)).toEqual(['乙']);
  });

  it('标题/正文超限裁剪；数量超限淘汰最旧', () => {
    usePromptStore.getState().addPrompt('x'.repeat(100), 'y'.repeat(5000));
    const p = usePromptStore.getState().prompts[0];
    expect(p.title).toHaveLength(PROMPT_TITLE_MAX);
    expect(p.body).toHaveLength(4000);
    for (let i = 0; i < PROMPTS_LIMIT + 5; i++) usePromptStore.getState().addPrompt(`p${i}`, 'b');
    expect(usePromptStore.getState().prompts).toHaveLength(PROMPTS_LIMIT);
    expect(usePromptStore.getState().prompts[0].title).toBe(`p${PROMPTS_LIMIT + 4}`); // 保留最新
  });
});

describe('持久化往返', () => {
  it('变更落 localStorage，重新 load 恢复（新的在前）', () => {
    usePromptStore.getState().addPrompt('检查时态', '请检查全文时态一致性');
    usePromptStore.getState().addPrompt('润色引言', '请润色引言');
    const raw = localStorage.getItem(PROMPTS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const restored = loadPersistedPrompts();
    expect(restored.map((p) => p.title)).toEqual(['润色引言', '检查时态']);
    expect(restored[1].body).toBe('请检查全文时态一致性');
  });

  it('坏 JSON / 非数组 / 坏记录宽容恢复', () => {
    localStorage.setItem(PROMPTS_STORAGE_KEY, '{bad json');
    expect(loadPersistedPrompts()).toEqual([]);
    localStorage.setItem(PROMPTS_STORAGE_KEY, '"str"');
    expect(loadPersistedPrompts()).toEqual([]);
    localStorage.setItem(
      PROMPTS_STORAGE_KEY,
      JSON.stringify([{ id: 1 }, { id: 'ok', title: 't', body: 'b', createdAt: 1, updatedAt: 1 }]),
    );
    const restored = loadPersistedPrompts();
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('ok');
  });
});

describe('promptsToSlashItems', () => {
  it('映射为斜杠项：label 补 / 前缀、insert 携带正文、hint 截断 40 字', () => {
    usePromptStore.getState().addPrompt('检查时态', '短指令');
    usePromptStore.getState().addPrompt('已有斜杠', `${'长'.repeat(50)}指令`);
    const items = promptsToSlashItems(usePromptStore.getState().prompts);
    expect(items[0]).toMatchObject({ id: `up:${usePromptStore.getState().prompts[0].id}`, label: '/已有斜杠', insert: `${'长'.repeat(50)}指令` });
    expect(items[0].hint).toHaveLength(41); // 40 + …
    expect(items[1].label).toBe('/检查时态');
    expect(items[1].insert).toBe('短指令');
  });
});
