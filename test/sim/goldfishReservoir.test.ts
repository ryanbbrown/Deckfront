import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { deepBeamSuite } from '../../src/sim/deepBeamSuite';
import { readGoldfishReservoir, readGoldfishTop } from '../../src/sim/goldfishReservoir';
import { nativeKingdomsJson } from '../../src/sim/nativeKingdoms';
import { nativeRuleFingerprint } from '../../src/sim/nativeGoldfishProtocol';
import { createOrderedCandidateSpace, orderedGoldfishCardIds } from '../../src/sim/orderedGoldfishBenchmark';
import { canonicalStrategy } from '../../src/sim/strategy';
import { candidateIdentitiesValid } from '../../src/sim/thresholdRacingPsro';

const binary = process.env.HEXDECK_GOLDFISH_BIN ?? path.resolve('rust/target/release/hexdeck-goldfish');
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
const run = (args: string[]): string => execFileSync(binary, args, { encoding: 'utf8' });
const writeList = (file: string, paths: string[]): void => fs.writeFileSync(file, `${JSON.stringify(paths)}\n`);

function writeResultFixture(file: string, kind: 1 | 2 | 3, numbers: readonly number[],
  sourceChecksum = 0): number {
  const rows = Buffer.alloc(numbers.length * 64);
  numbers.forEach((number, rowIndex) => {
    const offset = rowIndex * 64;
    rows.writeUInt32LE(number, offset);
    for (let profile = 0; profile < 3; profile += 1) {
      rows.writeUInt32LE(4, offset + (1 + profile * 5) * 4);
      rows.writeUInt32LE(2, offset + (2 + profile * 5) * 4);
      rows.writeUInt32LE(20, offset + (3 + profile * 5) * 4);
      rows.writeUInt32LE(100, offset + (4 + profile * 5) * 4);
      rows.writeUInt32LE(10, offset + (5 + profile * 5) * 4);
    }
  });
  const checksum = crc32(rows);
  const header = Buffer.alloc(64);
  header.write('HGR1');
  header.writeUInt32LE(kind, 4);
  header.writeUInt32LE(64, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(numbers.length, 16);
  header.writeUInt32LE(numbers.length, 20);
  header.writeUInt32LE(checksum, 24);
  header.writeUInt32LE(sourceChecksum, 28);
  const seeds = kind === 2 ? [4_100_001, 4_100_002, 4_100_003, 0] : [4_100_000, 0, 0, 0];
  seeds.forEach((seed, index) => header.writeUInt32LE(seed, 32 + index * 4));
  header.write(nativeRuleFingerprint(kingdom.id, 30, 200), 48, 'ascii');
  fs.writeFileSync(file, Buffer.concat([header, rows]));
  return checksum;
}

interface ReducerReport {
  command: string;
  bytesRead: number;
  bytesWritten: number;
  elapsedMs: number;
  readMs: number;
  reduceMs: number;
  writeMs: number;
}

beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

describe.skipIf(!fs.existsSync(binary))('Rust Goldfish reservoir', () => {
  it('maps sampled strategy numbers exactly to the TypeScript ordered candidate space', () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const numbers = new Set<number>([0, space.candidateCount - 1]);
    for (const permutation of [0, 1, 17, 1_337]) {
      for (let quantity = 0; quantity < 54; quantity += 1) numbers.add(permutation * 54 + quantity);
    }
    for (let number = 0; number < space.candidateCount; number += 4_093) numbers.add(number);
    const ordered = [...numbers].sort((left, right) => left - right);
    for (let start = 0; start < ordered.length; start += 400) {
      const chunk = ordered.slice(start, start + 400);
      const lines = run(['strategies', '--kingdom', kingdom.id, '--numbers', chunk.join(',')])
        .trim().split('\n').map((line) => JSON.parse(line) as { number: number; cardIds: string[]; counts: number[] });
      expect(lines).toHaveLength(chunk.length);
      for (const line of lines) {
        const expected = space.candidateAt(line.number).buyPlan.slice(0, 5);
        expect(line.cardIds).toEqual(expected.map((slot) => slot.kind === 'buy' ? slot.cardId : ''));
        expect(line.counts).toEqual(expected.map((slot) => slot.kind === 'buy' ? slot.desiredCount : -1));
      }
    }
  }, 30_000);

  it('produces identical verified files across shard layouts and repeat runs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-reservoir-'));
    const pipeline = (name: string, oneRanges: Array<[number, number]>, twoRanges: Array<[number, number]>) => {
      const directory = path.join(root, name); fs.mkdirSync(directory);
      const oneFiles = oneRanges.map(([start, end]) => {
        const file = path.join(directory, `one-${start}-${end}.hgs`);
        run(['score-one', '--kingdom', kingdom.id, '--start', `${start}`, '--end', `${end}`,
          '--threads', '4', '--out', file]); return file;
      });
      const oneList = path.join(directory, 'one.json'); writeList(oneList, oneFiles);
      const top = path.join(directory, 'top.hgf');
      run(['reduce-one', '--kingdom', kingdom.id, '--inputs', oneList, '--out', top,
        '--start', '0', '--end', '600', '--keep', '120']);
      const twoFiles = twoRanges.map(([start, end]) => {
        const file = path.join(directory, `two-${start}-${end}.hgs`);
        run(['score-two', '--kingdom', kingdom.id, '--top', top, '--start', `${start}`, '--end', `${end}`,
          '--threads', '4', '--out', file]); return file;
      });
      const twoList = path.join(directory, 'two.json'); writeList(twoList, twoFiles);
      const reservoir = path.join(directory, 'reservoir.hgf');
      run(['reduce-two', '--kingdom', kingdom.id, '--top', top, '--inputs', twoList,
        '--out', reservoir, '--keep', '40']);
      for (const args of [
        ['verify', '--kingdom', kingdom.id, '--kind', 'top', '--file', top,
          '--start', '0', '--end', '600', '--keep', '120'],
        ['verify', '--kingdom', kingdom.id, '--kind', 'reservoir', '--file', reservoir,
          '--top', top, '--keep', '40']
      ]) expect(JSON.parse(run(args))).toMatchObject({ valid: true });
      const decodedTop = readGoldfishTop(top, kingdom.id, { start: 0, end: 600, keep: 120 });
      const decoded = readGoldfishReservoir(reservoir, kingdom.id,
        { start: 0, end: 600, keep: 40, topKeep: 120, top });
      expect(decoded.records.every((record) => record.strategy.id === `gf-${record.strategyNumber}`
        && canonicalStrategy(record.strategy) === canonicalStrategy(
          createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id)).candidateAt(record.strategyNumber))))
        .toBe(true);
      expect(decodedTop.records).toHaveLength(120);
      return { top, reservoir };
    };
    try {
      const outputs = [pipeline('one', [[0, 600]], [[0, 60], [60, 120]]),
        pipeline('two', [[0, 200], [200, 600]], [[0, 40], [40, 120]]),
        pipeline('three', [[0, 300], [300, 600]], [[0, 80], [80, 120]]),
        pipeline('repeat', [[0, 600]], [[0, 60], [60, 120]])];
      for (const output of outputs.slice(1)) {
        expect(fs.readFileSync(output.top)).toEqual(fs.readFileSync(outputs[0]!.top));
        expect(fs.readFileSync(output.reservoir)).toEqual(fs.readFileSync(outputs[0]!.reservoir));
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 120_000);

  it('rejects damaged rows, protocol headers, sources, and test-sized production reads', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-rejections-'));
    try {
      const one = path.join(root, 'one.hgs'), oneList = path.join(root, 'one.json');
      const top = path.join(root, 'top.hgf'), two = path.join(root, 'two.hgs');
      const twoList = path.join(root, 'two.json'), reservoir = path.join(root, 'reservoir.hgf');
      run(['score-one', '--kingdom', kingdom.id, '--start', '0', '--end', '100', '--threads', '4', '--out', one]);
      writeList(oneList, [one]);
      run(['reduce-one', '--kingdom', kingdom.id, '--inputs', oneList, '--out', top,
        '--start', '0', '--end', '100', '--keep', '20']);
      run(['score-two', '--kingdom', kingdom.id, '--top', top, '--start', '0', '--end', '20',
        '--threads', '4', '--out', two]);
      writeList(twoList, [two]);
      run(['reduce-two', '--kingdom', kingdom.id, '--top', top, '--inputs', twoList,
        '--out', reservoir, '--keep', '10']);
      expect(() => readGoldfishTop(top, kingdom.id)).toThrow('retained count');
      const changedRow = Buffer.from(fs.readFileSync(top)); changedRow[70] = changedRow[70]! ^ 1;
      fs.writeFileSync(path.join(root, 'row.hgf'), changedRow);
      expect(() => readGoldfishTop(path.join(root, 'row.hgf'), kingdom.id,
        { start: 0, end: 100, keep: 20 })).toThrow('CRC-32');
      for (const [label, offset] of [['fingerprint', 48], ['seed', 32], ['source', 28]] as const) {
        const bytes = Buffer.from(fs.readFileSync(label === 'source' ? reservoir : top));
        bytes[offset] = bytes[offset]! ^ 1;
        const file = path.join(root, `${label}.hgf`); fs.writeFileSync(file, bytes);
        const read = label === 'source'
          ? () => readGoldfishReservoir(file, kingdom.id,
            { start: 0, end: 100, keep: 10, topKeep: 20, top })
          : () => readGoldfishTop(file, kingdom.id, { start: 0, end: 100, keep: 20 });
        expect(read).toThrow();
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('reports reducer file reads separately from heap ranking and final sorting', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-timing-'));
    try {
      const stageOne = path.join(root, 'one.hgs');
      const stageOneNumbers = Array.from({ length: 500_000 }, (_unused, number) => number);
      writeResultFixture(stageOne, 1, stageOneNumbers);
      const oneInputs = path.join(root, 'one.json'); writeList(oneInputs, [stageOne]);
      const oneReportFile = path.join(root, 'reduce-one.json');
      run(['reduce-one', '--kingdom', kingdom.id, '--inputs', oneInputs,
        '--out', path.join(root, 'reduced-top.hgf'), '--start', '0', '--end', '500000', '--keep', '1',
        '--report', oneReportFile]);

      const top = path.join(root, 'top.hgf');
      const topNumbers = Array.from({ length: 500_000 }, (_unused, number) => number);
      const topChecksum = writeResultFixture(top, 3, topNumbers);
      const stageTwo = path.join(root, 'two.hgs');
      writeResultFixture(stageTwo, 2, topNumbers, topChecksum);
      const twoInputs = path.join(root, 'two.json'); writeList(twoInputs, [stageTwo]);
      const twoReportFile = path.join(root, 'reduce-two.json');
      run(['reduce-two', '--kingdom', kingdom.id, '--top', top, '--inputs', twoInputs,
        '--out', path.join(root, 'reservoir.hgf'), '--keep', '1', '--report', twoReportFile]);

      const reports = [JSON.parse(fs.readFileSync(oneReportFile, 'utf8')) as ReducerReport,
        JSON.parse(fs.readFileSync(twoReportFile, 'utf8')) as ReducerReport];
      expect(reports.map((report) => [report.command, report.bytesWritten]))
        .toEqual([['reduce-one', 128], ['reduce-two', 188]]);
      for (const report of reports) {
        expect(report.bytesRead).toBeGreaterThan(30_000_000);
        expect(report.readMs).toBeGreaterThan(0);
        expect(report.reduceMs).toBeGreaterThan(0);
        expect(report.writeMs).toBeGreaterThanOrEqual(0);
        expect(report.readMs + report.reduceMs + report.writeMs).toBeLessThanOrEqual(report.elapsedMs);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  it('accepts unique gf identities only when their numbered strategy canonical matches', () => {
    const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
    const numbers = [0, 1, 12_345];
    const ids = numbers.map((number) => `gf-${number}`);
    const canonicals = numbers.map((number) => canonicalStrategy(space.candidateAt(number)));
    expect(candidateIdentitiesValid(ids, canonicals, kingdom.id)).toBe(true);
    expect(candidateIdentitiesValid(ids, [canonicals[1]!, canonicals[0]!, canonicals[2]!], kingdom.id)).toBe(false);
  });

  it('keeps the embedded kingdom database current', () => {
    expect(fs.readFileSync('rust/goldfish/kingdoms.json', 'utf8')).toBe(nativeKingdomsJson());
    const value = JSON.parse(run(['kingdom', '--kingdom', kingdom.id]));
    expect(value).toMatchObject({ kingdomId: kingdom.id, candidateCount: 12_972_960 });
  });

  it('rejects reduce-one gaps and overlaps', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-coverage-'));
    try {
      const first = path.join(root, 'first.hgs'), second = path.join(root, 'second.hgs');
      run(['score-one', '--kingdom', kingdom.id, '--start', '0', '--end', '10', '--threads', '2', '--out', first]);
      run(['score-one', '--kingdom', kingdom.id, '--start', '11', '--end', '20', '--threads', '2', '--out', second]);
      const inputs = path.join(root, 'inputs.json'); writeList(inputs, [first, second]);
      const failed = spawnSync(binary, ['reduce-one', '--kingdom', kingdom.id, '--inputs', inputs,
        '--out', path.join(root, 'top.hgf'), '--start', '0', '--end', '20', '--keep', '5'], { encoding: 'utf8' });
      expect(failed.status).not.toBe(0);
      expect(failed.stderr).toContain('gap');
      writeList(inputs, [first, first]);
      const overlap = spawnSync(binary, ['reduce-one', '--kingdom', kingdom.id, '--inputs', inputs,
        '--out', path.join(root, 'top.hgf'), '--start', '0', '--end', '10', '--keep', '5'], { encoding: 'utf8' });
      expect(overlap.status).not.toBe(0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
