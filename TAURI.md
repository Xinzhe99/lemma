# Tauri 桌面壳

Lemma 的桌面形态：同一 Web 应用（`apps/desktop`）由 Tauri 2 壳承载，获得本地
文件、进程与密钥能力（桥接实现见 `apps/desktop/src-tauri/src/lib.rs`，前端侧
`apps/desktop/src/platform/tauri.ts`）。

## 桥命令

| 命令 | 参数 | 说明 |
|---|---|---|
| `fs_read` | `{path}` | 读项目虚拟文件（应用数据目录下相对路径；路径穿越被拒） |
| `fs_write` / `fs_delete` | `{path, content?}` | 写/删（自动建父目录） |
| `fs_list` | `{}` | 递归列出全部文件 |
| `secret_get` / `secret_set` | `{key, value?}` | API key 存取（数据目录 JSON；正式版换 OS keychain） |
| `proc_run` | `{cmd, args, cwd?}` | 阻塞执行外部命令（Tectonic / latexmk / CLI agent 一次性调用） |

编译链：Tauri 环境下 `runCompile()` 自动优先真实 `TectonicEngine`（经 `proc_run`），
不可用时回退模拟引擎并提示。本机若装有 TeX Live（如 `D:\texlive\2024`），可把
`LatexmkEngine` 接到 `proc_run`（`compileAction.ts` 中 `tauriRunner` 已就绪）。

## 构建要求

- Rust（`rustup`）+ **MSVC 工具链**（VS 2022 Build Tools + Windows SDK）
  > Windows 上 `stable-gnu` 工具链在生成 windows-sys 导入库时需要额外 MinGW binutils
  > （`dlltool`/`as`），rustup 自带的 self-contained 集不完整；直接用 `stable-msvc` 最稳。
- WebView2 运行时（Windows 10/11 通常预装）

## 常用命令

```bash
cd apps/desktop
npm run desktop:dev    # 开发（自动起 vite + 壳）
npm run desktop:build  # 打包安装程序（需在 tauri.conf.json 开启 bundle）
```

## 当前状态

- Rust 桥代码完整；`cargo check` 已在 MSVC 工具链下通过。
- `bundle.active` 目前为 `false`（专注开发期）；发布时改为 `true` 并补图标
  （`npm run tauri icon <png>`）。
