/**
 * 极简 i18n：字典 + t(key, lang)。en 缺键回退 zh；两语皆缺返回 key 本身。
 * 并行面板可用 defineMessages() 注册本地字典（模块加载即合并，不覆盖已有键）。
 */

import { useSettingsStore, type Language } from './state/settingsStore';

export type MessageEntry = { zh: string; en?: string };
export type MessageDict = Record<string, MessageEntry>;

const dict: MessageDict = {
  // 顶栏与命令面板
  'palette.trigger': { zh: '命令面板', en: 'Command palette' },
  'palette.placeholder': { zh: '输入命令…', en: 'Type a command…' },
  'palette.empty': { zh: '无匹配命令', en: 'No matching commands' },
  // 命令面板分组标题与默认视图提示（顺序见 commandPalette.tsx 的 PALETTE_GROUP_ORDER）
  'palette.group.project': { zh: '项目与文件', en: 'Project & Files' },
  'palette.group.compile': { zh: '编译与预览', en: 'Compile & Preview' },
  'palette.group.edit': { zh: '编辑与插入', en: 'Editing & Insert' },
  'palette.group.ai': { zh: 'AI 助手', en: 'AI Assistant' },
  'palette.group.library': { zh: '文献与阅读', en: 'Library & Reading' },
  'palette.group.view': { zh: '视图与面板', en: 'View & Panels' },
  'palette.group.submit': { zh: '投稿', en: 'Submission' },
  'palette.group.knowledge': { zh: '知识库', en: 'Knowledge' },
  'palette.group.app': { zh: '应用', en: 'App' },
  'palette.searchAll': { zh: '输入关键词，搜索全部 {n} 个命令', en: 'Type to search all {n} commands' },
  'compile.idle': { zh: '编译 · 未运行', en: 'Compile · idle' },
  'compile.running': { zh: '编译 · 运行中…', en: 'Compile · running…' },
  'compile.ok': { zh: '编译 · 成功', en: 'Compile · ok' },
  'compile.fail': { zh: '编译 · 失败', en: 'Compile · failed' },
  'topbar.gitChip': { zh: 'Git ◐', en: 'Git ◐' },

  // 导航栏与侧栏
  'nav.outline': { zh: '大纲', en: 'Outline' },
  'nav.files': { zh: '文件', en: 'Files' },
  'nav.citations': { zh: '引用', en: 'Citations' },
  'nav.library': { zh: '文献库', en: 'Library' },
  'nav.sessions': { zh: '会话', en: 'Sessions' },
  'nav.git': { zh: '版本', en: 'Versions' },
  'viewer.noPdf': {
    zh: '还没有可预览的 PDF——编译一次（Ctrl+Enter）即可实时预览；AI 修改后的位置会自动定位。',
    en: 'No PDF yet — compile once (Ctrl+Enter) to live-preview; the view follows AI edits automatically.',
  },
  'nav.knowledge': { zh: '知识', en: 'Knowledge' },
  'nav.submit': { zh: '投稿', en: 'Submit' },
  'nav.reading': { zh: '文献阅读', en: 'Reading' },
  'placeholder.wsac': { zh: '待 WS-A/C 集成', en: 'Pending WS-A/C integration' },

  // 知识页签（术语/笔记）与动态面板加载
  'knowledge.glossary': { zh: '术语', en: 'Glossary' },
  'knowledge.notes': { zh: '笔记', en: 'Notes' },
  'panel.loading': { zh: '面板加载中…', en: 'Loading panel…' },
  'panel.loadFailed': { zh: '面板加载失败', en: 'Panel failed to load' },
  'panel.loadFailedDesc': {
    zh: '该面板尚未就绪（可能由并行工作流提供）。功能落地后重启应用即可自动出现。',
    en: 'This panel is not available yet (provided by a parallel workflow). It appears automatically once its module lands.',
  },
  'notes.placeholder': { zh: '笔记面板待集成', en: 'Notes panel pending integration' },
  'submit.placeholder': { zh: '投稿面板待集成', en: 'Submit panel pending integration' },

  // 文件树
  'tree.newFile': { zh: '新建文件', en: 'New file' },
  'tree.moreActions': { zh: '更多操作（新建 / 重命名 / 删除）', en: 'More actions (new / rename / delete)' },
  'tree.rename': { zh: '重命名', en: 'Rename' },
  'tree.delete': { zh: '删除', en: 'Delete' },
  'tree.newFilePrompt': { zh: '新建文件路径（如 sections/notes.tex）', en: 'New file path (e.g. sections/notes.tex)' },
  'tree.renamePrompt': { zh: '重命名为', en: 'Rename to' },
  'tree.deleteConfirm': { zh: '确认删除', en: 'Confirm delete' },
  // 文件树按项目分组
  'tree.currentChip': { zh: '当前', en: 'Current' },
  'tree.untitledProject': { zh: '未命名项目', en: 'Untitled project' },
  'tree.otherProjects': { zh: '其他项目', en: 'Other projects' },
  'tree.fileCount': { zh: '{n} 个文件', en: '{n} files' },
  'tree.switchTo': { zh: '切换到此项目', en: 'Switch to this project' },
  'tree.readonlyHint': { zh: '只读清单——切换到该项目后可编辑', en: 'Read-only list — switch to this project to edit' },
  'tree.emptyGuide': {
    zh: '还没有文件——点「新建项目」创建你的第一个项目，或从模板开始。',
    en: 'No files yet — click "New project" to create your first one, or start from a template.',
  },
  'tree.projectNoFiles': { zh: '（该记录没有文件）', en: '(no files in this record)' },

  // 编辑区
  'editor.pending': { zh: '打开文件开始编辑', en: 'Open a file to start editing' },
  'editor.noOpen': { zh: '未打开文件', en: 'No file open' },
  'editor.unsupportedType': { zh: '该文件类型暂不支持文本编辑', en: 'This file type is not editable as text' },

  // 首启引导卡（全新安装空态：编辑器区）
  'empty.firstProject.title': { zh: '创建你的第一个项目', en: 'Create your first project' },
  'empty.firstProject.desc': {
    zh: '给项目起个名字，可选一个本地文件夹保存；也可以先看看内置的演示项目。',
    en: 'Name your project and optionally pick a local folder to save it in; or take a look at the built-in demo first.',
  },
  'empty.firstProject.create': { zh: '新建项目', en: 'New project' },
  'empty.firstProject.demo': { zh: '先看看演示项目', en: 'View the demo project' },

  // 选中即问工具条（EditorArea）
  'selbar.selected': { zh: '已选 {n} 字', en: '{n} chars selected' },
  'selbar.polish': { zh: '润色', en: 'Polish' },
  'selbar.paraphrase': { zh: '改写', en: 'Paraphrase' },
  'selbar.paraphraseTitle': { zh: '选择一个改写变体（点击应用，经 diff 审批落稿）', en: 'Pick a rewrite variant (applies via diff approval)' },
  'selbar.paraphraseBusy': { zh: '生成变体…', en: 'Generating variants…' },
  'selbar.paraphraseDemo': { zh: '离线规则改写（配置模型服务获得深度变体）', en: 'Offline rule-based rewrite (configure a model for deeper variants)' },
  'selbar.explain': { zh: '解释', en: 'Explain' },
  'selbar.translate': { zh: '翻译', en: 'Translate' },
  'selbar.find': { zh: '找文献', en: 'Find papers' },
  'selbar.clear': { zh: '清除选区标记', en: 'Clear selection' },

  // 编译控制台
  'console.title': { zh: '编译输出', en: 'Compile output' },
  'console.clear': { zh: '清空', en: 'Clear' },
  'console.aiFix': { zh: '✦ AI 修复编译错误', en: '✦ AI fix compile errors' },
  'cmd.imageToLatex': { zh: '图像转 LaTeX（公式/表格截图）', en: 'Image to LaTeX (formula/table screenshot)' },
  'cmd.tikzFigure': { zh: 'AI 画图（描述 → TikZ 流程/架构/示意图）', en: 'AI figure (describe → TikZ)' },
  'cmd.bibHealth': { zh: '参考文献体检（缺失字段/重复/悬空引用）', en: 'Bibliography health check' },
  'cmd.searchReplace': { zh: '搜索并替换（全项目）', en: 'Search & replace in project' },
  'cmd.readAloud': { zh: '朗读这一节（校对：读出声听问题）', en: 'Read this section aloud (proofreading)' },
  // v7.1.0 新面板/对话框 i18n
  'sessions.newSession': { zh: '新会话', en: 'New session' },
  'sessions.newSessionHint': {
    zh: '在当前项目下新建会话',
    en: 'Start a new session in the current project',
  },
  'sessions.newProject': { zh: '新建项目', en: 'New project' },
  'sessions.ungrouped': { zh: '未分组', en: 'Ungrouped' },
  'sessions.noSessions': { zh: '还没有会话——点「新会话」开始与 AI 协作。', en: 'No sessions yet — click "New session" to start.' },
  'sessions.noSessionsInGroup': { zh: '（无会话——点「新会话」开始）', en: '(no sessions)' },
  'sessions.emptySession': { zh: '（空会话）', en: '(empty)' },
  'sessions.msgCount': { zh: ' 条', en: ' msg' },
  'sessions.rename': { zh: '重命名', en: 'Rename' },
  'sessions.delete': { zh: '删除', en: 'Delete' },
  'sessions.renameSessionTitle': { zh: '重命名会话', en: 'Rename session' },
  'sessions.deleteSessionTitle': { zh: '删除该会话？', en: 'Delete this session?' },
  'sessions.deleteSessionDesc': { zh: '会话消息将一并删除，不可恢复。', en: 'All messages will be deleted permanently.' },
  'sessions.newProjectPrompt': { zh: '新建项目', en: 'New project' },
  'sessions.newProjectDefault': { zh: '新论文', en: 'New paper' },
  'sessions.emptyGuide': {
    zh: '还没有项目——点「新建项目」创建你的第一个项目，并选择本地保存位置。',
    en: 'No projects yet — click "New project" to create your first one and pick where to save it.',
  },
  'sessions.renameProject': { zh: '重命名项目', en: 'Rename project' },
  'sessions.deleteProject': { zh: '删除项目', en: 'Delete project' },
  'sessions.deleteProjectTitle': { zh: '删除项目', en: 'Delete project' },
  'sessions.deleteProjectDesc': { zh: '只删除项目分组（项目文件记录一并移除），其下会话将移入「未分组」，不会丢失。', en: 'Removes the project group only; its sessions move to "Ungrouped" and are not lost.' },
  'sessions.deleteProjectConfirmTitle': { zh: '删除项目「{name}」？只删除项目分组（项目文件记录一并移除），其下会话将移入「未分组」，不会丢失。', en: 'Delete project "{name}"? Removes the project group only; its sessions move to "Ungrouped" and are not lost.' },
  'sessions.deleteSessionConfirmTitle': { zh: '删除该会话？会话消息将一并删除，不可恢复。', en: 'Delete this session? All messages will be deleted permanently.' },
  'sessions.openProject': { zh: '打开此项目', en: 'Open this project' },
  'git.commit': { zh: '提交当前进度', en: 'Commit progress' },
  'git.browserOnly': { zh: '版本管理在桌面应用中可用（浏览器形态无本地 git）。', en: 'Version control is desktop-only.' },
  'git.missingGit': { zh: '未检测到系统 git——安装 git 后重启应用即可启用内置版本管理。', en: 'System git not found — install git and restart.' },
  'git.remote': { zh: '未关联远端', en: 'No remote' },
  'git.linkRemote': { zh: '关联 GitHub 仓库', en: 'Link GitHub repo' },
  'git.unlink': { zh: '解除', en: 'Unlink' },
  'git.link': { zh: '关联', en: 'Link' },
  'git.unlinkTitle': { zh: '解除远端关联？', en: 'Unlink remote?' },
  'git.unlinkDesc': { zh: '将移除 origin（本地历史保留）。', en: 'Removes origin; local history is kept.' },
  'git.remotePrompt': { zh: '关联 GitHub 仓库', en: 'Link GitHub repo' },
  'git.remotePlaceholder': { zh: 'https://github.com/user/repo.git 或 git@github.com:user/repo.git', en: 'https://github.com/user/repo.git or git@github.com:user/repo.git' },
  'git.push': { zh: '推送中…', en: 'Pushing…' },
  'git.pull': { zh: '拉取中…', en: 'Pulling…' },
  'git.noCommits': { zh: '还没有提交——AI 改动采纳后会自动提交，也可手动提交。', en: 'No commits yet — AI changes auto-commit, or commit manually.' },
  'git.diff': { zh: '差异', en: 'Diff' },
  'git.changesPdf': { zh: '对照 PDF', en: 'Changes PDF' },
  'git.restore': { zh: '恢复', en: 'Restore' },
  'git.restoreTitle': { zh: '恢复到此版本', en: 'Restore to this version' },
  // v7.8.0：版本面板此前整块硬编码中文；确认文案合并进标题（confirmText 是按钮文案，不是说明）
  'git.resetToHead': { zh: '回滚到上次提交', en: 'Roll back to last commit' },
  'git.resetToHeadTitle': { zh: '丢弃所有未提交改动，回到上次提交状态', en: 'Discard all uncommitted changes and return to the last commit' },
  'git.resetConfirmTitle': { zh: '回滚到上次提交？所有未提交的修改（含 AI 刚做的改动）将被丢弃，此操作不可撤销。', en: 'Roll back to the last commit? All uncommitted edits (including recent AI changes) are discarded — this cannot be undone.' },
  'git.unlinkConfirmTitle': { zh: '解除远端关联？将移除 origin（{remote}），本地历史保留。', en: 'Unlink the remote? origin ({remote}) is removed; local history is kept.' },
  'git.committed': { zh: '已提交：{subject}', en: 'Committed: {subject}' },
  'git.nothingToCommit': { zh: '没有可提交的变更', en: 'Nothing to commit' },
  'git.changesPdfBuilding': { zh: '生成对照 PDF（{subject}…）…', en: 'Building changes PDF ({subject}…)…' },
  'git.changesPdfDone': { zh: '对照 PDF 已生成：{files} 个文件 / {lines} 行变更（右侧预览）', en: 'Changes PDF ready: {files} files / {lines} changed lines (preview on the right)' },
  'git.remoteLinked': { zh: '已关联远端', en: 'Remote linked' },
  'git.remoteUnlinked': { zh: '已解除（重启应用后生效）', en: 'Unlinked (takes effect after restart)' },
  'git.rolledBack': { zh: '已回滚到上次提交（{n} 个文件同步）', en: 'Rolled back to the last commit ({n} files synced)' },
  'git.restoreConfirmTitle': { zh: '恢复到「{subject}」？当前源文件将被该提交的版本覆盖（此操作本身也会产生新变更，可再提交）。', en: 'Restore to "{subject}"? Current sources will be overwritten by that commit (this itself creates new changes you can commit again).' },
  'git.restored': { zh: '已恢复 {n} 个文件到「{subject}」', en: 'Restored {n} files to "{subject}"' },
  'tikz.title': { zh: '✏️ AI 画图（TikZ）', en: '✏️ AI Figure (TikZ)' },
  'tikz.desc': { zh: '描述想要的图（流程图/架构图/示意/几何图），AI 生成 TikZ；桌面端可编译预览，插入走 diff 审批。', en: 'Describe the figure; AI generates TikZ. Desktop compiles a live preview; insert goes through diff approval.' },
  'tikz.placeholder': { zh: '例：三阶段 pipeline：输入 → 特征提取（CNN） → 融合与输出，横向排布，箭头标注数据流', en: 'e.g. 3-stage pipeline: input → CNN features → fusion, horizontal, arrows labeled' },
  'tikz.generate': { zh: '生成中…', en: 'Generating…' },
  'tikz.generateBtn': { zh: '生成 TikZ', en: 'Generate TikZ' },
  'tikz.preview': { zh: '编译中…', en: 'Compiling…' },
  'tikz.previewBtn': { zh: '编译预览', en: 'Compile preview' },
  'tikz.insert': { zh: '插入到稿件（走审批）', en: 'Insert (via approval)' },
  'tikz.codeLabel': { zh: 'TikZ 代码（可编辑后预览/插入）：', en: 'TikZ code (editable):' },
  'tikz.noTexFile': { zh: '没有打开的 .tex 文件——请先在编辑器中打开目标文件', en: 'No .tex file open — open the target file first' },
  'img2tex.title': { zh: '🖼 图像转 LaTeX', en: '🖼 Image to LaTeX' },
  'img2tex.desc': { zh: '粘贴（Ctrl+V）/ 拖拽 / 选择公式或表格截图，AI 转换为可插入的 LaTeX（需视觉模型，如 GLM-4V / gpt-4o / Qwen-VL）。', en: 'Paste (Ctrl+V) / drop a formula or table screenshot; AI converts to LaTeX (needs a vision model).' },
  'img2tex.drop': { zh: '点击选择图片，或直接 Ctrl+V 粘贴截图', en: 'Click to pick an image, or Ctrl+V to paste' },
  'img2tex.kind.auto': { zh: '自动识别', en: 'Auto' },
  'img2tex.kind.formula': { zh: '数学公式', en: 'Formula' },
  'img2tex.kind.table': { zh: '表格', en: 'Table' },
  'img2tex.convert': { zh: '转换中…', en: 'Converting…' },
  'img2tex.convertBtn': { zh: '转换为 LaTeX', en: 'Convert to LaTeX' },
  'img2tex.clear': { zh: '清除图片', en: 'Clear' },
  'img2tex.result': { zh: '转换结果（可编辑）：', en: 'Result (editable):' },
  'img2tex.insert': { zh: '插入到稿件（走审批）', en: 'Insert (via approval)' },
  'img2tex.noTexFile': { zh: '没有打开的 .tex 文件——请先在右侧「编辑器」模式打开目标文件', en: 'No .tex file open.' },
  'img2tex.dialogLabel': { zh: '图像转 LaTeX', en: 'Image to LaTeX' },
  'img2tex.previewAlt': { zh: '待转换截图', en: 'Screenshot to convert' },
  'img2tex.insertLabel': { zh: '图像转 LaTeX（截图 → 公式/表格）', en: 'Image to LaTeX (screenshot → formula/table)' },
  'img2tex.pasteFailed': { zh: '读取剪贴板图片失败', en: 'Failed to read the pasted image' },
  'img2tex.readFailed': { zh: '读取图片失败', en: 'Failed to read the image' },
  'img2tex.convertFailed': { zh: '转换失败', en: 'Conversion failed' },
  // TikZ 画图对话框（错误提示与审批标签）
  'tikz.dialogLabel': { zh: 'AI 画图', en: 'AI figure' },
  'tikz.demoMode': { zh: '演示模式不支持画图——请先在设置中配置模型服务', en: 'Figure generation needs a model — configure a provider in Settings first' },
  'tikz.noTikz': { zh: '生成结果不含 tikzpicture——换个更具体的描述试试', en: 'The result has no tikzpicture — try a more specific description' },
  'tikz.previewFailed': { zh: '预览编译失败——检查 TikZ 代码（常见：缺少 tikzlibrary）', en: 'Preview compile failed — check the TikZ code (often a missing tikzlibrary)' },
  'tikz.defaultCaption': { zh: '示意图', en: 'Illustration' },
  'tikz.insertLabel': { zh: 'AI 画图（TikZ）插入', en: 'AI figure (TikZ) insert' },
  // 通用对话框动作（多个弹窗共用的取消键）
  'dlg.cancel': { zh: '取消', en: 'Cancel' },
  'cmd.stopReadAloud': { zh: '停止朗读', en: 'Stop reading aloud' },
  'console.pending': { zh: '尚未编译 —— Ctrl+Enter 或命令面板运行编译（浏览器形态为模拟引擎）', en: 'Not compiled yet — Ctrl+Enter or command palette (mock engine in browser)' },

  // Agent 面板
  'agent.title': { zh: 'AI 助手', en: 'AI Assistant' },
  'agent.pending': { zh: 'WS-D 集成待办', en: 'Pending WS-D integration' },
  'agent.provider': { zh: '当前模型服务', en: 'Active provider' },
  'agent.noProvider': { zh: '未配置', en: 'None configured' },

  // 中心区 PDF 视图与标签动作
  'center.editorTab': { zh: '编辑器', en: 'Editor' },
  'center.pdfTab': { zh: 'PDF', en: 'PDF' },
  'center.closePdf': { zh: '关闭', en: 'Close' },
  'center.split': { zh: '⿴ 分屏', en: '⿴ Split' },
  'center.splitHint': { zh: 'PDF 与编辑器并排显示（再点切回）', en: 'Show PDF and editor side by side' },
  'tab.polish': { zh: '润色', en: 'Polish' },
  'tab.polishTitle': { zh: 'AI 润色当前文件（diff 审批后落盘）', en: 'AI polish current file (applied after diff approval)' },
  'tab.history': { zh: '历史', en: 'History' },
  'tab.historyTitle': { zh: '快照历史（AI 修改自动创建，可恢复）', en: 'Snapshot history (auto-created on AI edits, restorable)' },
  // 编辑器分屏（v7.2.1 F2）与懒加载浮层
  'editor.splitOpen': { zh: '分屏编辑（同时查看两个文件）', en: 'Split editor (view two files at once)' },
  'editor.splitClose': { zh: '关闭分屏', en: 'Close split' },
  'editor.splitFile': { zh: '分屏文件', en: 'Split file' },
  // v7.9.1 标签右键菜单（添加到对话）
  'tabs.addToChat': { zh: '添加到对话', en: 'Add to conversation' },
  'tabs.close': { zh: '关闭标签', en: 'Close tab' },
  'toast.addedToChat': { zh: '已把 {name} 加入对话附件', en: 'Attached {name} to the conversation' },
  'dlg.loading': { zh: '加载中…', en: 'Loading…' },
  'dlg.loadFailed': { zh: '组件加载失败（{file}）—— 请确认对应工作流已合入。', en: 'Failed to load component ({file}) — check that its module is bundled.' },
  'toast.noAnnotations': { zh: '没有未处理的批注——先在 PDF 中标注，或经「审阅导入」导入导师批注', en: 'No open annotations — annotate in the PDF first, or import reviewer comments via Reviews import' },
  'pdf.quoteLabel': { zh: '引述：{citekey}（PDF 选中 → 稿件）', en: 'Quote: {citekey} (PDF selection → manuscript)' },

  // 设置对话框
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.tab.providers': { zh: '模型服务', en: 'Providers' },
  'settings.tab.appearance': { zh: '外观', en: 'Appearance' },
  'settings.tab.about': { zh: '关于', en: 'About' },
  'settings.addProvider': { zh: '新增服务', en: 'Add provider' },
  'settings.empty': { zh: '尚无模型服务，请新增。', en: 'No providers yet.' },
  'settings.field.label': { zh: '名称', en: 'Label' },
  'settings.field.baseUrl': { zh: '接口地址', en: 'Base URL' },
  'settings.field.apiKey': { zh: 'API 密钥', en: 'API key' },
  'settings.field.model': { zh: '模型', en: 'Model' },
  'settings.modelsFetched': { zh: '已获取 {n} 个模型（点击填入）', en: 'Fetched {n} models (click to fill)' },
  'settings.field.tier': { zh: '档位', en: 'Tier' },
  'settings.tier.cheap': { zh: '经济', en: 'Cheap' },
  'settings.tier.flagship': { zh: '旗舰', en: 'Flagship' },
  'settings.activate': { zh: '激活', en: 'Activate' },
  'settings.active': { zh: '已激活', en: 'Active' },
  'settings.edit': { zh: '编辑', en: 'Edit' },
  'settings.delete': { zh: '删除', en: 'Delete' },
  'settings.save': { zh: '保存', en: 'Save' },
  'settings.cancel': { zh: '取消', en: 'Cancel' },
  'settings.deleteConfirm': { zh: '确认删除该模型服务？', en: 'Delete this provider?' },
  'settings.unnamedProvider': { zh: '未命名服务', en: 'Unnamed provider' },
  'settings.embedding': { zh: '语义嵌入模型（可选）', en: 'Embedding model (optional)' },
  'settings.engine': { zh: 'Agent 引擎', en: 'Agent engine' },
  'settings.engine.auto': { zh: '自动（优先 API）', en: 'Auto (API first)' },
  'settings.engine.api': { zh: '仅 API 服务', en: 'API only' },
  'settings.engine.cli': { zh: '仅 CLI agent', en: 'CLI agent only' },
  // v7.5.0：Agent 会话设置（预算 / 会话亲和缓存）+ 语音输入（此前硬编码中文）
  'settings.sessionBudget': { zh: '会话 token 预算（0 = 不限）', en: 'Session token budget (0 = unlimited)' },
  'settings.promptCacheKey': { zh: '会话亲和缓存（prompt_cache_key）', en: 'Session affinity cache (prompt_cache_key)' },
  'settings.promptCacheKeyHint': {
    zh: '同一会话使用稳定缓存键，支持前缀缓存的服务商可降低长会话费用',
    en: 'Stable per-session cache key; providers with prefix caching charge less for long sessions',
  },
  'settings.speech': { zh: '语音输入（Whisper 本地识别）', en: 'Voice input (local Whisper)' },
  'settings.speech.off': { zh: '关闭', en: 'Off' },
  'settings.speech.auto': { zh: '自动', en: 'Auto' },
  'settings.speech.zh': { zh: '中文', en: '中文' },
  'settings.speech.en': { zh: 'English', en: 'English' },
  'settings.cliTitle': { zh: 'CLI agent 桥（codex / claude 等本地代理）', en: 'CLI agent bridge (codex / claude, local)' },
  'settings.cliEnable': { zh: '启用', en: 'Enable' },
  'settings.cliLabel': { zh: '显示名称', en: 'Label' },
  'settings.cliCommand': { zh: '命令（如 codex / claude / 绝对路径）', en: 'Command (codex / claude / absolute path)' },
  'settings.cliTemplate': { zh: '参数模板（{prompt} 为提示词占位）', en: 'Args template ({prompt} = prompt)' },
  'settings.cliTest': { zh: '检测 (--version)', en: 'Probe (--version)' },
  'settings.cliTestOk': { zh: '✓ 命令可用：{v}', en: '✓ command available: {v}' },
  'settings.cliTestFail': { zh: '✗ {e}', en: '✗ {e}' },
  'settings.enginePreference': { zh: 'LaTeX 引擎', en: 'LaTeX engine' },
  'settings.engineAuto': { zh: '自动（优先 Tectonic）', en: 'Auto (Tectonic first)' },
  'settings.livePreview': { zh: '实时预览', en: 'Live preview' },
  'settings.livePreviewHint': { zh: '编辑后 0.5 秒自动重编（需开启自动编译）', en: 'Recompile 0.5s after edit (needs auto-compile)' },
  'settings.cliHint': {
    zh: '仅桌面版可用。一次性进程调用：输出完成后整段返回（伪流式），不支持中途停止与工具协议；浏览器形态自动回落 API/演示。',
    en: 'Desktop only. One-shot process call: output returns whole (pseudo-streaming); no mid-run stop or tool protocol; browser falls back to API/demo.',
  },
  'settings.cliUnavailable': { zh: '当前为浏览器形态，CLI 桥不可用（桌面版可启用）', en: 'Browser form detected — CLI bridge unavailable (desktop only)' },
  'settings.embeddingPlaceholder': {
    zh: '如 text-embedding-3-small / embedding-3，留空则用本地哈希嵌入',
    en: 'e.g. text-embedding-3-small / embedding-3; blank uses local hash embeddings',
  },
  'settings.embeddingHint': {
    zh: '配置后知识检索走当前激活服务的 /embeddings 端点（需该服务支持）；调用失败会自动回退本地哈希嵌入。',
    en: 'When set, knowledge retrieval uses the active provider\'s /embeddings endpoint (must be supported); failures fall back to local hash embeddings.',
  },
  'settings.theme': { zh: '主题', en: 'Theme' },
  'settings.theme.dark': { zh: '深色', en: 'Dark' },
  'settings.theme.light': { zh: '浅色', en: 'Light' },
  'settings.language': { zh: '语言', en: 'Language' },
  'settings.lang.zh': { zh: '简体中文' },
  'settings.lang.en': { zh: 'English', en: 'English' },

  // 关于
  'about.desc': { zh: 'AI 原生的一站式科研写作工作站', en: 'AI-native scholarly writing workstation' },
  'about.designDoc': { zh: '设计文档：DESIGN.md（仓库根）', en: 'Design doc: DESIGN.md (repo root)' },

  // 自动更新横幅（UpdateBar：类 Codex 三段——静默检查 / 后台下载 / 重启即完成）
  'update.available': { zh: '发现新版本 v{version}', en: 'New version v{version} available' },
  'update.downloading': { zh: '正在后台下载…（{percent}%）', en: 'Downloading in background… ({percent}%)' },
  'update.downloadingIndeterminate': { zh: '正在后台下载…', en: 'Downloading in background…' },
  'update.ready': {
    zh: '✓ 新版本 v{version} 已就绪 — 重启即可完成更新',
    en: '✓ v{version} is ready — restart to finish updating',
  },
  'update.restart': { zh: '立即重启', en: 'Restart now' },
  'update.installed': { zh: '✓ v{version} 已安装 — 重启应用即完成升级', en: '✓ v{version} installed — restart to finish' },
  'update.restartNow': { zh: '立即重启', en: 'Restart now' },
  'update.confirmUpdate': { zh: '立即更新并重启', en: 'Update & restart now' },
  'update.restoreHint': {
    zh: '更新会自动重启应用；会话、项目与文献库状态将自动恢复',
    en: 'The app restarts automatically; sessions, projects and library are restored',
  },
  'update.updatedRestored': {
    zh: '已更新到 v{version}，会话与项目状态已恢复',
    en: 'Updated to v{version} — sessions and projects restored',
  },
  'update.later': { zh: '稍后', en: 'Later' },
  'update.restarting': { zh: '正在重启…', en: 'Restarting…' },
  'update.error.browser': { zh: '当前为浏览器形态，不支持应用内更新', en: 'In-app updates are unavailable in the browser form' },
  'update.error.notReady': { zh: '更新尚未就绪，无法安装', en: 'The update is not ready to install yet' },
  'update.error.installFailed': { zh: '安装更新失败，请稍后重试', en: 'Failed to install the update — please try again later' },
  'update.error.signKeyMissing': {
    zh: '更新签名密钥未配置：请等待发布流程生成密钥并填入 tauri.conf.json 后重试',
    en: 'Update signing key is not configured — wait for the release pipeline to generate it, fill it into tauri.conf.json, then retry',
  },
  'update.error.signVerify': { zh: '更新包签名校验失败', en: 'Update package signature verification failed' },
  'update.error.network': { zh: '网络请求失败，请检查网络后重试', en: 'Network request failed — check your connection and retry' },
  'update.error.checkFailed': { zh: '检查更新失败', en: 'Update check failed' },

  // 命令面板动作
  'cmd.newProject': { zh: '新建项目（演示重置）', en: 'New project (demo reset)' },
  'cmd.newFile': { zh: '新建文件', en: 'New file' },
  'cmd.save': { zh: '保存当前文件', en: 'Save current file' },
  'cmd.toggleTheme': { zh: '切换深色/浅色主题', en: 'Toggle dark/light theme' },
  'cmd.globalSearch': { zh: '全局搜索（全项目）', en: 'Search across project' },
  'cmd.insertImage': { zh: '插入图片', en: 'Insert image' },
  'cmd.insertCitation': { zh: '插入引用（从文献库选择）', en: 'Insert citation (from library)' },
  'cmd.backup': { zh: '备份与恢复（全量数据导出/导入）', en: 'Backup & restore (full data export/import)' },
  'cmd.checkUpdate': { zh: '检查应用更新', en: 'Check for updates' },
  'cmd.importReviews': { zh: '导入真实审稿意见（Word/PDF/文本 → Rebuttal）', en: 'Import real reviews (Word/PDF/text → Rebuttal)' },
  'cmd.agentPlan': { zh: '计划模式：先规划后逐步执行（复杂任务）', en: 'Plan mode: plan first, then execute step by step' },
  'cmd.agentResearch': { zh: '并行研究：拆分子任务多角度调研', en: 'Parallel research: split and investigate from multiple angles' },
  'cmd.agentUsage': { zh: 'Agent 用量与成本', en: 'Agent usage & cost' },
  'cmd.styleReport': { zh: '风格分析报告（长句/被动语态/可读性）', en: 'Style report (long sentences/passive/readability)' },
  'cmd.normalizeDoc': { zh: '格式规范化（智能引号/破折号/空格一键清理）', en: 'Normalize document (smart quotes/dashes/spaces)' },
  'cmd.mathPalette': { zh: '数学符号面板（希腊字母/运算符/箭头，点击插入）', en: 'Math symbol palette (Greek/operators/arrows, click to insert)' },
  'cmd.quickCite': { zh: '快速添加引用（粘贴 DOI / arXiv ID → 自动入库）', en: 'Quick add citation (paste DOI / arXiv ID → auto import)' },
  'cmd.helpPanel': { zh: '使用帮助（常见任务指引）', en: 'Help (common task guide)' },
  'cmd.collabMerge': { zh: '协作补丁（CRDT 离线合并，无需服务器）', en: 'Collab patch (offline CRDT merge, no server)' },
  'cmd.citeSuggest': { zh: '智能引用推荐（当前段落 → 文献库检索）', en: 'Smart citation suggest (paragraph → library search)' },
  'research.taskPrompt': { zh: '研究任务（将拆为多个子任务并行调研）', en: 'Research task (will be split into parallel sub-tasks)' },
  'plan.taskPrompt': { zh: '描述任务（agent 将先给出执行计划）', en: 'Describe the task (agent will plan first)' },
  'cmd.aiFix': { zh: 'AI 修复编译错误（诊断 → diff 审批）', en: 'AI fix compile errors (diagnostics → diff approval)' },
  'cmd.exportDocx': { zh: '导出 Word (.docx)', en: 'Export Word (.docx)' },
  'cmd.externalDiff': { zh: '对比外部版本（导师改稿 vs 当前稿）', en: 'Compare external version (advisor\'s tex vs current)' },
  'cmd.openComments': { zh: '打开稿件批注面板', en: 'Open manuscript comments' },
  'cmd.focusMode': { zh: '切换专注模式（隐藏侧栏，沉浸写作）', en: 'Toggle focus mode' },
  'cmd.writingStats': { zh: '写作统计（字数/目标/连续天数）', en: 'Writing statistics' },
  'cmd.spellcheck': { zh: '切换拼写与用词检查', en: 'Toggle spell & usage check' },
  'nav.comments': { zh: '批注', en: 'Comments' },
  'nav.home': { zh: '首页', en: 'Home' },
  'knowledge.memory': { zh: '记忆', en: 'Memory' },
  'cmd.settings': { zh: '打开设置', en: 'Open settings' },
  'cmd.focusTree': { zh: '聚焦文件树', en: 'Focus file tree' },
  'cmd.clearLog': { zh: '清空编译日志', en: 'Clear compile log' },
  'cmd.compile': { zh: '编译项目', en: 'Compile project' },
  'cmd.template': { zh: '从模板新建项目（6 套起步模板，含中文 ctex）', en: 'New project from template (6 starter templates, incl. Chinese ctex)' },
  'cmd.importZip': { zh: '导入 Overleaf / LaTeX 项目 zip', en: 'Import Overleaf / LaTeX project zip' },
  'cmd.exportZip': { zh: '导出项目 zip（含 figures 图片）', en: 'Export project zip (incl. figures)' },
  'cmd.exportBib': { zh: '导出文献库为 BibTeX (.bib)', en: 'Export library as BibTeX (.bib)' },
  'cmd.exportBibCited': { zh: '只导出稿件引用的文献 (.bib)', en: 'Export only cited references (.bib)' },
  'cmd.importBibtex': { zh: '导入 BibTeX 到文献库', en: 'Import BibTeX into library' },
  'cmd.fetchMetadata': { zh: '按 DOI / arXiv ID 抓取文献元数据', en: 'Fetch metadata by DOI / arXiv ID' },
  'cmd.openPdf': { zh: '打开本地 PDF 阅读（标注 + 选中即问）', en: 'Open local PDF (annotations + ask-on-selection)' },
  'cmd.discover': { zh: '文献发现：检索 arXiv + Crossref 并一键入库', en: 'Discover papers: search arXiv + Crossref, add in one click' },
  'cmd.agentPolish': { zh: 'AI 润色当前文件（diff 审批后落盘）', en: 'AI polish current file (applied after diff approval)' },
  'cmd.agentDraft': { zh: 'AI 起草新章节（diff 审批后落盘）', en: 'AI draft a new section (applied after diff approval)' },
  'cmd.history': { zh: '查看当前文件快照历史（可恢复）', en: 'View snapshot history (restorable)' },
  'cmd.newSession': { zh: '新建 Agent 会话', en: 'New agent session' },
  'cmd.simulateToolEdit': { zh: '演示：模拟 agent 调用 tex.edit（阻塞式 diff 审批闭环）', en: 'Demo: simulate agent tex.edit (blocking diff-approval loop)' },
  'cmd.submitPackage': { zh: '投稿打包：准备提交材料（切到投稿页签）', en: 'Submission packaging: prepare materials (open Submit tab)' },
  'cmd.submitVenue': { zh: '设置目标期刊 / 会议（venue）', en: 'Set target journal / conference (venue)' },
  'cmd.openNotes': { zh: '打开笔记面板', en: 'Open notes panel' },
  'cmd.openGlossary': { zh: '打开术语面板', en: 'Open glossary panel' },
  'hint.project': { zh: '项目', en: 'Project' },
  'hint.file': { zh: '文件', en: 'File' },
  'hint.compile': { zh: '编译', en: 'Compile' },
  'hint.app': { zh: '应用', en: 'App' },
  'hint.view': { zh: '视图', en: 'View' },
  'hint.library': { zh: '文献', en: 'Library' },
  'hint.reading': { zh: '阅读', en: 'Reading' },
  'hint.agent': { zh: 'Agent', en: 'Agent' },
  'hint.version': { zh: '版本', en: 'Version' },
  'hint.submit': { zh: '投稿', en: 'Submission' },
  'hint.knowledge': { zh: '知识', en: 'Knowledge' },
  'prompt.newFilePath': { zh: '新文件路径（如 sections/notes.tex）', en: 'New file path (e.g. sections/notes.tex)' },
  'toast.noTexEntry': { zh: '未找到可编译的 .tex 入口文件', en: 'No compilable .tex entry file found' },
  'toast.needTexFile': { zh: '请先打开一个 .tex 文件再演示', en: 'Open a .tex file first to run the demo' },
  'toast.noDemoChange': {
    zh: '当前文件没有可演示的修改——试试写入含 "very / in order to / utilize" 等冗余表达的英文文本',
    en: 'Nothing to demo in this file — try English text with wordy phrases like "very / in order to / utilize"',
  },
  'approval.demoEditLabel': { zh: 'AI 修改稿件（tex.edit · 模拟）', en: 'AI edit (tex.edit · simulated)' },
  'approval.demoEditVia': { zh: '演示命令（未配置模型时亦可体验完整审批闭环）', en: 'Demo command (full approval loop without a configured model)' },
  'toast.verdict': { zh: '模型将收到裁决：{note}', en: 'Model receives verdict: {note}' },

  // Toast
  'toast.projectReset': { zh: '已重置为演示项目', en: 'Demo project loaded' },
  'toast.saved': { zh: '已自动保存（所有修改即时持久化）', en: 'Auto-saved (changes persist instantly)' },
  'hint.edit': { zh: '编辑', en: 'Edit' },
  'hint.comments': { zh: '批注', en: 'Comments' },
  'cmd.reopenPdf': { zh: '重新打开上次编译的 PDF', en: 'Reopen last compiled PDF' },
  'toast.noLastPdf': { zh: '还没有编译产物，请先编译', en: 'No compiled PDF yet — compile first' },
  'cmd.manageProjects': { zh: '切换 / 管理项目', en: 'Switch / manage projects' },
  'cmd.insertTable': { zh: '插入表格（可视化编辑器）', en: 'Insert table (visual editor)' },
  'toast.fileCreated': { zh: '文件已创建', en: 'File created' },
  'toast.invalidPath': { zh: '无效的文件路径', en: 'Invalid file path' },
  'toast.zipImported': {
    zh: '已导入项目（入口 {entry}，{count} 个文本文件{skipped}）',
    en: 'Project imported (entry {entry}, {count} text files{skipped})',
  },
  'toast.zipSkipped': { zh: '，跳过 {count} 个二进制文件', en: ', {count} binary files skipped' },
  'toast.zipImportFailed': { zh: '导入失败：{reason}', en: 'Import failed: {reason}' },
  // 项目 ↔ 本地目录磁盘同步（打开/切换项目时）
  'toast.diskSync': {
    zh: '已从本地文件夹并入 {merged} 个文件，{updated} 个以磁盘新版本为准',
    en: 'Merged {merged} file(s) from the local folder; {updated} taken from newer disk versions',
  },

  // 模板向导
  'wiz.title': { zh: '新建项目（模板向导）', en: 'New project (template wizard)' },
  'wiz.fieldTitle': { zh: '标题', en: 'Title' },
  'wiz.fieldAuthors': { zh: '作者', en: 'Authors' },
  'wiz.defaultTitle': { zh: '未命名论文', en: 'Untitled paper' },
  'wiz.defaultAuthors': { zh: '作者姓名', en: 'Author name' },
  'wiz.defaultAbstract': { zh: '（待填写摘要）', en: '(Abstract to be filled)' },
  'wiz.cancel': { zh: '取消', en: 'Cancel' },
  'wiz.create': { zh: '创建项目', en: 'Create project' },
  'wiz.created': { zh: '已按模板「{name}」创建项目', en: 'Project created from template "{name}"' },

  // 引用面板
  'cites.bodyCited': { zh: '正文引用 {n}', en: '{n} cited in text' },
  'cites.missingBib': { zh: 'bib 缺失 {n}', en: '{n} missing in bib' },
  'cites.missingLib': { zh: '库缺失 {n}', en: '{n} missing in library' },
  'cites.importFrom': { zh: '从 {path} 导入文献库', en: 'Import library from {path}' },
  'cites.imported': { zh: '已从 {path} 导入 {n} 条{errors}', en: 'Imported {n} entries from {path}{errors}' },
  'cites.importErrors': { zh: '（{n} 条提示）', en: ' ({n} warnings)' },
  'cites.empty': { zh: '正文暂无 \\cite 引用', en: 'No \\cite references in text yet' },
  'cites.inBib': { zh: 'bib ✓', en: 'bib ✓' },
  'cites.notInBib': { zh: 'bib ✗', en: 'bib ✗' },
  'cites.inLib': { zh: '文献库 ✓', en: 'library ✓' },
  'cites.notInLib': { zh: '文献库 ✗', en: 'library ✗' },

  // 大纲面板
  'outline.empty': { zh: '未发现章节（\\section / \\subsection）', en: 'No sections found (\\section / \\subsection)' },

  // 快照历史对话框
  'snap.title': { zh: '快照历史 · 全项目', en: 'Snapshot history · whole project' },
  'snap.empty': {
    zh: '暂无快照。采纳 AI 修改时会自动创建快照（设计约定：一切 AI 修改可回滚）。',
    en: 'No snapshots yet. They are created automatically when AI edits are accepted (all AI edits are reversible by design).',
  },
  'snap.restore': { zh: '恢复此版本', en: 'Restore' },
  'snap.restoreConfirm': { zh: '恢复', en: 'Restore' },
  'snap.restoreConfirmTitle': { zh: '恢复「{path}」到此版本？当前内容将被该快照覆盖，且不会自动备份（不可撤销）。', en: 'Restore "{path}" to this snapshot? Current content is overwritten and is not backed up automatically (cannot be undone).' },
  'snap.close': { zh: '关闭', en: 'Close' },
  'snap.currentFile': { zh: '当前文件', en: 'current file' },

  // 首启引导卡
  'onboarding.title': { zh: '开始使用 Lemma', en: 'Get started with Lemma' },
  'onboarding.subtitle': {
    zh: '三步跑通第一条工作流：导入 → 编译 → 问 Agent',
    en: 'Three steps to your first workflow: import → compile → ask the agent',
  },
  'onboarding.stepImport': { zh: '导入项目', en: 'Import a project' },
  'onboarding.stepImportDesc': {
    zh: '导入 Overleaf/LaTeX zip，或从模板新建',
    en: 'Import an Overleaf/LaTeX zip, or start from a template',
  },
  'onboarding.stepImportBtn': { zh: '导入 zip', en: 'Import zip' },
  'onboarding.stepImportAlt': { zh: '从模板新建', en: 'From template' },
  'onboarding.stepCompile': { zh: '编译项目', en: 'Compile the project' },
  'onboarding.stepCompileDesc': {
    zh: 'Ctrl+Enter 或命令面板运行编译，查看 PDF 产出',
    en: 'Ctrl+Enter or the command palette compiles and previews the PDF',
  },
  'onboarding.stepCompileBtn': { zh: '立即编译', en: 'Compile now' },
  'onboarding.stepAgent': { zh: '问 Agent', en: 'Ask the agent' },
  'onboarding.stepAgentDesc': {
    zh: '右侧 Agent 面板可润色、起草、跑工作流',
    en: 'The agent panel polishes, drafts, and runs workflows',
  },
  'onboarding.stepAgentBtn': { zh: '发一条示例提问', en: 'Send a sample question' },
  'onboarding.agentSampleQuestion': {
    zh: '请总结当前论文的核心贡献，并指出最需要补强的一处论证。',
    en: 'Summarize the core contributions of the current paper and point out the weakest argument to strengthen.',
  },
  'onboarding.dismiss': { zh: '不再显示', en: "Don't show again" },

  // 欢迎导览（WelcomeTour：首启全屏 4 页 carousel）
  'tour.skip': { zh: '跳过引导', en: 'Skip the tour' },
  'tour.prev': { zh: '上一步', en: 'Back' },
  'tour.next': { zh: '下一步', en: 'Next' },
  'tour.start': { zh: '开始使用', en: 'Get started' },
  'tour.later': { zh: '先看看', en: 'Explore first' },
  'tour.page1.title': { zh: '欢迎来到 Lemma', en: 'Welcome to Lemma' },
  'tour.page1.desc': {
    zh: 'AI 原生的一站式论文工作站——写作、编译、文献与智能体，在同一工作区完成一篇论文的完整生命周期。',
    en: 'An AI-native, all-in-one workstation for papers — writing, compiling, references, and agents in a single workspace for the full life cycle of a paper.',
  },
  'tour.page2.title': { zh: '写作与编译', en: 'Write & compile' },
  'tour.page2.desc': {
    zh: '无需预装 LaTeX：点一次编译即自动配置内置 Tectonic 引擎；产出 PDF 与源码经 SyncTeX 双向跳转。',
    en: 'No LaTeX install needed: one click auto-configures the bundled Tectonic engine; the PDF and source stay linked both ways via SyncTeX.',
  },
  'tour.page3.title': { zh: 'AI 深度参与', en: 'AI, deeply involved' },
  'tour.page3.desc': {
    zh: '7 条内置工作流覆盖起草、润色与投稿；写级修改一律经 diff 审批后落盘；引用幻觉自动拦截。',
    en: 'Seven built-in workflows cover drafting, polishing, and submission; every write-level edit lands only after diff approval; hallucinated citations are intercepted.',
  },
  'tour.page4.title': { zh: '三步上手', en: 'Three steps to start' },
  'tour.page4.desc': {
    zh: '首页的新手任务清单会自动检测进度——跑通这三步，Lemma 就是你的了。',
    en: 'The getting-started checklist on Home tracks progress automatically — finish these three steps and Lemma is yours.',
  },
  'tour.step1.title': { zh: '创建项目', en: 'Create a project' },
  'tour.step1.desc': { zh: '从模板新建，或导入 Overleaf zip', en: 'Start from a template or import an Overleaf zip' },
  'tour.step2.title': { zh: '写作并编译', en: 'Write & compile' },
  'tour.step2.desc': { zh: '中央左写右预览，实时编译不跳页', en: 'Write left, live-preview right — no page jumps' },
  'tour.step3.title': { zh: '问 AI', en: 'Ask the AI' },
  'tour.step3.desc': { zh: '右侧直接说需求——润色、找文献、改稿、修错（支持语音）', en: 'Just ask — polish, find refs, edit, fix errors (voice supported)' },
  'tour.imgAlt.writing': { zh: '写作视图截图', en: 'Writing view screenshot' },
  'tour.imgAlt.outline': { zh: '编译与 PDF 预览截图', en: 'Compile & PDF preview screenshot' },
  'tour.imgAlt.reviewer': { zh: 'AI 工作流截图', en: 'AI workflow screenshot' },
  'tour.pageOf': { zh: '第 {n} / {total} 页', en: 'Page {n} of {total}' },

  // 新手任务清单（GettingStarted：Dashboard 顶部，自动检测完成态）
  'gs.title': { zh: '上手 Lemma', en: 'Get started' },
  'gs.subtitle': { zh: '完成这几个动作，跑通第一条工作流', en: 'Finish these actions to run your first workflow' },
  'gs.progress': { zh: '{n} / 5', en: '{n} / 5' },
  'gs.collapse': { zh: '收起', en: 'Collapse' },
  'gs.expand': { zh: '展开新手清单', en: 'Show checklist' },
  'gs.dismiss': { zh: '不再显示', en: "Don't show again" },
  'gs.done': { zh: '已完成', en: 'Done' },
  'gs.stepProject.title': { zh: '创建或导入项目', en: 'Create or import a project' },
  'gs.stepProject.desc': {
    zh: '从模板新建，或导入 Overleaf / LaTeX 项目 zip',
    en: 'Start from a template, or import an Overleaf / LaTeX project zip',
  },
  'gs.stepProject.done': { zh: '已有项目', en: 'Project ready' },
  'gs.stepProject.btn': { zh: '从模板新建', en: 'New from template' },
  'gs.stepProject.alt': { zh: '导入 zip', en: 'Import zip' },
  'gs.stepWrite.title': { zh: '写下第一段内容', en: 'Write your first paragraph' },
  'gs.stepWrite.desc': {
    zh: '在编辑器里打开任意文件，写点什么或改一句',
    en: 'Open any file in the editor and write or tweak something',
  },
  'gs.stepWrite.btn': { zh: '去写作', en: 'Start writing' },
  'gs.stepCompile.title': { zh: '完成一次编译', en: 'Run your first compile' },
  'gs.stepCompile.desc': {
    zh: 'Ctrl+Enter 或点按钮编译，首次会自动配置引擎',
    en: 'Ctrl+Enter or the button compiles; the engine auto-configures on first run',
  },
  'gs.stepCompile.btn': { zh: '立即编译', en: 'Compile now' },
  'gs.stepChat.title': { zh: '和 AI 对话一次', en: 'Chat with the AI once' },
  'gs.stepChat.desc': {
    zh: '右侧 Agent 面板可以润色、起草、跑工作流（未配置模型也有演示模式）',
    en: 'The agent panel on the right polishes, drafts, and runs workflows (demo mode works without a model)',
  },
  'gs.stepChat.btn': { zh: '问一个问题', en: 'Ask a question' },
  'gs.stepProvider.title': { zh: '激活 AI（配置模型服务）', en: 'Activate AI (configure a provider)' },
  'gs.stepProvider.desc': {
    zh: '在设置中添加任意 OpenAI 兼容服务；不配置也可用内置演示模式',
    en: 'Add any OpenAI-compatible service in Settings; the built-in demo mode works without one',
  },
  'gs.stepProvider.btn': { zh: '去配置', en: 'Configure' },

  // 内置 TeX 引擎（Tectonic）自动下载（texSetup 状态机；编译日志行在 compileAction 的 L 字典）
  'texsetup.downloading': { zh: '正在下载 Tectonic（约 30MB）…', en: 'Downloading Tectonic (~30 MB)…' },
  'texsetup.ready': {
    zh: '内置 Tectonic 已就绪（缓存于应用数据目录）',
    en: 'Bundled Tectonic is ready (cached in the app data directory)',
  },
  'texsetup.error': { zh: '内置 Tectonic 获取失败：{reason}', en: 'Failed to get the bundled Tectonic: {reason}' },
  'texsetup.browserUnsupported': {
    zh: '浏览器形态无法内置编译器，请使用桌面版',
    en: 'The browser build cannot bundle a compiler; please use the desktop app',
  },
  'texsetup.firstRun': {
    zh: '首次编译将联网获取宏包，稍慢属正常',
    en: 'The first compile fetches TeX packages online and may be slower',
  },

  // 产品代号（暂不提供英文，验证 zh 回退）
  'app.codename': { zh: '论文 IDE' },
};

export function t(key: string, lang: Language = 'zh', vars?: Record<string, string | number>): string {
  const entry = dict[key];
  let out = entry ? (entry[lang] ?? entry.zh) : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}

/** 组件内使用：跟随设置语言的翻译函数（支持 {name} 插值变量）。 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useSettingsStore((s) => s.language);
  return (key: string, vars?: Record<string, string | number>) => t(key, lang, vars);
}

/**
 * 注册本地消息字典（供并行开发的面板使用）：模块被加载即合并进全局字典。
 * 已存在的键不会被覆盖（壳内字典优先）；返回原字典以便面板保留类型与默认值。
 * 纯新增 API，不影响 t/useT 的既有行为。
 */
export function defineMessages<T extends MessageDict>(local: T): T {
  for (const [key, entry] of Object.entries(local)) {
    if (!dict[key]) dict[key] = entry;
  }
  return local;
}

/** 测试与调试用：读取全局字典快照（只读视图）。 */
export function getDict(): Readonly<MessageDict> {
  return dict;
}
