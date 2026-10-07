/**
 * 工作流本地化（v7.5.0）：内置工作流的 name/description 单一来源在工作流 YAML
 * （中文），UI 层经本表按界面语言覆盖英文显示；未命中的 id 原样回退 YAML 文案。
 * 提示词库斜杠菜单 / 工作流列表 / WorkflowLauncher 三处共用。
 */
import type { Language } from './state/settingsStore';

interface WorkflowNames {
  name: string;
  description: string;
}

/** id → 英文显示（zh 走 YAML 原文，无需重复维护） */
const EN: Record<string, WorkflowNames> = {
  'w2-section-draft': {
    name: 'Section draft',
    description: 'Draft one outline section: retrieve relevant papers, assemble context, write a LaTeX draft with real citations, then self-check.',
  },
  'w3-polish': {
    name: 'Academic polish',
    description: 'Polish selected passages toward a goal (clarity / concision / formality / journal style); produces a diff applied after your checkpoint approval.',
  },
  'w6-reviewer-sim': {
    name: 'Three-reviewer simulation',
    description: 'Three independent reviewer personas review in parallel (rigorous methods / domain expert / statistics & reproducibility); a meta-review is summarized and returned at a checkpoint before revision suggestions.',
  },
  'w7-rebuttal': {
    name: 'Rebuttal draft',
    description: 'Parse reviewer comments one by one and draft responses (direct-fix / partial / argue / cite), then integrate the rebuttal document and revision list after checkpoint confirmation.',
  },
  'w10-pre-submission': {
    name: 'Pre-submission check',
    description: 'Check the manuscript against the target venue: compile, page limit, anonymization, citation format, data statement, and AI disclosure.',
  },
  'w11-cover-letter': {
    name: 'Cover letter draft',
    description: 'Draft a cover letter for the target journal/conference: contributions, positioning, and editor concerns — editable output.',
  },
  'w12-related-work': {
    name: 'Related work survey',
    description: 'Generate a Related Work draft from your library (grouped narrative, all citations locally verifiable).',
  },
  'w13-beamer': {
    name: 'Generate slides',
    description: 'Generate a Beamer slides skeleton from the manuscript (per-section bullets + key figures/tables).',
  },
  'w14-compress': {
    name: 'AI page compression',
    description: 'Compress to a target page count (citations and conclusions preserved) — analyzes redundancy and proposes deletion diffs, applied after checkpoint confirmation.',
  },
  'w16-promo': {
    name: 'Post-acceptance promo',
    description: 'Generate promotion materials after acceptance: X/Twitter thread, Chinese social posts, graphical abstract ideas, and departmental news.',
  },
};

/** 按界面语言取工作流显示名（zh 回退 YAML 原文） */
export function workflowName(id: string, yamlName: string, lang: Language): string {
  if (lang === 'en') return EN[id]?.name ?? yamlName;
  return yamlName;
}

/** 按界面语言取工作流描述 */
export function workflowDescription(id: string, yamlDescription: string, lang: Language): string {
  if (lang === 'en') return EN[id]?.description ?? yamlDescription;
  return yamlDescription;
}
