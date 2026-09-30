/**
 * 内置工作流（W2/W3/W6/W7/W10/W11）：YAML 单一事实来源，构建期以 ?raw 内联，运行期 parseWorkflowYaml 解析。
 */
import { parse as parseYaml } from 'yaml';
import type { WorkflowDef, WorkflowStepDef } from '@scholarforge/shared';
import w2Source from './builtin/w2-section-draft.yaml?raw';
import w3Source from './builtin/w3-polish.yaml?raw';
import w6Source from './builtin/w6-reviewer-sim.yaml?raw';
import w7Source from './builtin/w7-rebuttal.yaml?raw';
import w10Source from './builtin/w10-pre-submission.yaml?raw';
import w11Source from './builtin/w11-cover-letter.yaml?raw';

export const WORKFLOW_YAML_SOURCES: Record<string, string> = {
  'w2-section-draft': w2Source,
  'w3-polish': w3Source,
  'w6-reviewer-sim': w6Source,
  'w7-rebuttal': w7Source,
  'w10-pre-submission': w10Source,
  'w11-cover-letter': w11Source,
};

/**
 * 解析并严格校验工作流 YAML：
 * id/name/description/inputs/steps 结构完整，steps 非空、id 唯一、dependsOn 引用存在。
 * 不合法时抛出带中文说明的 Error。
 */
export function parseWorkflowYaml(text: string): WorkflowDef {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new Error(`YAML 语法错误：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('工作流定义必须是一个映射（对象）');
  const o = raw as Record<string, unknown>;

  for (const key of ['id', 'name', 'description'] as const) {
    if (typeof o[key] !== 'string' || !(o[key] as string).trim()) {
      throw new Error(`工作流缺少必填字符串字段：${key}`);
    }
  }
  if (!Array.isArray(o.inputs) || o.inputs.some((v) => typeof v !== 'string')) {
    throw new Error(`工作流 ${o.id} 的 inputs 必须是字符串数组`);
  }
  if (!Array.isArray(o.steps) || o.steps.length === 0) {
    throw new Error(`工作流 ${o.id} 未定义任何步骤（steps 为空）`);
  }

  const steps: WorkflowStepDef[] = (o.steps as Record<string, unknown>[]).map((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`工作流 ${o.id} 第 ${i + 1} 个步骤不是映射`);
    const { id, name, prompt, dependsOn, allowedTools, modelTier, checkpoint, parallel } = s;
    if (typeof id !== 'string' || !id.trim()) throw new Error(`工作流 ${o.id} 第 ${i + 1} 个步骤缺少 id`);
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error(`步骤 ${id} 缺少 prompt`);
    if (dependsOn !== undefined && (!Array.isArray(dependsOn) || dependsOn.some((d) => typeof d !== 'string'))) {
      throw new Error(`步骤 ${id} 的 dependsOn 必须是字符串数组`);
    }
    if (allowedTools !== undefined && (!Array.isArray(allowedTools) || allowedTools.some((t) => typeof t !== 'string'))) {
      throw new Error(`步骤 ${id} 的 allowedTools 必须是字符串数组`);
    }
    if (modelTier !== undefined && modelTier !== 'cheap' && modelTier !== 'flagship') {
      throw new Error(`步骤 ${id} 的 modelTier 只能是 cheap 或 flagship`);
    }
    if (checkpoint !== undefined && typeof checkpoint !== 'boolean') {
      throw new Error(`步骤 ${id} 的 checkpoint 必须是布尔值`);
    }
    if (parallel !== undefined && typeof parallel !== 'boolean') {
      throw new Error(`步骤 ${id} 的 parallel 必须是布尔值`);
    }
    const step: WorkflowStepDef = {
      id,
      name: typeof name === 'string' && name.trim() ? name : id,
      prompt,
    };
    if (dependsOn) step.dependsOn = dependsOn as string[];
    if (allowedTools) step.allowedTools = allowedTools as string[];
    if (modelTier) step.modelTier = modelTier as 'cheap' | 'flagship';
    if (checkpoint) step.checkpoint = checkpoint;
    if (parallel) step.parallel = parallel;
    return step;
  });

  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) throw new Error(`工作流 ${o.id} 的步骤 id 重复：${s.id}`);
    ids.add(s.id);
  }
  for (const s of steps) {
    for (const d of s.dependsOn ?? []) {
      if (!ids.has(d)) throw new Error(`步骤 ${s.id} 依赖了不存在的步骤：${d}`);
    }
  }

  return {
    id: o.id as string,
    name: o.name as string,
    description: o.description as string,
    inputs: o.inputs as string[],
    steps,
  };
}

/** 全部内置工作流（解析失败会在模块加载期直接抛错——内置定义不允许坏） */
export const BUILTIN_WORKFLOWS: WorkflowDef[] = Object.values(WORKFLOW_YAML_SOURCES).map(parseWorkflowYaml);

export function getBuiltinWorkflow(id: string): WorkflowDef | undefined {
  return BUILTIN_WORKFLOWS.find((w) => w.id === id);
}
