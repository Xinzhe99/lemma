import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineMessages, getDict, t } from './i18n';

/** 允许只有 zh 的例外：语言自称（简体中文）与故意验证回退的产品代号 */
const ZH_ONLY_ALLOWLIST = new Set(['settings.lang.zh', 'app.codename']);

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

  it('支持 {name} 插值变量', () => {
    expect(t('selbar.selected', 'zh', { n: 12 })).toBe('已选 12 字');
    expect(t('selbar.selected', 'en', { n: 12 })).toBe('12 chars selected');
    expect(t('toast.verdict', 'en', { note: 'approved' })).toBe('Model receives verdict: approved');
  });

  it('en 完整性：除允许例外，每键必有非空 en 与非空 zh', () => {
    const dict = getDict();
    const keys = Object.keys(dict);
    expect(keys.length).toBeGreaterThan(120);
    const missing: string[] = [];
    for (const key of keys) {
      if (ZH_ONLY_ALLOWLIST.has(key)) continue;
      const entry = dict[key]!;
      if (!entry.zh || !entry.zh.trim()) missing.push(`${key}: zh 空`);
      if (!entry.en || !entry.en.trim()) missing.push(`${key}: en 缺失/空`);
    }
    expect(missing).toEqual([]);
  });

  it('字典覆盖壳 UI 主要区域（命令面板/设置/文件树/编译/Agent/知识/投稿/快照/引导）', () => {
    const areas = [
      'palette.trigger',
      'cmd.compile',
      'cmd.newProject',
      'nav.files',
      'nav.knowledge',
      'nav.submit',
      'knowledge.glossary',
      'knowledge.notes',
      'panel.loadFailed',
      'tree.rename',
      'console.title',
      'agent.provider',
      'settings.tab.providers',
      'settings.field.apiKey',
      'settings.embedding',
      'wiz.create',
      'cites.bodyCited',
      'outline.empty',
      'selbar.polish',
      'snap.title',
      'onboarding.title',
      'about.designDoc',
    ];
    for (const key of areas) {
      expect(t(key, 'zh')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(key);
    }
  });

  it('defineMessages：注册新键可供 t 使用，且不覆盖已有键', () => {
    const local = defineMessages({
      'notes.testKey': { zh: '测试笔记', en: 'Test note' },
      'nav.files': { zh: '被覆盖？', en: 'Overwritten?' },
    });
    expect(local['notes.testKey']!.zh).toBe('测试笔记');
    expect(t('notes.testKey', 'en')).toBe('Test note');
    expect(t('nav.files', 'en')).toBe('Files'); // 壳内字典优先，未被覆盖
  });

  it('源码中 t(\'key\') 字面量必须存在于字典（防拼错键名渲染成原始 key）', () => {
    const srcDir = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    for (const sub of ['components', 'panels']) {
      const dir = join(srcDir, sub);
      if (existsSync(dir)) walk(dir);
    }
    for (const f of ['App.tsx', 'commandPalette.tsx']) {
      const p = join(srcDir, f);
      if (existsSync(p)) files.push(p);
    }
    expect(files.length).toBeGreaterThan(20);

    const dict = getDict();
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/\b(?:t|tr)\(\s*'([^']+)'/g)) {
          if (!dict[m[1]!]) missing.push(`${relative(srcDir, file)}:${i + 1} → ${m[1]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });
});
