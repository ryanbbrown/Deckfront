import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds
} from '../../src/sim/orderedGoldfishBenchmark';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  CURRENT_ORDERED_PRODUCT_VERSION, ORDERED_PRODUCT_COLLISION_ALLOWANCE, ORDERED_PRODUCT_PROFILES,
  ORDERED_PRODUCT_SPACE_COUNT, deriveCurrentOrderedProductIdentity, deriveScoreEvidence, provenanceDigest,
  rankingKey, sha256Bytes
} from '../../src/sim/orderedGoldfishProduct';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { canonicalStrategy, stableHash } from '../../src/sim/strategy';

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

  it('rejects an impossible current-schema cohort record before stage-two scoring', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-ordered-cohort-'));
    const kingdomId = 'deep-beam-tuning-002', seeds = [11, 12, 13, 14];
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!;
    registerKingdom(kingdom);
    const identity = deriveCurrentOrderedProductIdentity({ kingdomId, seeds,
      scorerVersion: 'native-goldfish-v1', buildVersion: 'fixture' });
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
    const wrong = space.candidateAt(candidateIndexAt(1, space.candidateCount));
    const profiles = ORDERED_PRODUCT_PROFILES.map((profile) => ({ profile, trials: 1,
      completions: 0, penalizedTurnsTo50: 1, damageArea: 0, moneySpent: 0 }));
    const stageOne = deriveScoreEvidence(profiles);
    const record = { traversalPosition: 0, displayId: wrong.id, canonicalStrategy: canonicalStrategy(wrong),
      strategy: wrong, stageOne, stageOneRankingKey: rankingKey(stageOne), stageOneRank: 1 };
    const partFile = path.join(root, 'cohort.part-0000.jsonl');
    const partText = `${JSON.stringify(record)}\n`; fs.writeFileSync(partFile, partText);
    const config = { kingdomId, candidateCount: ORDERED_PRODUCT_SPACE_COUNT, retainedCount: 1,
      reservoirCount: 1, seeds, profiles: [...ORDERED_PRODUCT_PROFILES], turnLimit: 30,
      actionCapPerTurn: 200, collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE };
    const shards: never[] = [];
    const base = { schemaVersion: 2, version: CURRENT_ORDERED_PRODUCT_VERSION, productIdentity: identity,
      runId: 'fixture', buildVersion: 'fixture', ruleFingerprint: nativeRuleFingerprint(kingdomId, 30, 200),
      scorerVersion: 'native-goldfish-v1', config, shards, provenanceDigest: provenanceDigest(shards),
      recordCount: 1, stageOneOrderDigest: createHash('sha256').update('unused').digest('hex'),
      parts: [{ file: path.basename(partFile), startIndex: 0, endIndex: 1, count: 1,
        sha256: sha256Bytes(partText) }] };
    const cohort = { ...base, contentDigest: stableHash(JSON.stringify(base)) };
    const cohortFile = path.join(root, 'cohort.json'); fs.writeFileSync(cohortFile, JSON.stringify(cohort));
    try {
      expect(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/ordered_goldfish_product.ts',
        'stage-two-input', '--schema-version', '2', '--kingdom', kingdomId, '--seeds', seeds.join(','),
        '--build-version', 'fixture', '--scorer-version', 'native-goldfish-v1', '--retained-count', '1',
        '--reservoir-count', '1', '--cohort', cohortFile, '--start-position', '0', '--end-position', '1',
        '--threads', '1', '--request', path.join(root, 'request.json'), '--metadata', path.join(root, 'meta.json')],
      { cwd: process.cwd(), stdio: 'pipe' })).toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
