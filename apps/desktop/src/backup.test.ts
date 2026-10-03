// @vitest-environment jsdom
/**
 * backup.ts 纯函数测试（全量备份/恢复，WS-F）：
 * 构建（结构/浅拷贝隔离）、校验（合法通过 / 坏 schema / 坏 version / 缺核心字段逐项拒绝 /
 * exportedAt 非法拒绝 / settings 可选宽容）、脱敏（清空全部 apiKey、不改原对象、无 providers 原样返回）。
 */
import { describe, expect, it } from 'vitest';
import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  buildBackup,
  stripSecrets,
  validateBackup,
  type BuildBackupInput,
} from './backup';

function sampleInput(): BuildBackupInput {
  return {
    papers: [{ id: 'p1', citekey: 'vaswani2017attention' }],
    notes: [{ id: 'n1', title: '卡片' }],
    annotationsByFile: { 'pdf:a.pdf': [{ id: 'a1', page: 1 }] },
    projects: [{ id: 'rec1', name: 'demo-paper' }],
    workspace: {
      projectName: 'demo-paper',
      entry: 'main.tex',
      files: { 'main.tex': '\\documentclass{article}' },
      snapshots: { 'main.tex': [{ content: 'old', ts: 1, label: 'AI 修改前' }] },
    },
    embeddingModel: 'text-embedding-3-small',
    theme: 'dark',
    language: 'zh',
  };
}

describe('buildBackup · 构建', () => {
  it('产出统一结构：schema/version/exportedAt(ISO) 与 data 各节', () => {
    const bak = buildBackup(sampleInput());
    expect(bak.schema).toBe(BACKUP_SCHEMA);
    expect(bak.schema).toBe('lemma-backup');
    expect(bak.version).toBe(BACKUP_VERSION);
    expect(bak.version).toBe(1);
    expect(() => new Date(bak.exportedAt).toISOString()).not.toThrow();
    expect(new Date(bak.exportedAt).getTime()).toBeGreaterThan(0);
    expect(bak.data.library.papers).toHaveLength(1);
    expect(bak.data.knowledge.notes).toHaveLength(1);
    expect(bak.data.knowledge.annotationsByFile['pdf:a.pdf']).toHaveLength(1);
    expect(bak.data.projects).toHaveLength(1);
    expect(bak.data.workspace.projectName).toBe('demo-paper');
    expect(bak.data.workspace.entry).toBe('main.tex');
    expect(bak.data.workspace.files['main.tex']).toContain('documentclass');
    expect(bak.data.workspace.snapshots).toEqual({
      'main.tex': [{ content: 'old', ts: 1, label: 'AI 修改前' }],
    });
    expect(bak.data.settings).toEqual({
      embeddingModel: 'text-embedding-3-small',
      theme: 'dark',
      language: 'zh',
    });
  });

  it('可选字段缺省也可构建（snapshots/embeddingModel/theme/language 均可缺省）', () => {
    const input = sampleInput();
    delete input.workspace.snapshots;
    delete input.embeddingModel;
    delete input.theme;
    delete input.language;
    const bak = buildBackup(input);
    expect(bak.data.workspace.snapshots).toBeUndefined();
    expect(bak.data.settings.embeddingModel).toBeUndefined();
    expect(bak.data.settings.theme).toBeUndefined();
    expect(bak.data.settings.language).toBeUndefined();
  });

  it('浅拷贝隔离：组装后改动备份顶层集合不影响输入，输入改动不影响备份', () => {
    const input = sampleInput();
    const bak = buildBackup(input);
    (bak.data.library.papers as unknown[]).push({ id: 'extra' });
    (bak.data.workspace as { files: Record<string, string> }).files['new.tex'] = 'x';
    expect(input.papers).toHaveLength(1);
    expect(input.workspace.files['new.tex']).toBeUndefined();
    input.notes.push({ id: 'n2' });
    expect(bak.data.knowledge.notes).toHaveLength(1);
  });
});

describe('validateBackup · 校验', () => {
  it('合法备份（buildBackup 产物）校验通过并原样取回', () => {
    const bak = buildBackup(sampleInput());
    const r = validateBackup(bak);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup).toEqual(bak);
  });

  it('JSON 序列化往返后仍校验通过（真实导出/导入路径）', () => {
    const r = validateBackup(JSON.parse(JSON.stringify(buildBackup(sampleInput()))));
    expect(r.ok).toBe(true);
  });

  it('非对象（null / 字符串 / 数组）拒绝', () => {
    const rNull = validateBackup(null);
    expect(rNull.ok).toBe(false);
    expect(validateBackup('lemma-backup').ok).toBe(false);
    expect(validateBackup([1, 2]).ok).toBe(false);
    if (!rNull.ok) expect(rNull.error).toContain('不是 JSON 对象');
  });

  it('坏 schema 拒绝（含错误信息）', () => {
    const bak = buildBackup(sampleInput()) as unknown as Record<string, unknown>;
    bak.schema = 'other-tool-backup';
    const r = validateBackup(bak);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('schema');
  });

  it('坏 version 拒绝：2、字符串 "1"、缺失 均不通过', () => {
    for (const version of [2, '1', undefined]) {
      const bak = buildBackup(sampleInput()) as unknown as Record<string, unknown>;
      bak.version = version;
      const r = validateBackup(bak);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('version');
    }
  });

  it('exportedAt 缺失/非字符串拒绝', () => {
    const bak = buildBackup(sampleInput()) as unknown as Record<string, unknown>;
    bak.exportedAt = 1700000000000;
    expect(validateBackup(bak).ok).toBe(false);
  });

  it('缺少 data / data.library.papers / data.knowledge.notes 逐项拒绝', () => {
    const base = () =>
      JSON.parse(JSON.stringify(buildBackup(sampleInput()))) as unknown as Record<
        string,
        Record<string, unknown>
      >;

    const noData = base();
    delete noData.data;
    expect(validateBackup(noData).ok).toBe(false);

    const noPapers = base();
    delete (noPapers.data.library as Record<string, unknown>).papers;
    const rPapers = validateBackup(noPapers);
    expect(rPapers.ok).toBe(false);
    if (!rPapers.ok) expect(rPapers.error).toContain('data.library.papers');

    const noNotes = base();
    delete (noNotes.data.knowledge as Record<string, unknown>).notes;
    expect(validateBackup(noNotes).ok).toBe(false);
  });

  it('annotationsByFile 形状错误（数组）与 projects 缺失拒绝', () => {
    const base = () =>
      JSON.parse(JSON.stringify(buildBackup(sampleInput()))) as unknown as Record<
        string,
        Record<string, unknown>
      >;

    const badAnn = base();
    (badAnn.data.knowledge as Record<string, unknown>).annotationsByFile = [];
    const rAnn = validateBackup(badAnn);
    expect(rAnn.ok).toBe(false);
    if (!rAnn.ok) expect(rAnn.error).toContain('annotationsByFile');

    const noProjects = base();
    delete noProjects.data.projects;
    const rProjects = validateBackup(noProjects);
    expect(rProjects.ok).toBe(false);
    if (!rProjects.ok) expect(rProjects.error).toContain('data.projects');
  });

  it('workspace 核心字段缺失拒绝（整体 / projectName / entry / files）', () => {
    const base = () =>
      JSON.parse(JSON.stringify(buildBackup(sampleInput()))) as unknown as Record<
        string,
        Record<string, unknown>
      >;

    const noWs = base();
    delete noWs.data.workspace;
    expect(validateBackup(noWs).ok).toBe(false);

    for (const field of ['projectName', 'entry', 'files']) {
      const bak = base();
      delete (bak.data.workspace as Record<string, unknown>)[field];
      expect(validateBackup(bak).ok).toBe(false);
    }
  });

  it('settings 可选：缺失或对象均通过，非对象拒绝', () => {
    const base = () =>
      JSON.parse(JSON.stringify(buildBackup(sampleInput()))) as unknown as Record<
        string,
        Record<string, unknown>
      >;

    const noSettings = base();
    delete noSettings.data.settings;
    expect(validateBackup(noSettings).ok).toBe(true);

    const badSettings = base();
    badSettings.data.settings = 'dark';
    expect(validateBackup(badSettings).ok).toBe(false);
  });
});

describe('stripSecrets · 脱敏', () => {
  it('清空全部 providers 的 apiKey（其余字段保留）', () => {
    const stripped = stripSecrets({
      providers: [
        { id: 'pv1', label: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'sk-secret-1', model: 'gpt' },
        { id: 'pv2', label: '本地', baseUrl: 'http://localhost', apiKey: 'sk-secret-2', model: 'qwen' },
      ],
      activeProviderId: 'pv1',
      embeddingModel: 'emb',
      theme: 'dark',
      language: 'zh',
    });
    expect(stripped.providers).toEqual([
      { id: 'pv1', label: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: '', model: 'gpt' },
      { id: 'pv2', label: '本地', baseUrl: 'http://localhost', apiKey: '', model: 'qwen' },
    ]);
    expect(stripped.activeProviderId).toBe('pv1');
    expect(stripped.theme).toBe('dark');
  });

  it('不修改原对象（返回新对象/新 providers 数组）', () => {
    const settings = { providers: [{ apiKey: 'sk-keep' }], theme: 'light' };
    const stripped = stripSecrets(settings);
    expect(settings.providers[0]!.apiKey).toBe('sk-keep');
    expect(stripped).not.toBe(settings);
    expect(stripped.providers).not.toBe(settings.providers);
    expect(stripped.providers![0]!.apiKey).toBe('');
  });

  it('无 providers 时同形状原样返回', () => {
    const settings = { theme: 'dark', language: 'en' };
    const stripped = stripSecrets(settings);
    expect(stripped).toEqual({ theme: 'dark', language: 'en' });
    expect(stripped).not.toBe(settings);
    expect('providers' in stripped).toBe(false);
  });
});
