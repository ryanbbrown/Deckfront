import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_GOLDFISH_RECORD_BYTES, compactScoreEvidence, decodeCompactScoreRecord, encodeCompactScoreRecord,
  goldfishFinalBytes, readCompactScoreFile, readCompactStageTwoFiles, readGoldfishArtifactV4,
  readGoldfishReservoirV4, reduceCompactStageOne, reduceCompactStageTwo, writeCompactScoreFile,
  writeGoldfishArtifactV4, writeGoldfishReservoirV4
} from '../../src/sim/strategySearchCompact';
import { deriveScoreEvidence } from '../../src/sim/orderedGoldfishProduct';
import type { OrderedProductProfileEvidence } from '../../src/sim/orderedGoldfishProduct';
import { canonicalStrategy, fixedBuyPlan } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

const evidenceId = 'a'.repeat(64);
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

  it('seals buffered full-range files and rejects corruption and duplicate positions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-'));
    try {
      const file = path.join(root, 'job.hgs');
      writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: 0, semanticEnd: 4,
        records: [compact(3), compact(1), compact(0), compact(2)] });
      expect(readCompactScoreFile(file, { evidenceId, stage: 'stage-one' }).records).toHaveLength(4);
      const bytes = fs.readFileSync(file); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; fs.writeFileSync(file, bytes);
      expect(() => readCompactScoreFile(file)).toThrow();
      expect(() => writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: 0,
        semanticEnd: 2, records: [compact(0), compact(0)] })).toThrow('overlap');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('produces byte-identical schema-4 outputs across partitions and completion orders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-layout-')), held = strategies();
    const execute = (name: string, sizes: number[], order: number[]) => {
      const files: string[] = []; let start = 0;
      for (const size of sizes) { const end = Math.min(start + size, held.length), file = path.join(root, `${name}-${start}.hgs`);
        writeCompactScoreFile({ file, evidenceId, stage: 'stage-one', semanticStart: start, semanticEnd: end,
          records: Array.from({ length: end - start }, (_unused, index) => compact(start + index)) });
        files.push(file); start = end; }
      let intermediateReadMs = 0;
      const selected = reduceCompactStageOne({ files: order.map((index) => files[index]!), evidenceId,
        total: held.length, retainCount: 8, collisionAllowance: 1_024, strategyAt: (position) => held[position]!,
        onIntermediateReadMs: (milliseconds) => { intermediateReadMs = milliseconds; } });
      const additional = new Map(selected.map((record, index) => [record.traversalPosition, profiles(20 - index)]));
      const second = selected.map((record, ordinal) => ({ traversalPosition: ordinal, displayId: record.displayId,
        profiles: additional.get(record.traversalPosition)! }));
      const secondFiles: string[] = [], secondSize = sizes.length === 1 ? selected.length : 2;
      for (let secondStart = 0; secondStart < selected.length; secondStart += secondSize) {
        const secondEnd = Math.min(secondStart + secondSize, selected.length), file = path.join(root, `${name}-second-${secondStart}.hgs`);
        writeCompactScoreFile({ file, evidenceId, stage: 'stage-two', semanticStart: secondStart,
          semanticEnd: secondEnd, records: second.slice(secondStart, secondEnd) }); secondFiles.push(file);
      }
      const stageTwo = readCompactStageTwoFiles({ files: [...secondFiles].reverse(), evidenceId, total: selected.length });
      const reservoirRecords = reduceCompactStageTwo({ stageOne: selected, additional: stageTwo, reservoirCount: 3 });
      const top = path.join(root, `${name}-top-500000.hgf`), reservoir = path.join(root, `${name}-reservoir.hgf`);
      const topResult = writeGoldfishArtifactV4(top, { evidenceId, kingdomId: 'fixture', candidateCount: held.length,
        seeds: [1], reservoirCount: 3, records: selected });
      writeGoldfishReservoirV4(reservoir, { evidenceId, kingdomId: 'fixture', candidateCount: held.length,
        seeds: [1, 2, 3, 4], retainedCount: selected.length, sourceArtifactHash: topResult.artifactHash,
        records: reservoirRecords });
      return { selected, reservoirRecords, top, reservoir, intermediateReadMs };
    };
    try {
      const one = execute('one', [12], [0]), many = execute('many', [2, 3, 1, 4, 2], [4, 2, 0, 3, 1]);
      expect(one.selected).toEqual(many.selected); expect(one.reservoirRecords).toEqual(many.reservoirRecords);
      expect(one.intermediateReadMs).toBeGreaterThan(0); expect(many.intermediateReadMs).toBeGreaterThan(0);
      expect(goldfishFinalBytes(one.top)).toEqual(goldfishFinalBytes(many.top));
      expect(goldfishFinalBytes(one.reservoir)).toEqual(goldfishFinalBytes(many.reservoir));
      const top = readGoldfishArtifactV4(one.top, (position) => held[position]!);
      const reservoir = readGoldfishReservoirV4(one.reservoir, (position) => held[position]!,
        { expectedSourceHash: top.artifactHash, topFile: one.top });
      expect(top.records).toHaveLength(8); expect(reservoir.records).toHaveLength(3);
      expect(top.records[0]).toHaveProperty('strategy');
      expect(goldfishFinalBytes(one.top).toString('utf8')).not.toContain('canonicalStrategy');
      expect(goldfishFinalBytes(one.top).toString('utf8')).not.toContain('stageOneRank');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('uses canonical strategy and traversal position only for a display-ID collision', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-compact-collision-'));
    const held = strategies().slice(0, 4); held[2] = { ...held[2]!, id: id(9) }; held[3] = { ...held[3]!, id: id(9) };
    const records = held.map((strategy, position) => ({ traversalPosition: position, displayId: strategy.id, profiles: profiles(10) }));
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
      expect(deriveScoreEvidence(reduced[0]!.profiles)).toBeDefined();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
