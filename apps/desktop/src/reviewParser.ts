/**
 * 审稿意见 markdown 解析：把审稿人步骤输出（约定 summary/strengths/weaknesses/
 * questions/score band 段落）宽容地解析为结构化分区，供 ReviewPanel 结构化渲染。
 * 识别的标题形态：`## Summary` / `**优点**` / `Weaknesses:` / `- **缺点**` 等中英别名。
 */

export interface ReviewSections {
  summary?: string;
  strengths?: string;
  weaknesses?: string;
  questions?: string;
  score?: string;
}

type SectionKey = keyof ReviewSections;

const SECTION_ALIASES: Array<{ key: SectionKey; re: RegExp }> = [
  { key: 'summary', re: /^(summary|摘要|概述|总评|overall)$/i },
  { key: 'strengths', re: /^(strengths?|优点|亮点|强项)$/i },
  { key: 'weaknesses', re: /^(weakness(es)?|缺点|弱项|不足|weak points?)$/i },
  { key: 'questions', re: /^(questions?|问题|疑问|提问)$/i },
  { key: 'score', re: /^(score(\s*band)?|评分|倾向|overall\s*recommendation)$/i },
];

const SCORE_INLINE =
  /(?:score\s*band|overall\s*recommendation|评分|整体倾向|倾向)[^\n：:]{0,8}[：:]\s*([^\n]{1,60})/i;

/** 剥掉标题行的装饰：#、列表标记、强调符号、结尾冒号 */
function normalizeHeading(line: string): string | null {
  const stripped = line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*[-*+>]\s*/, '')
    .replace(/[*_`]+/g, '')
    .replace(/[：:]\s*$/, '')
    .trim();
  return stripped || null;
}

function matchSection(stripped: string): SectionKey | null {
  for (const { key, re } of SECTION_ALIASES) {
    if (re.test(stripped)) return key;
  }
  return null;
}

export function parseReviewSections(md: string): ReviewSections {
  const result: ReviewSections = {};
  const lines = md.split('\n');
  const state: { current: SectionKey | null } = { current: null };
  const buckets: Partial<Record<SectionKey, string[]>> = {};

  const openSection = (key: SectionKey): string[] => {
    state.current = key;
    return (buckets[key] ??= []);
  };

  for (const line of lines) {
    // 形态一：独立标题行（## Summary / **优点** / ### Weaknesses:）
    const stripped = normalizeHeading(line);
    const key = stripped ? matchSection(stripped) : null;
    if (key) {
      const bucket = openSection(key);
      // 结尾带冒号的标题行若还有行内内容则归入该节
      const inline = line.replace(/^[^：:]*[：:]/, '').trim();
      if (inline && normalizeHeading(inline) === null) bucket.push(inline);
      continue;
    }

    // 形态二：行内式标题（`Weaknesses: 1) ...` / `**缺点**：xxx`）
    const sepIdx = line.search(/[：:]/);
    if (sepIdx > 0) {
      const headPart = normalizeHeading(line.slice(0, sepIdx));
      const inlineKey = headPart ? matchSection(headPart) : null;
      if (inlineKey) {
        const bucket = openSection(inlineKey);
        const inline = line.slice(sepIdx + 1).trim();
        if (inline) bucket.push(inline);
        continue;
      }
    }

    if (state.current) {
      (buckets[state.current] ??= []).push(line);
    }
  }

  for (const [key, linesOf] of Object.entries(buckets) as Array<[SectionKey, string[]]>) {
    const text = linesOf.join('\n').trim();
    if (text) result[key] = text;
  }

  if (!result.score) {
    const m = SCORE_INLINE.exec(md);
    if (m?.[1]) result.score = m[1].trim();
  }

  return result;
}

/** 评分/倾向 → 展示颜色 */
export function scoreTone(score?: string): 'good' | 'mid' | 'bad' | 'unknown' {
  if (!score) return 'unknown';
  const s = score.toLowerCase();
  if (/(strong\s*)?accept|接收|录用|accept/.test(s) && !/reject/.test(s)) return 'good';
  if (/reject|拒/.test(s)) return 'bad';
  if (/borderline|边缘|摇摆/.test(s)) return 'mid';
  return 'unknown';
}
