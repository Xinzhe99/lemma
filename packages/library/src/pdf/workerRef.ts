/**
 * PDF worker URL 中转（纯模块，无 pdfjs 依赖）：
 * 宿主启动时 setPdfWorkerUrl 注入（如 Vite 的 `?url` 资产地址），reader
 * 子入口加载时读取并转交给 pdfjs。拆成独立小模块是为了让 barrel 能导出
 * 注入函数而不牵连 pdfjs-dist 运行时。
 */

let pdfWorkerUrl = '';

export function setPdfWorkerUrl(url: string): void {
  pdfWorkerUrl = url;
}

export function getPdfWorkerUrl(): string {
  return pdfWorkerUrl;
}
