import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerKingdom } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import {
  COMPACT_GOLDFISH_RECORD_BYTES, compactScoreEvidence, createGoldfishArtifactV3,
  createGoldfishReservoirV3, decodeCompactScoreRecord, encodeCompactScoreRecord, goldfishFinalBytes,
  readCompactScoreFile, readCompactStageTwoFiles, reduceCompactStageOne, reduceCompactStageTwo,
  referenceGoldfishReduction, validateGoldfishArtifactV3, validateGoldfishReservoirV3,
  writeCompactScoreFile
} from '../../src/sim/strategySearchCompact';
import { combineScoreEvidence, deriveScoreEvidence, rankingKey } from '../../src/sim/orderedGoldfishProduct';
import type { OrderedProductProfileEvidence, OrderedProductStageOneRecord } from '../../src/sim/orderedGoldfishProduct';
import { canonicalStrategy, fixedBuyPlan } from '../../src/sim/strategy';
import { scoreMovementAwareGoldfishStrategy } from '../../src/sim/goldfish';
import { candidateIndexAt, createOrderedCandidateSpace, orderedGoldfishCardIds } from '../../src/sim/orderedGoldfishBenchmark';
import type { Strategy } from '../../src/sim/strategy';

const evidenceId = 'a'.repeat(64);
beforeAll(() => registerKingdom(deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-002')!));
const id = (value: number) => `sg-${value.toString(16).padStart(10, '0')}`;
function profiles(value: number): OrderedProductProfileEvidence[] { return ['stationary', 'chaser', 'kiter']
  .map((profile, index) => ({ profile, trials: 1, completions: value % 2,
    penalizedTurnsTo50: 50 - value, damageArea: value * 100 + index, moneySpent: value * 10 + index })); }
function strategies(): Strategy[] { return Array.from({ length: 12 }, (_unused, index) => ({ id: id(index),
  startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: index % 2 ? 'volley' : 'drive',
    desiredCount: index + 1 }]) })); }
function compact(position: number, strategy = strategies()[position]!) { return { traversalPosition: position,
  displayId: strategy.id, profiles: profiles(position) }; }

describe('deterministic compact Goldfish format', () => {
  it('encodes every primitive metric in one fixed-width record with no operational fields', () => {
    const record = compact(4), encoded = encodeCompactScoreRecord(record);
    expect(encoded).toHaveLength(COMPACT_GOLDFISH_RECORD_BYTES);
    expect(decodeCompactScoreRecord(encoded)).toEqual(record);
    expect(compactScoreEvidence(record)).toMatchObject({ worstDamageArea: 400, totalMoneySpent: 123 });
  });

  it('seals sorted full-range files and rejects corruption, gaps, and duplicate positions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-'));
    try {
      const file = path.join(root, 'job.hgs');
      writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: 0, semanticEnd: 4,
        records: [compact(3), compact(1), compact(0), compact(2)] });
      expect(readCompactScoreFile(file, { evidenceId, stage: 'stage-one' }).records).toHaveLength(4);
      const bytes = fs.readFileSync(file); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      fs.writeFileSync(file, bytes);
      expect(() => readCompactScoreFile(file)).toThrow();
      expect(() => writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: 0,
        semanticEnd: 2, records: [compact(0), compact(0)] })).toThrow('overlap');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('matches the independent reducer across materially different layouts and completion order', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-layout-')), held = strategies();
    const stageOne: OrderedProductStageOneRecord[] = held.map((strategy, position) => {
      const evidence = deriveScoreEvidence(profiles(position));
      return { traversalPosition: position, displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy),
        strategy, stageOne: evidence, stageOneRankingKey: rankingKey(evidence) };
    });
    const additional = new Map(stageOne.map((record, index) => [record.traversalPosition,
      deriveScoreEvidence(profiles(20 - index))]));
    const reference = referenceGoldfishReduction({ stageOne, additionalByPosition: additional,
      retainedCount: 8, reservoirCount: 3 });
    const execute = (sizes: number[], order: number[]) => {
      const files: string[] = []; let start = 0;
      for (const size of sizes) { const end = Math.min(start + size, held.length), file = path.join(root, `${sizes.join('-')}-${start}.hgs`);
        writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: start, semanticEnd: end,
          records: Array.from({ length: end - start }, (_unused, index) => compact(start + index)) });
        files.push(file); start = end; }
      const selected = reduceCompactStageOne({ files: order.map((index) => files[index]!), evidenceId,
        total: held.length, retainCount: 8, collisionAllowance: 1_024, strategyAt: (position) => held[position]! });
      const second = selected.map((record, ordinal) => ({ traversalPosition: ordinal, displayId: record.displayId,
        profiles: additional.get(record.traversalPosition)!.profiles }));
      const secondFiles: string[] = [], secondSize = sizes.length === 1 ? selected.length : 2;
      for (let secondStart = 0; secondStart < selected.length; secondStart += secondSize) {
        const secondEnd = Math.min(secondStart + secondSize, selected.length);
        const file = path.join(root, `second-${sizes.length}-${secondStart}.hgs`);
        writeCompactScoreFile({ file, evidenceId, stage: 'stage-two', semanticStart: secondStart,
          semanticEnd: secondEnd, records: second.slice(secondStart, secondEnd) }); secondFiles.push(file);
      }
      const stageTwo = readCompactStageTwoFiles({ files: [...secondFiles].reverse(), evidenceId,
        total: selected.length });
      const ranked = reduceCompactStageTwo({ stageOne: selected, additional: stageTwo, reservoirCount: 3 });
      const top = createGoldfishArtifactV3({ evidenceId, kingdomId: 'fixture', candidateCount: held.length,
        seeds: [1, 2, 3, 4], retainedCount: selected.length, reservoirCount: 3, records: selected });
      const reservoir = createGoldfishReservoirV3({ evidenceId, sourceArtifactHash: top.artifactHash,
        entries: ranked.slice(0, 3) });
      return { selected, ranked, top, reservoir };
    };
    try {
      const one = execute([12], [0]), many = execute([2, 3, 1, 4, 2], [4, 2, 0, 3, 1]);
      expect(one.selected).toEqual(reference.stageOne); expect(many.selected).toEqual(reference.stageOne);
      expect(one.ranked).toEqual(reference.ranked); expect(many.ranked).toEqual(reference.ranked);
      expect(goldfishFinalBytes(one.top)).toEqual(goldfishFinalBytes(many.top));
      expect(goldfishFinalBytes(one.reservoir)).toEqual(goldfishFinalBytes(many.reservoir));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('matches frozen direct-scorer evidence and combined membership without sharing reducer code', () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds('deep-beam-tuning-002'));
    const held = Array.from({ length: 6 }, (_unused, position) =>
      space.candidateAt(candidateIndexAt(position, space.candidateCount)));
    const score = (strategy: Strategy, seeds: number[]) => deriveScoreEvidence(
      scoreMovementAwareGoldfishStrategy(strategy, { kingdomId: 'deep-beam-tuning-002', seeds,
        turnLimit: 30, actionCapPerTurn: 200 }).profiles.map((entry) => ({ profile: entry.profile,
        trials: entry.score.trials, completions: entry.score.completions,
        penalizedTurnsTo50: entry.score.penalizedTurnsTo50, damageArea: entry.score.damageArea,
        moneySpent: entry.score.moneySpent })));
    const ordinary = held.map((strategy, position): OrderedProductStageOneRecord => {
      const stageOne = score(strategy, [4_100_000]); return { traversalPosition: position,
        displayId: strategy.id, canonicalStrategy: canonicalStrategy(strategy), strategy, stageOne,
        stageOneRankingKey: rankingKey(stageOne) }; });
    const additional = new Map(ordinary.map((record) => [record.traversalPosition,
      score(record.strategy, [4_100_001, 4_100_002, 4_100_003])]));
    const reference = referenceGoldfishReduction({ stageOne: ordinary, additionalByPosition: additional,
      retainedCount: 6, reservoirCount: 3 });
    expect(reference.stageOne.map((entry) => entry.displayId).slice(0, 3))
      .toEqual(['sg-9f56e4e7bf', 'sg-a7c8c1e3c9', 'sg-6eae0136c3']);
    expect(reference.ranked.map((entry) => entry.displayId)).toEqual([
      'sg-a7c8c1e3c9', 'sg-9f56e4e7bf', 'sg-8654661bca',
      'sg-6eae0136c3', 'sg-62a2ae80c4', 'sg-6201ef26c5']);
    expect(reference.ranked[0]!.combined)
      .toEqual(combineScoreEvidence(reference.ranked[0]!.stageOne, reference.ranked[0]!.additional));
    const top = createGoldfishArtifactV3({ evidenceId, kingdomId: 'deep-beam-tuning-002',
      candidateCount: 6, seeds: [4_100_000], retainedCount: 6, reservoirCount: 3,
      records: reference.stageOne });
    const reservoir = createGoldfishReservoirV3({ evidenceId, sourceArtifactHash: top.artifactHash,
      entries: reference.reservoir });
    expect(validateGoldfishArtifactV3(top)).toBe(true);
    expect(validateGoldfishReservoirV3(reservoir, top)).toBe(true);
    expect(validateGoldfishReservoirV3({ ...reservoir, sourceArtifactHash: 'b'.repeat(64) }, top)).toBe(false);
  });

  it('uses canonical strategy then traversal position for a display-ID collision at the cutoff', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-collision-'));
    const held = strategies().slice(0, 4); held[2] = { ...held[2]!, id: id(9) }; held[3] = { ...held[3]!, id: id(9) };
    const records = held.map((strategy, position) => ({ traversalPosition: position, displayId: strategy.id,
      profiles: profiles(10) }));
    try {
      const left = path.join(root, 'left.hgs'), right = path.join(root, 'right.hgs');
      writeCompactScoreFile({ file: left, evidenceId, stage: 'stage-one', semanticStart: 0, semanticEnd: 2,
        records: records.slice(0, 2), canonicalAt: (position) => canonicalStrategy(held[position]!) });
      writeCompactScoreFile({ file: right, evidenceId, stage: 'stage-one', semanticStart: 2, semanticEnd: 4,
        records: records.slice(2), canonicalAt: (position) => canonicalStrategy(held[position]!) });
      const reduced = reduceCompactStageOne({ files: [right, left], evidenceId, total: 4, retainCount: 3,
        collisionAllowance: 1_024, strategyAt: (position) => held[position]! });
      expect(new Set(reduced.map((entry) => entry.displayId)).size).toBe(3);
      expect(reduced.filter((entry) => entry.displayId === id(9))).toHaveLength(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
