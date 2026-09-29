import type { Diagnostic } from '@scholarforge/shared';

interface HintRule {
  match: RegExp;
  hint: string;
}

/** 常见 LaTeX 诊断 → 中文修复提示（按序匹配，命中即返回） */
const HINT_RULES: HintRule[] = [
  {
    match: /Undefined control sequence/i,
    hint: '命令未定义：检查拼写（如 \\ref 误作 \\reef），或确认对应宏包已在导言区 \\usepackage 加载。',
  },
  {
    match: /Missing \$ inserted/i,
    hint: '数学符号出现在正文中：用 $...$ 或 \\[...\\] 将公式包进数学模式。',
  },
  {
    match: /File `[^']+' not found|file .* not found/i,
    hint: '文件未找到：检查文件名与相对路径；tectonic 会自动下载宏包，系统 TeX 请用包管理器安装。',
  },
  {
    match: /Citation `[^']+' (?:on page .*)?undefined/i,
    hint: '引用未解析：确认 \\cite 的 citekey 与 refs.bib 条目一致，并完整执行 编译 → bibtex → 再编译 流程。',
  },
  {
    match: /Reference `[^']+' .*undefined/i,
    hint: '交叉引用未解析：检查 \\label 与 \\ref 是否匹配（含大小写与冒号），再编译一至两次。',
  },
  {
    match: /There were undefined references/i,
    hint: '存在未解析引用：通常再编译一次即可；若持续出现，检查缺失的 \\label 或 citekey。',
  },
  {
    match: /Label\(s\) may have changed|Rerun to get/i,
    hint: '交叉引用发生变化：再编译一到两次即可收敛。',
  },
  {
    match: /multiply defined/i,
    hint: '标签重复定义：同一 \\label 出现了多次，重命名其中之一。',
  },
  {
    match: /Overfull \\hbox/i,
    hint: '内容超出版心：调整断行位置、表格列宽或公式长度，也可在局部使用 \\sloppy。',
  },
  {
    match: /Underfull \\hbox/i,
    hint: '排版过松：多为段落末尾多余的 \\\\ 或强制换行导致，删除后由 LaTeX 自主断行。',
  },
  {
    match: /Environment \w+ undefined/i,
    hint: '环境未定义：检查环境名拼写；如 align 需要 amsmath、figure 需要标准的浮动体环境。',
  },
  {
    match: /Can be used only in preamble/i,
    hint: '导言区专用命令位置错误：\\usepackage、\\documentclass 等只能出现在 \\begin{document} 之前。',
  },
  {
    match: /Runaway argument/i,
    hint: '参数未闭合：检查 { 与 }、\\begin 与 \\end 是否正确配对。',
  },
  {
    match: /Extra \\\}|Too many \}'/i,
    hint: '花括号多余或缺失：逐层核对 { 与 } 的配对。',
  },
  {
    match: /\\begin\{[^}]*\} ended by \\end\{[^}]*\}/i,
    hint: '环境不匹配：\\begin 与 \\end 的名称必须一致且正确嵌套。',
  },
  {
    match: /LaTeX Error: Environment|not found in any of/i,
    hint: '资源缺失：确认宏包/文件已安装，或路径拼写正确。',
  },
];

/** 由诊断映射中文修复提示；无匹配规则时返回 undefined */
export function diagnosticHint(d: Diagnostic): string | undefined {
  for (const rule of HINT_RULES) {
    if (rule.match.test(d.message)) return rule.hint;
  }
  return undefined;
}
