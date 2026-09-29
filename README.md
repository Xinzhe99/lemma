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

## 平台说明

应用通过 `apps/desktop/src/platform` 抽象本地能力（文件、进程、密钥）。当前提供
Browser 实现（开发/演示用）；Tauri 实现在 Rust 工具链就绪后接入，业务代码不感知。
