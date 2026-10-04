/**
 * 图表存在性验证（v2.9.0 ②）：检查 \ref{fig:xxx} 是否有对应的
 * \label{fig:xxx}，以及 \includegraphics 的图片文件是否在项目中。
 */

export interface FigureCheckResult {
  label: string;
  refLocation: string;
  issue: 'no-label' | 'no-image';
  message: string;
}

export function checkFigureReferences(files: Record<string, string>): FigureCheckResult[] {
  const results: FigureCheckResult[] = [];
  const definedLabels = new Set<string>();
  const imageFiles = new Set<string>();

  // 收集全部 label 和图片路径
  for (const content of Object.values(files)) {
    if (typeof content !== 'string') continue;
    for (const l of content.matchAll(/\\label\{([^}]+)\}/g)) {
      definedLabels.add(l[1]!.trim());
    }
    for (const img of content.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
      imageFiles.add(img[1]!.trim());
    }
  }

  // 检查 fig:/tab: 引用是否有对应 label
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !path.toLowerCase().endsWith('.tex')) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of (lines[i] ?? '').matchAll(/\\(?:ref|autoref)\{([^}]+)\}/g)) {
        const label = m[1]!.trim();
        if (!label.startsWith('fig:') && !label.startsWith('tab:')) continue;
        if (!definedLabels.has(label)) {
          results.push({
            label,
            refLocation: `${path}:${i + 1}`,
            issue: 'no-label',
            message: `引用 ${label} 无对应 \\label 定义`,
          });
        }
      }
    }
  }

  // 检查图片文件是否存在
  for (const img of imageFiles) {
    const variants = [img, `figures/${img}`, img.replace(/^figures\//, '')];
    const found = variants.some((v) => files[v] !== undefined);
    if (!found) {
      results.push({
        label: img,
        refLocation: '(includegraphics)',
        issue: 'no-image',
        message: `图片 ${img} 不在项目文件中（检查 figures/ 目录）`,
      });
    }
  }

  return results;
}
