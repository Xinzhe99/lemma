/** @scholarforge/agent-hub —— WS-D：Provider 适配 / 工具注册 / 权限 / 工作流引擎 / 会话 UI */
import './ui/agent-hub.css';

// provider 统一对话接口
export type { ChatRequest, ChatEvent, ChatProvider, ChatUsage } from './providers/types';
export { OpenAICompatibleProvider, parseSseChunk } from './providers/openaiCompat';
export type { OpenAICompatibleProviderOptions, FetchLike } from './providers/openaiCompat';
export {
  CliProvider,
  EchoProvider,
  MockProcessRunner,
  buildPrompt,
  extractJsonlEvents,
  extractUsage,
} from './providers/cli';
export type { CliProviderOptions, ProcessRunner } from './providers/cli';
export {
  connectMcp,
  encodeRpc,
  decodeRpcLines,
  MCP_PROTOCOL_VERSION,
} from './providers/mcp';
export type { McpTransport, McpSession, RpcRequest, RpcResponse, RpcNotification, RpcError, RpcMessage } from './providers/mcp';

// 论文域工具注册表
export {
  PAPER_TOOLS,
  PAPER_TOOLS_BY_NAME,
  validateArgs,
  createToolExecutor,
} from './tools/registry';
export type { ToolExecutor, ToolHandler } from './tools/registry';

// 权限网关
export { checkCall } from './permissions';
export type { PermissionPolicy, PermissionMode, PermissionDecision, PermissionDecisionKind } from './permissions';

// 工作流引擎与内置工作流
export { WorkflowRun } from './workflow/engine';
export type { WorkflowRunHooks, WorkflowRunResult, WorkflowStepContext } from './workflow/engine';
export {
  parseWorkflowYaml,
  BUILTIN_WORKFLOWS,
  WORKFLOW_YAML_SOURCES,
  getBuiltinWorkflow,
} from './workflow/builtin';

// 会话状态
export { useAgentHubStore, COMPLETED_RUNS_STORAGE_KEY, COMPLETED_RUNS_LIMIT } from './store';
export type { AgentSession, AgentSessionStatus, CompletedRun } from './store';

// UI 组件
export { ChatPanel, MessageList, ToolCallCard } from './ui/ChatPanel';
export type { ChatPanelProps } from './ui/ChatPanel';
export { DiffApprovalCard, PatchView } from './ui/DiffApprovalCard';
export type { DiffApprovalCardProps } from './ui/DiffApprovalCard';
export { WorkflowRunView } from './ui/WorkflowRunView';
export type { WorkflowRunViewProps, WorkflowStepUiStatus } from './ui/WorkflowRunView';
export { CostBadge, formatCost } from './ui/CostBadge';
export type { CostBadgeProps } from './ui/CostBadge';

export const AGENT_HUB_PACKAGE_VERSION = '0.8.0';
