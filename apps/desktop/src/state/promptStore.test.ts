// @vitest-environment jsdom
/**
 * 自定义提示词库测试（v1.2.0 ③）：
 * CRUD（新增置顶/更新重排/删除）+ localStorage 持久化往返 + 宽容恢复
 * + promptsToSlashItems 斜杠菜单映射
 * + v7.7.0 导入/导出：parsePromptImport（行格式/JSON 自动识别、多行内容）、
 *   formatPromptsForExport（JSON 格式、往返一致）、importPrompts（追加去重计数）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  usePromptStore,
  loadPersistedPrompts,
  promptsToSlashItems,
  parsePromptImport,
  formatPromptsForExport,
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
  it('映射为斜杠项：label 补 / 前缀、insertText 携带全文、hint 截断 40 字', () => {
    usePromptStore.getState().addPrompt('检查时态', '短指令');
    usePromptStore.getState().addPrompt('已有斜杠', `${'长'.repeat(50)}指令`);
    const items = promptsToSlashItems(usePromptStore.getState().prompts);
    expect(items[0]).toMatchObject({
      id: `up:${usePromptStore.getState().prompts[0].id}`,
      label: '/已有斜杠',
      insertText: `${'长'.repeat(50)}指令`,
    });
    expect(items[0].hint).toHaveLength(41); // 40 + …
    expect(items[1].label).toBe('/检查时态');
    expect(items[1].insertText).toBe('短指令');
  });
});

// ---------------------------------------------------------------------------
// v7.7.0 导入 / 导出
// ---------------------------------------------------------------------------

describe('parsePromptImport（导入解析，纯函数）', () => {
  it('行格式：全角｜与半角 | 分隔均可', () => {
    expect(parsePromptImport('检查时态｜请检查全文时态一致性')).toEqual([
      { title: '检查时态', text: '请检查全文时态一致性' },
    ]);
    expect(parsePromptImport('润色引言 | 请润色引言部分')).toEqual([
      { title: '润色引言', text: '请润色引言部分' },
    ]);
  });

  it('行格式：多行内容持续到下一个标题行', () => {
    const raw = [
      '第一条｜检查时态，',
      '并给出修改建议',
      '逐段输出 diff',
      '第二条 | 润色引言',
    ].join('\n');
    expect(parsePromptImport(raw)).toEqual([
      { title: '第一条', text: '检查时态，\n并给出修改建议\n逐段输出 diff' },
      { title: '第二条', text: '润色引言' },
    ]);
  });

  it('JSON 数组自动识别（text 字段，兼容 body），坏 JSON 落回行格式', () => {
    const json = JSON.stringify([
      { title: '检查时态', text: '请检查全文时态一致性' },
      { title: '旧库迁移', body: 'body 兼容字段' },
    ]);
    expect(parsePromptImport(json)).toEqual([
      { title: '检查时态', text: '请检查全文时态一致性' },
      { title: '旧库迁移', text: 'body 兼容字段' },
    ]);
    // 不是 JSON → 按行格式解析
    expect(parsePromptImport('[备注｜这其实是行格式]')).toEqual([
      { title: '[备注', text: '这其实是行格式]' },
    ]);
  });

  it('宽容丢弃：空输入、空标题、空内容、无分隔符的散行', () => {
    expect(parsePromptImport('')).toEqual([]);
    expect(parsePromptImport('   \n  ')).toEqual([]);
    expect(parsePromptImport('｜无标题')).toEqual([]);
    expect(parsePromptImport('有标题｜   ')).toEqual([]);
    expect(parsePromptImport('只有一段没有分隔符的文字')).toEqual([]);
    expect(
      parsePromptImport(JSON.stringify([{ title: '', text: 'x' }, { title: 't', text: '  ' }, 42])),
    ).toEqual([]);
  });
});

describe('formatPromptsForExport（导出格式）', () => {
  it('输出 JSON 数组 [{title, text}]，可被 parsePromptImport 往返复原', () => {
    const source = [
      { title: '检查时态', body: '请检查全文时态一致性' },
      { title: '多行', body: '第一行\n第二行' },
    ];
    const json = formatPromptsForExport(source);
    expect(JSON.parse(json)).toEqual([
      { title: '检查时态', text: '请检查全文时态一致性' },
      { title: '多行', text: '第一行\n第二行' },
    ]);
    expect(parsePromptImport(json)).toEqual([
      { title: '检查时态', text: '请检查全文时态一致性' },
      { title: '多行', text: '第一行\n第二行' },
    ]);
    expect(formatPromptsForExport([])).toBe('[]');
  });
});

describe('importPrompts（追加去重）', () => {
  it('追加置顶；同名（与既有库/同批内）跳过并计数', () => {
    usePromptStore.getState().addPrompt('已有', 'old');
    const { added, skipped } = usePromptStore.getState().importPrompts([
      { title: '新的甲', text: 'a' },
      { title: '已有', text: '同名跳过' }, // 与既有库同名
      { title: '新的乙', text: 'b' },
      { title: '新的甲', text: '批内同名跳过' }, // 同批内同名
      { title: '  ', text: '空标题' },
    ]);
    expect(added).toBe(2);
    expect(skipped).toBe(3);
    const titles = usePromptStore.getState().prompts.map((p) => p.title);
    expect(titles).toEqual(['新的乙', '新的甲', '已有']); // 新的在前
    expect(usePromptStore.getState().prompts.find((p) => p.title === '已有')!.body).toBe('old'); // 不覆盖
  });

  it('标题/正文裁剪到上限；导入落盘可恢复', () => {
    usePromptStore.getState().importPrompts([
      { title: 'x'.repeat(100), text: 'y'.repeat(5000) },
    ]);
    const p = usePromptStore.getState().prompts[0];
    expect(p.title).toHaveLength(PROMPT_TITLE_MAX);
    expect(p.body).toHaveLength(4000);
    expect(loadPersistedPrompts().map((x) => x.title)).toEqual([p.title]);
  });

  it('导入数量超限淘汰最旧（上限 PROMPTS_LIMIT）', () => {
    const items = Array.from({ length: PROMPTS_LIMIT + 5 }, (_, i) => ({ title: `p${i}`, text: 'b' }));
    const { added } = usePromptStore.getState().importPrompts(items);
    expect(added).toBe(PROMPTS_LIMIT + 5);
    const list = usePromptStore.getState().prompts;
    expect(list).toHaveLength(PROMPTS_LIMIT);
    expect(list[0].title).toBe(`p${PROMPTS_LIMIT + 4}`); // 新的在前，最旧被淘汰
  });

  it('全部无效时不改动既有列表', () => {
    usePromptStore.getState().addPrompt('保持不变', 'body');
    const before = usePromptStore.getState().prompts;
    const { added, skipped } = usePromptStore.getState().importPrompts([{ title: '保持不变', text: 'x' }]);
    expect(added).toBe(0);
    expect(skipped).toBe(1);
    expect(usePromptStore.getState().prompts).toBe(before); // 引用不变（零写入）
  });
});
