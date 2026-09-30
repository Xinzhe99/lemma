/** @scholarforge/compile —— WS-B：编译服务 / log 解析 / SyncTeX / 模板 */
export const COMPILE_PACKAGE_VERSION = '0.7.0';

// engine
export type { CommandRunner, CompileInput, LatexEngine, MockEngineOptions } from './engine';
export { LatexmkEngine, MockEngine, TectonicEngine } from './engine';

// pipeline
export type { FullCompileResult } from './pipeline';
export { needsRerun, runFullCompile } from './pipeline';

// log 解析
export { parseLatexLog } from './logParser';

// synctex
export type { PdfLocation, SourceLocation, SynctexBlock, SynctexIndex, SynctexInput } from './synctex';
export { lineLocation, parseSynctex, sourceLocation } from './synctex';

// 模板与脚手架
export { listTemplates, scaffoldProject, substitute } from './templates';
export type { TemplateModule } from './templates';

// 项目 zip 导入（Overleaf 导出等）
export { parseProjectZip } from './zip';
export type { ParsedProjectZip } from './zip';

// 项目导出与投稿打包清单
export { buildProjectZip, packagingChecklist } from './export';
export type { PackagingCheckItem } from './export';

// quickfix
export { diagnosticHint } from './quickfix';
