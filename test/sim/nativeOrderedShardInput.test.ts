import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds
} from '../../src/sim/orderedGoldfishBenchmark';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { canonicalStrategy } from '../../src/sim/strategy';

describe('native ordered shard input identity', () => {
  it('uses registered kingdoms for schema v2 but keeps the schema-v1 allowlist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-ordered-shard-'));
    const request = path.join(root, 'request.json'), metadata = path.join(root, 'metadata.json');
    const common = ['--kingdom', 'deep-beam-tuning-002', '--start-position', '0', '--end-position', '1',
      '--threads', '1', '--cpu', '1', '--seeds', '11', '--mode', 'compact',
      '--request', request, '--metadata', metadata];
    try {
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/native_ordered_shard_input.ts',
        ...common, '--schema-version', '2'], { cwd: process.cwd(), stdio: 'pipe' });
      const held = JSON.parse(fs.readFileSync(metadata, 'utf8')) as {
        schemaVersion: number; kingdomId: string; firstCanonical: string;
      };
      const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === held.kingdomId)!;
      registerKingdom(kingdom);
      const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
      expect(held).toMatchObject({ schemaVersion: 2, kingdomId: 'deep-beam-tuning-002',
        firstCanonical: canonicalStrategy(space.candidateAt(candidateIndexAt(0, space.candidateCount))) });
      expect(() => execFileSync(process.execPath, ['--import', 'tsx',
        'scripts/native_ordered_shard_input.ts', ...common, '--schema-version', '1'],
      { cwd: process.cwd(), stdio: 'pipe' })).toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
