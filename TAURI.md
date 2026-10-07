# Tauri 桌面壳

Lemma 的桌面形态：同一 Web 应用（`apps/desktop`）由 Tauri 2 壳承载，获得本地
文件、进程与密钥能力（桥接实现见 `apps/desktop/src-tauri/src/lib.rs`，前端侧
`apps/desktop/src/platform/tauri.ts`）。

## 桥命令

注册于 `lib.rs` 的 `invoke_handler`（共 17 个）；前端一律经 `window.__TAURI__.core.invoke` 调用。
应用自有命令不走 ACL（`capabilities/default.json` 只声明插件权限）。

| 命令 | 参数 | 说明 |
|---|---|---|
| `fs_read` / `fs_write` / `fs_delete` | `{path, content?}` | 项目虚拟文件读写删（应用数据目录下相对路径，自动建父目录；`..`/绝对路径被拒） |
| `fs_read_base64` / `fs_write_base64` | `{path, data?}` | 二进制读写（编译产出的 PDF 读回、插图向导的图片落盘） |
| `fs_list` | `{}` | 递归列出虚拟文件系统的全部路径 |
| `fs_read_absolute` / `fs_write_absolute` / `fs_delete_absolute` | `{dir, rel, content?}` | 用户自选项目文件夹（绝对 `dir` + `safe_rel` 校验的 `rel`，双保险防逃逸） |
| `fs_scan_absolute` | `{dir}` | 扫描用户项目目录（跳过隐藏项，封顶 4000 项）→ `[{path, mtimeMs}]` |
| `secret_get` / `secret_set` | `{key, value?}` | API key 存取（数据目录 `secrets.json`；Unix 下 chmod 600，正式版换 OS keychain） |
| `proc_run` | `{cmd, args, cwd?}` | 一次性执行外部命令（Tectonic / latexmk / pandoc / CLI agent）；async + `spawn_blocking`，Windows 带 `CREATE_NO_WINDOW` |
| `open_external` | `{target}` | 用系统浏览器/资源管理器打开 http(s) 链接或已存在的本地路径（「去获取 Key」、打开文献库目录） |
| `updater_status` | `{}` | 读编译期配置，报告 updater 签名公钥是否已配置（前端据此给精确提示） |
| `download_and_install_tectonic` | `{}` | 下载并解包内置 Tectonic（约 20–30MB）到 `bin/tectonic[.exe]`，幂等缓存 |
| `download_and_install_pandoc` | `{}` | 同上（docx 导出用）；先探测系统 pandoc，仅 Windows x64 走内置下载 |

编译链：`runCompile()` 先并行探测引擎矩阵（tectonic → lualatex → xelatex →
pdflatex → latexmk → 内置 Tectonic），**全部不可用时如实失败并给出安装指引**，
不再静默回退模拟引擎（v7.6.0）。浏览器形态才走内置 MockEngine（有意的演示行为，
日志注明「浏览器形态：模拟编译」）。

## 构建要求

- Rust（`rustup`）+ **MSVC 工具链**（VS 2022 Build Tools + Windows SDK）
  > Windows 上 `stable-gnu` 工具链在生成 windows-sys 导入库时需要额外 MinGW binutils
  > （`dlltool`/`as`），rustup 自带的 self-contained 集不完整；直接用 `stable-msvc` 最稳。
- WebView2 运行时（Windows 10/11 通常预装）

## 常用命令

```bash
cd apps/desktop
npm run desktop:dev    # 开发（自动起 vite + 壳）
npm run desktop:build  # 打包安装程序（bundle.active 已为 true）
```

## 当前状态

- Rust 桥代码完整；`cargo check` 已在 MSVC 工具链下通过（CI 对 `src-tauri/**` 变更跑 cargo check）。
- `bundle.active` 已为 `true`，图标由 `tauri icon` 管线生成（源图 `brand/png/icon-1024.png`），
  updater 插件启用（公钥见 `tauri.conf.json` → `plugins.updater`；`updater_status` 会回报配置状态）。
- 窗口标题随界面语言：`core:window:allow-set-title` + 前端 `docLanguage.ts`（v7.8.0）。
