/**
 * 会话面板：消息列表（markdown 富渲染 / 流式光标 / 工具调用卡片 / 消息操作条）
 * + 输入增强（slash 命令菜单、@ 引用菜单、空输入 ↑ 回填上一条 user 消息）。
 * 纯展示组件：发送、停止、清空、重生成、编辑重发等全部经 props 回调由宿主处理。
 *
 * 说明：MessageList 保持无 hooks（既有测试以元素树遍历方式直接调用），
 * 消息操作（复制反馈 / 编辑重发草稿）的状态由 ChatPanel 持有并经 props 下传。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { isSpeechSupported, startSpeechSession, type SpeechSession } from '../asr/speechInput';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { AgentMessage, ToolCallRequest } from '@lemma/shared';
import type { AgentSession } from '../store';
import { renderMarkdown } from './markdown';

/** slash 命令菜单项（宿主注入：工作流启动 / 压缩等命令） */
export interface SlashMenuItem {
  id: string;
  label: string;
  hint?: string;
  /**
   * 自定义提示词正文（v1.2.0 ③）：非空时选中 = 填入输入框（用户可改后发送），
   * 不触发 onSlashWorkflow。
   */
  insert?: string;
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
  speechStart?: string;
  speechRecording?: string;
  speechTranscribing?: string;
  speechLoadingModel?: string;
  speechUnsupported?: string;
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
  /** v7.5.0：空会话居中引导（默认中文，宿主按语言覆盖） */
  emptyTitle?: string;
  emptyHint?: string;
}

const DEFAULT_LABELS: Required<ChatLabels> = {
  send: '发送',
  speechStart: '语音输入（点击开始，再次点击结束并转写）',
  speechRecording: '录音中，点击结束',
  speechTranscribing: '识别中…',
  speechLoadingModel: '下载语音模型（首次约 40MB，之后离线可用）…',
  speechUnsupported: '当前环境不支持录音',
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
  emptyTitle: '开始与 AI 协作',
  emptyHint: '描述你想做的事——润色、找文献、改稿、修编译错误；AI 会自己调用工具完成。',
};

/** 内置 /清空 菜单项 id（避免与宿主注入 id 冲突） */
const CLEAR_ITEM_ID = '__sf_ah_clear__';

export interface ChatPanelProps {
  session: AgentSession;
  onSend?: (text: string, images?: string[], files?: File[]) => void;
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
  /** latex/tex 围栏代码块「插入到稿件」回调（宿主构造提案走 diff 审批） */
  onInsertLatex?: (code: string) => void;
  /** 插入按钮文案（宿主本地化注入） */
  insertLatexLabel?: string;
  /** 文案注入（zh 默认，宿主可给 en） */
  /** v5.8.0 语音输入：'auto' | 'zh' | 'en'；undefined = 不显示麦克风 */
  speechLanguage?: 'auto' | 'zh' | 'en';
  /** v5.9.0 会话产物（Codex 式）：本会话 AI 改动过的文件（新→旧） */
  artifacts?: Array<{ file: string; kind: 'edit' | 'create'; at: number }>;
  /** 点击产物文件跳转（打开编辑器并定位该文件） */
  onOpenArtifact?: (file: string) => void;
  labels?: ChatLabels;
  /** 当前 Provider 徽标（v3.8.0 E：显示在输入框上方） */
  providerLabel?: string;
}

export interface MessageListProps {
  session: AgentSession;
  /** markdown 引用 chip 点击，透传 renderMarkdown */
  onCitekeyClick?: (key: string) => void;
  /** latex 围栏插入动作（透传 renderMarkdown actions） */
  onInsertLatex?: (code: string) => void;
  insertLatexLabel?: string;
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

const TOOL_ICONS: Record<string, string> = {
  'library.search_fulltext': '🔍',
  'library.search': '🔍',
  'project.context': '📋',
  'project.read_file': '📖',
  'project.find_in_files': '🔎',
  'project.list_files': '🗂️',
  'tex.last_errors': '⚠️',
  'tex.edit': '✏️',
  'tex.create_file': '📄',
  'tex.compile': '🔨',
  'citation.validate': '✅',
  'citation.add': '📚',
  'snapshot.create': '📸',
  'submission.checklist': '📋',
  'figure.render': '🎨',
  'memory.write': '🧠',
  'git.log': '🕘',
  'git.show': '🔬',
  'paper.read': '📄',
  'paper.citations': '📚',
  'web.search_scholar': '🌐',
};

const TOOL_LABELS: Record<string, string> = {
  'library.search_fulltext': '检索文献库',
  'library.search': '检索文献',
  'paper.read': '阅读文献全文',
  'paper.citations': '查询引文网络',
  'web.search_scholar': '联网检索学术文献',
  'project.context': '获取项目上下文',
  'project.read_file': '读取文件',
  'project.find_in_files': '搜索项目文件',
  'project.list_files': '查看文件列表',
  'tex.last_errors': '查看编译错误',
  'tex.edit': '修改稿件',
  'tex.create_file': '创建文件',
  'tex.compile': '编译',
  'citation.validate': '验证引用',
  'citation.add': '添加引用',
  'snapshot.create': '创建快照',
  'submission.checklist': '查询投稿要求',
  'memory.write': '写入项目记忆',
  'git.log': '查看修订历史',
  'git.show': '查看提交明细',
};

/**
 * 流式渲染优化（v4.2.0）：memo 化工具卡与消息正文。
 * store 的 appendDelta/appendToolCall 只替换流式中的最后一条消息对象，其余
 * 消息保持引用相等——memo 后每个流式 token 只重渲最后一条的 markdown，
 * 历史消息（含其 markdown 重解析）全部跳过。
 */
const ToolCallCardMemo = memo(ToolCallCard);

export function ToolCallCard({ call, result }: { call: ToolCallRequest; result?: AgentMessage }) {
  const icon = TOOL_ICONS[call.tool] ?? '🔧';
  const label = TOOL_LABELS[call.tool] ?? call.tool;
  return (
    <div className="sf-ah-toolcard">
      <div className="sf-ah-toolcard-head">
        <span className="sf-ah-toolcard-badge">{icon}</span>
        <span>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>{call.tool}</span>
        <span style={{ fontSize: 10, color: 'var(--fg-2)', marginLeft: 'auto' }}>
          {result ? '✓' : '⏳'}
        </span>
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

/** v6.5.0：附件类型图标（按扩展名） */
function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return '📄';
  if (ext === 'docx' || ext === 'doc') return '📝';
  if (ext === 'csv' || ext === 'xlsx' || ext === 'tsv') return '📊';
  if (ext === 'tex' || ext === 'bib') return '🧮';
  return '📎';
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
  onInsertLatex,
  insertLatexLabel,
}: {
  message: AgentMessage;
  onCitekeyClick?: (key: string) => void;
  onInsertLatex?: (code: string) => void;
  insertLatexLabel?: string;
}): ReactNode {
  if (message.role === 'assistant') {
    return (
      <div className="sf-ah-md">
        {renderMarkdown(
          message.content,
          { onCitekeyClick },
          onInsertLatex ? { onInsertLatex, insertLatexLabel } : undefined,
        )}
      </div>
    );
  }
  // v6.4.0：用户消息附图缩略图（图片未持久化，重启后仅剩 [图片 ×N] 文字标记）
  if (message.role === 'user' && message.images && message.images.length > 0) {
    return (
      <span>
        {message.content}
        <span className="sf-ah-images" style={{ marginTop: 6 }}>
          {message.images.map((url, i) => (
            <img key={i} src={url} alt={`附件 ${i + 1}`} className="sf-ah-image-chip" style={{ position: 'static', width: 88, height: 88 }} />
          ))}
        </span>
      </span>
    );
  }
  return <span>{message.content}</span>;
}

/** 见 ToolCallCardMemo 注释：流式 token 只重渲最后一条消息 */
const MessageBodyMemo = memo(MessageBody);

/** 消息列表（纯展示、无 hooks：交互状态经 props 下传） */
export function MessageList(props: MessageListProps) {
  const { session } = props;
  const streaming = session.status === 'streaming';
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const lastAssistantId = lastMessageId(session.messages, 'assistant');
  const lastUserId = lastMessageId(session.messages, 'user');
  // 工具结果索引（v4.2.0）：O(n) 预建 Map，替代逐工具卡的 messages.find（O(n²)，
  // 长会话（50 轮 × 多工具）下每个流式 token 都全列表扫描）
  const toolResults = new Map<string, AgentMessage>();
  for (const m of session.messages) {
    if (m.role === 'tool' && m.toolCallId) toolResults.set(m.toolCallId, m);
  }
  return (
    <div className="sf-ah-msgs">
      {/* v5.3.0：空会话居中引导（Codex 式留白提示），替代一片空白 */}
      {session.messages.length === 0 && (
        <div className="sf-ah-empty-hint">
          <strong>{labels.emptyTitle}</strong>
          <span>{labels.emptyHint}</span>
        </div>
      )}
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
                <MessageBodyMemo
                  message={m}
                  onCitekeyClick={props.onCitekeyClick}
                  onInsertLatex={props.onInsertLatex}
                  insertLatexLabel={props.insertLatexLabel}
                />
              )}
              {m.toolCalls?.map((call) => (
                <ToolCallCardMemo key={call.id} call={call} result={toolResults.get(call.id)} />
              ))}
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
    speechLanguage,
    artifacts,
    onOpenArtifact,
    placeholder,
    onCitekeyClick,
    onSlashWorkflow,
    onClearSession,
    onRegenerate,
    onEditResend,
    slashItems,
    mentionItems,
    onInsertLatex,
    insertLatexLabel,
    providerLabel,
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

  // v6.4.0 对话贴图：textarea 粘贴图片 → dataUrl 暂存（多模态模型随消息发送）
  const [imageAttachments, setImageAttachments] = useState<string[]>([]);
  /** v6.5.0 非图片附件（PDF/Word/数据/文本）：原 File 对象，宿主负责按类型读取 */
  const [fileAttachments, setFileAttachments] = useState<File[]>([]);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const MAX_IMAGES = 4;
  const MAX_FILES = 4;

  const addImageAttachment = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    // v7.0.0 修复：上限检查移入函数式更新——此前读渲染闭包旧值，
    // 一次拖入/多选 8 张图全部绕过 MAX_IMAGES
    const reader = new FileReader();
    reader.onload = () =>
      setImageAttachments((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, String(reader.result)]));
    reader.readAsDataURL(file);
  };

  const addFileAttachment = (file: File | null | undefined) => {
    if (!file) return;
    if (file.type.startsWith('image/')) {
      addImageAttachment(file);
      return;
    }
    setFileAttachments((prev) =>
      prev.length >= MAX_FILES || prev.some((f) => f.name === file.name && f.size === file.size)
        ? prev
        : [...prev, file],
    );
  };

  const onInputPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    addImageAttachment(item.getAsFile());
  };

  // v5.8.0 语音输入：录音 → Whisper 本地转写 → 追加到输入框
  const speechSupported = speechLanguage !== undefined && isSpeechSupported();
  const [speechPhase, setSpeechPhase] = useState<'idle' | 'recording' | 'transcribing' | 'loading-model'>('idle');
  const speechSessionRef = useRef<SpeechSession | null>(null);
  const speechStartingRef = useRef(false);
  const [speechError, setSpeechError] = useState('');

  const toggleSpeech = async () => {
    setSpeechError('');
    if (speechPhase === 'recording') {
      const session = speechSessionRef.current;
      speechSessionRef.current = null;
      if (!session) return;
      setSpeechPhase('transcribing');
      try {
        const transcript = await session.stop();
        if (transcript) {
          setText((t) => (t ? `${t} ${transcript}` : transcript));
        }
      } catch (err) {
        setSpeechError(err instanceof Error ? err.message : String(err));
      } finally {
        speechStartingRef.current = false;
        setSpeechPhase('idle');
      }
      return;
    }
    if (speechPhase !== 'idle' || speechStartingRef.current) return;
    // v7.0.0 修复：getUserMedia 权限弹窗期间 phase 仍 idle——同步占位防双击，
    // 否则第二个会话覆盖 ref，第一个 MediaStream 永不关闭（麦克风常亮）
    speechStartingRef.current = true;
    try {
      speechSessionRef.current = await startSpeechSession(speechLanguage ?? 'auto', (e) => {
        if (e.phase === 'loading-model') setSpeechPhase('loading-model');
      });
      setSpeechPhase('recording');
    } catch (err) {
      speechStartingRef.current = false;
      const name = err instanceof DOMException ? err.name : '';
      const friendly =
        name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? '未检测到麦克风设备'
          : name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? '麦克风权限被拒绝（系统设置中允许本应用使用麦克风）'
            : err instanceof Error && err.message
              ? err.message
              : '当前环境不支持录音';
      setSpeechError(friendly);
    }
  };

  useEffect(() => () => speechSessionRef.current?.cancel(), []);

  const send = () => {
    const trimmed = text.trim();
    const hasAttach = imageAttachments.length > 0 || fileAttachments.length > 0;
    if ((!trimmed && !hasAttach) || streaming) return;
    onSend?.(
      trimmed || (imageAttachments.length > 0 ? '（请看图）' : '（请读附件）'),
      imageAttachments.length > 0 ? imageAttachments : undefined,
      fileAttachments.length > 0 ? fileAttachments : undefined,
    );
    setText('');
    setImageAttachments([]);
    setFileAttachments([]);
  };

  const selectSlash = (item: SlashMenuItem) => {
    if (item.id === CLEAR_ITEM_ID) {
      onClearSession?.();
      setText('');
      return;
    }
    // 用户自定义提示词（v1.2.0 ③）：insert 携带正文 → 直接填入输入框（可改后发送）
    if (item.insert != null) {
      setText(item.insert);
      setMenuDismissed(true);
      return;
    }
    if (onSlashWorkflow) {
      onSlashWorkflow(item.id);
      setText('');
    }
  };

  const selectMention = (item: MentionItem) => {
    // 保留 @ 前缀（v4.3.0）。v7.0.0 修复：替换串走函数形式——label 含 $&/$1 等
    // 模式串时字符串形式会被 RegExp 展开破坏插入内容
    setText((t) => t.replace(/@[^\s]*$/, () => `@${item.label} `));
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
    <div
      className="sf-ah-chat"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        for (const f of e.dataTransfer.files) addFileAttachment(f);
      }}
    >
      <MessageList
        session={session}
        onCitekeyClick={onCitekeyClick}
        onInsertLatex={onInsertLatex}
        insertLatexLabel={insertLatexLabel}
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
        {/* v3.8.0 E：Provider 徽标 + v3.8.0 D：错误重试 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '2px 4px',
            fontSize: 10.5,
            color: 'var(--fg-2)',
          }}
        >
          {providerLabel && (
            <span
              style={{
                padding: '1px 6px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--bg-0)',
                fontSize: 10,
                flex: 'none',
              }}
            >
              {providerLabel}
            </span>
          )}
          {session.status === 'error' && onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate()}
              style={{
                padding: '1px 8px',
                borderRadius: 999,
                border: '1px solid var(--err)',
                background: 'transparent',
                color: 'var(--err)',
                fontSize: 10.5,
                cursor: 'pointer',
              }}
            >
              ↻ 重试
            </button>
          )}
        </div>
        {/* v5.4.0：预设建议 chips 移除——原生 AI 能力下用户直接描述需求即可 */}
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
        {/* v5.9.0：会话产物清单（Codex 式）——AI 在本会话改/建过的文件，点击打开 */}
        {artifacts && artifacts.length > 0 ? (
          <div className="sf-ah-artifacts">
            <span className="sf-ah-artifacts-label">产物</span>
            {[...artifacts].reverse().slice(0, 6).map((a) => (
              <button
                key={a.file}
                type="button"
                className="sf-ah-artifact-chip"
                title={a.kind === 'create' ? `AI 新建：${a.file}` : `AI 修改：${a.file}`}
                onClick={() => onOpenArtifact?.(a.file)}
              >
                {a.kind === 'create' ? '＋' : '✎'} {a.file.split('/').pop()}
              </button>
            ))}
            {artifacts.length > 6 ? <span className="dim">+{artifacts.length - 6} 更早</span> : null}
          </div>
        ) : null}
        {(imageAttachments.length > 0 || fileAttachments.length > 0) ? (
          <div className="sf-ah-images">
            {imageAttachments.map((url, i) => (
              <div key={i} className="sf-ah-image-chip">
                <img src={url} alt={`附件 ${i + 1}`} />
                <button
                  type="button"
                  title="移除"
                  onClick={() => setImageAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
            {fileAttachments.map((f, i) => (
              <div key={`f-${i}`} className="sf-ah-file-chip" title={`${f.name} · ${(f.size / 1024).toFixed(1)} KB`}>
                <span className="sf-ah-file-icon">{fileIcon(f.name)}</span>
                <span className="sf-ah-file-name">{f.name}</span>
                <button
                  type="button"
                  title="移除"
                  onClick={() => setFileAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {(speechPhase !== 'idle' || speechError) && speechSupported ? (
          <div className="sf-ah-speech-status">
            {speechError
              ? speechError
              : speechPhase === 'recording'
                ? labels.speechRecording
                : speechPhase === 'loading-model'
                  ? labels.speechLoadingModel
                  : labels.speechTranscribing}
          </div>
        ) : null}
        {/* v6.6.0 Codex 式输入卡：大输入框为主体，图标按钮收纳框内——对话才是核心 */}
        <div className="sf-ah-input">
          <textarea
            value={text}
            placeholder={placeholder ?? '向 AI 提问，或 / 工作流、@ 引用、粘贴/拖入文件…'}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={onInputPaste}
          />
          <div className="sf-ah-input-actions">
            <button
              className="sf-ah-icon-btn"
              title={`添加附件（图片/PDF/Word/数据/文本，或拖入/粘贴；最多 图 ${MAX_IMAGES} + 文件 ${MAX_FILES}）`}
              onClick={() => imageFileRef.current?.click()}
            >
              📎
            </button>
            <input
              ref={imageFileRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                for (const f of e.target.files ?? []) addFileAttachment(f);
                e.target.value = '';
              }}
            />
            {speechSupported ? (
              <button
                className={`sf-ah-icon-btn sf-ah-btn--speech${speechPhase === 'recording' ? ' recording' : ''}`}
                title={labels.speechStart}
                disabled={streaming || (speechPhase !== 'idle' && speechPhase !== 'recording')}
                onClick={() => void toggleSpeech()}
              >
                {speechPhase === 'recording' ? '●' : '🎤'}
              </button>
            ) : null}
            <span style={{ flex: 1 }} />
            {streaming ? (
              <button
                className="sf-ah-icon-btn sf-ah-icon-btn--stop"
                title={labels.stop}
                onClick={() => onStop?.()}
              >
                ■
              </button>
            ) : (
              <button
                className="sf-ah-icon-btn sf-ah-icon-btn--send"
                title={`${labels.send}（Enter）`}
                aria-label={labels.send}
                onClick={send}
                disabled={(!text.trim() && imageAttachments.length === 0 && fileAttachments.length === 0) || streaming}
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
