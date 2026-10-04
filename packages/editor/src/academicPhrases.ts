/**
 * 学术句式自动补全（v2.9.0 ①）：输入学术写作常用前缀 → 建议完整句式。
 *
 * 按修辞功能分组（Introduction / Method / Results / Discussion / Conclusion / Transition），
 * 每条含前缀触发词 + 完整句式模板。面向非英语母语研究者的日常写作加速器。
 *
 * 与 LaTeX snippet 补全的区别：那类是结构命令（\frac、\begin），这类是
 * 自然语言句式（"In this paper, we propose..."）。触发方式：行首输入英文
 * 前缀（大小写不敏感），匹配到句式库时弹出建议。
 */

export interface AcademicPhrase {
  /** 触发前缀（输入匹配用，如 "In this"） */
  trigger: string;
  /** 完整句式 */
  phrase: string;
  /** 修辞功能分类 */
  category: 'intro' | 'method' | 'results' | 'discussion' | 'conclusion' | 'transition' | 'related';
}

/** 80+ 常用学术句式库 */
export const ACADEMIC_PHRASES: readonly AcademicPhrase[] = [
  // —— Introduction ——
  { trigger: 'In this paper', phrase: 'In this paper, we propose ${1:method name}, a novel approach that ${2:key contribution}.', category: 'intro' },
  { trigger: 'In this work', phrase: 'In this work, we investigate ${1:research question} and demonstrate that ${2:finding}.', category: 'intro' },
  { trigger: 'In this study', phrase: 'In this study, we examine ${1:topic} through ${2:methodology}.', category: 'intro' },
  { trigger: 'Recent advances', phrase: 'Recent advances in ${1:field} have shown that ${2:finding}.', category: 'intro' },
  { trigger: 'Recent years', phrase: 'In recent years, ${1:topic} has attracted significant attention due to ${2:motivation}.', category: 'intro' },
  { trigger: 'has become', phrase: '${1:Technology} has become increasingly important in ${2:domain}.', category: 'intro' },
  { trigger: 'growing interest', phrase: 'There has been growing interest in ${1:topic}, driven by ${2:motivation}.', category: 'intro' },
  { trigger: 'Despite recent', phrase: 'Despite recent progress in ${1:field}, ${2:challenge} remains an open problem.', category: 'intro' },
  { trigger: 'However existing', phrase: 'However, existing approaches suffer from ${1:limitation}, which motivates our work.', category: 'intro' },
  { trigger: 'The main contributions', phrase: 'The main contributions of this paper are threefold: (1) ${1:contribution}, (2) ${2:contribution}, and (3) ${3:contribution}.', category: 'intro' },
  { trigger: 'Our key insight', phrase: 'Our key insight is that ${1:insight}, which enables ${2:capability}.', category: 'intro' },
  { trigger: 'To the best', phrase: 'To the best of our knowledge, this is the first work to ${1:novelty}.', category: 'intro' },

  // —— Method ——
  { trigger: 'We propose', phrase: 'We propose ${1:method}, which ${2:key mechanism}.', category: 'method' },
  { trigger: 'We present', phrase: 'We present ${1:system/method}, a ${2:descriptor} for ${3:task}.', category: 'method' },
  { trigger: 'We introduce', phrase: 'We introduce ${1:technique} that ${2:capability}.', category: 'method' },
  { trigger: 'Our approach', phrase: 'Our approach consists of three stages: ${1:stage 1}, ${2:stage 2}, and ${3:stage 3}.', category: 'method' },
  { trigger: 'Our method', phrase: 'Our method leverages ${1:technique} to achieve ${2:goal}.', category: 'method' },
  { trigger: 'We evaluate', phrase: 'We evaluate our approach on ${1:benchmark/dataset} and compare against ${2:baselines}.', category: 'method' },
  { trigger: 'We conduct', phrase: 'We conduct experiments on ${1:dataset} to validate ${2:hypothesis}.', category: 'method' },
  { trigger: 'Specifically we', phrase: 'Specifically, we ${1:specific action} by ${2:mechanism}.', category: 'method' },
  { trigger: 'Formally given', phrase: 'Formally, given ${1:input}, our goal is to ${2:objective}.', category: 'method' },
  { trigger: 'Let us denote', phrase: 'Let ${1:x} denote the ${2:variable/representation}.', category: 'method' },
  { trigger: 'The architecture', phrase: 'The architecture comprises ${1:component 1}, ${2:component 2}, and ${3:component 3}.', category: 'method' },
  { trigger: 'We first', phrase: 'We first ${1:step 1}, then ${2:step 2}, and finally ${3:step 3}.', category: 'method' },

  // —— Results ——
  { trigger: 'Experimental results', phrase: 'Experimental results demonstrate that our method ${1:achievement}, outperforming ${2:baseline} by ${3:margin}.', category: 'results' },
  { trigger: 'Our results', phrase: 'Our results show that ${1:finding}, which is consistent with ${2:previous work}.', category: 'results' },
  { trigger: 'Our approach achieves', phrase: 'Our approach achieves ${1:metric} of ${2:value}, representing a ${3:improvement} improvement over ${4:baseline}.', category: 'results' },
  { trigger: 'As shown', phrase: 'As shown in ${1:Figure/Table}~\\ref{${2:fig:label}}, ${3:observation}.', category: 'results' },
  { trigger: 'As can be', phrase: 'As can be seen from ${1:Table}~\\ref{${2:tab:label}}, ${3:observation}.', category: 'results' },
  { trigger: 'Table', phrase: 'Table~\\ref{${1:tab:label}} summarizes ${2:what it shows}.', category: 'results' },
  { trigger: 'We observe', phrase: 'We observe that ${1:observation}, suggesting ${2:interpretation}.', category: 'results' },
  { trigger: 'Notably our', phrase: 'Notably, our method achieves ${1:specific result} even when ${2:challenging condition}.', category: 'results' },
  { trigger: 'Significantly outperforms', phrase: 'Our method significantly outperforms ${1:baseline} (${2:p-value or margin}), demonstrating the effectiveness of ${3:component}.', category: 'results' },
  { trigger: 'achieves competitive', phrase: 'Our approach achieves competitive performance with ${1:baseline} while requiring only ${2:resource constraint}.', category: 'results' },

  // —— Discussion / Analysis ——
  { trigger: 'These findings', phrase: 'These findings suggest that ${1:implication}, which has important consequences for ${2:broader impact}.', category: 'discussion' },
  { trigger: 'One limitation', phrase: 'One limitation of our approach is that ${1:limitation}. Future work could address this by ${2:solution}.', category: 'discussion' },
  { trigger: 'There are several', phrase: 'There are several potential explanations for ${1:observation}. First, ${2:explanation 1}. Second, ${3:explanation 2}.', category: 'discussion' },
  { trigger: 'It is worth', phrase: 'It is worth noting that ${1:caveat/observation}, which ${2:implication}.', category: 'discussion' },
  { trigger: 'We hypothesize', phrase: 'We hypothesize that ${1:hypothesis}, because ${2:reasoning}.', category: 'discussion' },
  { trigger: 'This is likely', phrase: 'This is likely because ${1:explanation}, as ${2:supporting evidence}.', category: 'discussion' },
  { trigger: 'Further analysis', phrase: 'Further analysis reveals that ${1:deeper finding}, indicating ${2:insight}.', category: 'discussion' },
  { trigger: 'We also conducted', phrase: 'We also conducted an ablation study to understand the contribution of ${1:component}.', category: 'discussion' },

  // —— Conclusion ——
  { trigger: 'In conclusion', phrase: 'In conclusion, we have presented ${1:method}, which ${2:key achievement}. Our experiments demonstrate ${3:main result}.', category: 'conclusion' },
  { trigger: 'In summary', phrase: 'In summary, this paper makes the following contributions: ${1:contribution list}.', category: 'conclusion' },
  { trigger: 'Future work', phrase: 'Future work will explore ${1:direction 1} and ${2:direction 2}.', category: 'conclusion' },
  { trigger: 'We believe', phrase: 'We believe that ${1:method} will inspire future research in ${2:direction}.', category: 'conclusion' },

  // —— Transitions ——
  { trigger: 'Furthermore', phrase: 'Furthermore, ${1:additional point}, which reinforces our hypothesis.', category: 'transition' },
  { trigger: 'Moreover', phrase: 'Moreover, ${1:additional evidence} supports the effectiveness of our approach.', category: 'transition' },
  { trigger: 'In contrast', phrase: 'In contrast, ${1:contrasting observation}, suggesting that ${2:interpretation}.', category: 'transition' },
  { trigger: 'On the other', phrase: 'On the other hand, ${1:alternative view}, which raises the question of ${2:open question}.', category: 'transition' },
  { trigger: 'Building on', phrase: 'Building on ${1:prior work}, we extend ${2:what} to ${3:new setting}.', category: 'transition' },
  { trigger: 'Inspired by', phrase: 'Inspired by ${1:source of inspiration}, we design ${2:component} to ${3:purpose}.', category: 'transition' },

  // —— Related Work ——
  { trigger: 'Several works', phrase: 'Several works have explored ${1:topic}. ${2:Author et al.} proposed ${3:method} for ${4:task}.', category: 'related' },
  { trigger: 'Prior work', phrase: 'Prior work has focused on ${1:aspect}, but ${2:gap} has received less attention.', category: 'related' },
  { trigger: 'Closely related', phrase: 'Closely related to our work, ${1:Author et al.}~\\cite{${2:citekey}} investigated ${3:topic}.', category: 'related' },
  { trigger: 'In contrast to', phrase: 'In contrast to ${1:prior approach}, our method ${2:key difference}.', category: 'related' },
  { trigger: 'Unlike previous', phrase: 'Unlike previous methods that ${1:limitation of prior}, our approach ${2:advantage}.', category: 'related' },
  { trigger: 'Concurrent with', phrase: 'Concurrent with our work, ${1:Author et al.} independently studied ${2:topic}.', category: 'related' },
];

/** 类别 → 标签 */
export const CATEGORY_LABELS: Record<AcademicPhrase['category'], string> = {
  intro: '引言',
  method: '方法',
  results: '结果',
  discussion: '讨论',
  conclusion: '结论',
  transition: '过渡',
  related: '相关工作',
};

/** 前缀匹配：输入文本前几个词与 trigger 匹配 */
export function matchPhrases(input: string): AcademicPhrase[] {
  const trimmed = input.trim();
  if (trimmed.length < 3) return [];
  const lower = trimmed.toLowerCase();
  return ACADEMIC_PHRASES.filter((p) => {
    const trigger = p.trigger.toLowerCase();
    // 输入是 trigger 的前缀，或 trigger 是输入的前缀
    return trigger.startsWith(lower) || lower.startsWith(trigger);
  });
}
