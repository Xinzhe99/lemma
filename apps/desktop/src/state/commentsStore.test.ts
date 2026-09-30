// @vitest-environment jsdom
/**
 * commentsStore：行级批注 CRUD、按文件过滤排序、localStorage（sf-comments）持久化与坏数据回退、
 * 审阅意见 Markdown 导出纯函数 commentsToMarkdown（分组/排序/已解决标记/回复缩进）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMENTS_STORAGE_KEY,
  commentsToMarkdown,
  useCommentsStore,
  type ManuscriptComment,
} from './commentsStore';

beforeEach(() => {
  localStorage.clear();
  useCommentsStore.setState({ comments: [] });
});

describe('commentsStore · 增/回复/解决/删', () => {
  it('addComment 落库：默认作者「导师」、resolved=false、replies=[]，返回创建的批注', () => {
    const c = useCommentsStore.getState().addComment('main.tex', 12, '这里的论证需要补强');
    expect(c).not.toBeNull();
    expect(c!.author).toBe('导师');
    expect(c!.resolved).toBe(false);
    expect(c!.replies).toEqual([]);
    expect(c!.id).toBeTruthy();
    expect(useCommentsStore.getState().comments).toHaveLength(1);
  });

  it('addComment 支持自定义作者；空文本/空文件名为无效输入不落库', () => {
    const c = useCommentsStore.getState().addComment('intro.tex', 3, 'rewrite this', 'Reviewer 2');
    expect(c!.author).toBe('Reviewer 2');

    expect(useCommentsStore.getState().addComment('main.tex', 1, '   ')).toBeNull();
    expect(useCommentsStore.getState().addComment('', 1, 'x')).toBeNull();
    expect(useCommentsStore.getState().comments).toHaveLength(1);
  });

  it('addReply 追加回复（默认作者「作者」）；未知 id / 空文本为 no-op', () => {
    const c = useCommentsStore.getState().addComment('main.tex', 5, '正文');
    useCommentsStore.getState().addReply(c!.id, '已按建议修改');

    const after = useCommentsStore.getState().comments[0]!;
    expect(after.replies).toHaveLength(1);
    expect(after.replies[0]!.author).toBe('作者');
    expect(after.replies[0]!.text).toBe('已按建议修改');

    useCommentsStore.getState().addReply('missing-id', 'x');
    useCommentsStore.getState().addReply(c!.id, '   ');
    expect(useCommentsStore.getState().comments[0]!.replies).toHaveLength(1);
  });

  it('toggleResolved 来回切换解决状态', () => {
    const c = useCommentsStore.getState().addComment('main.tex', 8, 't');
    useCommentsStore.getState().toggleResolved(c!.id);
    expect(useCommentsStore.getState().comments[0]!.resolved).toBe(true);
    useCommentsStore.getState().toggleResolved(c!.id);
    expect(useCommentsStore.getState().comments[0]!.resolved).toBe(false);
  });

  it('removeComment 只删除目标批注', () => {
    const a = useCommentsStore.getState().addComment('main.tex', 1, 'a');
    const b = useCommentsStore.getState().addComment('main.tex', 2, 'b');
    useCommentsStore.getState().removeComment(a!.id);
    const rest = useCommentsStore.getState().comments;
    expect(rest).toHaveLength(1);
    expect(rest[0]!.id).toBe(b!.id);
  });
});

describe('commentsStore · commentsFor 按文件过滤 + 行号升序', () => {
  it('只返回目标文件的批注且按行号升序（乱序插入）', () => {
    useCommentsStore.getState().addComment('main.tex', 30, '三');
    useCommentsStore.getState().addComment('intro.tex', 2, '别处');
    useCommentsStore.getState().addComment('main.tex', 7, '二');
    useCommentsStore.getState().addComment('main.tex', 12, '一');

    const rows = useCommentsStore.getState().commentsFor('main.tex');
    expect(rows.map((c) => c.line)).toEqual([7, 12, 30]);
    expect(rows.every((c) => c.file === 'main.tex')).toBe(true);
    expect(useCommentsStore.getState().commentsFor('nope.tex')).toEqual([]);
  });

  it('返回副本：对结果排序/修改不影响 store 内部顺序', () => {
    useCommentsStore.getState().addComment('main.tex', 9, 'a');
    useCommentsStore.getState().addComment('main.tex', 2, 'b');
    const rows = useCommentsStore.getState().commentsFor('main.tex');
    rows.reverse();
    expect(useCommentsStore.getState().commentsFor('main.tex')[0]!.line).toBe(2);
  });
});

describe('commentsStore · localStorage 持久化（sf-comments）', () => {
  it('CRUD 后写入 sf-comments，且为合法 JSON 批注数组', () => {
    const c = useCommentsStore.getState().addComment('main.tex', 4, 'p');
    useCommentsStore.getState().addReply(c!.id, 'r');
    const raw = localStorage.getItem(COMMENTS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as ManuscriptComment[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.file).toBe('main.tex');
    expect(persisted[0]!.replies).toHaveLength(1);
  });

  it('持久化往返：重新加载模块时从 localStorage 恢复（含回复与解决态）', async () => {
    const c = useCommentsStore.getState().addComment('sections/intro.tex', 15, '术语不一致');
    useCommentsStore.getState().addReply(c!.id, '已在第二稿统一', '学生');
    useCommentsStore.getState().toggleResolved(c!.id);

    vi.resetModules();
    const fresh = await import('./commentsStore');
    const restored = fresh.useCommentsStore.getState().comments;
    expect(restored).toHaveLength(1);
    expect(restored[0]!.text).toBe('术语不一致');
    expect(restored[0]!.resolved).toBe(true);
    expect(restored[0]!.replies[0]!.text).toBe('已在第二稿统一');
    expect(restored[0]!.replies[0]!.author).toBe('学生');
  });

  it('坏数据回退：损坏 JSON / 非数组 → 初始化为空', async () => {
    localStorage.setItem(COMMENTS_STORAGE_KEY, '{bad json');
    vi.resetModules();
    const broken = await import('./commentsStore');
    expect(broken.useCommentsStore.getState().comments).toEqual([]);

    localStorage.setItem(COMMENTS_STORAGE_KEY, '{"not":"array"}');
    vi.resetModules();
    const notArray = await import('./commentsStore');
    expect(notArray.useCommentsStore.getState().comments).toEqual([]);
  });

  it('坏数据回退：逐条校验，非法条目被过滤、合法条目保留', async () => {
    const valid = useCommentsStore.getState().addComment('main.tex', 6, 'ok');
    localStorage.setItem(
      COMMENTS_STORAGE_KEY,
      JSON.stringify([
        { id: 'bad-1', file: 123, line: 'x', text: true }, // 字段类型全错
        { id: 'bad-2', file: 'main.tex', line: 1 }, // 缺 author/text/resolved/createdAt
        'not-an-object',
        {
          id: valid!.id,
          file: 'main.tex',
          line: 6,
          author: '导师',
          text: 'ok',
          resolved: false,
          createdAt: valid!.createdAt,
        },
      ]),
    );
    vi.resetModules();
    const filtered = await import('./commentsStore');
    const comments = filtered.useCommentsStore.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.id).toBe(valid!.id);
  });

  it('坏数据回退：replies 缺失默认 []、replies 非法成员被过滤', async () => {
    const base = {
      id: 'r1',
      file: 'main.tex',
      line: 2,
      author: '导师',
      text: 't',
      resolved: true,
      createdAt: 100,
    };
    localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify([base, { ...base, id: 'r2', replies: 'nope' }, { ...base, id: 'r3', replies: [{ author: '学生', text: 'ok', createdAt: 1 }, { author: 1, text: 'bad' }] }]));
    vi.resetModules();
    const { useCommentsStore: fresh } = await import('./commentsStore');
    const comments = fresh.getState().comments;
    expect(comments).toHaveLength(3);
    expect(comments[0]!.replies).toEqual([]); // 缺失 → 默认空数组
    expect(comments[1]!.replies).toEqual([]); // 非数组 → 回退空数组
    expect(comments[2]!.replies).toHaveLength(1); // 非法回复被过滤，合法保留
    expect(comments[2]!.replies[0]!.text).toBe('ok');
  });
});

describe('commentsToMarkdown · 审阅意见导出（纯函数）', () => {
  const mk = (over: Partial<ManuscriptComment>): ManuscriptComment => ({
    id: over.id ?? 'c',
    file: 'main.tex',
    line: 1,
    author: '导师',
    text: 't',
    resolved: false,
    createdAt: 1,
    replies: [],
    ...over,
  });

  it('按文件分组（组间空行分隔）、组内按行号升序', () => {
    const md = commentsToMarkdown([
      mk({ id: 'a', file: 'sections/intro.tex', line: 40, text: '后' }),
      mk({ id: 'b', file: 'main.tex', line: 30, text: '三十' }),
      mk({ id: 'c', file: 'main.tex', line: 7, text: '七' }),
      mk({ id: 'd', file: 'sections/intro.tex', line: 2, text: '前' }),
    ]);
    const introAt = md.indexOf('## sections/intro.tex');
    const mainAt = md.indexOf('## main.tex');
    expect(introAt).toBeGreaterThanOrEqual(0);
    expect(mainAt).toBeGreaterThanOrEqual(0);
    // 文件名排序：main.tex 在 sections/intro.tex 前
    expect(mainAt).toBeLessThan(introAt);
    // 行号升序：7 在 30 前、2 在 40 前
    expect(md.indexOf('[行 7]')).toBeLessThan(md.indexOf('[行 30]'));
    expect(md.indexOf('[行 2]')).toBeLessThan(md.indexOf('[行 40]'));
  });

  it('条目格式 `- [行 N] 作者：文本`，已解决追加（已解决）标记', () => {
    const md = commentsToMarkdown([
      mk({ id: 'a', line: 12, text: '论证不足', resolved: true }),
      mk({ id: 'b', line: 20, text: '术语不一致', resolved: false }),
    ]);
    expect(md).toContain('## main.tex');
    expect(md).toContain('- [行 12] 导师：论证不足（已解决）');
    expect(md).toContain('- [行 20] 导师：术语不一致');
    expect(md).not.toContain('术语不一致（已解决）');
  });

  it('回复以两个空格缩进为子列表，跟随其批注', () => {
    const md = commentsToMarkdown([
      mk({
        id: 'a',
        line: 3,
        text: '首',
        replies: [
          { author: '学生', text: '已修改', createdAt: 2 },
          { author: '导师', text: '确认', createdAt: 3 },
        ],
      }),
      mk({ id: 'b', line: 9, text: '次' }),
    ]);
    expect(md).toContain('- [行 3] 导师：首\n  - 学生：已修改\n  - 导师：确认');
    // 回复缩进在批注行与其下一条批注之间
    const head = md.indexOf('- [行 3]');
    const next = md.indexOf('- [行 9]');
    const reply = md.indexOf('  - 学生：已修改');
    expect(reply).toBeGreaterThan(head);
    expect(reply).toBeLessThan(next);
  });

  it('空数组返回空串', () => {
    expect(commentsToMarkdown([])).toBe('');
  });
});
