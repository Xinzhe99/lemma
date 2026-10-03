# macOS 构建指南

Lemma 的 Tauri 2 壳天然跨平台——Windows 与 macOS 共用同一 Rust 桥代码（fs/secret/proc/updater 命令均无平台特定代码，权限收敛的 `#[cfg(unix)]` 分支已就位）。本仓库的 CI（`.github/workflows/release.yml`）在打 tag 时会自动产出三平台安装包：

| 平台 | 产物 | 构建机 |
|---|---|---|
| Windows x64 | `Lemma_x.y.z_x64-setup.exe`（NSIS） | `windows-latest` |
| macOS Apple Silicon | `Lemma_aarch64.dmg` | `macos-latest` |
| macOS Intel | `Lemma_x64.dmg` | `macos-latest` |

## 在 macOS 本机构建

```bash
# 前置：Xcode Command Line Tools + Rust（rustup 默认 host 即可）
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

git clone https://github.com/Xinzhe99/lemma.git
cd lemma
npm install
cd apps/desktop
npm run desktop:dev     # 开发运行
npm run desktop:build   # 打 dmg（自动同时出 arm64/x64 取决于本机）
```

## 图标

`src-tauri/icons/` 已含 icns（macOS）与 ico/png（Windows），由 `npx tauri icon` 从 `app-icon.png` 统一生成；换品牌图后重跑该命令即可。

## 自动更新签名（重要）

updater 插件要求更新包签名。发布前一次性生成密钥对：

```bash
npm run tauri signer generate -w ~/.tauri/lemma.key
```

- **公钥**（`.pub` 内容）填入 `tauri.conf.json` → `plugins.updater.pubkey`（当前为空 = 构建产物不带签名，updater 会报"未配置签名"——发布前必须完成）
- **公钥已配置**（`tauri.conf.json` → `plugins.updater.pubkey`，v0.10.0 起生效）
- **私钥**放仓库 Secrets（API 令牌无 secrets 写权限，需手动一次）：仓库 **Settings → Secrets and variables → Actions → New repository secret**，名称 `TAURI_SIGNING_PRIVATE_KEY`，值为 `~/.tauri/lemma.key` 文件全文（本机已生成）。密钥无密码，无需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

签名就绪后，`tauri-action` 会在 Release 里自动生成 `latest.json`（与 conf 中的 endpoints 对应），应用内的闲时更新链路即完整闭环。
