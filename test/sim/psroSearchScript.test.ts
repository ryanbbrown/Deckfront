import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runWrapper(extraArguments: string[] = []): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-wrapper-'));
  try {
    const binary = path.join(root, 'fake-goldfish');
    const callLog = path.join(root, 'calls.txt');
    fs.writeFileSync(binary, '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$CALL_LOG"\n');
    fs.chmodSync(binary, 0o755);
    execFileSync('bash', ['scripts/psro_search.sh', 'kingdom', '4', 'top', 'reservoir',
      'matrix', path.join(root, 'out'), ...extraArguments], { env: {
      ...process.env, HEXDECK_GOLDFISH_BIN: binary, CALL_LOG: callLog
    } });
    return fs.readFileSync(callLog, 'utf8').trim().split('\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('PSRO search wrapper', () => {
  it('skips deep verification by default', () => {
    expect(runWrapper()).toEqual(['psro']);
  });

  it('runs deep verification when requested', () => {
    expect(runWrapper(['--verify'])).toEqual(['psro', 'psro-verify']);
  });
});
