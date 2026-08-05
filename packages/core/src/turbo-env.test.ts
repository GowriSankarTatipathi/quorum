import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('turbo.json environment configuration', () => {
  it('includes all accessed process.env variables in globalEnv', () => {
    const rootDir = join(__dirname, '../../..');
    const turboJsonPath = join(rootDir, 'turbo.json');
    const turboJson = JSON.parse(readFileSync(turboJsonPath, 'utf8')) as { globalEnv?: string[] };
    const globalEnv: string[] = turboJson.globalEnv || [];

    // Find all process.env accesses in the codebase
    // Using git grep ensures we only search tracked files and respect ignores
    const output = execSync(
      'git grep -h -o "process.env\\.[A-Za-z0-9_]\\+" -- apps packages',
      { cwd: rootDir, encoding: 'utf8' }
    );

    const accesses = new Set(
      output
        .split('\n')
        .filter(Boolean)
        .map((match) => match.replace('process.env.', ''))
    );

    const missing: string[] = [];

    for (const accessed of accesses) {
      const isCovered = globalEnv.some((envVar) => {
        if (envVar.endsWith('*')) {
          const prefix = envVar.slice(0, -1);
          return accessed.startsWith(prefix);
        }
        return envVar === accessed;
      });

      if (!isCovered) {
        missing.push(accessed);
      }
    }

    expect(missing, `Variables read from process.env are missing from turbo.json globalEnv`).toEqual([]);
  });
});
