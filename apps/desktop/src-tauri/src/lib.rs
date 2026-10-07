/**
 * Lemma Tauri 壳（Rust 侧）。
 *
 * 桥接约定与 apps/desktop/src/platform/tauri.ts 一一对应：
 * - fs_read / fs_read_base64 / fs_write / fs_write_base64 / fs_delete / fs_list：
 *   项目虚拟文件系统（数据目录下的相对路径）；fs_write_base64 供二进制写入（插图向导的 figures/ 图片）
 * - fs_read_absolute / fs_write_absolute / fs_delete_absolute / fs_scan_absolute：
 *   用户在新建项目时选择的本地文件夹（绝对路径 dir + safe_rel 校验的相对路径 rel）——
 *   项目文件物化到用户目录 / 打开项目时与磁盘同步合并。独立于相对路径命令族：
 *   safe_rel 一律拒绝绝对路径，绝对路径必须走本组显式命令（目录锚定 + 相对段校验，双保险）
 * - secret_get / secret_set：API key 存取（当前为数据目录 JSON 文件；正式版换 OS keychain）
 * - proc_run：一次性命令执行（Tectonic/latexmk/lualatex 编译与 CLI agent 调用；
 *   async 命令 + spawn_blocking 不阻塞主线程，Windows 带 CREATE_NO_WINDOW 不弹黑窗；
 *   流式 spawn 属后续增量）
 *
 * 边界说明：项目文件均为文本（LaTeX 工程），fs_read 以 UTF-8 读取；
 * 二进制产物（编译得到的 PDF）经 fs_read_base64 以 base64 编码返回，由前端解码为字节；
 * 二进制写入（图片）经 fs_write_base64 以 base64 编码接收，Rust 侧解码后落盘。
 */

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use tauri::Manager;

// ---------------------------------------------------------------------------
// 自动更新（类 Codex 无感三段：闲时静默检查 → 后台下载 → 重启即完成）
// 检查/下载/安装与重启由前端 npm 插件（plugin-updater / plugin-process）经
// 各自的 IPC 命令完成；Rust 侧只注册插件并暴露 updater_status 诊断桥。
// 权限见 capabilities/default.json（updater:default + process:allow-restart）。
// ---------------------------------------------------------------------------

fn base_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("lemma"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn secrets_path(app: &tauri::AppHandle) -> PathBuf {
    base_dir(app).join("secrets.json")
}

/// 拒绝路径逃逸：规范化相对路径，禁止绝对路径与 ..
fn safe_rel(path: &str) -> Result<String, String> {
    if path.is_empty() || path.contains('\0') {
        return Err("非法路径".into());
    }
    if Path::new(path).is_absolute() {
        return Err("不允许绝对路径".into());
    }
    let mut parts: Vec<String> = Vec::new();
    for seg in Path::new(path).components() {
        match seg {
            std::path::Component::Normal(s) => {
                let s = s.to_string_lossy().to_string();
                if s == ".." {
                    return Err("不允许路径穿越".into());
                }
                parts.push(s);
            }
            std::path::Component::CurDir => {}
            _ => return Err("非法路径段".into()),
        }
    }
    Ok(parts.join("/"))
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let path = entry.path();
        if path.is_dir() {
            walk(&path, &rel, out);
        } else {
            out.push(rel);
        }
    }
}

#[tauri::command]
fn fs_read(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let rel = safe_rel(&path)?;
    let target = base_dir(&app).join(&rel);
    if !target.is_file() {
        return Err(format!("文件不存在：{rel}"));
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn fs_read_base64(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let rel = safe_rel(&path)?;
    let target = base_dir(&app).join(&rel);
    if !target.is_file() {
        return Err(format!("文件不存在：{rel}"));
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    Ok(BASE64_STANDARD.encode(bytes))
}

#[tauri::command]
fn fs_write(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let rel = safe_rel(&path)?;
    let target = base_dir(&app).join(&rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write_base64(app: tauri::AppHandle, path: String, data: String) -> Result<(), String> {
    let rel = safe_rel(&path)?;
    let target = base_dir(&app).join(&rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let clean: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = BASE64_STANDARD
        .decode(clean.as_bytes())
        .map_err(|e| format!("base64 解码失败：{e}"))?;
    fs::write(&target, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_delete(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let rel = safe_rel(&path)?;
    let target = base_dir(&app).join(&rel);
    if target.is_file() {
        fs::remove_file(&target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn fs_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = base_dir(&app);
    let mut out = Vec::new();
    walk(&dir, "", &mut out);
    out.sort();
    Ok(out)
}

// ---------------------------------------------------------------------------
// 用户选择的本地项目文件夹（绝对路径）命令族：
// 「新建项目选择本地路径」后，项目文本文件物化到该目录；打开项目时扫描磁盘做
// 增量合并（磁盘有而记录无 → 并入；磁盘比记录新 → 以磁盘为准）。
// 安全边界：dir 必须是绝对路径（由前端文件夹选择器给出）；rel 走 safe_rel
// （禁绝对路径与 ..，防止借 dir 锚点逃逸到目录外）；不提供整目录删除。
// ---------------------------------------------------------------------------

/// 校验用户选择的绝对目录：非空、无 \0、必须为绝对路径（前端文件夹选择器的产物）
fn abs_dir(dir: &str) -> Result<PathBuf, String> {
    if dir.trim().is_empty() || dir.contains('\0') {
        return Err("目录不能为空".into());
    }
    let p = PathBuf::from(dir);
    if !p.is_absolute() {
        return Err(format!("需要绝对路径：{dir}"));
    }
    Ok(p)
}

/// 修改时间 → Unix 毫秒（早于 epoch 等异常情况回落 0）
fn mtime_ms_of(path: &Path) -> u64 {
    path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 扫描用户项目目录的 walker：跳过隐藏条目（`.` 开头），条目数封顶防巨型目录拖垮 IPC
fn walk_abs(dir: &Path, prefix: &str, out: &mut Vec<(String, u64)>) {
    const MAX_ENTRIES: usize = 4000;
    if out.len() >= MAX_ENTRIES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_ENTRIES {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let path = entry.path();
        if path.is_dir() {
            walk_abs(&path, &rel, out);
        } else {
            out.push((rel, mtime_ms_of(&path)));
        }
    }
}

#[tauri::command]
fn fs_write_absolute(dir: String, rel: String, content: String) -> Result<(), String> {
    let base = abs_dir(&dir)?;
    let rel = safe_rel(&rel)?;
    let target = base.join(&rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    fs::write(&target, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_absolute(dir: String, rel: String) -> Result<String, String> {
    let base = abs_dir(&dir)?;
    let rel = safe_rel(&rel)?;
    let target = base.join(&rel);
    if !target.is_file() {
        return Err(format!("文件不存在：{rel}"));
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn fs_delete_absolute(dir: String, rel: String) -> Result<(), String> {
    let base = abs_dir(&dir)?;
    let rel = safe_rel(&rel)?;
    let target = base.join(&rel);
    if target.is_file() {
        fs::remove_file(&target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct AbsDirEntry {
    /// 相对 dir 的路径（/ 分隔）
    path: String,
    /// 修改时间（Unix 毫秒；不可得为 0）
    mtime_ms: u64,
}

#[tauri::command]
fn fs_scan_absolute(dir: String) -> Result<Vec<AbsDirEntry>, String> {
    let base = abs_dir(&dir)?;
    if !base.is_dir() {
        return Err(format!("目录不存在：{dir}"));
    }
    let mut raw: Vec<(String, u64)> = Vec::new();
    walk_abs(&base, "", &mut raw);
    raw.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(raw
        .into_iter()
        .map(|(path, mtime_ms)| AbsDirEntry { path, mtime_ms })
        .collect())
}

fn load_secrets(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    fs::read_to_string(secrets_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    Ok(load_secrets(&app).get(&key).cloned())
}

#[tauri::command]
fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mut secrets = load_secrets(&app);
    secrets.insert(key, value);
    let json = serde_json::to_string_pretty(&secrets).map_err(|e| e.to_string())?;
    let path = secrets_path(&app);
    fs::write(&path, json).map_err(|e| e.to_string())?;
    // 尽力收紧权限（Windows ACL 语义不同；正式版换 OS keychain）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct ProcResult {
    code: i32,
    stdout: String,
    stderr: String,
}

/// Windows：CREATE_NO_WINDOW 抑制子进程附带的控制台窗口（否则每次编译/探测
/// 都会闪出黑色 conhost 窗口）。0x08000000 即 winbase.h 的 CREATE_NO_WINDOW。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 构造并同步执行子进程（阻塞直至退出）：供 proc_run / 系统引擎探测共用。
/// work_dir 为 None 时沿用当前目录；Windows 下一律带 CREATE_NO_WINDOW；
/// args 原样传递，不做 shell 展开。
fn run_child(cmd: &str, args: &[String], work_dir: Option<&Path>) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(cmd);
    command.args(args);
    if let Some(dir) = work_dir {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.output()
}

/** 用系统默认浏览器/资源管理器打开外部 URL 或本地文件夹（「去获取 Key」、打开文献库目录）。 */
#[tauri::command]
async fn open_external(target: String) -> Result<(), String> {
    // 仅放行 http(s) 链接与本地存在的目录/文件路径，防止任意命令面
    let is_http = target.starts_with("http://") || target.starts_with("https://");
    if !is_http {
        let path = std::path::Path::new(&target);
        if !path.exists() {
            return Err(format!("路径不存在：{target}"));
        }
    }
    let (cmd, args): (&str, Vec<String>) = if cfg!(target_os = "windows") {
        ("explorer.exe", vec![target.clone()])
    } else if cfg!(target_os = "macos") {
        ("open", vec![target.clone()])
    } else {
        ("xdg-open", vec![target.clone()])
    };
    let handle = tauri::async_runtime::spawn_blocking(move || {
        run_child(cmd, &args, None).map_err(|e| format!("打开失败：{e}"))
    })
    .await
    .map_err(|e| format!("open_external 任务失败：{e}"))??;
    // explorer/open/xdg-open 的退出码不统一（ explorer 常>0 ），只关心命令能启动
    let _ = handle;
    Ok(())
}

/// 一次性命令执行：供 Tectonic/latexmk/lualatex 等编译与 CLI agent 调用。
/// cwd 为空时使用应用数据目录。async 命令 + spawn_blocking：阻塞的 output()
/// 在阻塞线程池执行，不占主线程与异步运行时工作线程（UI 不冻结）。
#[tauri::command]
async fn proc_run(
    app: tauri::AppHandle,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<ProcResult, String> {
    let work_dir = match cwd {
        Some(dir) if !dir.is_empty() => {
            let rel = safe_rel(&dir)?;
            base_dir(&app).join(rel)
        }
        _ => base_dir(&app),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let output = run_child(&cmd, &args, Some(&work_dir))
            .map_err(|e| format!("无法启动命令 {cmd}：{e}"))?;
        Ok(ProcResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    })
    .await
    .map_err(|e| format!("proc_run 任务失败：{e}"))?
}

#[derive(serde::Serialize)]
struct UpdaterStatus {
    /// tauri.conf.json 的 updater.pubkey 是否非空（空 = 签名密钥未配置，
    /// check 必失败；前端据此给出精确的中文提示而非晦涩的后端错误）。
    configured: bool,
}

/// updater 诊断桥：读编译期配置，报告签名公钥配置状态。
#[tauri::command]
fn updater_status(app: tauri::AppHandle) -> UpdaterStatus {
    // plugins 节为自由结构（各插件自定义 schema），经 serde_json 导航最稳。
    let plugins = serde_json::to_value(&app.config().plugins).unwrap_or(serde_json::Value::Null);
    let pubkey = plugins
        .pointer("/updater/pubkey")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    UpdaterStatus {
        configured: !pubkey.trim().is_empty(),
    }
}

// ---------------------------------------------------------------------------
// 内置 TeX 引擎（Tectonic）自动下载
//
// 普及问题：用户电脑没装 LaTeX 也要能真实编译。Tectonic 为单二进制、自包含、
// 免安装发行（官方 GitHub Releases 提供 zip / tar.gz），故选作内置引擎：
// 从 Releases 下载平台对应发行包到数据目录 bin/download.tmp，解包出可执行文件
// bin/tectonic[.exe]，返回其绝对路径。前端 compileAction 的探测链为
// 系统 tectonic → 系统 latexmk → 内置 tectonic（本命令，必要时触发下载）→ Mock 兜底。
// ---------------------------------------------------------------------------

/// 内置的 Tectonic 版本（升级时改这里，并核对 tectonic_asset 的资产名模式）
const TECTONIC_VERSION: &str = "0.15.0";

/// 失败时统一附上的手动安装指引（网络错误/解包失败共用）
const TECTONIC_MANUAL_HINT: &str = "请检查网络/代理；也可手动安装 Tectonic（https://tectonic-typesetting.github.io/）或 TeX Live 后重启应用";

/// 平台对应的 Tectonic 发行资产（GitHub Releases 文件名 + 打包格式）。
/// 资产名 URL 中 `@` 需编码为 `%40`（tag 形如 tectonic@0.15.0）。
fn tectonic_asset() -> Result<(String, &'static str), String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Ok((
        format!("tectonic-{TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip"),
        "zip",
    ));
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Ok((
        format!("tectonic-{TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz"),
        "tgz",
    ));
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Ok((
        format!("tectonic-{TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz"),
        "tgz",
    ));
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok((
        format!("tectonic-{TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz"),
        "tgz",
    ));
    #[allow(unreachable_code)]
    Err(format!("当前平台暂不支持内置 Tectonic 自动下载。{TECTONIC_MANUAL_HINT}"))
}

/// 流式下载到文件（GitHub Releases 资产通用骨架：tectonic / pandoc 共用）；
/// 每约 1MB 向 stdout 打一行进度（供 tauri 日志/终端观察），
/// 拿不到细粒度百分比属预期（前端 UI 用不确定进度文案）。
fn release_download(url: &str, dest: &Path, tag: &str) -> Result<(), String> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("下载 {tag} 失败：{e}"))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = fs::File::create(dest).map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_print: u64 = 0;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("下载中断：{e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入临时文件失败：{e}"))?;
        downloaded += n as u64;
        if downloaded - last_print >= 1024 * 1024 {
            last_print = downloaded;
            if total > 0 {
                println!(
                    "[{tag}] {}/{} MB",
                    downloaded / (1024 * 1024),
                    total / (1024 * 1024)
                );
            } else {
                println!("[{tag}] 已下载 {} MB", downloaded / (1024 * 1024));
            }
        }
    }
    println!("[{tag}] 下载完成（{downloaded} 字节），开始解包");
    Ok(())
}

/// 内置 Tectonic 的下载入口（保留原日志标签）
fn tectonic_download(url: &str, dest: &Path) -> Result<(), String> {
    release_download(url, dest, "tectonic-download")
}

/// 从发行包中提取名为 want / want.exe 的文件成员到 out。
/// 实测包内为单文件成员，但成员名可能带目录前缀（tectonic zip 内为 tectonic.exe；
/// pandoc Windows zip 内为 pandoc-3.12/pandoc.exe），故按「文件名等于 want[.exe]」匹配。
fn release_extract(archive: &Path, kind: &str, out: &Path, want: &str) -> Result<(), String> {
    let want_exe = format!("{want}.exe");
    let is_target = |name: &str| name == want || name == want_exe;
    match kind {
        "zip" => {
            let file = fs::File::open(archive).map_err(|e| format!("打开发行包失败：{e}"))?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("解包失败（zip）：{e}"))?;
            for i in 0..zip.len() {
                let mut entry = zip
                    .by_index(i)
                    .map_err(|e| format!("解包失败（zip）：{e}"))?;
                if !entry.is_file() {
                    continue;
                }
                let name = entry.name().rsplit('/').next().unwrap_or("");
                if is_target(name) {
                    let mut out_file =
                        fs::File::create(out).map_err(|e| format!("写出可执行文件失败：{e}"))?;
                    std::io::copy(&mut entry, &mut out_file)
                        .map_err(|e| format!("解包失败（zip）：{e}"))?;
                    return Ok(());
                }
            }
            Err(format!("解包失败：发行包内未找到 {want} 可执行文件"))
        }
        "tgz" => {
            let file = fs::File::open(archive).map_err(|e| format!("打开发行包失败：{e}"))?;
            let gz = flate2::read::GzDecoder::new(file);
            let mut tar = tar::Archive::new(gz);
            for entry in tar.entries().map_err(|e| format!("解包失败（tar.gz）：{e}"))? {
                let mut entry = entry.map_err(|e| format!("解包失败（tar.gz）：{e}"))?;
                let name = entry
                    .path()
                    .ok()
                    .and_then(|p| p.file_name().map(|s| s.to_string_lossy().into_owned()))
                    .unwrap_or_default();
                if !entry.header().entry_type().is_file() {
                    continue;
                }
                if is_target(&name) {
                    let mut out_file =
                        fs::File::create(out).map_err(|e| format!("写出可执行文件失败：{e}"))?;
                    std::io::copy(&mut entry, &mut out_file)
                        .map_err(|e| format!("解包失败（tar.gz）：{e}"))?;
                    return Ok(());
                }
            }
            Err(format!("解包失败：发行包内未找到 {want} 可执行文件"))
        }
        _ => Err("解包失败：未知的发行包格式".into()),
    }
}

/// 内置 Tectonic 的解包入口（等价于 release_extract(..., "tectonic")）
fn tectonic_extract(archive: &Path, kind: &str, out: &Path) -> Result<(), String> {
    release_extract(archive, kind, out, "tectonic")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TectonicInstall {
    /// 内置 tectonic 可执行文件的绝对路径（前端以该路径作为编译命令）
    path: String,
    /// true = 数据目录已存在，本次未下载（幂等）
    cached: bool,
    /// 首次编译时 Tectonic 自身仍需联网拉取宏包缓存（首次编译慢属正常），前端据此提示
    first_run_note: bool,
}

/// 内置 TeX 引擎自动下载：数据目录 bin/tectonic[.exe] 已存在直接返回；
/// 否则从 GitHub Releases 下载平台发行包（约 20-30MB）解包出单二进制并落盘。
/// async 命令：下载在线程池执行，不阻塞 UI 主线程。
#[tauri::command]
async fn download_and_install_tectonic(app: tauri::AppHandle) -> Result<TectonicInstall, String> {
    // 串行化并发调用（共享同一个 download.tmp；后者会得到 cached=true）
    static INSTALL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let exe_name = if cfg!(windows) { "tectonic.exe" } else { "tectonic" };
    let bin_dir = base_dir(&app).join("bin");
    let target = bin_dir.join(exe_name);
    if target.is_file() {
        return Ok(TectonicInstall {
            path: target.to_string_lossy().into_owned(),
            cached: true,
            first_run_note: true,
        });
    }

    fs::create_dir_all(&bin_dir).map_err(|e| format!("创建 bin 目录失败：{e}。{TECTONIC_MANUAL_HINT}"))?;
    let (asset, kind) = tectonic_asset()?;
    let url = format!(
        "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40{TECTONIC_VERSION}/{asset}"
    );
    println!("[tectonic-download] 开始下载内置 Tectonic {TECTONIC_VERSION}（{url}）");

    let tmp = bin_dir.join("download.tmp");
    let work = tectonic_download(&url, &tmp).and_then(|()| tectonic_extract(&tmp, kind, &target));
    let _ = fs::remove_file(&tmp); // 临时发行包尽力清理（失败不致命）
    work.map_err(|e| format!("{e}。{TECTONIC_MANUAL_HINT}"))?;

    // unix 下标记可执行（zip/tar 提取不保留权限位）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("设置可执行权限失败：{e}"))?;
    }

    println!("[tectonic-download] 内置 Tectonic 已就绪：{}", target.display());
    Ok(TectonicInstall {
        path: target.to_string_lossy().into_owned(),
        cached: false,
        first_run_note: true,
    })
}

// ---------------------------------------------------------------------------
// 内置 pandoc（docx 导出）自动下载
//
// 普及问题：投稿或送导师批注常需要 Word（.docx）版本，pandoc 是 LaTeX →
// docx 的事实标准转换器。官方 GitHub Releases 的 Windows x64 资产为
// pandoc-x.y-windows-x86_64.zip（约 40MB，内含 pandoc-x.y/pandoc.exe，
// 位于子目录，须按文件名提取），与 Tectonic 同为免安装单二进制，故复用
// 同一套下载/解包骨架内置到数据目录 bin/pandoc.exe。
//
// 平台边界（务实方案）：macOS 新版官方资产为 .pkg 安装器（无法静默解包
// 落盘），Linux 为 deb/tar.gz（发行版差异大）——两者不做内置下载，改为
// 先探测系统 pandoc（--version 退出码 0 即直接使用，proc_run 经 PATH 解析），
// 探测不到时返回中文指引（macOS：brew install pandoc）。
// ---------------------------------------------------------------------------

/// 内置的 pandoc 版本（升级时改这里，并核对 pandoc_asset 的资产名模式；
/// URL 已验证：https://github.com/jgm/pandoc/releases/download/3.12/
///   pandoc-3.12-windows-x86_64.zip -> 302 -> 200）
const PANDOC_VERSION: &str = "3.12";

/// 失败时统一附上的手动安装指引（网络错误/解包失败/平台不支持共用）
const PANDOC_MANUAL_HINT: &str = "请检查网络/代理；也可手动安装 pandoc（https://pandoc.org/installing.html；macOS 可 brew install pandoc）后重启应用";

/// 平台对应的 pandoc 发行资产（GitHub Releases 文件名 + 打包格式）。
/// 仅 Windows x64 提供内置下载（官方 zip 资产）；其余平台回落系统 pandoc /
/// 中文指引（见 download_and_install_pandoc）。
fn pandoc_asset() -> Result<(String, &'static str), String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Ok((
        format!("pandoc-{PANDOC_VERSION}-windows-x86_64.zip"),
        "zip",
    ));
    #[allow(unreachable_code)]
    Err(format!(
        "当前平台暂不支持内置 pandoc 自动下载，请先安装系统 pandoc（macOS：brew install pandoc；Debian/Ubuntu：apt install pandoc）。{PANDOC_MANUAL_HINT}"
    ))
}

/// 系统探测：PATH 上能否直接运行 pandoc（--version 退出码 0）。
fn system_pandoc_available() -> bool {
    run_child("pandoc", &["--version".to_string()], None)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PandocInstall {
    /// 可用的 pandoc 可执行路径（内置为数据目录绝对路径；系统 pandoc 为命令名 "pandoc"）
    path: String,
    /// true = 未发生下载（数据目录已有 / 使用系统 pandoc）
    cached: bool,
}

/// 内置 pandoc 自动下载：探测链为数据目录 bin/pandoc[.exe]（幂等缓存）→
/// 系统 pandoc（--version 探测）→ Windows x64 从 GitHub Releases 下载 zip
/// 解包出 pandoc.exe；其余平台返回中文指引错误。
/// async 命令：下载在线程池执行，不阻塞 UI 主线程。
#[tauri::command]
async fn download_and_install_pandoc(app: tauri::AppHandle) -> Result<PandocInstall, String> {
    // 串行化并发调用（与 tectonic 共用解包骨架但不共用 download.tmp）
    static INSTALL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = INSTALL_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let exe_name = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
    let bin_dir = base_dir(&app).join("bin");
    let target = bin_dir.join(exe_name);
    if target.is_file() {
        return Ok(PandocInstall {
            path: target.to_string_lossy().into_owned(),
            cached: true,
        });
    }

    // 系统已装 pandoc：直接使用命令名（前端经 proc_run 调用，按 PATH 解析），免 40MB 下载
    if system_pandoc_available() {
        println!("[pandoc-download] 检测到系统 pandoc，跳过内置下载");
        return Ok(PandocInstall {
            path: "pandoc".into(),
            cached: true,
        });
    }

    let (asset, kind) = pandoc_asset().map_err(|e| format!("{e}。{PANDOC_MANUAL_HINT}"))?;
    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("创建 bin 目录失败：{e}。{PANDOC_MANUAL_HINT}"))?;
    let url = format!("https://github.com/jgm/pandoc/releases/download/{PANDOC_VERSION}/{asset}");
    println!("[pandoc-download] 开始下载内置 pandoc {PANDOC_VERSION}（{url}）");

    let tmp = bin_dir.join("pandoc-download.tmp");
    let work = release_download(&url, &tmp, "pandoc-download")
        .and_then(|()| release_extract(&tmp, kind, &target, "pandoc"));
    let _ = fs::remove_file(&tmp); // 临时发行包尽力清理（失败不致命）
    work.map_err(|e| format!("{e}。{PANDOC_MANUAL_HINT}"))?;

    // unix 下标记可执行（zip/tar 提取不保留权限位；当前仅 Windows 走此路径，防御性保留）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("设置可执行权限失败：{e}"))?;
    }

    println!("[pandoc-download] 内置 pandoc 已就绪：{}", target.display());
    Ok(PandocInstall {
        path: target.to_string_lossy().into_owned(),
        cached: false,
    })
}

#[cfg(test)]
mod tectonic_install_tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sf-tectonic-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 平台资产名与打包格式（支持的平台上为 Ok；版本升级时本测试同步约束命名模式）
    #[test]
    fn asset_name_pattern() {
        if let Ok((asset, kind)) = tectonic_asset() {
            assert!(asset.starts_with(&format!("tectonic-{TECTONIC_VERSION}-")), "{asset}");
            assert!(matches!(kind, "zip" | "tgz"));
        }
    }

    /// zip 解包：忽略无关成员、按文件名提取 tectonic.exe（对应 Windows 发行包布局）
    #[test]
    fn extract_zip_picks_tectonic_exe() {
        let dir = temp_dir("zip");
        let archive = dir.join("pkg.zip");
        let file = fs::File::create(&archive).unwrap();
        let mut w = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();
        w.start_file("README.md", opts).unwrap();
        w.write_all(b"readme").unwrap();
        w.start_file("tectonic.exe", opts).unwrap();
        w.write_all(b"FAKE-EXE-BYTES").unwrap();
        w.finish().unwrap();

        let out = dir.join("tectonic.exe");
        tectonic_extract(&archive, "zip", &out).unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"FAKE-EXE-BYTES");
        let _ = fs::remove_dir_all(&dir);
    }

    /// tar.gz 解包：成员名带目录前缀（./dir/tectonic）也能按文件名提取（对应 macOS/Linux 布局）
    #[test]
    fn extract_tgz_picks_tectonic_among_prefixed_members() {
        let dir = temp_dir("tgz");
        let archive = dir.join("pkg.tar.gz");

        let mut tar_bytes = Vec::new();
        {
            let mut tar = tar::Builder::new(&mut tar_bytes);
            let mut h = tar::Header::new_gnu();
            h.set_size(9);
            h.set_mode(0o755);
            h.set_cksum();
            tar.append_data(&mut h, "notes.txt", b"ignored\n" as &[u8]).unwrap();
            tar.append_data(&mut h, "./dir/tectonic", b"FAKE-BIN\n" as &[u8]).unwrap();
            tar.finish().unwrap();
        }
        let mut gz = flate2::write::GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            flate2::Compression::default(),
        );
        gz.write_all(&tar_bytes).unwrap();
        gz.finish().unwrap();

        let out = dir.join("tectonic");
        tectonic_extract(&archive, "tgz", &out).unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"FAKE-BIN\n");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 包内没有 tectonic 可执行成员时报中文错误
    #[test]
    fn extract_missing_member_errors_in_chinese() {
        let dir = temp_dir("missing");
        let archive = dir.join("pkg.zip");
        let file = fs::File::create(&archive).unwrap();
        let mut w = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();
        w.start_file("README.md", opts).unwrap();
        w.write_all(b"readme").unwrap();
        w.finish().unwrap();

        let err = tectonic_extract(&archive, "zip", &dir.join("tectonic.exe")).unwrap_err();
        assert!(err.contains("未找到 tectonic"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod pandoc_install_tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sf-pandoc-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 平台资产名与打包格式（Windows x64 上为 zip；版本升级时本测试同步约束命名模式）
    #[test]
    fn asset_name_pattern() {
        if let Ok((asset, kind)) = pandoc_asset() {
            assert!(
                asset.starts_with(&format!("pandoc-{PANDOC_VERSION}-"))
                    && asset.ends_with("-windows-x86_64.zip"),
                "{asset}"
            );
            assert_eq!(kind, "zip");
        }
    }

    /// zip 解包：官方 Windows 包布局为 pandoc-3.12/pandoc.exe（子目录前缀），按文件名提取
    #[test]
    fn extract_zip_picks_pandoc_exe_from_subdirectory() {
        let dir = temp_dir("zip");
        let archive = dir.join("pkg.zip");
        let file = fs::File::create(&archive).unwrap();
        let mut w = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();
        w.start_file(&format!("pandoc-{PANDOC_VERSION}/COPYING.rtf"), opts)
            .unwrap();
        w.write_all(b"license").unwrap();
        w.start_file(&format!("pandoc-{PANDOC_VERSION}/pandoc.exe"), opts)
            .unwrap();
        w.write_all(b"FAKE-PANDOC-EXE").unwrap();
        w.finish().unwrap();

        let out = dir.join("pandoc.exe");
        release_extract(&archive, "zip", &out, "pandoc").unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"FAKE-PANDOC-EXE");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 包内没有 pandoc 成员时报中文错误（错误信息点名 pandoc，便于与 tectonic 区分）
    #[test]
    fn extract_missing_pandoc_member_errors_in_chinese() {
        let dir = temp_dir("missing");
        let archive = dir.join("pkg.zip");
        let file = fs::File::create(&archive).unwrap();
        let mut w = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();
        w.start_file("MANUAL.html", opts).unwrap();
        w.write_all(b"<html></html>").unwrap();
        w.finish().unwrap();

        let err = release_extract(&archive, "zip", &dir.join("pandoc.exe"), "pandoc").unwrap_err();
        assert!(err.contains("未找到 pandoc"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod abs_fs_tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sf-abs-fs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// abs_dir：接受绝对路径、拒绝空串与相对路径（相对路径必须走数据目录命令族）
    #[test]
    fn abs_dir_validates_input() {
        let tmp = temp_dir("validate");
        let as_str = tmp.to_string_lossy().into_owned();
        assert_eq!(abs_dir(&as_str).unwrap(), tmp);
        assert!(abs_dir("").is_err());
        assert!(abs_dir("   ").is_err());
        assert!(abs_dir("relative/path").is_err());
        let _ = fs::remove_dir_all(&tmp);
    }

    /// write → read 往返；子目录自动创建；rel 段校验复用 safe_rel（拒 .. 与绝对 rel）
    #[test]
    fn write_read_roundtrip_and_rel_validation() {
        let tmp = temp_dir("roundtrip");
        let dir = tmp.to_string_lossy().into_owned();

        fs_write_absolute(dir.clone(), "sections/intro.tex".into(), "hello".into()).unwrap();
        assert_eq!(fs_read_absolute(dir.clone(), "sections/intro.tex".into()).unwrap(), "hello");
        assert!(tmp.join("sections").is_dir());

        assert!(fs_write_absolute(dir.clone(), "../escape.tex".into(), "x".into()).is_err());
        assert!(fs_write_absolute(dir.clone(), "C:\\abs.tex".into(), "x".into()).is_err());
        assert!(fs_read_absolute(dir.clone(), "missing.tex".into()).is_err());
        let _ = fs::remove_dir_all(&tmp);
    }

    /// scan：返回相对路径 + mtime，隐藏文件跳过；delete 收尾探针文件
    #[test]
    fn scan_lists_relative_paths_and_skips_hidden() {
        let tmp = temp_dir("scan");
        let dir = tmp.to_string_lossy().into_owned();
        fs_write_absolute(dir.clone(), "main.tex".into(), "x".into()).unwrap();
        fs_write_absolute(dir.clone(), "sections/method.tex".into(), "y".into()).unwrap();
        fs_write_absolute(dir.clone(), ".hidden.cfg".into(), "z".into()).unwrap();

        let entries = fs_scan_absolute(dir.clone()).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["main.tex", "sections/method.tex"]);
        assert!(entries.iter().all(|e| e.mtime_ms > 0));

        fs_delete_absolute(dir.clone(), "main.tex".into()).unwrap();
        assert!(!tmp.join("main.tex").exists());
        // 删除不存在的文件不报错（与 fs_delete 同语义）
        fs_delete_absolute(dir.clone(), "main.tex".into()).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }

    /// scan：目录不存在时中文报错
    #[test]
    fn scan_missing_dir_errors() {
        let tmp = temp_dir("missing-scan");
        let err = fs_scan_absolute(tmp.join("nope").to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("目录不存在"), "{err}");
        let _ = fs::remove_dir_all(&tmp);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 原生文件夹选择器（新建项目选择本地路径）；权限见 capabilities/default.json（dialog:default）
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_read,
            fs_read_base64,
            fs_write,
            fs_write_base64,
            fs_delete,
            fs_list,
            fs_read_absolute,
            fs_write_absolute,
            fs_delete_absolute,
            fs_scan_absolute,
            secret_get,
            secret_set,
            proc_run,
            open_external,
            updater_status,
            download_and_install_tectonic,
            download_and_install_pandoc
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lemma");
}
