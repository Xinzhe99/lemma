/**
 * ScholarForge Tauri 壳（Rust 侧）。
 *
 * 桥接约定与 apps/desktop/src/platform/tauri.ts 一一对应：
 * - fs_read / fs_write / fs_delete / fs_list：项目虚拟文件系统（数据目录下的相对路径）
 * - secret_get / secret_set：API key 存取（当前为数据目录 JSON 文件；正式版换 OS keychain）
 * - proc_run：阻塞式命令执行（Tectonic/latexmk 编译与一次性 CLI agent 调用；流式 spawn 属后续增量）
 *
 * 边界说明：项目文件均为文本（LaTeX 工程）；若出现非 UTF-8 二进制，
 * fs_read 以 lossy 解码返回并在内容上无法保证字节精确（PDF 不走平台 fs，不受影响）。
 */

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::Manager;

fn base_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("scholarforge"));
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
fn fs_write(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let rel = safe_rel(&path)?;
    let target = base_dir(&app).join(&rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, content).map_err(|e| e.to_string())
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

/// 阻塞式命令执行：供 Tectonic/latexmk 编译与一次性 CLI agent 调用。
/// cwd 为空时使用应用数据目录；args 原样传递，不做 shell 展开。
#[tauri::command]
fn proc_run(
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
    let output = Command::new(&cmd)
        .args(&args)
        .current_dir(&work_dir)
        .output()
        .map_err(|e| format!("无法启动命令 {cmd}：{e}"))?;
    Ok(ProcResult {
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fs_read,
            fs_write,
            fs_delete,
            fs_list,
            secret_get,
            secret_set,
            proc_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScholarForge");
}
