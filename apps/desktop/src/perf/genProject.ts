/**
 * 合成大项目生成器（性能基线测试专用）：确定性生成一个贴近真实论文规模的项目——
 *  - main.tex 通过 \input 引用全部 sections/sec-NNNN.tex；
 *  - 每个 section 含 section/subsection/subsubsection 层级、\label/\ref 交叉引用、
 *    从 refs.bib 随机取的 \cite、少量 figure / table / equation 环境与行内注释；
 *  - refs.bib 含数百条混合中英标题的条目（@article/@inproceedings/@book/@misc，
 *    含 @string 常量、嵌套大括号、转义作者名等真实语料形态）；
 *  - 正文每行 60–120 字符的中英文混排。
 *
 * 确定性：使用固定种子的 LCG（无 Math.random），同参数输出逐字节一致，便于
 * 性能测量可复现。生成本身必须是纯字符串拼接，120 文件 + 500 条 bib < 1s。
 */

export interface GenerateBigProjectOptions {
  /** .tex 文件总数（含 main.tex）；1 表示只有 main.tex 且正文内联 */
  files?: number;
  /** 每个 .tex 文件的近似正文行数 */
  linesPerFile?: number;
  /** refs.bib 的条目数 */
  bibCount?: number;
}

export interface BigProject {
  /** 项目全部文件（main.tex + sections/*.tex + refs.bib），键为相对路径 */
  files: Record<string, string>;
  mainFile: string;
  sectionFiles: string[];
  bibFile: string;
  /** refs.bib 中全部 citekey（生成顺序） */
  citekeys: string[];
  /** 各 section 的 \label 键（sec:NNNN 形式） */
  sectionLabels: string[];
}

/** 固定种子 LCG（NumRecipes 常数）：[0,1) 均匀浮点 */
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** 下一个 [0,1) 浮点数 */
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  /** [0,n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** [min,max] 整数 */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }
  /** 从数组取一个元素 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }
}

const EN_WORDS = [
  'the', 'model', 'training', 'data', 'language', 'representation', 'learning',
  'attention', 'transformer', 'gradient', 'inference', 'dataset', 'evaluation',
  'baseline', 'performance', 'optimization', 'network', 'semantic', 'distribution',
  'embedding', 'token', 'sequence', 'feature', 'layer', 'parameter', 'benchmark',
  'corpus', 'alignment', 'retrieval', 'generation', 'robustness', 'generalization',
  'compression', 'distillation', 'fine-tuning', 'pretraining', 'multimodal',
  'structured', 'probabilistic', 'scalable', 'adaptive', 'hierarchical',
] as const;

const CN_WORDS = [
  '模型', '训练', '数据', '语言', '表示', '学习', '注意力', '梯度', '推断',
  '评估', '基线', '性能', '优化', '网络', '语义', '分布', '向量', '序列',
  '特征', '参数', '实验', '结果', '方法', '任务', '上下文', '基准', '语料',
  '对齐', '检索', '生成', '鲁棒性', '泛化', '压缩', '蒸馏', '微调', '预训练',
  '多模态', '结构化', '概率', '可扩展', '自适应', '层次化', '显著', '进一步',
] as const;

const TOPIC_EN = [
  'Large-Scale', 'Cross-Lingual', 'Self-Supervised', 'Sparse', 'Continual',
  'Faithful', 'Efficient', 'Adversarially Robust', 'Low-Resource', 'Open-Domain',
] as const;
const TOPIC_CN = [
  '大规模', '跨语言', '自监督', '稀疏', '持续', '可信', '高效', '对抗鲁棒', '低资源', '开放域',
] as const;

/** 段落正文行：混合中英文词，长度落在 [60,120] 字符区间 */
function proseLine(rng: Rng): string {
  let s = '';
  let cn = rng.next() < 0.45; // 中英交替起头，混合比例约一半
  while (s.length < 60) {
    if (cn) {
      s += rng.pick(CN_WORDS);
      if (rng.next() < 0.3) s += '的';
    } else {
      s += rng.pick(EN_WORDS);
    }
    cn = !cn;
    s += rng.next() < 0.85 ? ' ' : '，';
  }
  if (s.length > 120) s = s.slice(0, 120).trimEnd();
  return s.trimEnd();
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

interface SectionContext {
  index: number;
  citekeys: string[];
  sectionCount: number;
}

/** 单个 section 文件：层级结构 + 交叉引用 + 浮动体 + 混排正文，约 linesPerFile 行 */
function generateSection(ctx: SectionContext, linesPerFile: number): string {
  const rng = new Rng(0x5eed0000 ^ (ctx.index * 2654435761));
  const id = pad4(ctx.index);
  const out: string[] = [];
  const push = (line: string): void => {
    out.push(line);
  };

  push(`% sections/sec-${id}.tex —— 合成章节 ${ctx.index}`);
  push('');
  push(`\\section{${rng.pick(TOPIC_EN)} ${rng.pick(TOPIC_CN)}方法在学术写作场景下的系统评估}\u00A0\\label{sec:${id}}`);
  push('');

  // 每 ~25 行一个 subsection，每 ~75 行一个 subsubsection，其余为正文/环境
  let subIdx = 0;
  let subsubIdx = 0;
  let lastHeadingAt = 0;
  while (out.length < linesPerFile) {
    const remaining = linesPerFile - out.length;

    if (out.length - lastHeadingAt >= 25 && remaining > 14) {
      subIdx++;
      lastHeadingAt = out.length;
      if (subIdx % 3 === 0) {
        subsubIdx++;
        push(`\\subsubsection{${rng.pick(TOPIC_CN)}子任务的${rng.pick(EN_WORDS)}分析}\\label{subsub:${id}-${subsubIdx}}`);
      } else {
        push(`\\subsection{${rng.pick(TOPIC_CN)}设置下的${rng.pick(EN_WORDS)}与${rng.pick(EN_WORDS)}}\\label{sub:${id}-${subIdx}}`);
      }
      push('');
      continue;
    }

    const roll = rng.next();
    if (roll < 0.02 && remaining > 12) {
      // figure 环境（含跨行 caption）
      const f = rng.range(1, 3);
      push('\\begin{figure}[t]');
      push('  \\centering');
      push(`  \\includegraphics[width=0.8\\linewidth]{figures/fig-${id}-${f}.pdf}`);
      push(`  \\caption{${rng.pick(TOPIC_CN)}设置下各${rng.pick(EN_WORDS)}方案的对比：`);
      push(`    ${proseLine(rng)}。}`);
      push(`  \\label{fig:${id}-${f}}`);
      push('\\end{figure}');
      push('');
    } else if (roll < 0.04 && remaining > 14) {
      // table 环境（booktabs 三线表）
      push('\\begin{table}[htbp]');
      push('  \\centering');
      push(`  \\caption{不同${rng.pick(CN_WORDS)}配置的${rng.pick(EN_WORDS)}得分}`);
      push(`  \\label{tab:${id}-1}`);
      push('  \\begin{tabular}{lccc}');
      push('    \\toprule');
      push(`    配置 & ${rng.pick(EN_WORDS)} & ${rng.pick(EN_WORDS)} & ${rng.pick(EN_WORDS)} \\\\`);
      push(`    base & ${rng.range(60, 95)}.${rng.range(0, 9)} & ${rng.range(60, 95)}.${rng.range(0, 9)} & ${rng.range(60, 95)}.${rng.range(0, 9)} \\\\`);
      push(`    ours & ${rng.range(70, 99)}.${rng.range(0, 9)} & ${rng.range(70, 99)}.${rng.range(0, 9)} & ${rng.range(70, 99)}.${rng.range(0, 9)} \\\\`);
      push('    \\bottomrule');
      push('  \\end{tabular}');
      push('\\end{table}');
      push('');
    } else if (roll < 0.055) {
      // equation 环境
      push('\\begin{equation}');
      push(`  \\mathcal{L}_{${rng.pick(EN_WORDS)}} = \\sum_{i=1}^{N} \\alpha_i \\cdot d(\\mathbf{x}_i, \\mathbf{y}_i) + \\lambda \\|\\theta\\|^2`);
      push(`  \\label{eq:${id}-1}`);
      push('\\end{equation}');
      push('');
    } else if (roll < 0.07) {
      // 行内注释（锻炼各扫描器的注释剥离路径）
      push(`% 备注：${proseLine(rng)}`);
    } else if (roll < 0.09) {
      // 引用其他章节的交叉引用句
      const target = pad4(rng.int(ctx.sectionCount));
      push(`如第~\\ref{sec:${target}} 节所示，式~\\eqref{eq:${target}-1} 的结论与表~\\ref{tab:${target}-1} 一致，参见算法~\\ref{alg:${target}}。`);
    } else if (roll < 0.13) {
      // 引用文献句（1~3 个 key）
      const n = rng.range(1, 3);
      const keys: string[] = [];
      for (let k = 0; k < n; k++) keys.push(ctx.citekeys[rng.int(ctx.citekeys.length)]!);
      push(`相关工作表明${rng.pick(CN_WORDS)}的${rng.pick(EN_WORDS)}至关重要~\\cite{${keys.join(', ')}}，${proseLine(rng)}。`);
    } else {
      // 普通正文段（连续 2~4 行成段）
      const n = rng.range(2, 4);
      for (let k = 0; k < n && out.length < linesPerFile; k++) push(proseLine(rng));
      push('');
    }
  }
  return out.join('\n');
}

/** main.tex：导言区 + \input 引用全部 section + 参考文献 */
function generateMain(sectionCount: number, inlineBody: string | null): string {
  const out: string[] = [
    '% main.tex —— 合成大项目入口（性能基线测试生成）',
    '\\documentclass[12pt]{article}',
    '\\usepackage{amsmath}',
    '\\usepackage{graphicx}',
    '\\usepackage{booktabs}',
    '\\usepackage{algorithm}',
    '\\usepackage{algorithmic}',
    '\\usepackage[UTF8]{ctex}',
    '',
    '\\title{A Synthetic 大规模 Survey of 深度学习 Methods for 学术写作}',
    '\\author{ScholarForge Perf Bot \\and 合成生成器}',
    '\\date{2026}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    '\\begin{abstract}',
    '本文系统评估各类 representation 与 attention 机制在长文档 scene 下的表现，',
    '并在全部章节给出可复现的实验设置、baseline 对比与误差分析。',
    '\\end{abstract}',
    '',
  ];
  if (inlineBody !== null) {
    out.push(inlineBody);
  } else {
    for (let i = 1; i <= sectionCount; i++) out.push(`\\input{sections/sec-${pad4(i)}}`);
  }
  out.push('', '\\bibliographystyle{plain}', '\\bibliography{refs}', '', '\\end{document}', '');
  return out.join('\n');
}

const BIB_TYPES = ['article', 'inproceedings', 'book', 'misc'] as const;
const FAMILY = [
  'Chen', 'Wang', 'Li', 'Zhang', 'Liu', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou',
  'Garcia', 'Tanaka', 'Muller', 'Rossi', 'Kim', 'Park', 'Singh', 'Nguyen',
  'Silva', 'Cohen', 'Novak', 'Kowalski', 'Dubois', 'Andersen',
] as const;
const GIVEN = ['Wei', 'Lei', 'Anna', 'Yuki', 'Maria', 'Jan', 'Omar', 'Ines', 'Kai', 'Sara'] as const;
const BIB_VENUES = [
  'Journal of Machine Learning Research',
  'IEEE Transactions on Pattern Analysis and Machine Intelligence',
  'Advances in Neural Information Processing Systems',
  'Proceedings of the Annual Meeting of the ACL',
  'Empirical Methods in Natural Language Processing',
  'ACM Computing Surveys',
  '计算机学报',
  '软件学报',
  'Springer Lecture Notes in Computer Science',
] as const;

/** refs.bib：混合条目类型、@string 宏、嵌套大括号、转义作者名 */
function generateBib(count: number): { text: string; citekeys: string[] } {
  const rng = new Rng(0x1b1dcafe);
  const out: string[] = [
    '% refs.bib —— 合成参考文献库（性能基线测试生成）',
    '@string{jsch = {计算机学报}}',
    '@string{soft = {软件学报}}',
    '',
  ];
  const citekeys: string[] = [];
  for (let i = 0; i < count; i++) {
    const type = BIB_TYPES[i % BIB_TYPES.length]!;
    const family = rng.pick(FAMILY);
    const year = 1995 + rng.int(31);
    const key = `${family.toLowerCase()}${year}${rng.pick(EN_WORDS).replace(/[^a-z]/g, '')}${pad4(i)}`;
    citekeys.push(key);

    const authors: string[] = [];
    const na = rng.range(2, 5);
    for (let a = 0; a < na; a++) {
      const f = rng.pick(FAMILY);
      const g = rng.pick(GIVEN);
      authors.push(rng.next() < 0.2 ? `${f}, ${g} and others` : a % 2 === 0 ? `${f}, ${g}` : `${g} ${f}`);
    }
    const title = `${rng.pick(TOPIC_EN)} ${rng.pick(EN_WORDS)} 与${rng.pick(TOPIC_CN)}${rng.pick(CN_WORDS)}的统一框架`;
    const venue = rng.pick(BIB_VENUES);

    out.push(`@${type}{${key},`);
    out.push(`  author = {${authors.join(' and ')}},`);
    out.push(`  title = {${title}}`);
    if (type === 'article') {
      out.push(`  journal = ${venue === '计算机学报' ? 'jsch' : venue === '软件学报' ? 'soft' : `{${venue}}`},`);
      out.push(`  volume = {${rng.range(1, 60)}},`);
      out.push(`  number = {${rng.range(1, 12)}},`);
      out.push(`  pages = {${rng.range(1, 400)}--${rng.range(401, 900)}},`);
    } else if (type === 'inproceedings') {
      out.push(`  booktitle = {${venue}},`);
      out.push(`  pages = {${rng.range(1, 300)}--${rng.range(301, 700)}},`);
    } else if (type === 'book') {
      out.push(`  publisher = ${rng.next() < 0.5 ? 'ieee' : rng.next() < 0.5 ? 'springer' : '{MIT Press}'},`);
      out.push(`  edition = {${rng.range(1, 3)}}`);
    } else {
      out.push(`  howpublished = {\\url{https://arxiv.org/abs/${rng.range(1000, 9999)}.${rng.range(10000, 99999)}}},`);
      out.push(`  note = {Preprint, cited by 合成测试}`);
    }
    out.push(`  year = {${year}},`);
    out.push(`  month = ${['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][rng.int(12)]},`);
    out.push(`  doi = {10.${rng.range(1000, 9999)}/${key}},`);
    out.push('}');
    out.push('');
  }
  return { text: out.join('\n'), citekeys };
}

/** 生成合成大项目。默认：120 个 .tex（1 main + 119 section）+ 500 条 refs.bib。 */
export function generateBigProject(opts: GenerateBigProjectOptions = {}): BigProject {
  const totalTex = Math.max(1, opts.files ?? 120);
  const linesPerFile = Math.max(20, opts.linesPerFile ?? 200);
  const bibCount = Math.max(0, opts.bibCount ?? 500);

  const bib = generateBib(bibCount);
  const sectionCount = totalTex - 1;
  const files: Record<string, string> = {};
  const sectionFiles: string[] = [];
  const sectionLabels: string[] = [];

  if (sectionCount === 0) {
    // 单文件模式：main.tex 直接内联全部正文（覆盖"单文件 1000 行"类用例）
    const body = generateSection({ index: 1, citekeys: bib.citekeys, sectionCount: 1 }, linesPerFile);
    files['main.tex'] = generateMain(0, body);
  } else {
    for (let i = 1; i <= sectionCount; i++) {
      const path = `sections/sec-${pad4(i)}.tex`;
      files[path] = generateSection({ index: i, citekeys: bib.citekeys, sectionCount }, linesPerFile);
      sectionFiles.push(path);
      sectionLabels.push(`sec:${pad4(i)}`);
    }
    files['main.tex'] = generateMain(sectionCount, null);
  }

  const bibFile = 'refs.bib';
  files[bibFile] = bib.text;
  return { files, mainFile: 'main.tex', sectionFiles, bibFile, citekeys: bib.citekeys, sectionLabels };
}

/**
 * 深嵌套 \input 链（书稿式多级 include）：main → f0 → f1 → … → f{depth-1} → leaf，
 * 每个文件约 bytesPerFile 字节。combinedDoc 的 O(深度²) 回归网专用：
 * 逐层 replace 重建字符串的实现在此形态下会随深度平方恶化。
 */
export function generateInputChain(depth: number, bytesPerFile = 2000): Record<string, string> {
  const files: Record<string, string> = { 'main.tex': 'top\n\\input{f0}\n' };
  const body = 'x'.repeat(Math.max(1, bytesPerFile));
  for (let i = 0; i < depth; i++) files[`f${i}.tex`] = `f${i}\n\\input{f${i + 1}}\n${body}`;
  files[`f${depth}.tex`] = `leaf\n${body}`;
  return files;
}
