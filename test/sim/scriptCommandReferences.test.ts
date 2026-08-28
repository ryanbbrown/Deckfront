import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

function typescriptFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return typescriptFiles(file);
    return entry.isFile() && entry.name.endsWith('.ts') ? [file] : [];
  });
}

describe('retained script command references', () => {
  it('invokes only npm scripts that package.json defines', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as PackageJson;
    const defined = new Set(Object.keys(packageJson.scripts ?? {}));
    const missing: string[] = [];
    const invocation = /(?:spawnSync|execFileSync)\(\s*['"]npm['"]\s*,\s*\[\s*['"]run['"]\s*,\s*['"]([^'"]+)['"]/g;

    for (const file of typescriptFiles('scripts')) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(invocation)) {
        if (!defined.has(match[1]!)) missing.push(`${file}: ${match[1]}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
