/** 主题应用：写 document.documentElement.dataset.theme，样式变量见 styles.css。 */

export type Theme = 'dark' | 'light';

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}
