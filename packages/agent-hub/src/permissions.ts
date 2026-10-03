/**
 * 权限网关（设计文档 5.3 权限模型）：
 * read 默认放行 → execute 首次确认（strict 下逐次确认）→ write 逐 diff 审批 → export 显式确认。
 * mode 档位：strict（最严）/ balanced（默认）/ yolo（全自动，风险自负）。
 */
import type { ToolDef } from '@lemma/shared';
import { PAPER_TOOLS } from './tools/registry';

export type PermissionMode = 'strict' | 'balanced' | 'yolo';

export interface PermissionPolicy {
  mode: PermissionMode;
  /** 是否允许内容离开本机（外发网络/生成投稿包）；false 时 export 级直接拦截 */
  allowExport: boolean;
}

export type PermissionDecisionKind = 'allow' | 'confirm' | 'blocked';

export interface PermissionDecision {
  decision: PermissionDecisionKind;
  reason: string;
}

/**
 * 判定一次工具调用在给定策略下的处置。
 * 工具默认查 PAPER_TOOLS；未知工具一律 blocked。可传入额外工具表（如 MCP 外部工具）。
 */
export function checkCall(
  toolName: string,
  policy: PermissionPolicy,
  tools: readonly ToolDef[] = PAPER_TOOLS,
): PermissionDecision {
  const def = tools.find((t) => t.name === toolName);
  if (!def) {
    return { decision: 'blocked', reason: `未知工具「${toolName}」，已拦截` };
  }
  switch (def.permission) {
    case 'read':
      return { decision: 'allow', reason: `「${toolName}」为只读操作，自动放行` };
    case 'execute':
      if (policy.mode === 'strict') {
        return { decision: 'confirm', reason: `strict 模式下「${toolName}」属执行级操作，需逐次确认` };
      }
      return { decision: 'allow', reason: `「${toolName}」属执行级操作，${modeLabel(policy.mode)}模式下放行` };
    case 'write':
      if (policy.mode === 'yolo') {
        return { decision: 'allow', reason: `yolo 模式下「${toolName}」的写操作免审批直接执行` };
      }
      return { decision: 'confirm', reason: `「${toolName}」属写级操作，修改需经 diff 审批` };
    case 'export':
      if (!policy.allowExport) {
        return { decision: 'blocked', reason: `策略禁止内容离开本机，「${toolName}」已拦截` };
      }
      return { decision: 'confirm', reason: `「${toolName}」会将内容发送到本机之外，需显式确认` };
  }
}

function modeLabel(mode: PermissionMode): string {
  return mode === 'strict' ? 'strict' : mode === 'yolo' ? 'yolo' : 'balanced';
}
