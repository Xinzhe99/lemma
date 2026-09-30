/**
 * ImageWizard 纯函数测试：normalizeImagePath（kebab-case / 重名 / 非法字符）、
 * buildIncludeGraphics、needsGraphicx（注释/选项宏包）、addGraphicxToPreamble（导言区插入）。
 * 组件交互（选择/插入/Tauri 写入）属宿主形态逻辑，由 typecheck/build 与人工验收覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
  addGraphicxToPreamble,
  buildIncludeGraphics,
  needsGraphicx,
  normalizeImagePath,
} from './ImageWizard';

describe('normalizeImagePath', () => {
  it('基础：figures/<kebab>.<小写扩展名>', () => {
    expect(normalizeImagePath('network.png', [])).toBe('figures/network.png');
  });

  it('扩展名统一小写', () => {
    expect(normalizeImagePath('Arch.PNG', [])).toBe('figures/arch.png');
    expect(normalizeImagePath('photo.JPEG', [])).toBe('figures/photo.jpeg');
  });

  it('空格转连字符并去重', () => {
    expect(normalizeImagePath('My Photo Final.png', [])).toBe('figures/my-photo-final.png');
  });

  it('camelCase 自动分词为 kebab-case', () => {
    expect(normalizeImagePath('systemOverview Diagram.svg', [])).toBe(
      'figures/system-overview-diagram.svg',
    );
  });

  it('非法字符（括号/点/表情）剔除，连字符折叠修剪', () => {
    expect(normalizeImagePath('Screenshot 2026-09-30 (1).png', [])).toBe(
      'figures/screenshot-2026-09-30-1.png',
    );
    expect(normalizeImagePath('!!weird___name!!.gif', [])).toBe('figures/weird-name.gif');
  });

  it('中文被剔除，空基名回退 image', () => {
    expect(normalizeImagePath('结果 图.png', [])).toBe('figures/image.png');
  });

  it('变音符脱落（café → cafe）', () => {
    expect(normalizeImagePath('café.jpg', [])).toBe('figures/cafe.jpg');
  });

  it('与既有文件重名追加 -2，再重名继续 -3', () => {
    const existing = ['main.tex', 'figures/fig.png'];
    expect(normalizeImagePath('fig.png', existing)).toBe('figures/fig-2.png');
    expect(normalizeImagePath('fig.png', [...existing, 'figures/fig-2.png'])).toBe(
      'figures/fig-3.png',
    );
  });

  it('冲突判定大小写不敏感，且只看规范化后的目标路径', () => {
    expect(normalizeImagePath('FIG.PNG', ['figures/fig.png'])).toBe('figures/fig-2.png');
    // 不同目录下的同名文件不构成冲突
    expect(normalizeImagePath('fig.png', ['screens/fig.png'])).toBe('figures/fig.png');
  });

  it('无扩展名文件不追加空点；输入含路径时仅取文件名', () => {
    expect(normalizeImagePath('diagram', [])).toBe('figures/diagram');
    expect(normalizeImagePath('C:\\pics\\My Shot.png', ['figures/my-shot.png'])).toBe(
      'figures/my-shot-2.png',
    );
  });
});

describe('buildIncludeGraphics', () => {
  it('生成 width=0.8\\textwidth 的插图代码', () => {
    expect(buildIncludeGraphics('figures/network.png')).toBe(
      '\\includegraphics[width=0.8\\textwidth]{figures/network.png}',
    );
  });
});

describe('needsGraphicx', () => {
  it('已引入 graphicx（含选项形式）返回 false', () => {
    expect(needsGraphicx('\\documentclass{article}\n\\usepackage{graphicx}\n')).toBe(false);
    expect(needsGraphicx('\\usepackage[draft]{graphicx}')).toBe(false);
    expect(needsGraphicx('\\usepackage{graphicx,xcolor}')).toBe(false);
    expect(needsGraphicx('\\usepackage{xcolor,graphicx}')).toBe(false);
  });

  it('未引入或仅有同类包名子串时返回 true', () => {
    expect(needsGraphicx('\\documentclass{article}\n\\usepackage{amsmath}\n')).toBe(true);
    expect(needsGraphicx('')).toBe(true);
    // graphics ≠ graphicx，不误判
    expect(needsGraphicx('\\usepackage{graphics}')).toBe(true);
  });

  it('注释中的 \\usepackage{graphicx} 不算已引入（复用 stripLineComment 语义）', () => {
    expect(needsGraphicx('% \\usepackage{graphicx}\n\\documentclass{article}')).toBe(true);
  });
});

describe('addGraphicxToPreamble', () => {
  it('插在 \\documentclass 行之后、其它 \\usepackage 之前', () => {
    const tex = '\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\end{document}\n';
    expect(addGraphicxToPreamble(tex)).toBe(
      '\\documentclass[11pt]{article}\n\\usepackage{graphicx}\n\\usepackage{amsmath}\n\\begin{document}\n\\end{document}\n',
    );
  });

  it('documentclass 带选项与缩进同样识别', () => {
    expect(addGraphicxToPreamble('  \\documentclass{book}\n\\usepackage{x}')).toBe(
      '  \\documentclass{book}\n\\usepackage{graphicx}\n\\usepackage{x}',
    );
  });

  it('找不到 \\documentclass 时置于文件最前；幂等不重复添加', () => {
    expect(addGraphicxToPreamble('\\begin{document}x\\end{document}')).toBe(
      '\\usepackage{graphicx}\n\\begin{document}x\\end{document}',
    );
    const withPkg = '\\documentclass{article}\n\\usepackage{graphicx}\n';
    expect(addGraphicxToPreamble(withPkg)).toBe(withPkg);
  });
});
