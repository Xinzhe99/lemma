/**
 * 工作流引擎（L3 编排层）：DAG 拓扑执行、并行分支、人工检查点、失败传播。
 * 纯逻辑零 UI；步骤的实际执行（模型调用/工具编排/占位符替换）由宿主通过 hooks 注入。
 */
import type { WorkflowDef, WorkflowStepDef } from '@scholarforge/shared';

export interface WorkflowStepContext {
  /** start(vars) 传入的工作流变量（对应 WorkflowDef.inputs） */
  vars: Record<string, string>;
  /** 已完成步骤的输出快照（步骤执行时取当时快照，并行分支互不干扰） */
  priorOutputs: Record<string, string>;
  /** checkpoint 步骤：用户在检查点输入的确认内容（无检查点时为 undefined） */
  checkpointInput?: string;
}

export interface WorkflowRunHooks {
  runStep(step: WorkflowStepDef, ctx: WorkflowStepContext): Promise<string>;
  /** 到达 checkpoint 步骤时调用；Promise 在用户完成确认/输入后 resolve，值作为 checkpointInput 传入 runStep */
  onCheckpoint?(step: WorkflowStepDef, priorOutputs: Record<string, string>): Promise<string>;
}

export interface WorkflowRunResult {
  status: 'done' | 'failed';
  outputs: Record<string, string>;
  /** failed 时携带错误信息（含出错步骤 id） */
  error?: string;
}

class StepFailure extends Error {
  constructor(
    readonly stepId: string,
    readonly stepName: string,
    readonly cause: unknown,
  ) {
    super(`步骤 ${stepId}（${stepName}）执行失败：${causeText(cause)}`);
  }
}

export class WorkflowRun {
  constructor(
    private readonly def: WorkflowDef,
    private readonly hooks: WorkflowRunHooks,
  ) {}

  async start(vars: Record<string, string>): Promise<WorkflowRunResult> {
    const steps = this.def.steps;
    const validateError = this.validate(steps);
    if (validateError) return { status: 'failed', outputs: {}, error: validateError };

    const outputs: Record<string, string> = {};
    const remaining = new Set(steps.map((s) => s.id));

    const runOne = async (step: WorkflowStepDef): Promise<void> => {
      let checkpointInput: string | undefined;
      if (step.checkpoint && this.hooks.onCheckpoint) {
        checkpointInput = await this.hooks.onCheckpoint(step, { ...outputs });
      }
      try {
        outputs[step.id] = await this.hooks.runStep(step, {
          vars: { ...vars },
          priorOutputs: { ...outputs },
          checkpointInput,
        });
        remaining.delete(step.id);
      } catch (e) {
        throw new StepFailure(step.id, step.name, e);
      }
    };

    try {
      while (remaining.size > 0) {
        const ready = steps.filter((s) => {
          if (!remaining.has(s.id)) return false;
          return (s.dependsOn ?? []).every((d) => !remaining.has(d));
        });
        if (ready.length === 0) {
          return { status: 'failed', outputs, error: `工作流 ${this.def.id} 存在循环依赖，无法继续执行` };
        }
        // dependsOn 相同且 parallel:true 的连续就绪步骤合并为一个并行批（如三个审稿人）
        const batches: WorkflowStepDef[][] = [];
        for (const s of ready) {
          const last = batches[batches.length - 1];
          if (s.parallel && last && last[0].parallel && depKey(last[0]) === depKey(s)) {
            last.push(s);
          } else {
            batches.push([s]);
          }
        }
        for (const batch of batches) {
          if (batch.length === 1) {
            await runOne(batch[0]);
          } else {
            await Promise.all(batch.map(runOne));
          }
        }
      }
      return { status: 'done', outputs };
    } catch (e) {
      if (e instanceof StepFailure) {
        return { status: 'failed', outputs, error: e.message };
      }
      return { status: 'failed', outputs, error: `工作流 ${this.def.id} 执行失败：${causeText(e)}` };
    }
  }

  private validate(steps: WorkflowStepDef[]): string | null {
    if (!Array.isArray(steps) || steps.length === 0) {
      return `工作流 ${this.def.id} 未定义任何步骤`;
    }
    const ids = new Set<string>();
    for (const s of steps) {
      if (!s.id || !s.prompt) return `工作流 ${this.def.id} 存在缺少 id 或 prompt 的步骤`;
      if (ids.has(s.id)) return `工作流 ${this.def.id} 的步骤 id 重复：${s.id}`;
      ids.add(s.id);
    }
    for (const s of steps) {
      for (const d of s.dependsOn ?? []) {
        if (!ids.has(d)) {
          return `工作流 ${this.def.id} 的步骤 ${s.id} 依赖了不存在的步骤：${d}`;
        }
      }
    }
    // Kahn 检环
    const indeg = new Map<string, number>();
    for (const s of steps) indeg.set(s.id, (s.dependsOn ?? []).length);
    let processed = 0;
    const queue = steps.filter((s) => (s.dependsOn ?? []).length === 0).map((s) => s.id);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      processed++;
      for (const s of steps) {
        if ((s.dependsOn ?? []).includes(id)) {
          const v = (indeg.get(s.id) ?? 0) - 1;
          indeg.set(s.id, v);
          if (v === 0) queue.push(s.id);
        }
      }
    }
    if (processed < steps.length) {
      const cyclical = steps.filter((s) => (indeg.get(s.id) ?? 0) > 0).map((s) => s.id);
      return `工作流 ${this.def.id} 存在循环依赖，涉及步骤：${cyclical.join('、')}`;
    }
    return null;
  }
}

function depKey(s: WorkflowStepDef): string {
  return (s.dependsOn ?? []).slice().sort().join('|');
}

function causeText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
