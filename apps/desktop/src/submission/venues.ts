/**
 * WF-1 投稿工作台：目标期刊/会议结构化档案（S1）。
 * 内置常见 ML/CV/NLP 会议与综合期刊的投稿要求（页数、模板、匿名规则、
 * 补充材料、AI 政策），供 SubmitPanel 展示、agent 工具 submission.checklist
 * 查询与期刊推荐（recommend.ts）打分复用。
 * 规则会随年份浮动，字段文案以「以当年 CFP / 投稿指南为准」的口径维护，
 * 社区共建是设计文档 4.6 的终态。
 */

export interface VenueProfile {
  id: string;
  name: string;
  type: 'conference' | 'journal';
  /** 页数上限（含浮动规则的说明） */
  pageLimit: string;
  /** 官方模板 / 排版要求 */
  template: string;
  /** 匿名规则（双盲/单盲及投稿版要求） */
  anonymity: string;
  /** 补充材料规则 */
  supplementary: string;
  /** AI 使用政策 */
  aiPolicy: string;
  /** 其他备注（截稿节奏、评审流程等） */
  notes: string;
  /** scope 词表：期刊推荐（S5）用，中英关键词均可 */
  scope: string[];
  /** 模糊匹配别名（大小写不敏感，含历史名称） */
  aliases?: string[];
}

export const VENUE_PROFILES: VenueProfile[] = [
  {
    id: 'neurips',
    name: 'NeurIPS',
    type: 'conference',
    pageLimit: '主文 9 页，参考文献与附录不计入（以当年 CFP 为准）',
    template: '官方 neurips.sty（单栏，preprint 选项需匿名）',
    anonymity: '双盲（double-blind）：提交版正文、附录与补充材料均不得出现作者身份信息',
    supplementary: '单独提交补充材料（附录/代码）；rebuttal 期间允许更新一次',
    aiPolicy: '允许 LLM 辅助写作，但需在文中披露使用方式；AI 不得列为作者',
    notes: '摘要截稿早于全文约两周；OpenReview 评审，含 author–reviewer 讨论期',
    scope: ['machine learning', 'deep learning', 'neural networks', 'learning theory', 'optimization', 'probabilistic modeling', 'reinforcement learning', 'representation learning', 'foundation models'],
    aliases: ['nips', 'neural information processing systems', 'annual conference on neural information processing systems'],
  },
  {
    id: 'icml',
    name: 'ICML',
    type: 'conference',
    pageLimit: '主文 8–9 页，参考文献不计入（以当年 CFP 为准）',
    template: '官方 icml.sty（单栏）',
    anonymity: '双盲：提交版需完全匿名，作者信息在录用后补齐',
    supplementary: '附录与代码作为 supplementary 单独上传，rebuttal 期间可更新',
    aiPolicy: '允许 AI 辅助写作但需披露；AI 不得署名，责任由作者承担',
    notes: 'PMLR 正式出版；两轮评审 + Area Chair 综合',
    scope: ['machine learning', 'deep learning', 'optimization', 'learning theory', 'generative models', 'bayesian methods', 'reinforcement learning', 'neural networks', 'foundation models'],
    aliases: ['international conference on machine learning'],
  },
  {
    id: 'iclr',
    name: 'ICLR',
    type: 'conference',
    pageLimit: '主文 9 页（2024 起口径，参考文献不计入），附录不限',
    template: '官方 iclr2026_conference.sty（单栏）',
    anonymity: '双盲：OpenReview 公开评审，讨论期作者以匿名身份回复',
    supplementary: '附录并入主 PDF 的方式或单独 supplementary，以当届说明为准',
    aiPolicy: '允许 LLM 辅助写作，需在 acknowledgments 说明；AI 不得列为作者',
    notes: '全年大部分时间开放投稿（rolling），评审意见公开可查',
    scope: ['deep learning', 'representation learning', 'neural networks', 'optimization', 'generative models', 'self-supervised learning', 'foundation models', 'transformer'],
    aliases: ['international conference on learning representations'],
  },
  {
    id: 'cvpr',
    name: 'CVPR',
    type: 'conference',
    pageLimit: '主文 8 页 + 参考文献不限（CVPR 2020 起；以当年 CFP 为准）',
    template: '官方 cvpr.sty（双栏）',
    anonymity: '双盲：提交版不得含作者信息，引用自身工作用第三人称',
    supplementary: '补充材料（视频/代码/更多实验）单独 zip/PDF 提交，不强制',
    aiPolicy: '遵循 IEEE/CVF 口径：AI 生成内容需披露，AI 不得为作者',
    notes: '摘要截稿早于全文约一周；录用后需注册展示 poster/oral',
    scope: ['computer vision', 'object detection', 'image segmentation', 'convolutional network', 'visual recognition', '3d vision', 'video understanding', 'image generation', 'diffusion models'],
    aliases: ['conference on computer vision and pattern recognition', 'ieee cvpr'],
  },
  {
    id: 'iccv',
    name: 'ICCV',
    type: 'conference',
    pageLimit: '主文 8 页 + 参考文献不限（以当年 CFP 为准）',
    template: '官方 iccv.sty（双栏，IEEE 风格）',
    anonymity: '双盲：提交版完全匿名',
    supplementary: '补充材料单独提交，rebuttal 期间政策以 CFP 为准',
    aiPolicy: '遵循 IEEE/CVF 口径：AI 生成内容需披露，AI 不得为作者',
    notes: '与 CVPR 交替举办（ICCV 奇数年），审稿流程与 CVPR 类似',
    scope: ['computer vision', 'object detection', 'image segmentation', 'visual recognition', '3d vision', 'video understanding', 'diffusion models'],
    aliases: ['international conference on computer vision'],
  },
  {
    id: 'eccv',
    name: 'ECCV',
    type: 'conference',
    pageLimit: '主文 14 页（Springer LNCS 格式）+ 参考文献不限',
    template: 'Springer LNCS 单栏模板（eccv.cls）',
    anonymity: '双盲：提交版完全匿名',
    supplementary: '补充材料单独上传；正式版需按 LNCS 终稿要求整理',
    aiPolicy: '允许 AI 辅助写作但需披露；AI 不得列为作者（遵循 Springer 口径）',
    notes: '偶数年举办；录用后版权转 Springer，出版于 LNCS 系列',
    scope: ['computer vision', 'object detection', 'image segmentation', 'scene understanding', 'visual recognition', '3d vision', 'image generation'],
    aliases: ['european conference on computer vision'],
  },
  {
    id: 'acl',
    name: 'ACL',
    type: 'conference',
    pageLimit: '长文 8 页 + 参考文献不限（短文 4 页；以当年 CFP 为准）',
    template: '官方 acl.sty（ACL Rolling Review 格式，单栏）',
    anonymity: '双盲：提交版需匿名（限制自引措辞、去作者信息）',
    supplementary: '附录与代码可放 supplementary 或文末限制页数内',
    aiPolicy: '允许 LLM 辅助写作，需在 limitations/伦理声明中披露；AI 不得为作者',
    notes: '经 ARR（ACL Rolling Review）滚动评审后 commitment 至大会；要求负责任研究声明',
    scope: ['natural language processing', 'machine translation', 'question answering', 'linguistics', 'dialogue systems', 'large language models', 'text generation', 'information extraction'],
    aliases: ['annual meeting of the association for computational linguistics', 'arr', 'acl rolling review'],
  },
  {
    id: 'emnlp',
    name: 'EMNLP',
    type: 'conference',
    pageLimit: '长文 8 页 + 参考文献不限（短文 4 页；以当年 CFP 为准）',
    template: '官方 acl.sty（ARR 格式）',
    anonymity: '双盲：提交版完全匿名',
    supplementary: '补充材料（代码/数据）单独上传；Findings 为未进主会的备选通道',
    aiPolicy: '与 ACL 一致：LLM 使用需披露，AI 不得署名',
    notes: '经 ARR 评审；实证性较强的 NLP 工作常投此处',
    scope: ['natural language processing', 'machine translation', 'text mining', 'information extraction', 'dialogue systems', 'multilingual', 'large language models', 'computational social science'],
    aliases: ['empirical methods in natural language processing'],
  },
  {
    id: 'aaai',
    name: 'AAAI',
    type: 'conference',
    pageLimit: '主文 7 页 + 参考文献不限（第 8 页通常需购页，以 CFP 为准）',
    template: '官方 aaai.sty（双栏）',
    anonymity: '双盲：提交版完全匿名',
    supplementary: '在线附录可引用 URL，技术附录多数年份并入主文页数',
    aiPolicy: '允许 AI 辅助写作但需披露；AI 不得列为作者',
    notes: '两阶段摘要/全文截稿；覆盖 AI 全分支，非 ML 方向（规划/知识表示）也可投',
    scope: ['artificial intelligence', 'machine learning', 'planning', 'knowledge representation', 'multi-agent systems', 'reasoning', 'search', 'constraints'],
    aliases: ['association for the advancement of artificial intelligence'],
  },
  {
    id: 'ijcai',
    name: 'IJCAI',
    type: 'conference',
    pageLimit: '主文 7 页 + 参考文献不限（以当年 CFP 为准）',
    template: '官方 ijcai.sty（双栏）',
    anonymity: '双盲：提交版完全匿名',
    supplementary: '补充材料政策以 CFP 为准，通常允许在线附录',
    aiPolicy: '允许 AI 辅助写作但需披露；AI 不得列为作者',
    notes: '与 AAAI 交替（IJCAI 偶数年）；AI 综合性大会',
    scope: ['artificial intelligence', 'machine learning', 'knowledge representation', 'reasoning', 'planning', 'multi-agent systems', 'search'],
    aliases: ['international joint conference on artificial intelligence'],
  },
  {
    id: 'nature',
    name: 'Nature',
    type: 'journal',
    pageLimit: 'Article 约 5,000 词（≈4 个印刷页）；Letter 约 1,500 词（无严格页数，按栏目字数）',
    template: '无强制模板；提供 Nature LaTeX 参考模板，双栏排版由编辑处理',
    anonymity: '单盲：审稿人匿名，作者信息公开，无需匿名化提交版',
    supplementary: 'Supplementary Information 随文发布（编号 Supplementary Note/Figure）',
    aiPolicy: 'LLM 不得列为作者；使用 LLM 生成内容需在 methods 或致谢中记录，并对内容负责',
    notes: '先投摘要（presubmission inquiry）可获编辑快速反馈；转投 Nature Communications 常见',
    scope: ['multidisciplinary science', 'physics', 'biology', 'neuroscience', 'climate', 'materials', 'astronomy'],
    aliases: ['nature journal', 'nature main', 'nature research'],
  },
  {
    id: 'nature-machine-intelligence',
    name: 'Nature Machine Intelligence',
    type: 'journal',
    pageLimit: 'Article 主文约 3,000–3,500 词 + 图表（以投稿指南为准）',
    template: 'Nature 系列 LaTeX 模板，无需匿名化',
    anonymity: '单盲：审稿人匿名，作者公开',
    supplementary: 'Supplementary Information 与代码（Code Ocean 集成）随文发布',
    aiPolicy: 'LLM 不得列为作者；AI 参与写作需披露并说明核查方式',
    notes: 'Nature 系列 AI/机器人/数据科学交叉刊；接收算法类工作需突出科学影响',
    scope: ['artificial intelligence', 'machine learning', 'robotics', 'ai ethics', 'data science', 'neural networks', 'human-ai interaction'],
    aliases: ['nat mach intell', 'nature machine intelligence journal'],
  },
  {
    id: 'tpami',
    name: 'IEEE TPAMI',
    type: 'journal',
    pageLimit: '常规论文 14 页（双栏 IEEEtran），超页需缴 Mandatory Page Charges',
    template: 'IEEEtran 双栏模板',
    anonymity: '单盲：审稿人匿名，作者信息公开',
    supplementary: '支持补充材料与多媒体附件（multimedia appendix）',
    aiPolicy: 'IEEE 政策：AI 生成文本/图像需在 experimental section 披露，AI 不得为作者',
    notes: '月刊，审稿周期较长（数月级别）；扩展版会议论文需 ≥30% 新内容并声明',
    scope: ['computer vision', 'pattern recognition', 'machine learning', 'image analysis', 'deep learning', 'document analysis', 'biometrics'],
    aliases: ['ieee transactions on pattern analysis and machine intelligence', 'pami', 'ieee t-pami'],
  },
  {
    id: 'jmlr',
    name: 'JMLR',
    type: 'journal',
    pageLimit: '无硬性页数上限（建议正文 ≤35 页，超长需说明贡献密度）',
    template: '官方 jmlr LaTeX 模板（单栏）',
    anonymity: '单盲：审稿人匿名，作者公开',
    supplementary: '附录与证明可并入主文或作为 supplementary 发布',
    aiPolicy: '需在投稿时说明 AI 工具使用情况；AI 不得列为作者',
    notes: '开放获取、无版面费；适合体量较大的机器学习理论/方法工作',
    scope: ['machine learning', 'learning theory', 'statistical learning', 'probabilistic models', 'optimization', 'deep learning', 'bayesian nonparametrics'],
    aliases: ['journal of machine learning research'],
  },
  {
    id: 'jos',
    name: '软件学报',
    type: 'journal',
    pageLimit: '一般 ≤25 页（中文双栏排版，以当期投稿指南为准）',
    template: '软件学报官方 LaTeX/Word 模板（中文双栏）',
    anonymity: '近年实行双盲评审：投稿版需匿名化，具体以官网投稿指南为准',
    supplementary: '支持附件材料与代码/数据可用性声明',
    aiPolicy: '需声明 AI 工具使用情况；AI 不得署名（遵循国内学报口径）',
    notes: '中文 EI 核心期刊；投中文稿件的默认目标场所之一',
    scope: ['软件工程', '系统软件', '程序设计语言', '数据库', '操作系统', '软件测试', '中文论文', '人工智能应用'],
    aliases: ['journal of software', 'jos'],
  },
];

// ---------------------------------------------------------------------------
// 模糊匹配
// ---------------------------------------------------------------------------

/** 归一化：小写 + 去空白/连字符/标点（保留中文字符） */
export function normalizeVenueText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_·.,:;'"`!?()[\]{}<>\\/|&#+]+/g, '');
}

/** 档案的全部可匹配键（id / name / aliases） */
function matchKeys(v: VenueProfile): string[] {
  return [v.id, v.name, ...(v.aliases ?? [])].map(normalizeVenueText).filter(Boolean);
}

/**
 * 按名称/id 模糊匹配档案：先精确（id/name/alias），再互相包含
 * （包含命中时取匹配键最长者，避免 "nature machine intelligence" 先命中 "nature"）。
 * profiles 参数供测试注入自定义档案（S3 的 mock venues）。
 */
export function findVenueProfile(
  query: string,
  profiles: readonly VenueProfile[] = VENUE_PROFILES,
): VenueProfile | undefined {
  const q = normalizeVenueText(query);
  if (!q) return undefined;
  for (const v of profiles) {
    if (normalizeVenueText(v.id) === q || normalizeVenueText(v.name) === q) return v;
  }
  for (const v of profiles) {
    if ((v.aliases ?? []).some((a) => normalizeVenueText(a) === q)) return v;
  }
  let best: { venue: VenueProfile; keyLen: number } | null = null;
  for (const v of profiles) {
    for (const k of matchKeys(v)) {
      if ((k.includes(q) || q.includes(k)) && (!best || k.length > best.keyLen)) {
        best = { venue: v, keyLen: k.length };
      }
    }
  }
  return best?.venue;
}

/** 全部档案名列表（无匹配时作为候选返回给模型） */
export function listVenueNames(profiles: readonly VenueProfile[] = VENUE_PROFILES): string[] {
  return profiles.map((v) => v.name);
}

export function venueById(id: string, profiles: readonly VenueProfile[] = VENUE_PROFILES): VenueProfile | undefined {
  return profiles.find((v) => v.id === id);
}
