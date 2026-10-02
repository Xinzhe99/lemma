/**
 * 会话面板：消息列表（markdown 富渲染 / 流式光标 / 工具调用卡片 / 消息操作条）
 * + 输入增强（slash 命令菜单、@ 引用菜单、空输入 ↑ 回填上一条 user 消息）。
 * 纯展示组件：发送、停止、清空、重生成、编辑重发等全部经 props 回调由宿主处理。
 *
 * 说明：MessageList 保持无 hooks（既有测试以元素树遍历方式直接调用），
 * 消息操作（复制反馈 / 编辑重发草稿）的状态由 ChatPanel 持有并经 props 下传。
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { AgentMessage, ToolCallRequest } from '@scholarforge/shared';
import type { AgentSession } from '../store';
import { renderMarkdown } from './markdown';

/** slash 命令菜单项（宿主注入：工作流启动 / 压缩等命令） */
export interface SlashMenuItem {
  id: string;
  label: string;
  hint?: string;
}

/** @ 引用菜单项（宿主注入：文献 / 文件） */
export interface MentionItem {
  id: string;
  label: string;
  type: 'paper' | 'file';
}

/** 宿主可注入的界面文案（缺省内置中文） */
export interface ChatLabels {
  send?: string;
  stop?: string;
  copy?: string;
  copied?: string;
  regenerate?: string;
  editResend?: string;
  editHint?: string;
  clear?: string;
  clearHint?: string;
  paper?: string;
  file?: string;
  slashMenuLabel?: string;
  mentionMenuLabel?: string;
}

const DEFAULT_LABELS: Required<ChatLabels> = {
  send: '发送',
  stop: '停止',
  copy: '复制',
  copied: '已复制',
  regenerate: '重新生成',
  editResend: '编辑重发',
  editHint: 'Enter 重发 · Esc 取消',
  clear: '清空',
  clearHint: '清空当前会话',
  paper: '文献',
  file: '文件',
  slashMenuLabel: '命令菜单',
  mentionMenuLabel: '引用文献或文件',
};

/** 内置 /清空 菜单项 id（避免与宿主注入 id 冲突） */
const CLEAR_ITEM_ID = '__sf_ah_clear__';

export interface ChatPanelProps {
  session: AgentSession;
  onSend?: (text: string) => void;
  onStop?: () => void;
  placeholder?: string;
  /** markdown 引用 chip 点击（宿主接 jumpTo / 打开文献） */
  onCitekeyClick?: (key: string) => void;
  /** slash 菜单选中宿主注入项（宿主接工作流启动等） */
  onSlashWorkflow?: (id: string) => void;
  /** 选中内置 /清空（ChatPanel 不持有历史，由宿主清空会话） */
  onClearSession?: () => void;
  /** 最后一条 assistant 消息的重新生成 */
  onRegenerate?: () => void;
  /** 最后一条 user 消息的编辑重发 */
  onEditResend?: (text: string) => void;
  /** slash 菜单项注入（如 BUILTIN_WORKFLOWS 映射） */
  slashItems?: SlashMenuItem[];
  /** @ 引用菜单项注入（文献库 / 工作区文件） */
  mentionItems?: MentionItem[];
  /** 文案注入（zh 默认，宿主可给 en） */
  labels?: ChatLabels;
}

export interface MessageListProps {
  session: AgentSession;
  /** markdown 引用 chip 点击，透传 renderMarkdown */
  onCitekeyClick?: (key: string) => void;
  /** 以下交互状态由 ChatPanel 持有下传（保持本组件无 hooks） */
  copiedId?: string | null;
  editingId?: string | null;
  editDraft?: string;
  onCopy?: (id: string, text: string) => void;
  onEditBegin?: (message: AgentMessage) => void;
  onEditDraftChange?: (text: string) => void;
  onEditSubmit?: () => void;
  onEditCancel?: () => void;
  onRegenerate?: () => void;
  onEditResend?: (text: string) => void;
  labels?: ChatLabels;
}

function summarizeArgs(args: Record<string, unknown>, max = 120): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    text = String(args);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ToolCallCard({ call, result }: { call: ToolCallRequest; result?: AgentMessage }) {
  return (
    <div className="sf-ah-toolcard">
      <div className="sf-ah-toolcard-head">
        <span className="sf-ah-toolcard-badge">工具</span>
        <span>{call.tool}</span>
      </div>
      <div className="sf-ah-toolcard-args">{summarizeArgs(call.args)}</div>
      {result ? (
        <details>
          <summary>结果</summary>
          <pre>{typeof result.content === 'string' ? result.content : summarizeArgs(result.content as Record<string, unknown>, 2000)}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** 最后一条指定角色消息的 id */
function lastMessageId(messages: AgentMessage[], role: 'user' | 'assistant'): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return messages[i].id;
  }
  return null;
}

/** 消息正文（assistant 走 markdown 富渲染；其余纯文本） */
function MessageBody({
  message,
  onCitekeyClick,
}: {
  message: AgentMessage;
  onCitekeyClick?: (key: string) => void;
}): ReactNode {
  if (message.role === 'assistant') {
    return <div className="sf-ah-md">{renderMarkdown(message.content, { onCitekeyClick })}</div>;
  }
  return <span>{message.content}</span>;
}

/** 消息列表（纯展示、无 hooks：交互状态经 props 下传） */
export function MessageList(props: MessageListProps) {
  const { session } = props;
  const streaming = session.status === 'streaming';
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const lastAssistantId = lastMessageId(session.messages, 'assistant');
  const lastUserId = lastMessageId(session.messages, 'user');
  return (
    <div className="sf-ah-msgs">
      {session.messages.map((m, i) => {
        const isLast = i === session.messages.length - 1;
        const editing = props.editingId != null && props.editingId === m.id;
        const actionable = m.role === 'assistant' || m.role === 'user';
        return (
          <div key={m.id} className={`sf-ah-msg-row sf-ah-msg-row--${m.role}`}>
            <div
              className={`sf-ah-msg sf-ah-msg--${m.role}`}
              data-role={m.role}
            >
              {editing ? (
                <div className="sf-ah-edit">
                  <textarea
                    value={props.editDraft ?? ''}
                    onChange={(e) => props.onEditDraftChange?.(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        props.onEditSubmit?.();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        props.onEditCancel?.();
                      }
                    }}
                  />
                  <div className="sf-ah-edit-hint">{labels.editHint}</div>
                </div>
              ) : (
                <MessageBody message={m} onCitekeyClick={props.onCitekeyClick} />
              )}
              {m.toolCalls?.map((call) => {
                const result = session.messages.find(
                  (x) => x.role === 'tool' && x.toolCallId === call.id,
                );
                return <ToolCallCard key={call.id} call={call} result={result} />;
              })}
              {streaming && isLast && m.role === 'assistant' ? (
                <span className="sf-ah-cursor" aria-label="生成中" />
              ) : null}
            </div>
            {actionable && !editing ? (
              <div className="sf-ah-msg-actions">
                <button
                  type="button"
                  className="sf-ah-act"
                  onClick={() => props.onCopy?.(m.id, m.content)}
                >
                  {props.copiedId === m.id ? labels.copied : labels.copy}
                </button>
                {m.role === 'assistant' && m.id === lastAssistantId && props.onRegenerate ? (
                  <button type="button" className="sf-ah-act" onClick={() => props.onRegenerate?.()}>
                    {labels.regenerate}
                  </button>
                ) : null}
                {m.role === 'user' && m.id === lastUserId && props.onEditResend ? (
                  <button type="button" className="sf-ah-act" onClick={() => props.onEditBegin?.(m)}>
                    {labels.editResend}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------- 输入菜单辅助 ------------------------- */

function clampIdx(i: number, len: number): number {
  return len <= 0 ? 0 : Math.min(Math.max(i, 0), len - 1);
}

function slashMatches(item: SlashMenuItem, query: string): boolean {
  if (!query) return true;
  return `${item.id} ${item.label}`.toLowerCase().includes(query.toLowerCase());
}

function mentionMatches(item: MentionItem, query: string): boolean {
  if (!query) return true;
  return `${item.id} ${item.label}`.toLowerCase().includes(query.toLowerCase());
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    session,
    onSend,
    onStop,
    placeholder,
    onCitekeyClick,
    onSlashWorkflow,
    onClearSession,
    onRegenerate,
    onEditResend,
    slashItems,
    mentionItems,
    labels: labelOverrides,
  } = props;
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };

  const [text, setText] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const copyTimer = useRef<number | undefined>(undefined);
  const streaming = session.status === 'streaming';

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  /* ---- 输入菜单（开合与过滤由输入文本派生；Esc 置 dismissed） ---- */
  const slashQuery = /^\/([^\s]*)$/.exec(text)?.[1];
  const builtinSlash: SlashMenuItem[] = onClearSession
    ? [{ id: CLEAR_ITEM_ID, label: `/${labels.clear}`, hint: labels.clearHint }]
    : [];
  const allSlash = [...(slashItems ?? []), ...builtinSlash];
  const slashFiltered =
    slashQuery !== undefined && !menuDismissed
      ? allSlash.filter((it) => slashMatches(it, slashQuery))
      : [];
  const mentionQuery =
    mentionItems && mentionItems.length > 0 && !menuDismissed
      ? /(?:^|\s)@([^\s]*)$/.exec(text)?.[1]
      : undefined;
  const mentionFiltered =
    mentionQuery !== undefined && mentionItems
      ? mentionItems.filter((it) => mentionMatches(it, mentionQuery))
      : [];
  const slashOpen = slashFiltered.length > 0;
  const mentionOpen = mentionFiltered.length > 0;
  const slashActive = clampIdx(slashIdx, slashFiltered.length);
  const mentionActive = clampIdx(mentionIdx, mentionFiltered.length);
  const menuOpen = slashOpen || mentionOpen;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend?.(trimmed);
    setText('');
  };

  const selectSlash = (item: SlashMenuItem) => {
    if (item.id === CLEAR_ITEM_ID) {
      onClearSession?.();
      setText('');
      return;
    }
    if (onSlashWorkflow) {
      onSlashWorkflow(item.id);
      setText('');
    }
  };

  const selectMention = (item: MentionItem) => {
    // 把结尾的 @query 替换为引用 label（后接空格，便于继续输入）
    setText((t) => t.replace(/@[^\s]*$/, `${item.label} `));
  };

  const handleInputChange = (v: string) => {
    setText(v);
    setMenuDismissed(false);
    setSlashIdx(0);
    setMentionIdx(0);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        if (slashOpen) {
          setSlashIdx((x) => (x + delta + slashFiltered.length) % slashFiltered.length);
        } else {
          setMentionIdx((x) => (x + delta + mentionFiltered.length) % mentionFiltered.length);
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (slashOpen) selectSlash(slashFiltered[slashActive]);
        else selectMention(mentionFiltered[mentionActive]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
      return;
    }
    // 空输入 ↑：回填上一条 user 消息（历史回调）
    if (e.key === 'ArrowUp' && text === '') {
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].role === 'user') {
          e.preventDefault();
          setText(session.messages[i].content);
          return;
        }
      }
    }
  };

  const handleCopy = (id: string, content: string) => {
    const done = () => {
      setCopiedId(id);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedId(null), 1600);
    };
    try {
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clip?.writeText) void clip.writeText(content).then(done, () => undefined);
      else done();
    } catch {
      /* 剪贴板不可用不打断 UI */
    }
  };

  const beginEdit = (m: AgentMessage) => {
    setEditingId(m.id);
    setEditDraft(m.content);
  };
  const submitEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    onEditResend?.(trimmed);
    setEditingId(null);
    setEditDraft('');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  return (
    <div className="sf-ah-chat">
      <MessageList
        session={session}
        onCitekeyClick={onCitekeyClick}
        copiedId={copiedId}
        editingId={editingId}
        editDraft={editDraft}
        onCopy={handleCopy}
        onEditBegin={beginEdit}
        onEditDraftChange={setEditDraft}
        onEditSubmit={submitEdit}
        onEditCancel={cancelEdit}
        onRegenerate={onRegenerate}
        onEditResend={onEditResend}
        labels={labelOverrides}
      />
      <div className="sf-ah-input-wrap">
        {slashOpen ? (
          <div className="sf-ah-menu sf-ah-menu--slash" role="listbox" aria-label={labels.slashMenuLabel}>
            {slashFiltered.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={idx === slashActive}
                className={`sf-ah-menu-item${idx === slashActive ? ' sf-ah-menu-item--active' : ''}`}
                onMouseEnter={() => setSlashIdx(idx)}
                onClick={() => selectSlash(it)}
              >
                <span className="sf-ah-menu-label">{it.label}</span>
                {it.hint ? <span className="sf-ah-menu-hint">{it.hint}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {mentionOpen ? (
          <div className="sf-ah-menu sf-ah-menu--mention" role="listbox" aria-label={labels.mentionMenuLabel}>
            {mentionFiltered.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={idx === mentionActive}
                className={`sf-ah-menu-item${idx === mentionActive ? ' sf-ah-menu-item--active' : ''}`}
                onMouseEnter={() => setMentionIdx(idx)}
                onClick={() => selectMention(it)}
              >
                <span className={`sf-ah-menu-badge sf-ah-menu-badge--${it.type}`}>
                  {it.type === 'paper' ? labels.paper : labels.file}
                </span>
                <span className="sf-ah-menu-label">{it.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="sf-ah-input">
          <textarea
            value={text}
            placeholder={placeholder ?? '向 agent 提问，或输入 / 启动工作流、@ 引用文献…'}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="sf-ah-btn sf-ah-btn--primary"
            onClick={send}
            disabled={!text.trim() || streaming}
          >
            {labels.send}
          </button>
          {streaming ? (
            <button className="sf-ah-btn sf-ah-btn--danger" onClick={() => onStop?.()}>
              {labels.stop}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
