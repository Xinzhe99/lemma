/**
 * computeHealth 纯函数详测：
 *  - 空项目 / 干净项目满分；
 *  - 各类扣分：lint error 计数（warning/hint 不算）、spell misspelling 计分 + confusable
 *    只计数、glossary 一致性 error、citation 悬空键；
 *  - 各类扣分上限钳制与总分下限 0；
 *  - words 口径（仅 .tex）、issues 四项恒定顺序、跨文件聚合（\input 展开 + 逐文件 lint）；
 *  - healthTone 色调映射边界；
 *  - 合成大项目（120 .tex + 500 bib）性能回归网（宽松时限 + 打印实测值）。
 */
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  HEALTH_PENALTY_CAPS,
  computeHealth,
  healthTone,
  type HealthIssueKind,
} from './healthScore';
import { generateBigProject } from './perf/genProject';

const CLEAN_MAIN = `\\documentclass{article}
\\begin{document}
Hello world.
\\end{document}
`;

const CLEAN_BIB = `@misc{known,
  title = {A Known Paper},
  year = {2024}
}
`;

function issueOf(kinds: ReturnType<typeof computeHealth>['issues'], kind: HealthIssueKind) {
  return kinds.find((i) => i.kind === kind)!;
}

describe('computeHealth', () => {
  it('空项目：满分 100、words 0、四类计数全 0 且顺序固定', () => {
    const r = computeHealth({});
    expect(r.score).toBe(100);
    expect(r.words).toBe(0);
    expect(r.issues.map((i) => i.kind)).toEqual(['lint', 'spell', 'glossary', 'citation']);
    expect(r.issues.every((i) => i.count === 0 && i.sample === '')).toBe(true);
  });

  it('干净小项目（.tex + .bib）：满分 100，words 计入 .tex、不计 .bib/.md', () => {
    const r = computeHealth({
      'main.tex': CLEAN_MAIN + '\nhello world 你好\n',
      'refs.bib': CLEAN_BIB,
      'notes.md': 'not counted at all',
    });
    expect(r.score).toBe(100);
    expect(r.issues.every((i) => i.count === 0)).toBe(true);
    // countWords 口径：LaTeX 命令词也计（documentclass/article/begin/document×2/end），
    // 即 8 命令词 + Hello world + hello world + 你好(2) = 12；.bib/.md 不计
    expect(r.words).toBe(12);
  });

  it('lint：未闭合环境计 error（×4 扣分），\\ref 悬空 warning 与 TODO hint 不算', () => {
    const r = computeHealth({
      'main.tex': `\\documentclass{article}
\\begin{document}
\\ref{nope} % TODO fix this later
\\begin{itemize}
\\end{document}
`,
    });
    const lint = issueOf(r.issues, 'lint');
    expect(lint.count).toBe(1); // 仅 itemize 未闭合
    expect(lint.sample).toContain('main.tex:4'); // \begin{itemize} 所在行
    expect(lint.sample).toContain('itemize');
    expect(r.score).toBe(96); // 100 - 1×4
  });

  it('spell：misspelling 计分（×2），confusable 只进计数不扣分；sample 为首个词形', () => {
    const r = computeHealth({
      'main.tex': `\\begin{document}
We recieve the input and the data is clean.
\\end{document}
`,
    });
    const spell = issueOf(r.issues, 'spell');
    expect(spell.count).toBe(2); // recieve(misspelling) + data is(confusable)
    expect(spell.sample).toBe('recieve');
    expect(r.score).toBe(98); // 100 - 1×2（confusable 不扣）
  });

  it('glossary：缩写在首次定义前使用计 error（×3 扣分）', () => {
    const r = computeHealth({
      'main.tex': `\\begin{document}
We evaluate CNN performance first.

A Convolutional Neural Network (CNN) is a deep model.
\\end{document}
`,
    });
    const glossary = issueOf(r.issues, 'glossary');
    expect(glossary.count).toBeGreaterThanOrEqual(1);
    expect(glossary.sample).toContain('CNN');
    expect(r.score).toBe(97); // 100 - 1×3
  });

  it('citation：\\cite 键不在任何 .bib 计悬空（×5 扣分），bib 内已有键不扣', () => {
    const r = computeHealth({
      'main.tex': `\\begin{document}
Known \\cite{known} and missing \\cite{missing} citations.
\\end{document}
`,
      'refs.bib': CLEAN_BIB,
    });
    const citation = issueOf(r.issues, 'citation');
    expect(citation.count).toBe(1);
    expect(citation.sample).toBe('missing');
    expect(r.score).toBe(95); // 100 - 1×5
    // \cite 未知键在 lint 里是 warning 级：不重复计入 lint error
    expect(issueOf(r.issues, 'lint').count).toBe(0);
  });

  it('扣分上限钳制：12 个 lint error 封顶 -40，20 个 misspelling 封顶 -25', () => {
    const unclosed = Array.from({ length: 12 }, () => '\\begin{itemize}').join('\n');
    const misspelled = Array.from({ length: 20 }, (_, i) => `Line ${i} will recieve input.`).join('\n');
    const r = computeHealth({
      'main.tex': `\\begin{document}\n${unclosed}\n\n${misspelled}\n\\end{document}\n`,
    });
    expect(issueOf(r.issues, 'lint').count).toBe(12);
    expect(issueOf(r.issues, 'spell').count).toBe(20);
    expect(r.score).toBe(35); // 100 - min(40,48) - min(25,40)
  });

  it('总分下限钳制 0：四类都打满上限（-40-25-15-20）→ 恰为 0，不为负', () => {
    const unclosed = Array.from({ length: 12 }, () => '\\begin{itemize}').join('\n'); // 12 lint error
    const misspelled = Array.from({ length: 20 }, (_, i) => `Line ${i} will recieve input.`).join('\n'); // 20 misspelling
    const abbrevs = ['CNN', 'GNN', 'RNN', 'LSTM', 'ANN']; // 5 个缩写均在定义前使用
    const defs = [
      'A Convolutional Neural Network (CNN) is a model.',
      'A Graph Neural Network (GNN) is a model.',
      'A Recurrent Neural Network (RNN) is a model.',
      'A Long Short Term Memory (LSTM) is a model.',
      'An Artificial Neural Network (ANN) is a model.',
    ].join('\n');
    const dangling = ['nope1', 'nope2', 'nope3', 'nope4', 'nope5'].map((k) => `\\cite{${k}}`).join(' '); // 5 悬空
    const r = computeHealth({
      'main.tex': `\\begin{document}\n${unclosed}\n\n${misspelled}\n\nWe use ${abbrevs.join(', ')} here.\n\n${defs}\n\n${dangling}\n\\end{document}\n`,
    });
    expect(issueOf(r.issues, 'lint').count).toBe(12);
    expect(issueOf(r.issues, 'spell').count).toBeGreaterThanOrEqual(20);
    expect(issueOf(r.issues, 'glossary').count).toBeGreaterThanOrEqual(5);
    expect(issueOf(r.issues, 'citation').count).toBe(5);
    expect(r.score).toBe(0);
  });

  it('跨文件聚合：\\input 展开后的正文计入 spell/citation，逐文件 lint 汇总', () => {
    const r = computeHealth({
      'main.tex': `\\documentclass{article}\n\\begin{document}\n\\input{sections/sec}\n\\end{document}\n`,
      'sections/sec.tex': `We recieve the data.\n\\cite{ghost}\n\\begin{quote}\n`,
    });
    expect(issueOf(r.issues, 'spell').count).toBe(1);
    expect(issueOf(r.issues, 'citation').count).toBe(1);
    expect(issueOf(r.issues, 'citation').sample).toBe('ghost');
    expect(issueOf(r.issues, 'lint').count).toBe(1); // sections/sec.tex 的 quote 未闭合
    expect(issueOf(r.issues, 'lint').sample).toContain('sections/sec.tex:');
  });

  it('healthTone 色调映射边界：85 绿、60 黄、59 红', () => {
    expect(healthTone(100)).toBe('good');
    expect(healthTone(85)).toBe('good');
    expect(healthTone(84)).toBe('warn');
    expect(healthTone(60)).toBe('warn');
    expect(healthTone(59)).toBe('bad');
    expect(healthTone(0)).toBe('bad');
  });

  it('扣分上限常量与公式口径一致', () => {
    expect(HEALTH_PENALTY_CAPS).toEqual({ lint: 40, spell: 25, glossary: 15, citation: 20 });
  });

  it('性能：120 文件合成项目 computeHealth < 300ms（验收口径；实测留有余量）', () => {
    const project = generateBigProject(); // 120 .tex + 500 bib ≈ 两万余行
    const runs: number[] = [];
    let result: ReturnType<typeof computeHealth> | undefined;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      result = computeHealth(project.files);
      runs.push(performance.now() - t0);
    }
    const best = Math.min(...runs);
    console.info(
      `[perf] computeHealth(120 files): best ${best.toFixed(1)}ms (runs: ${runs
        .map((t) => t.toFixed(1))
        .join('/')}ms, limit 300ms)`,
    );
    expect(result!.words).toBeGreaterThan(0);
    expect(best).toBeLessThan(300);
  });
});
