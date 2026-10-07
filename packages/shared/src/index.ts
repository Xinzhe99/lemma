/**
 * Lemma 跨包共享领域类型。
 * 各包如有更细粒度的类型请在包内定义并导出；此处只放被多个包共同依赖的稳定词汇。
 */

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// 文献库（4.2）
// ---------------------------------------------------------------------------

export interface PaperAuthor {
  family: string;
  given?: string;
  orcid?: string;
}

/** 期刊/会议等发表场所 */
export interface Venue {
  type: 'journal' | 'conference' | 'workshop' | 'preprint' | 'thesis' | 'book' | 'unknown';
  name?: string;
  volume?: string;
  issue?: string;
  pages?: string;
}

export type ReadStatus = 'to-read' | 'reading' | 'done';

export interface Paper {
  id: string;
  citekey: string;
  title: string;
  authors: PaperAuthor[];
  year?: number;
  venue?: Venue;
  abstract?: string;
  doi?: string;
  arxivId?: string;
  pdfPath?: string;
  /** 附件 PDF 抽取的纯文本（v4.4.0：知识索引全文检索用，截断 30k 字符） */
  fullText?: string;
  /** GROBID/启发式解析出的结构化全文（分节） */
  sections?: PaperSection[];
  tags: string[];
  collections: string[];
  readStatus: ReadStatus;
  rating?: 1 | 2 | 3 | 4 | 5;
  addedAt: number;
}

export interface PaperSection {
  id: string;
  heading: string;
  level: number; // 1 = \section
  text: string;
  pageStart?: number;
}

export interface Collection {
  id: string;
  parentId?: string | null;
  name: string;
}

/** 智能过滤器：保存的查询（4.2） */
export interface SmartFilter {
  id: string;
  name: string;
  query: string; // 检索式，如 `year:>2023 venue:CVPR status:unread "diffusion model"`
}

export type AnnotationKind = 'highlight' | 'note' | 'area';
/** 高亮的四色语义（4.2 阅读器） */
export type HighlightSemantic = 'method' | 'finding' | 'question' | 'citation';

export interface Annotation {
  id: string;
  paperId: string;
  page: number;
  kind: AnnotationKind;
  semantic?: HighlightSemantic;
  /** PDF 用户空间坐标 [x1, y1, x2, y2]，note 可为空 */
  bbox?: [number, number, number, number];
  /** 高亮的原文 */
  quotedText?: string;
  /** 备注 markdown */
  text?: string;
  /** 审阅处理状态（v5.7.0：导师批注逐条勾销） */
  resolved?: boolean;
  createdAt: number;
}

/** 多模态消息内容片段（v6.4.0：对话贴图） */
export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface Note {
  id: string;
  title: string;
  bodyMd: string;
  links: string[]; // [[双链]] 目标标题
  originAnnotationId?: string;
  paperId?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 编译（4.3 / WS-B）
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  /** 建议的 quickfix 描述（由编译器日志或 AI 提供） */
  hint?: string;
}

export type CompileEngineKind =
  | 'tectonic'
  | 'latexmk'
  | 'lualatex'
  | 'xelatex'
  | 'pdflatex'
  | 'mock';

export interface CompileResult {
  success: boolean;
  engine: CompileEngineKind;
  durationMs: number;
  diagnostics: Diagnostic[];
  /** 产出的 PDF 字节数组（由平台层写入目标位置） */
  pdf?: Uint8Array;
  log?: string;
}

export interface ProjectFileMap {
  /** 相对项目根的路径 -> 内容 */
  [path: string]: string | Uint8Array;
}

// ---------------------------------------------------------------------------
// 模板与项目脚手架（4.3）
// ---------------------------------------------------------------------------

export interface TemplateDescriptor {
  id: string;
  name: string; // 展示名（中文）
  venue: string; // 适配场所描述
  category: 'conference' | 'journal' | 'thesis' | 'chinese' | 'generic' | 'preprint' | 'presentation' | 'report' | 'other';
  engine: CompileEngineKind;
  /** main 文件相对路径 */
  entry: string;
  description: string;
}

export interface ScaffoldVars {
  title: string;
  authors: string;
  /** 占位符替换变量，如 {TITLE} {AUTHORS} {DATE} */
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// Agent 中枢（4.5 / 第 5 章）
// ---------------------------------------------------------------------------

/** 权限分级（5.3）：read 默认放行；execute 首次确认；write 逐 diff 审批；export 显式确认 */
export type PermissionLevel = 'read' | 'execute' | 'write' | 'export';

export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string; // 如 library.search
  description: string;
  permission: PermissionLevel;
  parameters: JsonSchema; // JSON Schema
}

export interface ToolCallRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  callId: string;
  ok: boolean;
  output: unknown;
  /** write 级操作的 diff/文件说明，供审批 UI 展示 */
  changeSummary?: string;
}

export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  /** 附图 dataUrl（v6.4.0：多模态对话；仅内存会话保留，持久化时剥离） */
  images?: string[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string; // role=tool 时对应的调用
  createdAt: number;
}

export type AgentRunStatus = 'pending' | 'running' | 'checkpoint' | 'done' | 'failed' | 'cancelled';

export interface AgentRun {
  id: string;
  projectId?: string;
  workflowId?: string;
  provider: string; // 适配器 id：openai-compat / codex-cli / mock / ...
  model?: string;
  status: AgentRunStatus;
  costUsd?: number;
  startedAt: number;
  endedAt?: number;
}

/** 工作流定义（5.2 L3 编排层，YAML/JSON 同构） */
export interface WorkflowStepDef {
  id: string;
  /** 步骤用途说明（也作为默认 prompt 的一部分） */
  name: string;
  prompt: string;
  /** 依赖的上一步骤 id */
  dependsOn?: string[];
  /** 本步骤允许使用的工具名列表；缺省=全部 */
  allowedTools?: string[];
  /** 建议模型档位：cheap 平衡 / flagship 旗舰 */
  modelTier?: 'cheap' | 'flagship';
  /** 到达此步骤前暂停等待人工确认 */
  checkpoint?: boolean;
  /** 并行分支（如三个审稿人） */
  parallel?: boolean;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  /** 输入变量占位符说明 */
  inputs: string[];
  steps: WorkflowStepDef[];
}

// ---------------------------------------------------------------------------
// 知识底座（4.7 / WS-E）
// ---------------------------------------------------------------------------

export interface TextChunk {
  id: string;
  paperId: string;
  sectionId?: string;
  heading?: string;
  page?: number;
  text: string;
}

export interface RetrievedChunk extends TextChunk {
  score: number;
}

export interface GlossaryTerm {
  id: string;
  term: string; // 规范术语
  abbr?: string;
  translation?: string; // 中文译名（锁定用）
  definition?: string;
}

export interface StyleProfile {
  sentenceLenMean: number;
  sentenceLenP90: number;
  passiveRatio: number;
  hedgingDensity: number; // 每千词的 hedging 词数
  notes: string[];
}

export interface ContextPack {
  outline?: string;
  glossary: GlossaryTerm[];
  style?: StyleProfile;
  relatedChunks: RetrievedChunk[];
  venueRequirements?: string;
  projectMemory: string[];
  budgetUsd?: number;
}

// ---------------------------------------------------------------------------
// 项目（3.3）
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  id: string;
  name: string;
  templateId?: string;
  targetVenue?: string;
  deadline?: string;
  createdAt: number;
}
