import { describe, expect, it } from 'vitest';
import type { PermissionLevel, ToolDef } from '@scholarforge/shared';
import { checkCall } from './permissions';
import type { PermissionMode, PermissionPolicy } from './permissions';

const fixture: ToolDef[] = (['read', 'execute', 'write', 'export'] as PermissionLevel[]).map((level) => ({
  name: `fixture.${level}`,
  description: `${level} 级测试工具`,
  permission: level,
  parameters: { type: 'object', properties: {} },
}));

const policy = (mode: PermissionMode, allowExport = true): PermissionPolicy => ({ mode, allowExport });

describe('checkCall 模式 × 权限级矩阵', () => {
  const modes: PermissionMode[] = ['strict', 'balanced', 'yolo'];

  it('read：所有模式放行', () => {
    for (const m of modes) {
      expect(checkCall('fixture.read', policy(m), fixture)).toMatchObject({ decision: 'allow' });
    }
  });

  it('execute：strict 确认，balanced/yolo 放行', () => {
    expect(checkCall('fixture.execute', policy('strict'), fixture)).toMatchObject({ decision: 'confirm' });
    expect(checkCall('fixture.execute', policy('balanced'), fixture)).toMatchObject({ decision: 'allow' });
    expect(checkCall('fixture.execute', policy('yolo'), fixture)).toMatchObject({ decision: 'allow' });
  });

  it('write：yolo 放行，strict/balanced 需审批', () => {
    expect(checkCall('fixture.write', policy('strict'), fixture)).toMatchObject({ decision: 'confirm' });
    expect(checkCall('fixture.write', policy('balanced'), fixture)).toMatchObject({ decision: 'confirm' });
    expect(checkCall('fixture.write', policy('yolo'), fixture)).toMatchObject({ decision: 'allow' });
  });

  it('export：allowExport=false 拦截，=true 时所有模式仍需显式确认', () => {
    for (const m of modes) {
      expect(checkCall('fixture.export', policy(m, false), fixture)).toMatchObject({ decision: 'blocked' });
      expect(checkCall('fixture.export', policy(m, true), fixture)).toMatchObject({ decision: 'confirm' });
    }
  });

  it('每个 decision 都带中文 reason', () => {
    for (const t of fixture) {
      const r = checkCall(t.name, policy('balanced'), fixture);
      expect(r.decision).toBeTruthy();
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('未知工具一律 blocked', () => {
    for (const m of modes) {
      expect(checkCall('who.am.i', policy(m))).toMatchObject({ decision: 'blocked' });
    }
  });

  it('默认查 PAPER_TOOLS：论文域工具按权限级判定', () => {
    expect(checkCall('library.search', policy('strict'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('paper.read', policy('strict'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.compile', policy('strict'))).toMatchObject({ decision: 'confirm' });
    expect(checkCall('tex.compile', policy('balanced'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.edit', policy('yolo'))).toMatchObject({ decision: 'allow' });
    expect(checkCall('tex.edit', policy('balanced'))).toMatchObject({ decision: 'confirm' });
    expect(checkCall('memory.write', policy('strict'))).toMatchObject({ decision: 'confirm' });
  });
});
