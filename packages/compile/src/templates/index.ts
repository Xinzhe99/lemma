import type { ProjectFileMap, ScaffoldVars, TemplateDescriptor } from '@scholarforge/shared';
import { chineseCtex } from './chinese-ctex';
import { conferenceIeeeLike } from './conference-ieee-like';
import { genericArticle } from './generic-article';
import { genericReport } from './generic-report';
import { journalSpringerLike } from './journal-springer-like';
import { preprintMlLike } from './preprint-ml-like';
import type { TemplateModule } from './types';

export type { TemplateModule } from './types';

const TEMPLATES: TemplateModule[] = [
  genericArticle,
  genericReport,
  conferenceIeeeLike,
  preprintMlLike,
  chineseCtex,
  journalSpringerLike,
];

/** 内置模板清单（descriptor 为浅拷贝，防止调用方篡改注册表数据） */
export function listTemplates(): TemplateDescriptor[] {
  return TEMPLATES.map((t) => ({ ...t.descriptor }));
}

/** 占位符替换支持的变量（大小写不敏感，ScaffoldVars 的键会被大写化后匹配） */
const PLACEHOLDER_KEYS = ['TITLE', 'AUTHORS', 'DATE', 'VENUE', 'ABSTRACT'] as const;

/**
 * 由模板生成项目文件集：替换占位符、附带 README.md（说明编译方式）。
 * vars 中缺失的变量按模板语种给默认值。
 */
export function scaffoldProject(templateId: string, vars: ScaffoldVars): ProjectFileMap {
  const tpl = TEMPLATES.find((t) => t.descriptor.id === templateId);
  if (!tpl) {
    throw new Error(`未找到模板「${templateId}」，可调用 listTemplates() 查看可用模板。`);
  }
  const chinese = tpl.descriptor.category === 'chinese';
  const defaults: Record<string, string> = {
    TITLE: chinese ? '（未命名稿件）' : '(Untitled Manuscript)',
    AUTHORS: chinese ? '（作者待填）' : '(Authors TBD)',
    DATE: new Date().toLocaleDateString('zh-CN'),
    VENUE: 'TBD',
    ABSTRACT: chinese
      ? '（待填写：在此概述研究问题、方法与主要结论。）'
      : '(To be filled: state the research question, method, and main results.)',
  };
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string' && PLACEHOLDER_KEYS.includes(key.toUpperCase() as (typeof PLACEHOLDER_KEYS)[number])) {
      if (value) defaults[key.toUpperCase()] = value;
    }
  }

  const out: ProjectFileMap = {};
  for (const [path, content] of Object.entries(tpl.files)) {
    out[path] = typeof content === 'string' ? substitute(content, defaults) : content;
  }
  out['README.md'] = renderReadme(tpl, defaults);
  return out;
}

/** 替换 {TITLE}/{AUTHORS}/{DATE}/{VENUE}/{ABSTRACT} 等占位符；未知占位符原样保留 */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([A-Z][A-Z0-9_]*)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

function renderReadme(tpl: TemplateModule, vars: Record<string, string>): string {
  const d = tpl.descriptor;
  const lines: string[] = [
    `# ${vars.TITLE}`,
    '',
    `> 由 ScholarForge 模板「${d.name}」生成的论文工程（模板 ID：\`${d.id}\`）。`,
    '',
    '## 文件说明',
    `- \`${d.entry}\`：主文件（编译入口）`,
    '- `refs.bib`：参考文献条目（示例 3 条，请替换为你自己的文献）',
    '- `README.md`：本说明',
    '',
    '## 如何编译',
    ...tpl.compileHints.map((h) => `- ${h}`),
    '',
    '## SyncTeX 正反向跳转',
    '- 编译时生成 synctex 数据后，可在编辑器与 PDF 预览之间点击互跳（源码行 ↔ PDF 页面坐标）。',
    '',
  ];
  if (tpl.notes && tpl.notes.length > 0) {
    lines.push('## 说明', ...tpl.notes.map((n) => `- ${n}`), '');
  }
  lines.push(
    '## 下一步',
    '- 正文各节替换为你的内容；标题/作者/摘要等占位符已在生成时替换完成。',
    '- 参考文献在 refs.bib 中维护，正文用 \\cite / \\citep 引用后需重新编译。',
    '',
  );
  return lines.join('\n');
}
