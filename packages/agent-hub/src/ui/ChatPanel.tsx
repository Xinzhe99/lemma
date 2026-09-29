/**
 * 会话面板：消息列表（角色样式 / 流式光标 / 工具调用卡片）+ 底部输入框。
 * 纯展示组件：发送、停止由宿主回调处理。
 */
import { useState } from 'react';
import type { AgentMessage, ToolCallRequest } from '@scholarforge/shared';
import type { AgentSession } from '../store';

export interface ChatPanelProps {
  session: AgentSession;
  onSend?: (text: string) => void;
  onStop?: () => void;
  placeholder?: string;
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

/** 消息列表（纯展示，无内部状态） */
export function MessageList({ session }: { session: AgentSession }) {
  const streaming = session.status === 'streaming';
  return (
    <div className="sf-ah-msgs">
      {session.messages.map((m, i) => {
        const isLast = i === session.messages.length - 1;
        return (
          <div
            key={m.id}
            className={`sf-ah-msg sf-ah-msg--${m.role}`}
            data-role={m.role}
          >
            <span>{m.content}</span>
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
        );
      })}
    </div>
  );
}

export function ChatPanel({ session, onSend, onStop, placeholder }: ChatPanelProps) {
  const [text, setText] = useState('');
  const streaming = session.status === 'streaming';

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend?.(trimmed);
    setText('');
  };

  return (
    <div className="sf-ah-chat">
      <MessageList session={session} />
      <div className="sf-ah-input">
        <textarea
          value={text}
          placeholder={placeholder ?? '向 agent 提问，或让它检索、编译、修改稿件…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="sf-ah-btn sf-ah-btn--primary"
          onClick={send}
          disabled={!text.trim() || streaming}
        >
          发送
        </button>
        {streaming ? (
          <button className="sf-ah-btn sf-ah-btn--danger" onClick={() => onStop?.()}>
            停止
          </button>
        ) : null}
      </div>
    </div>
  );
}
