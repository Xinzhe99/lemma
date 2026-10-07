/**
 * MCP（Model Context Protocol）客户端：连接任意外部 MCP server 作为额外工具源。
 * 传输层抽象注入（stdio / WebSocket / 内存回环皆可），本模块只做 JSON-RPC 2.0 over ndjson。
 */
import type { ToolDef } from '@lemma/shared';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 类型
// ---------------------------------------------------------------------------

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: RpcError;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcNotification;

// ---------------------------------------------------------------------------
// ndjson 编解码（纯函数）
// ---------------------------------------------------------------------------

/** 编码：JSON 一行 + 换行符 */
export function encodeRpc(msg: RpcMessage): string {
  return `${JSON.stringify(msg)}\n`;
}

/** 解码：已完整的行 → 消息；不完整的尾行留在 rest；无法解析的行静默跳过 */
export function decodeRpcLines(buffer: string): { messages: RpcMessage[]; rest: string } {
  const messages: RpcMessage[] = [];
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj && typeof obj === 'object' && obj.jsonrpc === '2.0') {
        messages.push(obj as unknown as RpcMessage);
      }
    } catch {
      // 非 JSON 行（日志噪音）忽略
    }
  }
  return { messages, rest };
}

// ---------------------------------------------------------------------------
// 传输与客户端
// ---------------------------------------------------------------------------

/** MCP 传输：send 发一行 ndjson；onMessage 收一行 ndjson */
export interface McpTransport {
  send(s: string): void;
  onMessage(cb: (s: string) => void): void;
}

export interface McpSession {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 连接 MCP server：initialize → notifications/initialized → tools/list。
 * 外部工具没有 Lemma 权限分级信息，保守地按 execute 级（首次确认）接入。
 */
export function connectMcp(transport: McpTransport): McpSession {
  let buffer = '';
  let nextId = 1;
  const pending = new Map<number | string, Pending>();

  transport.onMessage((chunk) => {
    buffer += chunk;
    const { messages, rest } = decodeRpcLines(buffer);
    buffer = rest;
    for (const msg of messages) {
      if (!('id' in msg) || msg.id === undefined) continue; // 通知/请求由宿主另行处理
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      const resp = msg as RpcResponse;
      if (resp.error) {
        waiter.reject(new Error(`MCP 错误 ${resp.error.code}：${resp.error.message}`));
      } else {
        waiter.resolve(resp.result);
      }
    }
  });

  function request(method: string, params?: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      transport.send(encodeRpc({ jsonrpc: '2.0', id, method, params }));
    });
  }

  function notify(method: string, params?: unknown): void {
    transport.send(encodeRpc({ jsonrpc: '2.0', method, params }));
  }

  const ready = (async () => {
    const result = await request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'lemma-agent-hub', version: '0.1.0' },
    });
    notify('notifications/initialized');
    return result;
  })();

  let toolsCache: ToolDef[] | null = null;

  return {
    async listTools(): Promise<ToolDef[]> {
      await ready;
      if (toolsCache) return toolsCache;
      const result = (await request('tools/list', {})) as {
        tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
      };
      toolsCache = (result?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? '',
        permission: 'execute',
        parameters: (t.inputSchema as ToolDef['parameters']) ?? { type: 'object', properties: {} },
      }));
      return toolsCache;
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      await ready;
      const result = (await request('tools/call', { name, arguments: args })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      // v7.8.0 修复：此前只取 content[0].text——多块结果（分块文本/文本+资源）被静默截断
      const textBlocks = (result?.content ?? [])
        .filter((b) => typeof b?.text === 'string')
        .map((b) => b.text as string);
      const payload: unknown =
        textBlocks.length === 1
          ? (tryParseJson(textBlocks[0]) ?? textBlocks[0])
          : textBlocks.length > 1
            ? textBlocks.join('\n')
            : result;
      if (result?.isError) {
        throw new Error(`工具 ${name} 执行失败：${stringifyPayload(payload)}`);
      }
      return payload;
    },
  };
}

function tryParseJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function stringifyPayload(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
