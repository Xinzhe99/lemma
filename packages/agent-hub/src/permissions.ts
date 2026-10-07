/**
 * 权限网关（设计文档 5.3 权限模型）。
 * v7.9.0：档位对齐 DeepSeek Harness 式三档（UI 可选，见设置/Agent 面板）：
 *  - readonly（仅可查看）：只读放行、编译放行；写级操作与内容外发一律拦截；
 *  - balanced（工作区内修改，默认）：只读/编译放行，写级操作逐 diff 审批，外发显式确认；
 *  - full（完全权限）：全部放行（写操作仍自动快照 + 自动进版本历史，可回滚）。
 */
import type { ToolDef } from '@lemma/shared';
import { PAPER_TOOLS } from './tools/registry';

export type PermissionMode = 'readonly' | 'balanced' | 'full';

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
      // 编译用于查看结果；readonly 档放行（构建产物不入稿件，改稿另有 write 级闸门）
      if (policy.mode === 'full') {
        return { decision: 'allow', reason: `「${toolName}」属执行级操作，完全权限下放行` };
      }
      return { decision: 'allow', reason: `「${toolName}」属执行级操作，放行` };
    case 'write':
      if (policy.mode === 'readonly') {
        return {
          decision: 'blocked',
          reason: '当前权限模式为「仅可查看」：AI 不能修改文件——切换到「工作区内修改」或「完全权限」后再试',
        };
      }
      if (policy.mode === 'full') {
        return { decision: 'allow', reason: `「${toolName}」属写级操作，完全权限下免审批直接执行（自动快照，可回滚）` };
      }
      return { decision: 'confirm', reason: `「${toolName}」属写级操作，修改需经 diff 审批` };
    case 'export':
      if (policy.mode === 'readonly' || !policy.allowExport) {
        return {
          decision: 'blocked',
          reason:
            policy.mode === 'readonly'
              ? '当前权限模式为「仅可查看」：内容外发已禁用'
              : `策略禁止内容离开本机，「${toolName}」已拦截`,
        };
      }
      if (policy.mode === 'full') {
        return { decision: 'allow', reason: `「${toolName}」会将内容发送到本机之外，完全权限下放行` };
      }
      return { decision: 'confirm', reason: `「${toolName}」会将内容发送到本机之外，需显式确认` };
  }
}
