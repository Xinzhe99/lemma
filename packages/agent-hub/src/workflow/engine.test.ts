import { describe, expect, it } from 'vitest';
import type { WorkflowDef, WorkflowStepDef } from '@scholarforge/shared';
import { WorkflowRun } from './engine';
import type { WorkflowRunHooks, WorkflowStepContext } from './engine';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function def(steps: Array<Partial<WorkflowStepDef> & { id: string }>): WorkflowDef {
  return {
    id: 'test-flow',
    name: '测试工作流',
    description: '',
    inputs: [],
    steps: steps.map((s) => ({ name: s.id, prompt: `prompt ${s.id}`, ...s })) as WorkflowStepDef[],
  };
}

describe('WorkflowRun', () => {
  it('并行分支真正并发：同一 dependsOn 且 parallel 的步骤同时运行', async () => {
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const hooks: WorkflowRunHooks = {
      async runStep(step) {
        order.push(`start:${step.id}`);
        active++;
        peak = Math.max(peak, active);
        await sleep(40);
        active--;
        order.push(`end:${step.id}`);
        return `out:${step.id}`;
      },
    };
    const run = new WorkflowRun(
      def([
        { id: 'prep' },
        { id: 'r1', dependsOn: ['prep'], parallel: true },
        { id: 'r2', dependsOn: ['prep'], parallel: true },
        { id: 'r3', dependsOn: ['prep'], parallel: true },
        { id: 'meta', dependsOn: ['r1', 'r2', 'r3'] },
      ]),
      hooks,
    );
    const result = await run.start({});
    expect(result.status).toBe('done');
    expect(peak).toBe(3); // 三个 reviewer 同时在飞
    expect(order.indexOf('start:r2')).toBeGreaterThan(order.indexOf('start:r1'));
    // meta 在三个并行步骤全部结束之后才开始
    expect(order.indexOf('start:meta')).toBeGreaterThan(order.indexOf('end:r3'));
    expect(result.outputs).toEqual({ prep: 'out:prep', r1: 'out:r1', r2: 'out:r2', r3: 'out:r3', meta: 'out:meta' });
  });

  it('非 parallel 的就绪步骤串行执行', async () => {
    let active = 0;
    let peak = 0;
    const hooks: WorkflowRunHooks = {
      async runStep(step) {
        active++;
        peak = Math.max(peak, active);
        await sleep(20);
        active--;
        return step.id;
      },
    };
    const run = new WorkflowRun(def([{ id: 'a' }, { id: 'b' }, { id: 'c', dependsOn: ['a'] }]), hooks);
    const result = await run.start({});
    expect(result.status).toBe('done');
    expect(peak).toBe(1);
  });

  it('checkpoint：暂停等待 onCheckpoint，确认输入透传给 runStep', async () => {
    const seen: Array<{ id: string; ctx: WorkflowStepContext }> = [];
    let release!: (v: string) => void;
    let checkpointHit!: () => void;
    const gate = new Promise<string>((resolve) => (release = resolve));
    const hit = new Promise<void>((resolve) => (checkpointHit = resolve));
    const hooks: WorkflowRunHooks = {
      async runStep(step, ctx) {
        seen.push({ id: step.id, ctx });
        return `done:${step.id}`;
      },
      async onCheckpoint(step, priorOutputs) {
        expect(step.id).toBe('approve');
        expect(priorOutputs).toEqual({ draft: 'done:draft' });
        checkpointHit();
        return gate; // 用户尚未确认，工作流停在这里
      },
    };
    const run = new WorkflowRun(
      def([
        { id: 'draft' },
        { id: 'approve', dependsOn: ['draft'], checkpoint: true },
        { id: 'apply', dependsOn: ['approve'] },
      ]),
      hooks,
    );
    const runPromise = run.start({});

    await hit; // 已到达检查点
    await sleep(10); // 再等一拍，确认引擎真的暂停了
    expect(seen.map((s) => s.id)).toEqual(['draft']); // approve/apply 尚未执行

    release('用户确认：采纳全部修改');
    const result = await runPromise;
    expect(result.status).toBe('done');
    expect(seen.map((s) => s.id)).toEqual(['draft', 'approve', 'apply']);
    expect(seen[1].ctx.checkpointInput).toBe('用户确认：采纳全部修改');
  });

  it('vars 与依赖输出注入 runStep 上下文', async () => {
    const seen: WorkflowStepContext[] = [];
    const hooks: WorkflowRunHooks = {
      async runStep(_step, ctx) {
        seen.push(ctx);
        return `o${seen.length}`;
      },
    };
    const run = new WorkflowRun(def([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }]), hooks);
    const result = await run.start({ topic: '扩散模型' });
    expect(result.status).toBe('done');
    expect(seen[0].vars).toEqual({ topic: '扩散模型' });
    expect(seen[1].priorOutputs).toEqual({ a: 'o1' });
  });

  it('单步异常：整体 failed，错误带 stepId，已完成输出保留', async () => {
    const hooks: WorkflowRunHooks = {
      async runStep(step) {
        if (step.id === 'boom') throw new Error('模型超时');
        return `ok:${step.id}`;
      },
    };
    const run = new WorkflowRun(
      def([{ id: 'a' }, { id: 'boom', dependsOn: ['a'] }, { id: 'c', dependsOn: ['boom'] }]),
      hooks,
    );
    const result = await run.start({});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('boom');
    expect(result.error).toContain('模型超时');
    expect(result.outputs).toEqual({ a: 'ok:a' });
  });

  it('并行批中任一步失败即整体 failed', async () => {
    const hooks: WorkflowRunHooks = {
      async runStep(step) {
        if (step.id === 'r2') throw new Error('审稿人二掉线');
        await sleep(20);
        return 'ok';
      },
    };
    const run = new WorkflowRun(
      def([{ id: 'prep' }, { id: 'r1', dependsOn: ['prep'], parallel: true }, { id: 'r2', dependsOn: ['prep'], parallel: true }, { id: 'meta', dependsOn: ['r1', 'r2'] }]),
      hooks,
    );
    const result = await run.start({});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('r2');
    expect(result.error).toContain('审稿人二掉线');
  });

  it('环检测报错', async () => {
    const hooks: WorkflowRunHooks = { runStep: async () => 'x' };
    const run = new WorkflowRun(def([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]), hooks);
    const result = await run.start({});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('循环依赖');
    expect(result.outputs).toEqual({});
  });

  it('依赖了不存在的步骤时报错', async () => {
    const hooks: WorkflowRunHooks = { runStep: async () => 'x' };
    const run = new WorkflowRun(def([{ id: 'a', dependsOn: ['ghost'] }]), hooks);
    const result = await run.start({});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('ghost');
  });
});
