/**
 * 编译错误友好化（v2.7.0 ①）：把 LaTeX 引擎输出的英文错误消息映射为
 * 中文解释 + 可行动的修复建议。
 */

export interface ErrorHint {
  pattern: RegExp;
  explanation: string;
  fix: string;
}

const HINTS: ErrorHint[] = [
  {
    pattern: /undefined control sequence/i,
    explanation: 'LaTeX 遇到了一个未定义的命令',
    fix: '检查命令拼写（如 \\tabllsx 应为 \\table），或确认对应的 \\usepackage 已加载。',
  },
  {
    pattern: /citation.*undefined|undefined.*citation/i,
    explanation: '引用的文献键在 .bib 文件中找不到',
    fix: '检查 \\cite{key} 的键名与 refs.bib 中的条目名是否一致。',
  },
  {
    pattern: /reference.*undefined|undefined.*reference/i,
    explanation: '交叉引用的标签不存在',
    fix: '检查 \\ref{label} 的标签名是否有对应的 \\label{label} 定义。',
  },
  {
    pattern: /missing.*\$|extra \$|math mode/i,
    explanation: '数学模式符号 $ 不匹配',
    fix: '检查 $...$ 是否成对；特殊字符（_ ^ &）需在数学模式内。',
  },
  {
    pattern: /environment.*undefined|\\begin\{(\w+)\}.*not found/i,
    explanation: '使用了未定义的环境',
    fix: '检查环境名拼写，或确认对应宏包已加载。',
  },
  {
    pattern: /file.*not found|cannot find|no such file/i,
    explanation: '找不到引用的文件',
    fix: '检查 \\input 或 \\includegraphics 的路径；图片需在 figures/ 目录。',
  },
  {
    pattern: /runaway argument/i,
    explanation: '某个命令的参数未正确闭合',
    fix: '检查最近编辑位置附近的花括号配对。',
  },
  {
    pattern: /multiply.*defined|duplicate.*label/i,
    explanation: '同一个 label 定义了多次',
    fix: '删除多余的 \\label{...}，不同对象应使用不同标签。',
  },
  {
    pattern: /package.*error|package.*not found/i,
    explanation: '宏包加载失败',
    fix: '检查 \\usepackage 包名拼写；Tectonic 会自动下载常用宏包。',
  },
  {
    pattern: /unicode.*character|invalid.*character/i,
    explanation: '引擎不支持的字符',
    fix: '中文需 \\usepackage{ctex} 或改用 XeLaTeX/LuaLaTeX。',
  },
  {
    pattern: /Emergency stop|emergency/i,
    explanation: '编译器遇到致命错误',
    fix: '查看上方第一条错误（Emergency stop 通常是连锁反应）。',
  },
];

export function explainError(message: string): ErrorHint | null {
  for (const h of HINTS) {
    if (h.pattern.test(message)) return h;
  }
  return null;
}

export function formatErrorHint(message: string): string | null {
  const h = explainError(message);
  if (!h) return null;
  return `\u2192 ${h.explanation}\u3002${h.fix}`;
}
