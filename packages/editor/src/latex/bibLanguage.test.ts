/**
 * bibLanguage 测试：直接驱动 tokenizer（StringStream + 跨行 state）断言 token 流，
 * 另加 EditorState 集成用例验证 StreamLanguage 装配与 languageData 生效。
 */
import { describe, expect, it } from 'vitest';
import { StringStream, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { bibBase, bibLanguage, bibStartState, bibToken, type BibState } from './bibLanguage';

interface Tok {
  text: string;
  tag: string | null;
}

/** 逐 token 驱动一行；同时守护"每次调用必须前进"（防 tokenizer 卡死） */
function tokenizeLine(line: string, state: BibState): Tok[] {
  const stream = new StringStream(line, 4, 4);
  const out: Tok[] = [];
  while (!stream.eol()) {
    const before = stream.pos;
    stream.start = before;
    const tag = bibToken(stream, state);
    if (stream.pos === before) throw new Error(`tokenizer 未前进："${line}" @${before}`);
    out.push({ text: stream.current(), tag });
  }
  return out;
}

/** 多行文档 → 带 tag 的 token 文本序列（过滤无 tag 的空白/杂项） */
function tagged(doc: string): string[] {
  const state = bibStartState();
  const out: string[] = [];
  for (const line of doc.split('\n')) {
    for (const tok of tokenizeLine(line, state)) {
      if (tok.tag) out.push(`${tok.tag}:${tok.text}`);
    }
  }
  return out;
}

describe('bibLanguage tokenizer', () => {
  it('标准条目：@类型 / citekey / 字段名 / 花括号值', () => {
    const doc = [
      '@inproceedings{vaswani2017attention,',
      '  title     = {Attention Is All You Need},',
      '  year      = {2017},',
      '}',
    ].join('\n');
    expect(tagged(doc)).toEqual([
      'tagName:@inproceedings',
      'bracket:{',
      'atom:vaswani2017attention',
      'bracket:,',
      'propertyName:title',
      'bracket:{',
      'string:Attention Is All You Need',
      'bracket:}',
      'bracket:,',
      'propertyName:year',
      'bracket:{',
      'string:2017',
      'bracket:}',
      'bracket:,',
      'bracket:}',
    ]);
  });

  it('引号值（含 \\" 转义不闭合）与裸值（数字/单词）', () => {
    const doc = ['@misc{key,', '  note = "a\\"b",', '  year = 2024,', '  month = jan,', '}'].join('\n');
    expect(tagged(doc)).toEqual([
      'tagName:@misc',
      'bracket:{',
      'atom:key',
      'bracket:,',
      'propertyName:note',
      'string:"',
      'string:a',
      'string:\\"',
      'string:b',
      'string:"',
      'bracket:,',
      'propertyName:year',
      'number:2024',
      'bracket:,',
      'propertyName:month',
      'string:jan',
      'bracket:,',
      'bracket:}',
    ]);
  });

  it('嵌套花括号值：{{GPT-4} Technical Report} 深度平衡后回到字段模式', () => {
    const doc = ['@misc{openai2023gpt4,', '  title = {{GPT-4} Technical Report},', '  year = {2023},', '}'].join(
      '\n',
    );
    expect(tagged(doc)).toEqual([
      'tagName:@misc',
      'bracket:{',
      'atom:openai2023gpt4',
      'bracket:,',
      'propertyName:title',
      'bracket:{',
      'string:{',
      'string:GPT-4',
      'string:}',
      'string: Technical Report',
      'bracket:}',
      'bracket:,',
      'propertyName:year',
      'bracket:{',
      'string:2023',
      'bracket:}',
      'bracket:,',
      'bracket:}',
    ]);
  });

  it('值内 % 不是注释；值外 % 到行尾是注释', () => {
    const doc = ['@article{k,', '  note = {50% off}, % trailing note', '  year = {2020},', '}'].join('\n');
    expect(tagged(doc)).toEqual([
      'tagName:@article',
      'bracket:{',
      'atom:k',
      'bracket:,',
      'propertyName:note',
      'bracket:{',
      'string:50% off',
      'bracket:}',
      'bracket:,',
      'comment:% trailing note',
      'propertyName:year',
      'bracket:{',
      'string:2020',
      'bracket:}',
      'bracket:,',
      'bracket:}',
    ]);
  });

  it('跨行花括号值：state 在换行后保持 valueBrace', () => {
    const doc = ['@article{k,', '  title = {Long', '    Cross-Line Title},', '}'].join('\n');
    expect(tagged(doc)).toEqual([
      'tagName:@article',
      'bracket:{',
      'atom:k',
      'bracket:,',
      'propertyName:title',
      'bracket:{',
      'string:Long',
      'string:    Cross-Line Title',
      'bracket:}',
      'bracket:,',
      'bracket:}',
    ]);
  });

  it('无字段条目 @misc{key} 直接闭合；条目外的普通文本与伪 @ 不高亮', () => {
    const doc = ['% 顶部说明', '随机文本 @ 不是条目起点', '@misc{key}'].join('\n');
    // 第一行：整行注释；第二行 junk 无 tag（@ 后非字母不构成条目）；第三行正常条目
    expect(tagged(doc)).toEqual(['comment:% 顶部说明', 'tagName:@misc', 'bracket:{', 'atom:key', 'bracket:}']);
  });

  it('圆括号条目 @article(key, ...) 同样支持', () => {
    const doc = ['@article(key,', '  author = {A},', ')'].join('\n');
    expect(tagged(doc)).toEqual([
      'tagName:@article',
      'bracket:(',
      'atom:key',
      'bracket:,',
      'propertyName:author',
      'bracket:{',
      'string:A',
      'bracket:}',
      'bracket:,',
      'bracket:)',
    ]);
  });

  it('连字符/点号/下划线 citekey 与连字符字段名', () => {
    const doc = ['@techreport{some_key-2.v3,', '  journal-title = {J},', '}'].join('\n');
    expect(tagged(doc)).toEqual([
      'tagName:@techreport',
      'bracket:{',
      'atom:some_key-2.v3',
      'bracket:,',
      'propertyName:journal-title',
      'bracket:{',
      'string:J',
      'bracket:}',
      'bracket:,',
      'bracket:}',
    ]);
  });

  it('未闭合条目不卡死：状态停留在 fields 等待后续行', () => {
    const state = bibStartState();
    tokenizeLine('@article{unclosed,', state);
    tokenizeLine('  title = {x},', state);
    const last = tokenizeLine('  year = {1999},', state);
    expect(last.map((t) => `${t.tag}:${t.text}`)).toContain('propertyName:year');
  });

  it('EditorState 集成：bibBase() 装配后可解析出预期 token 节点', () => {
    const doc = ['@article{demo,', '  title = {Demo},', '}'].join('\n');
    const state = EditorState.create({ doc, extensions: [bibBase()] });
    const names: string[] = [];
    syntaxTree(state).iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names).toContain('tagName');
    expect(names).toContain('atom');
    expect(names).toContain('propertyName');
    expect(names).toContain('string');
  });

  it('languageData：% 注释符与括号配对配置经 languageDataAt 生效', () => {
    const state = EditorState.create({ doc: '@article{k,}', extensions: [bibBase()] });
    expect(state.languageDataAt<{ line: string }>('commentTokens', 0)).toEqual([{ line: '%' }]);
    expect(state.languageDataAt<{ brackets: string[] }>('closeBrackets', 0)).toEqual([
      { brackets: ['(', '[', '{', '"'] },
    ]);
  });

  it('bibLanguage 名称为 bibtex，不影响 latexLanguage', () => {
    expect(bibLanguage.name).toBe('bibtex');
  });
});
