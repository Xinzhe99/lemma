# ScholarForge

> AI 原生的一站式科研写作工作站 —— "IDE for Papers"

设计文档见 [DESIGN.md](./DESIGN.md)。

## 仓库结构（npm workspaces monorepo）

```
apps/desktop        # 桌面应用（Vite + React；Tauri 壳后续接入，见 src/platform）
packages/shared     # 跨包共享领域类型
packages/editor     # WS-A LaTeX 编辑器（CodeMirror 6）
packages/compile    # WS-B 编译服务（引擎抽象 / log 解析 / SyncTeX / 模板）
packages/library    # WS-C 文献库与 PDF 阅读器
packages/agent-hub  # WS-D Agent 中枢（Provider 适配 / 工具注册 / 工作流引擎）
packages/knowledge  # WS-E 知识底座（RAG / Context Pack / 术语与风格）
```

## 开发

```bash
npm install         # 根目录一次安装全部工作区依赖
npm run dev         # 启动桌面应用（浏览器形态）
npm test            # 全部包的单元测试
npm run typecheck   # 全部包类型检查
npm run build       # 构建应用
```

## 已实现（v0.6.0 —— 完整研究工作流）

- **引用插入向导**：从文献库搜索/多选插入 \cite（命令面板「插入引用」或标签栏「引用」按钮）；**智能推荐**基于当前段落语义检索自动推荐相关文献（混合检索，含回退策略）
- **快照 diff 对比**：快照历史任意版本一键「对比当前」，增删行可视化后再决定是否恢复
- **PDF 阅读器增强**：大纲（书签）导航 + 连续滚动模式（懒渲染虚拟化，视口同步页码）
- **RIS 导入**：EndNote/Zotero 导出的 RIS 一键入库（自动补 citekey）
- **全量备份/恢复**：文献/笔记/标注/项目/工作区一键导出 JSON（**API key 永不入备份**），恢复含数据摘要确认
- **编辑器字号**：Ctrl+=/-/0 调节（10–24px，持久化）
- **W12 相关工作综述工作流**（第 7 个内置）：库内检索分组 → 分组叙事草稿（引用全部本地可验证）→ 检查点 → 经 diff 审批插入稿件
- **投稿 deadline 追踪**：目标 venue 设截止日期，倒计时三档预警（<3 天红色）
- 修复：BibTeX/RIS 导入 citekey 消歧顺序错误（每次误加 -a 后缀）

## 已实现（v0.5.0 —— 大厂交付标准）

- **数学公式实时预览**：悬停 `$...$`/`$$...$$`/`\(...\)`/`\[...\]` 即出 KaTeX 渲染浮层（缓存加速，错误回显原始 TeX）
- **BibTeX 专用语法高亮**（条目/键/字段/值/注释分层）；**插图向导**（规范化路径 + 生成 includegraphics 代码 + 自动补 graphicx + 桌面形态真实写入图片）
- **SyncTeX 双向同步**：真实编译产出同步数据，状态栏「⇄ PDF」源码定位 PDF；PDF 点击回跳源码行
- **全项目搜索**（Ctrl+Shift+F）：跨文件实时搜索、大小写/整词开关、分组高亮、点击跳转；**W10 自检报告联动投稿工作台**（一键跳转 + 位置引用可点 + 复制修复建议）
- **根级 ErrorBoundary**（崩溃不再白屏）；应用内对话框全面替代 window.prompt/confirm（Tauri WKWebView 兼容）
- **发布工程**：GitHub Actions CI（web + cargo-check 双 job）、CHANGELOG、版本统一 0.5.0、Tauri bundle 启用（可打安装包）

## 已实现（v0.4 —— 生产可用性）

- **真实编译与 PDF 应用内预览**：桌面形态自动探测 Tectonic / latexmk（用户机器 TeX Live 2024 即开即用），项目文件物化→编译→产物 base64 读回→自动打开 PDF 预览；首个 error 诊断自动跳转源码行；不可用时回退模拟引擎并说明
- **可视化表格编辑器**：图形网格编辑→实时生成 tabular 代码（round-trip 解析/转义/注释容忍）→插入编辑器光标处（标签栏「表格」按钮或命令面板）
- **多项目管理**：保存/切换/重命名/复制/删除多个论文项目（上限 20，损坏数据安全回退），顶栏项目名即入口；打开切换器时自动留当前项目崩溃恢复快照

## 已实现（v0.3 —— Codex 风格亮色界面 + 生产力特性）

- 全新明亮主题（默认）：白底极简、黑色药丸主按钮、青绿强调、hairline 边框与柔和阴影；暗色主题完整保留可切换；编辑器/diff/Agent 面板全量跟随双主题
- 编辑器状态栏：字数（CJK+拉丁混合统计）/行数/光标行列/自动保存状态（脏标记 + 写盘时间）
- Ctrl+P 快速打开文件（模糊匹配）、Ctrl+/ 快捷键速查面板
- LaTeX 质量检查：环境配对/花括号平衡/悬空 
ef/未知 \cite/TODO 六条规则的实时问题列表（点击跳转行）
- 知识导出：全库导出 BibTeX、PDF 标注一键导出 Markdown、批量转卡片

## 已实现（v0.2）

### 桌面形态（Tauri 2，本机构建通过）
- `npm run desktop:dev` / `desktop:build`（apps/desktop）；Rust 桥实现本地虚拟文件系统、密钥存取与 `proc_run` 进程桥（详见 TAURI.md）
- Tauri 环境自动切换真实 Tectonic 编译（不可用时回退模拟引擎并提示）；本机 TeX Live 可经 latexmk 接入

### 浏览器/桌面通用

- LaTeX 编辑器（语法高亮 / 大纲跳转 / \cite 补全 / diff 视图）
- 编译流水线（MockEngine 演示；Tectonic/latexmk 引擎待 Tauri 桥接）+ 6 套模板（含中文 ctex）+ Overleaf zip 一键导入
- 文献库：BibTeX / DOI / arXiv 导入，发现检索（arXiv+Crossref 聚合去重一键入库），智能过滤，BM25+向量混合知识检索（可配语义嵌入，失败自动回退本地）
- PDF 阅读器：四色语义标注，按文件持久化
- Agent 中枢：Context Pack 注入流式对话（真实 provider 可调用论文域工具，多轮回填）、引用幻觉核查护栏、5 个内置工作流（三审稿人仿真 → 结构化审稿面板 → Rebuttal 起草一键衔接）
- AI 改稿审批闭环：润色/起草/选中文本润色 → diff 审批卡 → 采纳前强制快照 → 历史时间线一键恢复
- 选中即问：编辑器与 PDF 阅读器选中文本浮动工具条（润色/解释/翻译/找文献）
- 投稿工作台：15 个内置 venue 档案、投稿打包自检（6 项清单门控导出 zip）、一键 Cover Letter（W11）、期刊推荐（库内去向+scope 匹配）
- 知识底座 UI：双链笔记卡片（标注一键转卡片、插入稿件）、术语表（跳转定义/导出 acronym 包/一致性检查）、风格档案四指标
- 工作流体验：表单式启动器（无原生 prompt）、W10 结构化自检报告（导出 .md）、W7 按审稿人分段 rebuttal、运行历史留存（可回看）
- 文献库闭环：条目详情（作者/摘要/DOI 外链/IEEE·APA·AMA 引用预览）、库内 PDF 关联打开（标注按文献键控恢复）、标注管理侧栏、批量操作
- 全站中英双语（i18n 190+ 键 + 面板级字典）、全项目快照时间线、首启引导
- Agent 写级工具（tex.edit/citation.add）：阻塞式人工审批，裁决结果回传模型继续生成；unified diff 应用器支持 W3 工作流输出

## 平台说明

应用通过 `apps/desktop/src/platform` 抽象本地能力（文件、进程、密钥）。当前提供
Browser 实现（开发/演示用）；Tauri 实现在 Rust 工具链就绪后接入，业务代码不感知。
