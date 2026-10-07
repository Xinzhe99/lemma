import { describe, expect, it } from 'vitest';
import type { PermissionLevel, ToolDef } from '@lemma/shared';
import { checkCall } from './permissions';
import type { PermissionMode, PermissionPolicy } from './permissions';

const fixture: ToolDef[] = (['read', 'execute', 'write', 'export'] as PermissionLevel[]).map((level) => ({
  name: `fixture.${level}`,
  description: `${level} 级测试工具`,
  permission: level,
  parameters: { type: 'object', properties: {} },
}));

const policy = (mode: PermissionMode, allowExport = true): PermissionPolicy => ({ mode, allowExport });

describe('checkCall 模式 × 权限级矩阵（v7.9.0 三档：readonly / balanced / full）', () => {
  const modes: PermissionMode[] = ['readonly', 'balanced', 'full'];

  it('read：所有模式放行', () => {
    for (const m of modes) {
      expect(checkCall('fixture.read', policy(m), fixture)).toMatchObject({ decision: 'allow' });
    }
  });

  it('execute：所有模式放行（编译用于查看结果；改稿另有 write 级闸门）', () => {
    for (const m of modes) {
      expect(checkCall('fixture.execute', policy(m), fixture)).toMatchObject({ decision: 'allow' });
    }
  });

  it('write：readonly 拦截（附可行动指引），balanced 需审批，full 放行', () => {
    const ro = checkCall('fixture.write', policy('readonly'), fixture);
    expect(ro).toMatchObject({ decision: 'blocked' });
    expect(ro.reason).toContain('仅可查看');
    expect(ro.reason).toContain('切换');
    expect(checkCall('fixture.write', policy('balanced'), fixture)).toMatchObject({ decision: 'confirm' });
    expect(checkCall('fixture.write', policy('full'), fixture)).toMatchObject({ decision: 'allow' });
  });

  it('export：readonly 或 allowExport=false 拦截；balanced 确认；full 放行', () => {
    for (const m of modes) {
      expect(checkCall('fixture.export', policy(m, false), fixture)).toMatchObject({ decision: 'blocked' });
    }
    expect(checkCall('fixture.export', policy('readonly', true), fixture)).toMatchObject({ decision: 'blocked' });
    expect(checkCall('fixture.export', policy('balanced', true), fixture)).toMatchObject({ decision: 'confirm' });
    expect(checkCall('fixture.export', policy('full', true), fixture)).toMatchObject({ decision: 'allow' });
  });

  it('每个 decision 都带中文 reason', () => {
    for (const t of fixture) {
      for (const m of modes) {
        const r = checkCall(t.name, policy(m), fixture);
        expect(r.decision).toBeTruthy();
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('未知工具一律 blocked', () => {
    for (const m of modes) {
      expect(checkCall('who.am.i', policy(m))).toMatchObject({ decision: 'blocked' });
    }
  });

  it('默认查 PAPER_TOOLS：论文域工具按权限级判定', () => {
    expect(checkCall('library.search', policy('readonly'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('paper.read', policy('readonly'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.compile', policy('readonly'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.compile', policy('balanced'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.edit', policy('readonly'))).toMatchObject({ decision: 'blocked' });
    expect(checkCall('tex.edit', policy('full'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.edit', policy('balanced'))).toMatchObject({ decision: 'confirm' });
    expect(checkCall('memory.write', policy('readonly'))).toMatchObject({ decision: 'blocked' });
  });
});
