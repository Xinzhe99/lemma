/**
 * 修改对照 PDF 文档生成（v6.0.0 F2，latexdiff 的本地等价）：
 * 输入 git unified diff（git diff a b），生成红（删）/蓝（增）标注的 LaTeX 文档，
 * 经真实引擎编译成 changes.pdf——导师审阅 / AI 改动汇报用。
 * 全文转义（不执行原稿宏，纯文本对照渲染），任意工程都可编译。
 */

export interface ChangesDocResult {
  /** 生成的 changes.tex 全文 */
  tex: string;
  /** 变更文件数（有 +/- 行的文件） */
  fileCount: number;
  /** 总变更行数（增 + 删） */
  lineCount: number;
}

/** LaTeX 特殊字符转义（对照文档是纯文本渲染，不执行原稿命令）。
 * 反斜杠先换成私有区占位符再最后还原——直接先/后替换都会自噬
 * （先替换：插入宏的花括号被二次转义；后替换：本函数刚插入的 \ 被再次处理）。 */
export function escapeLatex(text: string): string {
  const BS = '\u0001';
  return text
    .replace(/\\/g, BS)
    .replace(/([{}$&%#_])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(new RegExp(BS, 'g'), '\\textbackslash{}');
}

/**
 * 解析 `git diff --unified=2` 输出 → 着色 LaTeX。
 * 结构：diff --git a/x b/x / --- a/x / +++ b/x / @@ hunk @@ / (+|-| )lines
 */
export function buildChangesTex(diffOutput: string, title = '修改对照'): ChangesDocResult {
  const lines = diffOutput.split('\n');
  const out: string[] = [];
  let fileCount = 0;
  let lineCount = 0;
  let inHunk = false;

  const head = [
    '% Lemma 自动生成的修改对照文档（勿手改）',
    '\\documentclass[11pt]{article}',
    '\\usepackage[a4paper,margin=2.2cm]{geometry}',
    '\\usepackage{xcolor}',
    '\\usepackage{setspace}',
    '\\usepackage[normalem]{ulem}',
    '\\usepackage[colorlinks=true,linkcolor=black]{hyperref}',
    '\\setlength{\\parindent}{0pt}',
    '\\renewcommand{\\familydefault}{\\ttdefault}',
    `\\title{\\textbf{${escapeLatex(title)}}\\\\ \\large 自动生成：红色删除 / 蓝色新增}}`,
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '',
  ];
  out.push(...head);

  let pendingFileHeader: string | null = null;
  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      const m = /diff --git a\/(.+?) b\//.exec(raw);
      pendingFileHeader = m?.[1] ?? raw.slice(11);
      inHunk = false;
      continue;
    }
    // v7.0.0 修复：git 文件头恒为 --- a/path、+++ b/path——此前宽松前缀会把
    // 内容本身以 -- / ++ 开头的增删行（如 diff 说明行）误判为文件头而吞掉
    if (raw.startsWith('--- a/') || raw.startsWith('+++ b/') || raw.startsWith('index ')) continue;
    if (raw.startsWith('new file mode') || raw.startsWith('deleted file mode') || raw.startsWith('Binary files')) {
      continue;
    }
    if (raw.startsWith('@@')) {
      if (pendingFileHeader !== null) {
        fileCount += 1;
        out.push('\\section*{\\normalsize ' + escapeLatex(pendingFileHeader) + '}', '');
        pendingFileHeader = null;
      }
      inHunk = true;
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) out.push(`\\textcolor{gray}{\\small （新文件第 ${m[1]} 行起）}`, '');
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      lineCount += 1;
      out.push(`\\textcolor{blue}{+${escapeLatex(raw.slice(1))}}\\\\`);
    } else if (raw.startsWith('-')) {
      lineCount += 1;
      out.push(`\\textcolor{red}{\\sout{-${escapeLatex(raw.slice(1))}}}\\\\`);
    }
    // 上下文行不输出（只看变化，控制篇幅）
  }

  if (fileCount === 0) {
    out.push('\\section*{没有变更}', '两个版本之间没有文本差异。');
  }
  out.push('', '\\end{document}');

  return { tex: out.join('\n'), fileCount, lineCount };
}
