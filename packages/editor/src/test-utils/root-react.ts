/**
 * 测试辅助：取得 monorepo 根 node_modules 的 require。
 *
 * 背景：npm workspaces 把 react 19 提升到根，而本包嵌套了 react 18，
 * @testing-library/react 与 react-dom 均解析到根 react 19。
 * 组件测试里用 vi.mock 把 'react'/'react/jsx-runtime' 重定向到根实例，
 * 保证整个测试模块图与 react-dom 使用同一份 React（否则元素 $$typeof 符号不一致）。
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findMonorepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      const data = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
      if (data.workspaces) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('未找到 monorepo 根目录（package.json with workspaces）');
    dir = parent;
  }
}

export function rootReactRequire(): NodeRequire {
  return createRequire(join(findMonorepoRoot(), 'package.json'));
}
