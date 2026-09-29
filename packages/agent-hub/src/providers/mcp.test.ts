import { describe, expect, it } from 'vitest';
import {
  connectMcp,
  decodeRpcLines,
  encodeRpc,
  MCP_PROTOCOL_VERSION,
} from './mcp';
import type { McpTransport, RpcMessage, RpcRequest, RpcResponse } from './mcp';

describe('ndjson 编解码', () => {
  it('encodeRpc 追加换行', () => {
    expect(encodeRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
    );
  });

  it('decodeRpcLines：完整行解析、残行留在 rest、坏行跳过', () => {
    const buffer = [
      encodeRpc({ jsonrpc: '2.0', id: 1, method: 'a' }),
      'not-json\n',
      encodeRpc({ jsonrpc: '2.0', id: 2, result: { ok: true } }),
      '{"no-jsonrpc":true}\n',
      encodeRpc({ jsonrpc: '2.0', method: 'notify' }),
      '{"jsonrpc":"2.0","id":3,"meth',
    ].join('');
    const { messages, rest } = decodeRpcLines(buffer);
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'a' },
      { jsonrpc: '2.0', id: 2, result: { ok: true } },
      { jsonrpc: '2.0', method: 'notify' },
    ]);
    expect(rest).toBe('{"jsonrpc":"2.0","id":3,"meth');

    // 跨 chunk 续上后可解析
    const next = decodeRpcLines(rest + 'od":"x"}\n');
    expect(next.messages).toEqual([{ jsonrpc: '2.0', id: 3, method: 'x' }]);
    expect(next.rest).toBe('');
  });
});

/** 内存回环 transport：模拟一个最小 MCP server */
function makeMockServer() {
  const received: RpcMessage[] = [];
  let clientCb: ((s: string) => void) | null = null;
  const transport: McpTransport = {
    send(s) {
      for (const msg of decodeRpcLines(s).messages) {
        received.push(msg);
        const resp = handle(msg);
        if (resp) clientCb?.(encodeRpc(resp));
      }
    },
    onMessage(cb) {
      clientCb = cb;
    },
  };
  function handle(msg: RpcMessage): RpcResponse | null {
    if (!('id' in msg) || msg.id === undefined) return null;
    const m = msg as RpcRequest;
    if (m.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: m.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-server', version: '0.0.1' },
        },
      };
    }
    if (m.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: m.id,
        result: {
          tools: [
            {
              name: 'demo.echo',
              description: '回显参数（JSON）',
              inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
            },
            { name: 'demo.raw', description: '返回纯文本' },
          ],
        },
      };
    }
    if (m.method === 'tools/call') {
      const params = m.params as { name: string; arguments: Record<string, unknown> };
      if (params.name === 'demo.echo') {
        return {
          jsonrpc: '2.0',
          id: m.id,
          result: { content: [{ type: 'text', text: JSON.stringify({ echo: params.arguments }) }] },
        };
      }
      if (params.name === 'demo.raw') {
        return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: '纯文本结果' }] } };
      }
      return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `未知工具 ${params.name}` } };
    }
    return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } };
  }
  return { transport, received };
}

describe('connectMcp 握手与工具调用', () => {
  it('initialize → notifications/initialized → tools/list → tools/call 全链路', async () => {
    const { transport, received } = makeMockServer();
    const session = connectMcp(transport);

    const tools = await session.listTools();
    expect(tools).toEqual([
      {
        name: 'demo.echo',
        description: '回显参数（JSON）',
        permission: 'execute',
        parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      },
      { name: 'demo.raw', description: '返回纯文本', permission: 'execute', parameters: { type: 'object', properties: {} } },
    ]);

    // 握手先于 tools/list，且发送过 initialized 通知
    expect((received[0] as RpcRequest).method).toBe('initialize');
    expect(received.some((m) => (m as RpcRequest).method === 'notifications/initialized')).toBe(true);
    const listCall = received.find((m) => (m as RpcRequest).method === 'tools/list');
    expect(listCall).toBeTruthy();

    // JSON 文本结果自动解析为对象
    await expect(session.callTool('demo.echo', { x: '1' })).resolves.toEqual({ echo: { x: '1' } });
    // 非 JSON 文本结果保持字符串
    await expect(session.callTool('demo.raw', {})).resolves.toBe('纯文本结果');
    // 服务端错误 → reject
    await expect(session.callTool('demo.missing', {})).rejects.toThrow(/MCP 错误 -32602/);

    // listTools 有缓存：不重复 tools/list
    await session.listTools();
    expect(received.filter((m) => (m as RpcRequest).method === 'tools/list')).toHaveLength(1);
  });
});
