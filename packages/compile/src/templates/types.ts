import type { ProjectFileMap, TemplateDescriptor } from '@lemma/shared';

export interface TemplateModule {
  descriptor: TemplateDescriptor;
  /** 未替换占位符的模板文件（main.tex / refs.bib 等） */
  files: ProjectFileMap;
  /** README 中"如何编译"一节列出的命令行 */
  compileHints: string[];
  /** 追加到 README 的说明（如版权/风格提示） */
  notes?: string[];
}
