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

## 已实现（v0.1 浏览器形态）

- LaTeX 编辑器（语法高亮 / 大纲跳转 / \cite 补全 / diff 视图）
- 编译流水线（MockEngine 演示；Tectonic/latexmk 引擎待 Tauri 桥接）+ 6 套模板（含中文 ctex）+ Overleaf zip 一键导入
- 文献库：BibTeX / DOI / arXiv 导入，发现检索（arXiv+Crossref 聚合去重一键入库），智能过滤，BM25+向量混合知识检索（可配语义嵌入，失败自动回退本地）
- PDF 阅读器：四色语义标注，按文件持久化
- Agent 中枢：Context Pack 注入流式对话（真实 provider 可调用论文域工具，多轮回填）、引用幻觉核查护栏、5 个内置工作流（三审稿人仿真 → 结构化审稿面板 → Rebuttal 起草一键衔接）
- AI 改稿审批闭环：润色/起草/选中文本润色 → diff 审批卡 → 采纳前强制快照 → 历史时间线一键恢复
- 选中即问：编辑器选中文本浮动工具条（润色/解释/翻译/找文献）
- Agent 写级工具（tex.edit/citation.add）：阻塞式人工审批，裁决结果回传模型继续生成；unified diff 应用器支持 W3 工作流输出

## 平台说明

应用通过 `apps/desktop/src/platform` 抽象本地能力（文件、进程、密钥）。当前提供
Browser 实现（开发/演示用）；Tauri 实现在 Rust 工具链就绪后接入，业务代码不感知。
