import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { deriveSourceImageIdentity } from '../src/sim/strategySearchCampaign';
import type { SourceImageIdentity } from '../src/sim/strategySearchCampaign';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function executableSourcePaths(root: string): string[] {
  const file = path.join(root, 'strategy-search-image-files.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string') || new Set(value).size !== value.length
    || !value.includes('strategy-search-image-files.json')) throw new Error('Executable image allowlist is invalid.');
  return [...value].sort();
}

export function validateStrategySearchImageClosure(root: string, expectedPaths: readonly string[]): void {
  const allowed = new Set(expectedPaths);
  const dependencyPattern = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]/g;
  for (const source of expectedPaths.filter((entry) => /\.(?:[cm]?js|tsx?)$/.test(entry))) {
    const text = fs.readFileSync(path.join(root, source), 'utf8');
    dependencyPattern.lastIndex = 0;
    for (const match of text.matchAll(dependencyPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier?.startsWith('.')) continue;
      const base = path.resolve(root, path.dirname(source), specifier);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, 'index.ts'),
        path.join(base, 'index.tsx')];
      const dependency = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!dependency) throw new Error(`Runtime dependency ${specifier} imported by ${source} cannot be resolved.`);
      const relative = path.relative(root, dependency).split(path.sep).join('/');
      if (relative.startsWith('../') || !allowed.has(relative)) {
        throw new Error(`Executable image allowlist omits runtime dependency ${relative} imported by ${source}.`);
      }
    }
  }
}

export function deriveTrackedStrategySearchSourceImage(root: string): SourceImageIdentity {
  const expectedPaths = executableSourcePaths(root);
  validateStrategySearchImageClosure(root, expectedPaths);
  const scientificPaths = JSON.parse(fs.readFileSync(path.join(root,
    'strategy-search-scientific-files.json'), 'utf8')) as unknown;
  if (!Array.isArray(scientificPaths) || scientificPaths.some((entry) => typeof entry !== 'string')
    || scientificPaths.some((entry) => !expectedPaths.includes(entry))) {
    throw new Error('Scientific source allowlist is invalid.');
  }
  const tracked = new Set(git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const missing = expectedPaths.filter((entry) => !tracked.has(entry) || !fs.existsSync(path.join(root, entry)));
  if (missing.length) throw new Error(`Executable image allowlist has missing or untracked files: ${missing.join(', ')}`);
  const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean)
    .map((entry) => entry.slice(3)).filter((entry) => expectedPaths.includes(entry));
  return deriveSourceImageIdentity({ expectedPaths, scientificPaths, dirtyExecutablePaths: dirty,
    files: expectedPaths.map((relative) => ({ path: relative, content: fs.readFileSync(path.join(root, relative)) })) });
}

export function streamProcess(input: { executable: string; phase: string; args: string[];
  timeoutMs: number }): Promise<string> {
  const startedMs = Date.now();
  process.stdout.write(`${JSON.stringify({ type: `${input.phase}-started`, startedMs,
    command: [input.executable, ...input.args] })}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutTail = '', stderrTail = '', timedOut = false;
    const append = (tail: string, chunk: Buffer): string => (tail + chunk.toString()).slice(-4_000_000);
    child.stdout.on('data', (chunk: Buffer) => { process.stdout.write(chunk); stdoutTail = append(stdoutTail, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(chunk); stderrTail = append(stderrTail, chunk); });
    let forceKill: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, input.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      const finishedMs = Date.now(), event = { startedMs, finishedMs, elapsedMs: finishedMs - startedMs };
      if (code === 0 && !timedOut) {
        process.stdout.write(`${JSON.stringify({ type: `${input.phase}-complete`, ...event })}\n`);
        resolve(stdoutTail);
      } else {
        process.stdout.write(`${JSON.stringify({ type: `${input.phase}-failed`, ...event,
          code, signal, timedOut })}\n`);
        const failureTail = `${stderrTail}\n${stdoutTail}`.slice(-4000);
        reject(new Error(`Modal ${input.phase} failed: ${failureTail}`));
      }
    });
  });
}
