/**
 * presets 数据测试（激活器 P0）：≥6 个预设、字段完整、models 非空、
 * 指定厂商的 baseUrl/模型级别正确、findPreset/matchPresetByBaseUrl 查询行为。
 */
import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, findPreset, matchPresetByBaseUrl } from './presets';

describe('PROVIDER_PRESETS 数据完整性', () => {
  it('至少 6 个预设', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it('每个预设字段完整：id 唯一非空、label 非空、baseUrl 规范、models 非空、note 非空、keyUrl 合法', () => {
    const ids = new Set<string>();
    for (const p of PROVIDER_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.label.trim()).not.toBe('');
      // baseUrl 要么为空串（自建模板），要么是 https 根地址且不带尾部斜杠
      if (p.baseUrl !== '') {
        expect(p.baseUrl.startsWith('https://')).toBe(true);
        expect(p.baseUrl.endsWith('/')).toBe(false);
      }
      expect(Array.isArray(p.models)).toBe(true);
      expect(p.models.length).toBeGreaterThan(0);
      for (const m of p.models) expect(m.trim()).not.toBe('');
      expect(p.note.trim()).not.toBe('');
      if (p.keyUrl !== undefined) expect(p.keyUrl.startsWith('https://')).toBe(true);
    }
  });

  it('要求的六家厂商齐备，且地址/模型级别正确', () => {
    const byId = new Map(PROVIDER_PRESETS.map((p) => [p.id, p]));

    const deepseek = byId.get('deepseek')!;
    expect(deepseek.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(deepseek.models).toContain('deepseek-chat');
    expect(deepseek.models).toContain('deepseek-reasoner');
    expect(deepseek.keyUrl).toBeTruthy();

    const glm = byId.get('zhipu-glm')!;
    expect(glm.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(glm.models.some((m) => m.startsWith('glm-'))).toBe(true);
    expect(glm.note).toContain('控制台');

    expect(byId.get('moonshot')!.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(byId.get('moonshot')!.models.some((m) => m.startsWith('moonshot-v1-'))).toBe(true);

    expect(byId.get('siliconflow')!.baseUrl).toBe('https://api.siliconflow.cn/v1');

    const openai = byId.get('openai')!;
    expect(openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(openai.models).toContain('gpt-4o-mini');

    // 自建模板：空 baseUrl，交给用户填写
    expect(byId.get('custom-openai-compat')!.baseUrl).toBe('');
  });
});

describe('findPreset / matchPresetByBaseUrl', () => {
  it('findPreset 命中与未命中', () => {
    expect(findPreset('deepseek')?.label).toBe('DeepSeek');
    expect(findPreset('no-such-id')).toBeUndefined();
    expect(findPreset('')).toBeUndefined();
  });

  it('matchPresetByBaseUrl 按 baseUrl（容忍尾部斜杠）匹配，空串不匹配', () => {
    expect(matchPresetByBaseUrl('https://api.deepseek.com/v1')?.id).toBe('deepseek');
    expect(matchPresetByBaseUrl('https://api.deepseek.com/v1/')?.id).toBe('deepseek');
    expect(matchPresetByBaseUrl('https://my-llm.local/v1')).toBeUndefined();
    expect(matchPresetByBaseUrl('')).toBeUndefined();
  });
});
