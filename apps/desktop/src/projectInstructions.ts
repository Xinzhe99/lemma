/**
 * 项目指令文件（v7.5.0，对齐 agent-foundation FileContextCapability）：
 * 项目根目录的 AGENTS.md（或 LEMMA.md）声明写作约定——语言、期刊风格、
 * 术语表、禁用措辞等——注入每次生成的 system prompt，优先级高于全局人设。
 * 与 memory.write 的区别：AGENTS.md 由用户手写、随项目走（进 git），
 * 项目记忆由 AI 经审批写入、本机生效。
 */

/** 指令文件的查找优先级（均为项目根路径） */
export const INSTRUCTION_FILES = ['AGENTS.md', 'LEMMA.md'] as const;

/** 单文件注入上限（字符）——超长指令截断，保护上下文窗口 */
export const INSTRUCTIONS_LIMIT = 4000;

/** 找到项目指令文件路径；无则 null */
export function findInstructionsFile(files: Record<string, string>): string | null {
  for (const name of INSTRUCTION_FILES) {
    if (typeof files[name] === 'string' && files[name]!.trim().length > 0) return name;
  }
  return null;
}

/** 把指令内容渲染为注入块（截断到上限） */
export function renderInstructionsBlock(content: string): string {
  const clipped =
    content.length > INSTRUCTIONS_LIMIT ? `${content.slice(0, INSTRUCTIONS_LIMIT)}\n…（AGENTS.md 过长已截断）` : content;
  return `## 项目写作约定（AGENTS.md，用户手写，优先级最高）\n${clipped}`;
}

/** 新建 AGENTS.md 的模板（用户可从设置/命令一键创建后自行编辑） */
export const AGENTS_MD_TEMPLATE = `# AGENTS.md — 本项目的写作约定

> 本文件中的约定会注入 AI 的每一次生成（润色/起草/改稿/计划），优先级高于全局人设。
> 改完保存即生效，建议纳入 git 版本管理。

## 语言与语气
- 正文使用英文（美式拼写），术语首次出现给中文注释
- 语气：客观、克制，避免营销化措辞（novel / revolutionary / significantly 等需数据支撑）

## 期刊与格式
- 目标期刊：（示例）IEEE TPAMI，双栏，正文不超过 14 页
- 章节结构：Introduction / Related Work / Method / Experiments / Conclusion

## 术语表
- （示例）diffusion → 扩散模型统一译法；不要写成"扩散过程模型"

## 禁止事项
- 不要改动 \\cite 键与数学环境内容
- 不要在未经确认的情况下新增宏包
`;
