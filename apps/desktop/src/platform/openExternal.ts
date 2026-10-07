/**
 * 外部链接打开（v7.6.0）：Tauri WebView 内 <a target="_blank"> 不会新开系统浏览器
 * （点「去获取 Key」无反应的根因）——桌面形态经 Rust 桥 open_external 调系统默认
 * 浏览器；浏览器形态退回 window.open。Rust 侧命令见 src-tauri open_external。
 */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): InvokeFn | null {
  if (typeof window === 'undefined') return null;
  const t = (window as unknown as { __TAURI__?: { core?: { invoke?: InvokeFn } } }).__TAURI__;
  return t?.core?.invoke ?? null;
}

export async function openExternal(url: string): Promise<void> {
  // 只放行 http(s)，防注入任意命令参数
  if (!/^https?:\/\//i.test(url)) return;
  const invoke = tauriInvoke();
  if (invoke) {
    try {
      await invoke<void>('open_external', { url });
      return;
    } catch {
      // 桥不可用（旧安装包）→ 落回 window.open 尽力而为
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
