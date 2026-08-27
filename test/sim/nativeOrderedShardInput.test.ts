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
  ORDERED_PRODUCT_SPACE_COUNT, combineScoreEvidence, compactProfileEvidence, compareRankedRecords,
  deriveCurrentOrderedProductIdentity, deriveScoreEvidence, provenanceDigest, rankingKey, sha256Bytes
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

  it('chains bounded candidate digests to the exact one-shot canonical shard digest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-ordered-digest-'));
    const run = (name: string, start: number, end: number, prior?: string): { metadata: {
      priorCandidateDigest: string | null; candidateDigest: string; startPosition: number; endPosition: number;
    }; canonical: string[] } => {
      const request = path.join(root, `${name}.request.json`), metadata = path.join(root, `${name}.metadata.json`);
      const args = ['--schema-version', '2', '--kingdom', 'deep-beam-tuning-002',
        '--start-position', String(start), '--end-position', String(end), '--threads', '1', '--cpu', '1',
        '--seeds', '11', '--mode', 'compact', '--request', request, '--metadata', metadata,
        ...(prior ? ['--candidate-digest', prior] : [])];
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/native_ordered_shard_input.ts', ...args],
        { cwd: process.cwd(), stdio: 'pipe' });
      const held = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      const payload = JSON.parse(fs.readFileSync(request, 'utf8')).payload as {
        strategies: Array<{ canonicalStrategy: string }> };
      return { metadata: held, canonical: payload.strategies.map((entry) => entry.canonicalStrategy) };
    };
    try {
      const full = run('full', 0, 7), first = run('first', 0, 3);
      const second = run('second', 3, 7, first.metadata.candidateDigest);
      expect(second.metadata).toMatchObject({ priorCandidateDigest: first.metadata.candidateDigest,
        startPosition: 3, endPosition: 7, candidateDigest: full.metadata.candidateDigest });
      expect([...first.canonical, ...second.canonical]).toEqual(full.canonical);
      expect(full.metadata.candidateDigest).toBe(stableHash(full.canonical.join('\n')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('merges bounded stage-one chunks to the exact one-shot checkpoint bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-ordered-stage-one-'));
    const kingdomId = 'deep-beam-tuning-002', seeds = [11, 12, 13, 14];
    const ruleFingerprint = nativeRuleFingerprint(kingdomId, 30, 200);
    const productArgs = ['--schema-version', '2', '--kingdom', kingdomId, '--seeds', seeds.join(','),
      '--build-version', 'fixture', '--scorer-version', 'native-goldfish-v1', '--run-id', 'fixture',
      '--rule-fingerprint', ruleFingerprint, '--retained-count', '3', '--reservoir-count', '1'];
    const create = (directory: string, start: number, end: number, shardId: number,
      prior?: string): { checkpoint: string; metadata: string; candidateDigest: string } => {
      fs.mkdirSync(directory, { recursive: true });
      const request = path.join(directory, 'request.json'), metadata = path.join(directory, 'metadata.json');
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/native_ordered_shard_input.ts',
        '--schema-version', '2', '--kingdom', kingdomId, '--start-position', String(start),
        '--end-position', String(end), '--threads', '1', '--cpu', '1', '--seeds', String(seeds[0]),
        '--mode', 'full', '--request', request, '--metadata', metadata,
        ...(prior ? ['--candidate-digest', prior] : [])], { cwd: process.cwd(), stdio: 'pipe' });
      const payload = JSON.parse(fs.readFileSync(request, 'utf8')).payload as {
        strategies: Array<{ id: string; canonicalStrategy: string }> };
      const scores = payload.strategies.map((strategy, index) => ({ strategyId: strategy.id,
        collisionTieKey: strategy.canonicalStrategy, profiles: ORDERED_PRODUCT_PROFILES.map((profile) => ({
          profile, score: { trials: 1, completions: (start + index) % 2,
            penalizedTurnsTo50: 100 - start - index, damageArea: start + index,
            moneySpent: start + index } })) }));
      const response = path.join(directory, 'response.json');
      fs.writeFileSync(response, JSON.stringify({ ok: true, result: { scores } }));
      const checkpoint = path.join(directory, 'shard.json');
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/ordered_goldfish_product.ts',
        'stage-one-checkpoint', '--request', request, '--response', response, '--metadata', metadata,
        '--out', checkpoint, '--shard-id', String(shardId), '--start-position', String(start),
        '--end-position', String(end), ...productArgs], { cwd: process.cwd(), stdio: 'pipe' });
      return { checkpoint, metadata,
        candidateDigest: JSON.parse(fs.readFileSync(metadata, 'utf8')).candidateDigest as string };
    };
    try {
      const full = create(path.join(root, 'full'), 0, 6, 0);
      const first = create(path.join(root, 'chunks', '0'), 0, 3, 0);
      const second = create(path.join(root, 'chunks', '1'), 3, 6, 1, first.candidateDigest);
      const manifest = path.join(root, 'manifest.json');
      fs.writeFileSync(manifest, JSON.stringify([first, second].map(({ checkpoint, metadata }) =>
        ({ checkpoint, metadata }))));
      const mergedDirectory = path.join(root, 'merged'); fs.mkdirSync(mergedDirectory);
      const merged = path.join(mergedDirectory, 'shard.json');
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/ordered_goldfish_product.ts',
        'stage-one-merge-shard', '--manifest', manifest, '--out', merged,
        '--metadata-out', path.join(mergedDirectory, 'metadata.json'), '--shard-id', '0',
        '--start-position', '0', '--end-position', '6', ...productArgs],
      { cwd: process.cwd(), stdio: 'pipe' });
      expect(fs.readFileSync(merged, 'utf8')).toBe(fs.readFileSync(full.checkpoint, 'utf8'));
      expect(fs.readFileSync(`${merged}.records.jsonl`, 'utf8'))
        .toBe(fs.readFileSync(`${full.checkpoint}.records.jsonl`, 'utf8'));
      const corrupt = JSON.parse(fs.readFileSync(second.metadata, 'utf8'));
      corrupt.priorCandidateDigest = '000000001';
      fs.writeFileSync(second.metadata, JSON.stringify(corrupt));
      expect(() => execFileSync(process.execPath, ['--import', 'tsx',
        'scripts/ordered_goldfish_product.ts', 'stage-one-merge-shard', '--manifest', manifest,
        '--out', merged, '--metadata-out', path.join(mergedDirectory, 'metadata.json'),
        '--shard-id', '0', '--start-position', '0', '--end-position', '6', ...productArgs],
      { cwd: process.cwd(), stdio: 'pipe' })).toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  it('keeps exact stage-two checkpoint bytes across bounded stream layouts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-ordered-stage-two-'));
    const kingdomId = 'deep-beam-tuning-002', seeds = [11, 12, 13, 14];
    const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === kingdomId)!;
    registerKingdom(kingdom);
    const identity = deriveCurrentOrderedProductIdentity({ kingdomId, seeds,
      scorerVersion: 'native-goldfish-v1', buildVersion: 'fixture' });
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
    const profiles = ORDERED_PRODUCT_PROFILES.map((profile) => ({ profile, trials: 1,
      completions: 0, penalizedTurnsTo50: 10, damageArea: 1, moneySpent: 1 }));
    const stageOne = deriveScoreEvidence(profiles);
    const cohortRecords = [0, 1].map((traversalPosition) => {
      const strategy = space.candidateAt(candidateIndexAt(traversalPosition, space.candidateCount));
      return { traversalPosition, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy),
        strategy, stageOne, stageOneRankingKey: rankingKey(stageOne), stageOneRank: traversalPosition + 1 };
    });
    const partFile = path.join(root, 'cohort.part-0000.jsonl');
    const partText = cohortRecords.map((record) => JSON.stringify(record)).join('\n') + '\n';
    fs.writeFileSync(partFile, partText);
    const config = { kingdomId, candidateCount: ORDERED_PRODUCT_SPACE_COUNT, retainedCount: 2,
      reservoirCount: 1, seeds, profiles: [...ORDERED_PRODUCT_PROFILES], turnLimit: 30,
      actionCapPerTurn: 200, collisionAllowance: ORDERED_PRODUCT_COLLISION_ALLOWANCE };
    const shards = [{ shardId: 0, startPosition: 0, endPosition: ORDERED_PRODUCT_SPACE_COUNT,
      completeCount: ORDERED_PRODUCT_SPACE_COUNT, retainedCount: 2, candidateDigest: stableHash('candidates'),
      scoreDigest: stableHash('scores'), contentDigest: stableHash('shard') }];
    const cohortBase = { schemaVersion: 2, version: CURRENT_ORDERED_PRODUCT_VERSION, productIdentity: identity,
      runId: 'fixture', buildVersion: 'fixture', ruleFingerprint: nativeRuleFingerprint(kingdomId, 30, 200),
      scorerVersion: 'native-goldfish-v1', config, shards, provenanceDigest: provenanceDigest(shards),
      recordCount: 2, stageOneOrderDigest: createHash('sha256').update('order').digest('hex'),
      parts: [{ file: path.basename(partFile), startIndex: 0, endIndex: 2, count: 2,
        sha256: sha256Bytes(partText) }] };
    const cohort = { ...cohortBase, contentDigest: stableHash(JSON.stringify(cohortBase)) };
    const cohortFile = path.join(root, 'cohort.json'); fs.writeFileSync(cohortFile, JSON.stringify(cohort));
    const metadata = path.join(root, 'metadata.json');
    fs.writeFileSync(metadata, JSON.stringify({ kingdomId, completeCount: 2,
      candidateDigest: stableHash(cohortRecords.map((record) => record.canonicalStrategy).join('\n')),
      ruleFingerprint: cohort.ruleFingerprint, shuffleSeeds: seeds.slice(1) }));
    const raws = cohortRecords.map((record, index) => ({ strategyId: record.displayId,
      collisionTieKey: record.canonicalStrategy, profiles: ORDERED_PRODUCT_PROFILES.map((profile) => ({
        profile, score: { trials: 3, completions: index + 1, penalizedTurnsTo50: 20 - index,
          damageArea: 10 + index, moneySpent: 4 + index } })) }));
    const writeStream = (file: string, blank: boolean): void => fs.writeFileSync(file, [
      '{"schemaVersion":1,"type":"score-batch-start","scoreCount":2}',
      ...(blank ? ['   ', ''] : []), ...raws.map((raw) => JSON.stringify(raw)),
      ...(blank ? ['\t'] : []), '{"schemaVersion":1,"type":"score-batch-end","scoreCount":2}'
    ].join('\n') + '\n');
    const responseA = path.join(root, 'response-a.ndjson'), responseB = path.join(root, 'response-b.ndjson');
    writeStream(responseA, false); writeStream(responseB, true);
    const productArgs = ['--schema-version', '2', '--kingdom', kingdomId, '--seeds', seeds.join(','),
      '--build-version', 'fixture', '--scorer-version', 'native-goldfish-v1', '--run-id', 'fixture',
      '--rule-fingerprint', cohort.ruleFingerprint, '--retained-count', '2', '--reservoir-count', '1'];
    const run = (directory: string, response: string): string => {
      fs.mkdirSync(directory); const output = path.join(directory, 'shard.json');
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/ordered_goldfish_product.ts',
        'stage-two-checkpoint', '--cohort', cohortFile, '--response', response, '--metadata', metadata,
        '--out', output, '--shard-id', '0', '--start-position', '0', '--end-position', '2', ...productArgs],
      { cwd: process.cwd(), stdio: 'pipe' });
      return output;
    };
    try {
      const first = run(path.join(root, 'first'), responseA), second = run(path.join(root, 'second'), responseB);
      expect(fs.readFileSync(first, 'utf8')).toBe(fs.readFileSync(second, 'utf8'));
      expect(fs.readFileSync(`${first}.records.jsonl`, 'utf8'))
        .toBe(fs.readFileSync(`${second}.records.jsonl`, 'utf8'));
      const expected = cohortRecords.map((record, index) => {
        const additional = compactProfileEvidence(raws[index]!);
        const combined = combineScoreEvidence(record.stageOne, additional);
        return { ...record, additional, combined, combinedRankingKey: rankingKey(combined), rank: 0 };
      }).sort(compareRankedRecords);
      expect(fs.readFileSync(`${first}.records.jsonl`, 'utf8'))
        .toBe(expected.map((record) => JSON.stringify(record)).join('\n') + '\n');
      const checkpoint = JSON.parse(fs.readFileSync(first, 'utf8'));
      expect(checkpoint.shard.scoreDigest).toBe(stableHash(expected.map((record) =>
        `${rankingKey(record.combined).join('\t')}\t${record.displayId}\t${record.canonicalStrategy}`
          + `\t${record.traversalPosition}`).join('\n')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

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
