import fs from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import rawNativeKingdoms from '../../../rust/goldfish/kingdoms.json' with { type: 'json' };
import type { NativeCommandResult, RustStrategySearchKingdomPaths } from '../../../src/sim/rustStrategySearchEvidence';

const KINGDOM_ID = 'balance-tuning-005';
const native = (rawNativeKingdoms as { kingdoms: Array<{ kingdomId: string; ruleFingerprint: string;
  kingdom: { cards: Array<{ id: string }> } }> }).kingdoms.find((row) => row.kingdomId === KINGDOM_ID)!;
const cardIds = native.kingdom.cards.map((card) => card.id);

function hgrHeader(kind: number, rowBytes: number, rangeEnd: number, rowCount: number,
  checksum: number, sourceChecksum: number, seeds: readonly number[]): Buffer {
  const header = Buffer.alloc(64); header.write('HGR1');
  [kind, rowBytes, 0, rangeEnd, rowCount, checksum, sourceChecksum].forEach((value, index) => header.writeUInt32LE(value, 4 + index * 4));
  seeds.forEach((value, index) => header.writeUInt32LE(value, 32 + index * 4));
  header.write(native.ruleFingerprint, 48, 'ascii');
  return header;
}
function writeHgr(file: string, kind: number, rowBytes: number, rangeEnd: number,
  rows: Buffer, sourceChecksum: number, seeds: readonly number[]): number {
  const checksum = crc32(rows) >>> 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([hgrHeader(kind, rowBytes, rangeEnd, rows.length / rowBytes,
    checksum, sourceChecksum, seeds), rows]));
  return checksum;
}
function goldfish(root: string): { top: string; reservoir: string; reservoirCrc: number } {
  const top = path.join(root, 'goldfish', 'top-500000.hgf');
  const reservoir = path.join(root, 'goldfish', 'reservoir.hgf');
  const numbers = [0, 1, 2, 3];
  const topRows = Buffer.alloc(numbers.length * 64);
  const reservoirRows = Buffer.alloc(numbers.length * 124);
  numbers.forEach((number, index) => {
    const topOffset = index * 64, reservoirOffset = index * 124;
    topRows.writeUInt32LE(number, topOffset); reservoirRows.writeUInt32LE(number, reservoirOffset);
    for (const profileOffset of [4, 24, 44]) {
      topRows.writeUInt32LE(1, topOffset + profileOffset);
      reservoirRows.writeUInt32LE(1, reservoirOffset + profileOffset);
    }
    for (const profileOffset of [64, 84, 104]) reservoirRows.writeUInt32LE(1, reservoirOffset + profileOffset);
  });
  const topCrc = writeHgr(top, 3, 64, 12_972_960, topRows, 0, [4_100_000, 0, 0, 0]);
  const reservoirCrc = writeHgr(reservoir, 4, 124, numbers.length, reservoirRows, topCrc,
    [4_100_000, 4_100_001, 4_100_002, 4_100_003]);
  return { top, reservoir, reservoirCrc };
}
function hgm(file: string, kind: number, rowBytes: number, size: number, rows: Buffer, sourceChecksum: number): number {
  return writeHgr(file, kind, rowBytes, size, rows, sourceChecksum, [4_200_001, 4_200_125, 0, 0]);
}
function matrixSet(directory: string, numbers: readonly number[], weights: readonly number[], reservoirCrc: number):
  { pairsCrc: number; purchasesCrc: number; matrixCrc: number } {
  fs.mkdirSync(directory, { recursive: true });
  const pairCount = numbers.length * (numbers.length - 1) / 2;
  const pairRows = Buffer.alloc(pairCount * 133); let pairIndex = 0;
  for (let left = 0; left < numbers.length; left += 1) for (let right = left + 1; right < numbers.length; right += 1) {
    const offset = pairIndex * 133; pairRows.writeUInt32LE(numbers[left]!, offset); pairRows.writeUInt32LE(numbers[right]!, offset + 4);
    pairRows.fill(2, offset + 8, offset + 133); pairIndex += 1;
  }
  const purchaseRowBytes = 8 + cardIds.length * 4 + 20;
  const purchaseRows = Buffer.alloc(pairCount * 2 * purchaseRowBytes); let purchaseIndex = 0;
  for (let left = 0; left < numbers.length; left += 1) for (let right = left + 1; right < numbers.length; right += 1) {
    const orders: Array<[number, number]> = [[numbers[left]!, numbers[right]!], [numbers[right]!, numbers[left]!]];
    for (const [strategy, opponent] of orders) {
      const offset = purchaseIndex * purchaseRowBytes; purchaseRows.writeUInt32LE(strategy, offset); purchaseRows.writeUInt32LE(opponent, offset + 4);
      const cardId = strategy % 3 === 0 ? 'cascade' : strategy % 3 === 1 ? 'flurry' : 'volley';
      purchaseRows.writeUInt32LE(100 + strategy, offset + 8 + cardIds.indexOf(cardId) * 4);
      purchaseRows.writeUInt32LE(50 + strategy, offset + 8 + cardIds.length * 4 + (strategy % 3 === 0 ? 4 : strategy % 3 === 1 ? 8 : 12));
      purchaseIndex += 1;
    }
  }
  const matrixRowBytes = 4 + numbers.length * 8 + 8, matrixRows = Buffer.alloc(numbers.length * matrixRowBytes);
  numbers.forEach((number, row) => {
    const offset = row * matrixRowBytes; matrixRows.writeUInt32LE(number, offset);
    numbers.forEach((_unused, column) => matrixRows.writeDoubleLE(50, offset + 4 + column * 8));
    matrixRows.writeDoubleLE(weights[row]!, offset + 4 + numbers.length * 8);
  });
  return { pairsCrc: hgm(path.join(directory, 'pairs.hgm'), 5, 133, numbers.length, pairRows, reservoirCrc),
    purchasesCrc: hgm(path.join(directory, 'purchases.hgm'), 6, purchaseRowBytes, numbers.length, purchaseRows, reservoirCrc),
    matrixCrc: hgm(path.join(directory, 'matrix.hgm'), 7, matrixRowBytes, numbers.length, matrixRows, reservoirCrc) };
}
function hps(file: string, kind: number, payload: Buffer, source: readonly number[], generation: number, search: number): void {
  const header = Buffer.alloc(128); header.write('HPS1'); header.writeUInt32LE(1, 4); header.writeUInt32LE(kind, 8);
  header.writeUInt32LE(128, 12); header.writeUInt32LE(payload.length, 16); header.writeUInt32LE(crc32(payload) >>> 0, 20);
  source.forEach((value, index) => header.writeUInt32LE(value, 24 + index * 4)); header.writeUInt32LE(generation, 40);
  header.writeUInt32LE(search, 44); header.writeUInt32LE(cardIds.length, 76); header.write(native.ruleFingerprint, 96, 'ascii');
  header.write('rust-psro-v1', 112, 'ascii'); fs.writeFileSync(file, Buffer.concat([header, payload]));
}
function psro(directory: string, numbers: readonly number[], weights: readonly number[], admissions: number,
  source: readonly number[]): void {
  fs.mkdirSync(directory, { recursive: true }); const search = 2 + admissions;
  const checkpoint = Buffer.alloc(96 + numbers.length * 12); checkpoint[0] = 1; checkpoint[1] = 5;
  checkpoint.writeUInt32LE(search, 4); checkpoint.writeUInt32LE(admissions, 16); checkpoint.writeUInt32LE(admissions, 20);
  checkpoint.writeUInt32LE(2, 24); checkpoint.writeUInt32LE(numbers.length, 28);
  numbers.forEach((number, index) => { checkpoint.writeUInt32LE(number, 96 + index * 12); checkpoint.writeDoubleLE(weights[index]!, 100 + index * 12); });
  hps(path.join(directory, 'checkpoint.hpc'), 5, checkpoint, source, admissions, search);
  const decisions = Buffer.alloc(32); [1, 1, 0, admissions, admissions + 1, search, admissions, 2]
    .forEach((value, index) => decisions.writeUInt32LE(value, index * 4));
  hps(path.join(directory, 'decisions.hpd'), 6, decisions, source, admissions, search);
  if (admissions) fs.writeFileSync(path.join(directory, 'admission-0001.hpa'), Buffer.from('fixture admission'));
}

export interface EvidenceFixture {
  paths: RustStrategySearchKingdomPaths;
  binary: string;
  runNativeCommand: (binary: string, args: readonly string[]) => NativeCommandResult;
  commands: string[][];
}

export function createEvidenceFixture(root: string, admissions: 0 | 1): EvidenceFixture {
  const base = path.join(root, KINGDOM_ID), source = goldfish(base), initialDir = path.join(base, 'matrix');
  const initial = matrixSet(initialDir, [0, 1], [0.75, 0.25], source.reservoirCrc);
  const psroDir = path.join(base, 'psro'), finalNumbers = admissions ? [0, 1, 2] : [0, 1];
  const finalWeights = admissions ? [0.2, 0.3, 0.5] : [0.75, 0.25];
  if (admissions) matrixSet(psroDir, finalNumbers, finalWeights, source.reservoirCrc);
  psro(psroDir, finalNumbers, finalWeights, admissions,
    [source.reservoirCrc, initial.pairsCrc, initial.purchasesCrc, initial.matrixCrc]);
  const binary = path.join(root, 'hexdeck-goldfish'); fs.writeFileSync(binary, 'fixture binary');
  const commands: string[][] = [];
  const runNativeCommand = (_binary: string, args: readonly string[]): NativeCommandResult => {
    commands.push([...args]); const command = args[0]!;
    const summary = command === 'psro-verify' ? { command, valid: true, searches: 2 + admissions,
      admissions, matrixSize: finalNumbers.length, kingdomId: KINGDOM_ID }
      : { command, valid: true, kingdomId: KINGDOM_ID };
    return { status: 0, signal: null, stdout: `${JSON.stringify(summary)}\n`, stderr: '' };
  };
  return { paths: { kingdomId: KINGDOM_ID, topFile: source.top, reservoirFile: source.reservoir,
    initialMatrixDir: initialDir, psroDir }, binary, runNativeCommand, commands };
}
