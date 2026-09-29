import { describe, expect, it } from 'vitest';
import { t } from './i18n';

describe('i18n', () => {
  it('zh/en 均可取到对应译文', () => {
    expect(t('nav.files', 'zh')).toBe('文件');
    expect(t('nav.files', 'en')).toBe('Files');
    expect(t('cmd.settings', 'en')).toBe('Open settings');
  });

  it('en 缺键回退 zh（app.codename 仅提供 zh）', () => {
    expect(t('app.codename', 'en')).toBe(t('app.codename', 'zh'));
    expect(t('app.codename', 'en')).toBe('论文 IDE');
  });

  it('未知键返回键本身', () => {
    expect(t('no.such.key', 'zh')).toBe('no.such.key');
    expect(t('no.such.key', 'en')).toBe('no.such.key');
  });

  it('字典覆盖壳 UI 主要区域（命令面板/设置/文件树/编译/Agent）', () => {
    const areas = [
      'palette.trigger',
      'cmd.compile',
      'cmd.newProject',
      'nav.files',
      'tree.rename',
      'console.title',
      'agent.provider',
      'settings.tab.providers',
      'settings.field.apiKey',
      'about.designDoc',
    ];
    for (const key of areas) {
      expect(t(key, 'zh')).not.toBe(key);
    }
  });
});
