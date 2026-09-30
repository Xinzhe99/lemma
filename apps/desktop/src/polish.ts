/**
 * 润色引擎：
 * - rulePolish：离线规则润色（确定性的真实文本变换，非 AI 模拟）；
 * - buildPolishPrompt / extractLatexBody：接真实模型服务的 prompt 组装与回复提取；
 * - draftSectionOffline：离线章节起草模板。
 */

interface PolishRule {
  re: RegExp;
  to: string | ((match: string) => string);
}

const RULES: PolishRule[] = [
  { re: /\bIn order to\b/g, to: 'To' },
  { re: /\bin order to\b/g, to: 'to' },
  { re: /\bdue to the fact that\b/gi, to: 'because' },
  { re: /\butilizes\b/gi, to: 'uses' },
  { re: /\butilize\b/gi, to: 'use' },
  { re: /\butilized\b/gi, to: 'used' },
  { re: /\ba number of\b/gi, to: 'several' },
  { re: /\bIt should be noted that\b/g, to: 'Note that' },
  { re: /\bit should be noted that\b/g, to: 'note that' },
  { re: /\bwe can see that\b/gi, to: '' },
  { re: /\bvery\s+/gi, to: '' },
  { re: /[ \t]{2,}/g, to: ' ' },
];

/**
 * 规则润色：常见冗余表达的学术化替换 + 空白清理。
 * 局限：不做语法分析，词组替换不区分数学环境（短语命中数学环境的概率极低）。
 */
export function rulePolish(latex: string): string {
  let out = latex;
  for (const rule of RULES) {
    out = out.replace(rule.re, rule.to as never);
  }
  return out;
}

/** 润色指令（发给真实模型时使用）：要求只输出完整替换源码 */
export function buildPolishPrompt(latex: string, requirements = '更清晰、更简洁、更符合学术表达'): string {
  return [
    '请润色以下 LaTeX 源码，要求：' + requirements + '。',
    '约束：不改动命令、环境、标签（\\label/\\ref/\\cite）与数学内容；保持章节结构不变。',
    '只输出润色后的完整 LaTeX 源码，用 ```latex 代码围栏包裹，不要任何解释。',
    '',
    '```latex',
    latex,
    '```',
  ].join('\n');
}

/** 从模型回复中提取 LaTeX 源码（剥掉代码围栏与前后说明文字） */
export function extractLatexBody(reply: string): string {
  const text = reply.trim();
  const fenced = /```(?:latex|tex)?\s*\n([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  return body.trim();
}

/** 离线章节起草：结构化占位模板（诚实标注，非 AI 生成） */
export function draftSectionOffline(title: string): string {
  return [
    '',
    `\\section{${title}}`,
    '（离线模板起草：结构占位。配置模型服务后可由 AI 生成完整草稿。）',
    '',
    '\\subsection{动机}',
    'TODO：说明本节要解决的问题及其重要性。',
    '',
    '\\subsection{主要内容}',
    'TODO：展开论述，引用使用 \\cite{}。',
    '',
  ].join('\n');
}
