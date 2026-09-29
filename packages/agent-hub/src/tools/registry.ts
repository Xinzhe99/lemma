/**
 * 论文域工具注册表（设计文档 5.3：内置 MCP Server 暴露的 15 个工具）。
 * ToolDef 只是"契约"；实际执行体由宿主通过 createToolExecutor 注入。
 */
import type { ToolCallRequest, ToolDef } from '@scholarforge/shared';

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const bool = (description: string) => ({ type: 'boolean', description });

export const PAPER_TOOLS: ToolDef[] = [
  {
    name: 'library.search',
    description: '检索个人文献库题录：支持关键词与结构化过滤（年份、 venue、标签、阅读状态）。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: str('关键词或检索式，如 "diffusion model"'),
        filters: {
          type: 'object',
          description: '可选过滤条件',
          properties: {
            yearFrom: int('起始年份（含）'),
            yearTo: int('截止年份（含）'),
            venue: str('发表场所名称'),
            tag: str('标签'),
            readStatus: { type: 'string', enum: ['to-read', 'reading', 'done'], description: '阅读状态' },
          },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'library.search_fulltext',
    description: '全文混合检索（BM25 + 向量）：返回命中段落与页码定位。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: str('检索内容，自然语言或关键词'),
        limit: int('返回条数上限，默认 10'),
      },
      required: ['query'],
    },
  },
  {
    name: 'paper.read',
    description: '读取解析后的 PDF 结构化全文（GROBID 分节输出），可指定页码范围。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        id: str('文献 id 或 citekey'),
        pages: { type: 'array', items: { type: 'integer' }, description: '页码列表（1 起），缺省 = 全文' },
      },
      required: ['id'],
    },
  },
  {
    name: 'paper.citations',
    description: '查询某篇文献的上位（引用了谁）或下位（被谁引用）引文网络。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        id: str('文献 id 或 citekey'),
        direction: { type: 'string', enum: ['upstream', 'downstream'], description: 'upstream=参考文献，downstream=施引文献' },
      },
      required: ['id'],
    },
  },
  {
    name: 'web.search_scholar',
    description: '联网聚合学术检索（arXiv / OpenAlex / Semantic Scholar），用于库外文献发现。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: str('检索式'),
        limit: int('返回条数上限，默认 10'),
      },
      required: ['query'],
    },
  },
  {
    name: 'tex.compile',
    description: '触发 LaTeX 增量编译，返回成功与否与诊断摘要。',
    permission: 'execute',
    parameters: {
      type: 'object',
      properties: {
        force: bool('是否忽略缓存全量编译，默认 false'),
      },
    },
  },
  {
    name: 'tex.last_errors',
    description: '获取上一次编译的结构化错误清单（文件/行号/信息/修复提示）。',
    permission: 'execute',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'tex.edit',
    description: '修改稿件源文件（unified diff），产生 diff 审批卡，用户采纳后才落盘。',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        file: str('相对项目根的文件路径'),
        diff: str('unified diff 格式的修改内容'),
        summary: str('本次修改的一句话说明'),
      },
      required: ['file', 'diff'],
    },
  },
  {
    name: 'figure.render',
    description: '渲染 TikZ / matplotlib 图表代码并做可读性自检（字号/配色/线型）。',
    permission: 'execute',
    parameters: {
      type: 'object',
      properties: {
        code: str('图表源代码'),
        engine: { type: 'string', enum: ['tikz', 'matplotlib'], description: '渲染引擎' },
      },
      required: ['code'],
    },
  },
  {
    name: 'citation.validate',
    description: '引用真实性核查：校验 bib 键存在，并评估被引文献是否支撑给定主张。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        key: str('bib 引用键'),
        claim: str('正文中的主张原文'),
      },
      required: ['key', 'claim'],
    },
  },
  {
    name: 'citation.add',
    description: '查重后向参考文献库新增 bib 条目（疑似重复时拒绝并返回已有条目）。',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        entry: {
          type: 'object',
          description: 'bib 条目字段',
          properties: {
            citekey: str('引用键'),
            title: str('标题'),
            authors: { type: 'array', items: { type: 'string' }, description: '作者列表' },
            year: int('年份'),
            venue: str('期刊/会议名'),
            doi: str('DOI'),
          },
          required: ['citekey', 'title'],
        },
      },
      required: ['entry'],
    },
  },
  {
    name: 'project.context',
    description: '获取 Context Pack：稿件状态、术语表、风格档案、相关文献、期刊要求、项目记忆。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string', enum: ['manuscript', 'glossary', 'style', 'related', 'venue', 'memory'] },
          description: '只取指定分区，缺省 = 全部',
        },
      },
    },
  },
  {
    name: 'memory.write',
    description: '写入 Project Memory（本项目历史决策、审稿意见摘要、已否决措辞等）。',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        key: str('记忆条目键名'),
        value: str('记忆内容（markdown）'),
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'snapshot.create',
    description: '创建 git 快照（AI 落盘修改前自动调用；带语义标签便于回滚）。',
    permission: 'execute',
    parameters: {
      type: 'object',
      properties: {
        label: str('快照标签，如 "润色引言后"'),
      },
    },
  },
  {
    name: 'submission.checklist',
    description: '查询目标期刊/会议的结构化投稿要求（页数、匿名规则、AI 政策、补充材料等）。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        journal: str('期刊或会议名称'),
      },
      required: ['journal'],
    },
  },
];

export const PAPER_TOOLS_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(
  PAPER_TOOLS.map((t) => [t.name, t]),
);

// ---------------------------------------------------------------------------
// 迷你 JSON Schema 校验器（type / required / properties / enum / items 递归，零依赖）
// ---------------------------------------------------------------------------

/**
 * 校验工具调用参数。合法返回 null，非法返回中文错误信息（含参数路径）。
 */
export function validateArgs(tool: ToolDef, args: Record<string, unknown>): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return `参数必须是对象`;
  }
  const schema = tool.parameters ?? {};
  return validateValue(schema, args, '参数');
}

function validateValue(schema: unknown, value: unknown, path: string): string | null {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as Record<string, unknown>;

  if (s.enum !== undefined) {
    if (!Array.isArray(s.enum) || !s.enum.some((v) => deepEqual(v, value))) {
      return `${path}：取值 ${JSON.stringify(value)} 不在允许的枚举 ${JSON.stringify(s.enum)} 内`;
    }
  }

  const type = s.type;
  if (typeof type === 'string' && !matchesType(type, value)) {
    return `${path}：类型应为 ${type}，实际为 ${typeName(value)}`;
  }
  if (Array.isArray(type)) {
    // 宽容：type: ['string','null'] 之类的联合
    if (!type.some((t) => typeof t === 'string' && matchesType(t, value))) {
      return `${path}：类型应为 ${type.join(' | ')}，实际为 ${typeName(value)}`;
    }
  }

  if (isPlainObject(value)) {
    const required = s.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(key in value)) return `${path}：缺少必填字段 ${key}`;
      }
    }
    const properties = s.properties;
    if (properties && isPlainObject(properties)) {
      for (const [key, sub] of Object.entries(properties)) {
        if (key in value) {
          const err = validateValue(sub, value[key], `${path}.${key}`);
          if (err) return err;
        }
      }
    }
  }

  if (Array.isArray(value)) {
    const items = s.items;
    if (items && typeof items === 'object') {
      for (let i = 0; i < value.length; i++) {
        const err = validateValue(items, value[i], `${path}[${i}]`);
        if (err) return err;
      }
    }
  }

  return null;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true; // 未知类型不设限
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// 执行器
// ---------------------------------------------------------------------------

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolExecutor {
  execute(call: ToolCallRequest): Promise<unknown>;
}

/**
 * 由宿主提供的处理器表创建执行器：
 * 未知工具 / 参数校验失败 / 缺处理器 一律抛错（中文信息）。
 */
export function createToolExecutor(handlers: Record<string, ToolHandler>): ToolExecutor {
  return {
    async execute(call: ToolCallRequest): Promise<unknown> {
      const def = PAPER_TOOLS_BY_NAME.get(call.tool);
      if (!def) {
        throw new Error(`未知工具：${call.tool}`);
      }
      const invalid = validateArgs(def, call.args ?? {});
      if (invalid) {
        throw new Error(`工具 ${call.tool} 参数校验失败：${invalid}`);
      }
      const handler = handlers[call.tool];
      if (!handler) {
        throw new Error(`工具 ${call.tool} 未注册处理器`);
      }
      return handler(call.args);
    },
  };
}
