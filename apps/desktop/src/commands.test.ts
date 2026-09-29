import { describe, expect, it } from 'vitest';
import { buildCommands, type CommandContext } from './commands';

const ctx: CommandContext = {
  t: (key) => key,
  openSettings: () => {},
  focusFileTree: () => {},
  toast: () => {},
};

describe('buildCommands', () => {
  it('注册表非空且覆盖核心动作', () => {
    const cmds = buildCommands(ctx);
    expect(cmds.length).toBeGreaterThanOrEqual(8);
    const ids = cmds.map((c) => c.id);
    for (const required of ['project.new', 'file.new', 'file.save', 'theme.toggle', 'app.settings', 'view.focusTree', 'compile.clearLog', 'compile.run']) {
      expect(ids).toContain(required);
    }
    for (const c of cmds) {
      expect(c.title).toBeTruthy();
    }
  });

  it('命令 id 去重（无重复注册）', () => {
    const cmds = buildCommands(ctx);
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
