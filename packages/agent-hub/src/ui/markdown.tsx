/**
 * 零依赖 Markdown 渲染器：文本 → React 元素树。
 *
 * 安全模型：全程不使用 dangerouslySetInnerHTML，一切内容都作为 React 文本
 * 子节点渲染；链接仅放行 http/https 协议（其余按纯文本输出），XSS 天然免疫。
 *
 * 支持范围（面向 LLM 助手消息）：
 * - 块级：#~#### 标题、--- 分隔线、``` 围栏代码块（语言标注）、> 引用块、
 *   - / * / 1. 列表（嵌套一层）、表格（| a | b | + 分隔行，横向滚动容器）、段落
 * - 行内：**粗**、*斜*、`code`、[文本](url)、~~删除~~、\[key\] 引用 chip
 * - 引用护栏：`[citekey]` / `[key p.12]`（行内 code 或转义括号形式）渲染为
 *   可点 chip，宿主经 MdCitationProps.onCitekeyClick 接 jumpTo / 打开文献。
 */
import type { CSSProperties, ReactNode } from 'react';

/** 引用护栏：宿主注入 citekey 点击行为（jumpTo / 打开文献） */
export interface MdCitationProps {
  onCitekeyClick?: (key: string) => void;
}

/* ------------------------- 行内：token 识别 ------------------------- */

/** 去除空白与控制字符（防 "java\nscript:" 之类协议绕过） */
function stripUnsafeChars(raw: string): string {
  let out = '';
  for (const c of raw) {
    const code = c.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += c;
  }
  return out;
}

/** 链接协议白名单：仅 http/https */
function safeHref(raw: string): string | null {
  const url = stripUnsafeChars(raw);
  return /^https?:\/\//i.test(url) ? url : null;
}

const CITE_KEY_RE = /^[A-Za-z][A-Za-z0-9_+:.#$/'-]*$/;
const CITE_LOCATOR_RE = /^(?:pp?\.|ch\.|sec\.)\s*\S+$/i;

/**
 * 识别 `[key]` / `[key p.12]` 形态的引用 token；不匹配返回 null。
 * 启发式护栏：无页码定位且过短的纯字母 token（如数学记号 [x]）不当引用。
 */
function parseCiteToken(content: string): { key: string; rest: string } | null {
  const m = /^\[([^\]]+)\]$/.exec(content.trim());
  if (!m) return null;
  const inner = m[1].trim();
  let key = inner;
  let rest = '';
  const lm = /^(.+?)\s+((?:pp?\.|ch\.|sec\.)\s*.+)$/i.exec(inner);
  if (lm) {
    key = lm[1].trim();
    rest = lm[2].trim();
  }
  if (!CITE_KEY_RE.test(key)) return null;
  if (rest && !CITE_LOCATOR_RE.test(rest)) return null;
  if (!rest && !/\d/.test(key) && key.length < 6) return null;
  return { key, rest };
}

/** 引用 chip：有回调时可点按钮，无回调时静态样式 */
function citeChip(
  tok: { key: string; rest: string },
  cite: MdCitationProps | undefined,
  key: string,
): ReactNode {
  const label = `[${tok.key}${tok.rest ? ` ${tok.rest}` : ''}]`;
  const click = cite?.onCitekeyClick;
  if (click) {
    return (
      <button
        key={key}
        type="button"
        className="sf-ah-md-cite"
        data-citekey={tok.key}
        title={`引用 ${tok.key}`}
        onClick={() => click(tok.key)}
      >
        {label}
      </button>
    );
  }
  return (
    <span key={key} className="sf-ah-md-cite sf-ah-md-cite--plain" data-citekey={tok.key}>
      {label}
    </span>
  );
}

/** 行内 code：内容形如引用 token 时渲染为 chip，否则普通 code 样式 */
function inlineCodeNode(content: string, cite: MdCitationProps | undefined, key: string): ReactNode {
  const tok = parseCiteToken(content);
  if (tok) return citeChip(tok, cite, key);
  return (
    <code key={key} className="sf-ah-md-code-inline">
      {content}
    </code>
  );
}

/**
 * 行内解析：单趟扫描，依次识别 `code`、**粗**、*斜*、~~删除~~、[文本](url)、
 * 反斜杠转义与 \[citekey\] 引用形式；未命中任何语法的字符按原文累积。
 */
function parseInline(src: string, cite: MdCitationProps | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let k = 0;
  const nextKey = () => `${keyBase}-i${k++}`;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '[') {
        // 转义括号形式 \[key\]：命中引用 token 则渲染 chip，否则输出字面 [
        const close = src.indexOf('\\]', i + 2);
        if (close > i + 1) {
          const tok = parseCiteToken(`${src.slice(i + 1, close)}]`);
          if (tok) {
            flush();
            out.push(citeChip(tok, cite, nextKey()));
            i = close + 2;
            continue;
          }
        }
        buf += '[';
        i += 2;
        continue;
      }
      if (next === '\\' || next === '*' || next === '~' || next === '`' || next === ']' || next === '(' || next === ')') {
        buf += next;
        i += 2;
        continue;
      }
      buf += '\\';
      i += 1;
      continue;
    }

    if (ch === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i) {
        flush();
        out.push(inlineCodeNode(src.slice(i + 1, close), cite, nextKey()));
        i = close + 1;
        continue;
      }
    }

    if (ch === '*') {
      if (src[i + 1] === '*') {
        const close = src.indexOf('**', i + 2);
        if (close > i + 2) {
          flush();
          out.push(
            <strong key={nextKey()}>{parseInline(src.slice(i + 2, close), cite, keyBase)}</strong>,
          );
          i = close + 2;
          continue;
        }
      }
      const close = src.indexOf('*', i + 1);
      if (close > i + 1) {
        flush();
        out.push(<em key={nextKey()}>{parseInline(src.slice(i + 1, close), cite, keyBase)}</em>);
        i = close + 1;
        continue;
      }
    }

    if (ch === '~' && src[i + 1] === '~') {
      const close = src.indexOf('~~', i + 2);
      if (close > i + 2) {
        flush();
        out.push(<del key={nextKey()}>{parseInline(src.slice(i + 2, close), cite, keyBase)}</del>);
        i = close + 2;
        continue;
      }
    }

    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      if (close > i && src[close + 1] === '(') {
        const end = src.indexOf(')', close + 2);
        if (end > close) {
          const label = src.slice(i + 1, close);
          const href = safeHref(src.slice(close + 2, end));
          flush();
          out.push(
            href ? (
              <a key={nextKey()} href={href} target="_blank" rel="noopener noreferrer">
                {parseInline(label, cite, keyBase)}
              </a>
            ) : (
              // 非白名单协议（javascript: 等）按原文输出，不渲染为链接
              src.slice(i, end + 1)
            ),
          );
          i = end + 1;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/* ------------------------- 块级：行结构识别 ------------------------- */

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_UL_RE = /^(\s*)[*-]\s+(.*)$/;
const LIST_OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^ {0,3}`{3,}\s*(\S*)\s*$/;
const FENCE_CLOSE_RE = /^ {0,3}`{3,}/;

/** 表格分隔行：仅由 | : - 空格构成，且含 - 与 | */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return t.includes('-') && t.includes('|') && /^[|:\-\s]+$/.test(t);
}

function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

type CellAlign = 'left' | 'center' | 'right' | undefined;

function cellAlign(sep: string): CellAlign {
  const s = sep.trim();
  const l = s.startsWith(':');
  const r = s.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  if (l) return 'left';
  return undefined;
}

function alignStyle(a: CellAlign): CSSProperties | undefined {
  return a ? { textAlign: a } : undefined;
}

/* ------------------------- 块级：列表 ------------------------- */

interface RawListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

/** 渲染嵌套一层的子列表（类型由首个子项的有序/无序决定） */
function renderNestedList(children: RawListItem[], cite: MdCitationProps | undefined, keyBase: string): ReactNode {
  const ordered = children[0].ordered;
  const items = children.map((c, ci) => <li key={ci}>{parseInline(c.text, cite, keyBase)}</li>);
  return ordered ? <ol className="sf-ah-md-list">{items}</ol> : <ul className="sf-ah-md-list">{items}</ul>;
}

/**
 * 解析一段连续列表行：顶层标记（缩进 <2）成组，缩进 >=2 归入上一顶层项的
 * 嵌套子列表；顶层有序/无序标记切换时拆成多个列表节点。
 */
function parseListBlock(
  lines: string[],
  start: number,
  cite: MdCitationProps | undefined,
  keyBase: string,
): { nodes: ReactNode[]; next: number } {
  const raw: RawListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break;
    const ul = LIST_UL_RE.exec(line);
    const ol = LIST_OL_RE.exec(line);
    if (ul) {
      raw.push({ indent: ul[1].length, ordered: false, text: ul[2] });
    } else if (ol) {
      raw.push({ indent: ol[1].length, ordered: true, text: ol[2] });
    } else if (raw.length && /^\s{2,}\S/.test(line)) {
      // 缩进续行并入上一项（懒延续）
      const prev = raw[raw.length - 1];
      raw[raw.length - 1] = { ...prev, text: `${prev.text} ${line.trim()}` };
      i += 1;
      continue;
    } else {
      break;
    }
    i += 1;
  }

  interface Group {
    text: string;
    children: RawListItem[];
  }
  const nodes: ReactNode[] = [];
  let groups: Group[] = [];
  let listOrdered: boolean | null = null;
  let n = 0;
  const pushList = () => {
    if (!groups.length || listOrdered === null) return;
    const items = groups.map((g, gi) => (
      <li key={gi}>
        {parseInline(g.text, cite, keyBase)}
        {g.children.length > 0 ? renderNestedList(g.children, cite, keyBase) : null}
      </li>
    ));
    nodes.push(
      listOrdered ? (
        <ol key={`${keyBase}-l${n++}`} className="sf-ah-md-list">
          {items}
        </ol>
      ) : (
        <ul key={`${keyBase}-l${n++}`} className="sf-ah-md-list">
          {items}
        </ul>
      ),
    );
    groups = [];
  };

  for (const r of raw) {
    const isNested = r.indent >= 2 && groups.length > 0;
    if (!isNested) {
      if (listOrdered !== null && r.ordered !== listOrdered) pushList();
      if (listOrdered === null) listOrdered = r.ordered;
      groups.push({ text: r.text, children: [] });
    } else {
      groups[groups.length - 1].children.push(r);
    }
  }
  pushList();
  return { nodes, next: i };
}

/* ------------------------- 块级：主循环 ------------------------- */

function parseBlocks(lines: string[], cite: MdCitationProps | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let n = 0;
  const nextKey = () => `${keyBase}-b${n++}`;
  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={nextKey()} className="sf-ah-md-p">
          {parseInline(para.join('\n'), cite, keyBase)}
        </p>,
      );
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }

    // 围栏代码块（未闭合时容忍：吃到底）
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(
        <div key={nextKey()} className="sf-ah-md-code">
          {lang ? <div className="sf-ah-md-code-lang">{lang}</div> : null}
          <pre className="sf-ah-md-pre">
            <code>{body.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      out.push(<hr key={nextKey()} className="sf-ah-md-hr" />);
      i += 1;
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      out.push(
        <Tag key={nextKey()} className={`sf-ah-md-h sf-ah-md-h${level}`}>
          {parseInline(h[2], cite, keyBase)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      out.push(
        <div key={nextKey()} className="sf-ah-md-tablewrap">
          <table className="sf-ah-md-table">
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th key={ci} style={alignStyle(aligns[ci])}>
                    {parseInline(c, cite, keyBase)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} style={alignStyle(aligns[ci])}>
                      {parseInline(c, cite, keyBase)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 引用块：收集连续 > 行，去掉标记后递归块级解析
    if (QUOTE_RE.test(line)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE_RE.exec(lines[i]);
        if (!q) break;
        inner.push(q[1]);
        i += 1;
      }
      out.push(
        <blockquote key={nextKey()} className="sf-ah-md-quote">
          {parseBlocks(inner, cite, keyBase)}
        </blockquote>,
      );
      continue;
    }

    if (LIST_UL_RE.test(line) || LIST_OL_RE.test(line)) {
      flushPara();
      const parsed = parseListBlock(lines, i, cite, keyBase);
      out.push(...parsed.nodes);
      i = parsed.next;
      continue;
    }

    para.push(line);
    i += 1;
  }
  flushPara();
  return out;
}

/**
 * 把 markdown 文本渲染为 React 元素树（数组节点可直接作为 JSX children）。
 * 空输入返回 null；纯文本输入直通为单个段落。
 */
export function renderMarkdown(text: string, cite?: MdCitationProps): ReactNode {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = parseBlocks(lines, cite, 'md');
  return blocks.length > 0 ? blocks : null;
}
