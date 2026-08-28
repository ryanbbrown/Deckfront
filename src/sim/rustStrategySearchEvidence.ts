import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import rawNativeKingdoms from '../../rust/goldfish/kingdoms.json' with { type: 'json' };
import { readGoldfishReservoir } from './goldfishReservoir';
import type { GoldfishFile, GoldfishReadOptions, GoldfishRecord } from './goldfishReservoir';
import { nativeRuleFingerprint } from './nativeGoldfishProtocol';
import { strategySearchKingdom } from './strategySearchKingdoms';
import { compareUtf16 } from './utf16';

const HGM_HEADER_BYTES = 64;
const HPS_HEADER_BYTES = 128;
const MATRIX_FIRST_SEED = 4_200_001;
const MATRIX_LAST_SEED = 4_200_125;
const FAMILY_NAMES = ['treasure', 'mana', 'melee', 'ranged', 'engine'] as const;
const SHA256 = /^[0-9a-f]{64}$/;

export type RustDamageFamily = typeof FAMILY_NAMES[number];

export interface NativeCommandResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface RustStrategySearchKingdomPaths {
  kingdomId: string;
  topFile: string;
  reservoirFile: string;
  initialMatrixDir: string;
  psroDir: string;
}

export interface LoadRustStrategySearchEvidenceOptions {
  binary: string;
  runNativeCommand?: (binary: string, args: readonly string[]) => NativeCommandResult;
  goldfishReadOptions?: Omit<GoldfishReadOptions, 'top'>;
}

export interface RustSourceFileHash {
  path: string;
  bytes: number;
  sha256: string;
  rowCrc32?: number;
}

export interface RustPairEvidence {
  firstStrategyNumber: number;
  secondStrategyNumber: number;
  points: number[];
}

export interface RustPurchaseEvidence {
  strategyNumber: number;
  opponentNumber: number;
  purchases: Record<string, number>;
  familyDamage: Record<RustDamageFamily, number>;
  playerGames: 250;
}

export interface RustMatrixEvidence {
  strategyNumbers: number[];
  percentages: number[][];
  weights: number[];
  sourceChecksum: number;
  rowCrc32: number;
}

export interface NativeVerificationSummary {
  top: Record<string, unknown>;
  reservoir: Record<string, unknown>;
  matrix: Record<string, unknown>;
  psro: Record<string, unknown> & { searches: number; admissions: number; matrixSize: number };
  binarySha256: string;
}

export interface RustStrategySearchKingdomEvidence {
  kingdomId: string;
  kingdomName: string;
  startingHealth: number;
  cardIds: string[];
  goldfish: GoldfishFile<GoldfishRecord>;
  completion: {
    complete: true;
    searchCount: number;
    admissionCount: number;
    matrixGeneration: number;
    cleanSearchCount: 2;
    finalStrategyNumbers: number[];
    finalWeights: number[];
  };
  finalMatrixSource: 'initial-matrix' | 'psro-expanded-matrix';
  pairs: RustPairEvidence[];
  purchases: RustPurchaseEvidence[];
  matrix: RustMatrixEvidence;
  sourceFiles: RustSourceFileHash[];
  evidenceSetSha256: string;
  nativeVerification: NativeVerificationSummary;
}

interface NativeKingdomRecord {
  kingdomId: string;
  ruleFingerprint: string;
  kingdom: { cards: Array<{ id: string }> };
}

interface HgmHeader {
  kind: number;
  rowBytes: number;
  rangeStart: number;
  rangeEnd: number;
  rowCount: number;
  checksum: number;
  sourceChecksum: number;
  seeds: number[];
  ruleFingerprint: string;
}

interface Checkpoint {
  search: number;
  admissions: number;
  generation: number;
  cleanSearches: number;
  matrixNumbers: number[];
  matrixWeights: number[];
}

function defaultNativeCommand(binary: string, args: readonly string[]): NativeCommandResult {
  const result = spawnSync(binary, [...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseSuccess(result: NativeCommandResult, command: string, kingdomId: string,
  verifyKind?: string): Record<string, unknown> {
  if (result.signal || result.status !== 0) {
    const detail = result.stderr.slice(-4_000).trim();
    throw new Error(`${kingdomId}: native ${command} failed${result.signal ? ` with ${result.signal}` : ''}${detail ? `: ${detail}` : '.'}`);
  }
  const line = result.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  let parsed: unknown;
  try { parsed = line ? JSON.parse(line) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${kingdomId}: native ${command} did not return a JSON summary.`);
  }
  const summary = parsed as Record<string, unknown>;
  const commandMatches = command === 'verify'
    ? summary.command === undefined && summary.valid === true && summary.kind === verifyKind
    : summary.command === command;
  if (!commandMatches || summary.valid === false
    || typeof summary.kingdomId === 'string' && summary.kingdomId !== kingdomId) {
    throw new Error(`${kingdomId}: native ${command} summary differs from the request.`);
  }
  return summary;
}

function sha256File(file: string): string {
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!SHA256.test(digest)) throw new Error(`Could not hash ${file}.`);
  return digest;
}

function requireRegularFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || path.basename(file).includes('.tmp')) {
    throw new Error(`Scientific source must be a regular final file: ${file}`);
  }
}

function nativeKingdom(kingdomId: string): NativeKingdomRecord {
  const records = (rawNativeKingdoms as { kingdoms: NativeKingdomRecord[] }).kingdoms;
  const record = records.find((entry) => entry.kingdomId === kingdomId);
  if (!record) throw new Error(`Missing native kingdom ${kingdomId}.`);
  return record;
}

function paddedAscii(bytes: Buffer, start: number, end: number, label: string): string {
  const held = bytes.subarray(start, end);
  const nul = held.indexOf(0);
  const length = nul < 0 ? held.length : nul;
  if (nul >= 0 && held.subarray(nul).some((byte) => byte !== 0)) throw new Error(`${label} padding is invalid.`);
  const value = held.subarray(0, length).toString('ascii');
  if (!Buffer.from(value, 'ascii').equals(held.subarray(0, length))) throw new Error(`${label} is not ASCII.`);
  return value;
}

function readHgm(file: string, expectedKind: number, expectedFingerprint: string,
  expectedSourceChecksum: number): { header: HgmHeader; rows: Buffer } {
  requireRegularFile(file);
  const bytes = fs.readFileSync(file);
  if (bytes.length < HGM_HEADER_BYTES || bytes.subarray(0, 4).toString('ascii') !== 'HGR1') {
    throw new Error(`${file}: HGM magic is invalid.`);
  }
  const header: HgmHeader = {
    kind: bytes.readUInt32LE(4), rowBytes: bytes.readUInt32LE(8), rangeStart: bytes.readUInt32LE(12),
    rangeEnd: bytes.readUInt32LE(16), rowCount: bytes.readUInt32LE(20), checksum: bytes.readUInt32LE(24),
    sourceChecksum: bytes.readUInt32LE(28), seeds: [32, 36, 40, 44].map((offset) => bytes.readUInt32LE(offset)),
    ruleFingerprint: paddedAscii(bytes, 48, 64, 'HGM fingerprint')
  };
  const rows = bytes.subarray(HGM_HEADER_BYTES);
  if (header.kind !== expectedKind || header.rangeStart !== 0
    || header.ruleFingerprint !== expectedFingerprint || header.sourceChecksum !== expectedSourceChecksum
    || header.seeds[0] !== MATRIX_FIRST_SEED || header.seeds[1] !== MATRIX_LAST_SEED
    || header.seeds[2] !== 0 || header.seeds[3] !== 0
    || bytes.length !== HGM_HEADER_BYTES + header.rowCount * header.rowBytes
    || (crc32(rows) >>> 0) !== header.checksum) {
    throw new Error(`${file}: HGM header, length, source, or CRC differs.`);
  }
  return { header, rows };
}

function readMatrixSet(directory: string, cardIds: readonly string[], expectedFingerprint: string,
  sourceChecksum: number, expectedSize: number): { pairs: RustPairEvidence[]; purchases: RustPurchaseEvidence[];
    matrix: RustMatrixEvidence; files: string[] } {
  const pairFile = path.join(directory, 'pairs.hgm');
  const purchaseFile = path.join(directory, 'purchases.hgm');
  const matrixFile = path.join(directory, 'matrix.hgm');
  const pairHeld = readHgm(pairFile, 5, expectedFingerprint, sourceChecksum);
  const purchaseHeld = readHgm(purchaseFile, 6, expectedFingerprint, sourceChecksum);
  const matrixHeld = readHgm(matrixFile, 7, expectedFingerprint, sourceChecksum);
  const pairCount = expectedSize * (expectedSize - 1) / 2;
  const purchaseRowBytes = 8 + 4 * cardIds.length + 20;
  const matrixRowBytes = 4 + 8 * expectedSize + 8;
  if (pairHeld.header.rangeEnd !== expectedSize || pairHeld.header.rowCount !== pairCount
    || pairHeld.header.rowBytes !== 133 || purchaseHeld.header.rangeEnd !== expectedSize
    || purchaseHeld.header.rowCount !== pairCount * 2 || purchaseHeld.header.rowBytes !== purchaseRowBytes
    || matrixHeld.header.rangeEnd !== expectedSize || matrixHeld.header.rowCount !== expectedSize
    || matrixHeld.header.rowBytes !== matrixRowBytes) throw new Error(`${directory}: HGM dimensions differ.`);

  const strategyNumbers: number[] = [], percentages: number[][] = [], weights: number[] = [];
  for (let row = 0; row < expectedSize; row += 1) {
    const offset = row * matrixRowBytes;
    strategyNumbers.push(matrixHeld.rows.readUInt32LE(offset));
    percentages.push(Array.from({ length: expectedSize }, (_unused, column) => matrixHeld.rows.readDoubleLE(offset + 4 + 8 * column)));
    weights.push(matrixHeld.rows.readDoubleLE(offset + 4 + 8 * expectedSize));
  }
  if (new Set(strategyNumbers).size !== expectedSize) throw new Error(`${directory}: matrix strategy numbers are not unique.`);

  const pairs: RustPairEvidence[] = [];
  let pairIndex = 0;
  for (let left = 0; left < expectedSize; left += 1) for (let right = left + 1; right < expectedSize; right += 1) {
    const offset = pairIndex * 133;
    const firstStrategyNumber = pairHeld.rows.readUInt32LE(offset);
    const secondStrategyNumber = pairHeld.rows.readUInt32LE(offset + 4);
    const points = [...pairHeld.rows.subarray(offset + 8, offset + 133)];
    if (firstStrategyNumber !== strategyNumbers[left] || secondStrategyNumber !== strategyNumbers[right]
      || points.some((point) => point > 4)) throw new Error(`${directory}: pair order or point byte differs.`);
    const expectedPercentage = points.slice(0, 75).reduce((sum, point) => sum + point, 0) / 3;
    if (percentages[left]![left] !== 50 || percentages[right]![right] !== 50
      || Math.abs(percentages[left]![right]! - expectedPercentage) > 1e-9
      || Math.abs(percentages[left]![right]! + percentages[right]![left]! - 100) > 1e-9) {
      throw new Error(`${directory}: matrix percentages differ from pair evidence.`);
    }
    pairs.push({ firstStrategyNumber, secondStrategyNumber, points });
    pairIndex += 1;
  }

  const purchases: RustPurchaseEvidence[] = [];
  for (let row = 0; row < pairCount * 2; row += 1) {
    const offset = row * purchaseRowBytes;
    const pair = pairs[Math.floor(row / 2)]!;
    const expectedStrategy = row % 2 === 0 ? pair.firstStrategyNumber : pair.secondStrategyNumber;
    const expectedOpponent = row % 2 === 0 ? pair.secondStrategyNumber : pair.firstStrategyNumber;
    const strategyNumber = purchaseHeld.rows.readUInt32LE(offset), opponentNumber = purchaseHeld.rows.readUInt32LE(offset + 4);
    if (strategyNumber !== expectedStrategy || opponentNumber !== expectedOpponent) {
      throw new Error(`${directory}: purchase rows are not in A-then-B pair order.`);
    }
    const cardPurchases = Object.fromEntries(cardIds.map((cardId, index) =>
      [cardId, purchaseHeld.rows.readUInt32LE(offset + 8 + 4 * index)]));
    const damageOffset = offset + 8 + 4 * cardIds.length;
    const familyDamage = Object.fromEntries(FAMILY_NAMES.map((family, index) =>
      [family, purchaseHeld.rows.readUInt32LE(damageOffset + 4 * index)])) as Record<RustDamageFamily, number>;
    purchases.push({ strategyNumber, opponentNumber, purchases: cardPurchases, familyDamage, playerGames: 250 });
  }

  if (weights.some((weight) => !Number.isFinite(weight) || weight < -1e-9)
    || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9
    || percentages.some((row) => row.some((value) => !Number.isFinite(value) || value < 0 || value > 100))) {
    throw new Error(`${directory}: matrix weights or percentages are invalid.`);
  }
  const centered = percentages.map((row) => row.map((value) => (value - 50) / 50));
  const maximumAdvantage = Math.max(...centered.map((row) => row.reduce((sum, value, column) => sum + value * weights[column]!, 0)));
  if (maximumAdvantage > 1e-6 + 1e-9) throw new Error(`${directory}: stored matrix witness is not an equilibrium.`);
  return { pairs, purchases, matrix: { strategyNumbers, percentages, weights,
    sourceChecksum, rowCrc32: matrixHeld.header.checksum }, files: [pairFile, purchaseFile, matrixFile] };
}

function readHps(file: string, expectedKind: number, fingerprint: string, sourceCrcs: readonly number[]):
  { header: Buffer; payload: Buffer } {
  requireRegularFile(file);
  const bytes = fs.readFileSync(file);
  if (bytes.length < HPS_HEADER_BYTES || bytes.subarray(0, 4).toString('ascii') !== 'HPS1'
    || bytes.readUInt32LE(4) !== 1 || bytes.readUInt32LE(8) !== expectedKind
    || bytes.readUInt32LE(12) !== HPS_HEADER_BYTES || paddedAscii(bytes, 96, 112, 'HPS fingerprint') !== fingerprint
    || paddedAscii(bytes, 112, 128, 'HPS protocol') !== 'rust-psro-v1') throw new Error(`${file}: HPS header differs.`);
  const payload = bytes.subarray(HPS_HEADER_BYTES);
  if (payload.length !== bytes.readUInt32LE(16) || (crc32(payload) >>> 0) !== bytes.readUInt32LE(20)
    || sourceCrcs.some((value, index) => bytes.readUInt32LE(24 + index * 4) !== value)) {
    throw new Error(`${file}: HPS source, length, or CRC differs.`);
  }
  return { header: bytes.subarray(0, HPS_HEADER_BYTES), payload };
}

function decodeCheckpoint(file: string, fingerprint: string, sourceCrcs: readonly number[]): Checkpoint {
  const { header, payload } = readHps(file, 5, fingerprint, sourceCrcs);
  if (payload.length < 96 || payload[0] !== 1 || payload[1] !== 5
    || payload.subarray(2, 4).some((byte) => byte !== 0) || payload.subarray(60, 96).some((byte) => byte !== 0)) {
    throw new Error(`${file}: checkpoint is not complete.`);
  }
  const search = payload.readUInt32LE(4), admissions = payload.readUInt32LE(16), generation = payload.readUInt32LE(20);
  const cleanSearches = payload.readUInt32LE(24), matrixCount = payload.readUInt32LE(28);
  const fixedCount = payload.readUInt32LE(32), activeCount = payload.readUInt32LE(36);
  const queueCount = payload.readUInt32LE(40), referenceCount = payload.readUInt32LE(44);
  let offset = 96;
  const matrixNumbers: number[] = [], matrixWeights: number[] = [];
  for (let index = 0; index < matrixCount; index += 1) {
    matrixNumbers.push(payload.readUInt32LE(offset));
    matrixWeights.push(payload.readDoubleLE(offset + 4));
    offset += 12;
  }
  offset += fixedCount * 8 + activeCount * 8 + queueCount * 48 + referenceCount * 24;
  if (offset !== payload.length || cleanSearches !== 2 || generation !== admissions
    || header.readUInt32LE(40) !== generation || header.readUInt32LE(44) !== search) {
    throw new Error(`${file}: checkpoint sections or counters differ.`);
  }
  return { search, admissions, generation, cleanSearches, matrixNumbers, matrixWeights };
}

function validateDecisions(file: string, fingerprint: string, sourceCrcs: readonly number[], checkpoint: Checkpoint): void {
  const { header, payload } = readHps(file, 6, fingerprint, sourceCrcs);
  if (payload.length < 32 || payload.readUInt32LE(0) !== 1 || payload.readUInt32LE(4) !== 1
    || payload.readUInt32LE(12) !== checkpoint.admissions || payload.readUInt32LE(16) !== checkpoint.admissions + 1
    || payload.readUInt32LE(20) !== checkpoint.search || payload.readUInt32LE(24) !== checkpoint.generation
    || payload.readUInt32LE(28) !== 2 || header.readUInt32LE(40) !== checkpoint.generation) {
    throw new Error(`${file}: final decisions summary differs from the checkpoint.`);
  }
}

function sameF64Bits(left: number, right: number): boolean {
  const held = Buffer.allocUnsafe(16);
  held.writeDoubleLE(left, 0); held.writeDoubleLE(right, 8);
  return held.subarray(0, 8).equals(held.subarray(8, 16));
}

function scientificFiles(paths: RustStrategySearchKingdomPaths, selectedMatrixFiles: readonly string[]): string[] {
  const files = [paths.topFile, paths.reservoirFile,
    path.join(paths.initialMatrixDir, 'pairs.hgm'), path.join(paths.initialMatrixDir, 'purchases.hgm'),
    path.join(paths.initialMatrixDir, 'matrix.hgm'), path.join(paths.psroDir, 'checkpoint.hpc'),
    path.join(paths.psroDir, 'decisions.hpd'), ...selectedMatrixFiles];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const held = path.join(directory, name), stat = fs.lstatSync(held);
      if (stat.isSymbolicLink()) throw new Error(`Scientific source must not be a symlink: ${held}`);
      if (stat.isDirectory()) visit(held);
      else if (/\.(?:hpl|hpa)$/u.test(name)) files.push(held);
    }
  };
  visit(paths.psroDir);
  return [...new Set(files.map((file) => path.resolve(file)))].sort();
}

function sourceHashes(files: readonly string[], root: string): { hashes: RustSourceFileHash[]; digest: string } {
  const hashes = files.map((file): RustSourceFileHash => {
    requireRegularFile(file);
    const bytes = fs.readFileSync(file), relative = path.relative(root, file).split(path.sep).join('/');
    const hash: RustSourceFileHash = { path: relative, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    if (bytes.length >= HGM_HEADER_BYTES && bytes.subarray(0, 4).toString('ascii') === 'HGR1') hash.rowCrc32 = bytes.readUInt32LE(24);
    return hash;
  }).sort((left, right) => compareUtf16(left.path, right.path));
  const digest = createHash('sha256').update(hashes.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')).digest('hex');
  return { hashes, digest };
}

export function loadRustStrategySearchKingdomEvidence(paths: RustStrategySearchKingdomPaths,
  options: LoadRustStrategySearchEvidenceOptions): RustStrategySearchKingdomEvidence {
  const kingdom = strategySearchKingdom(paths.kingdomId), native = nativeKingdom(paths.kingdomId);
  const run = options.runNativeCommand ?? defaultNativeCommand;
  requireRegularFile(options.binary);
  const commands = [
    ['verify', '--kingdom', paths.kingdomId, '--kind', 'top', '--file', paths.topFile],
    ['verify', '--kingdom', paths.kingdomId, '--kind', 'reservoir', '--file', paths.reservoirFile, '--top', paths.topFile],
    ['matrix-verify', '--kingdom', paths.kingdomId, '--reservoir', paths.reservoirFile, '--out', paths.initialMatrixDir],
    ['psro-verify', '--kingdom', paths.kingdomId, '--top-file', paths.topFile, '--reservoir', paths.reservoirFile,
      '--matrix-dir', paths.initialMatrixDir, '--out', paths.psroDir]
  ] as const;
  const summaries = commands.map((args) => parseSuccess(run(options.binary, args), args[0], paths.kingdomId,
    args[0] === 'verify' ? args[4] : undefined));
  const psro = summaries[3]!;
  if (!Number.isInteger(psro.searches) || !Number.isInteger(psro.admissions) || !Number.isInteger(psro.matrixSize)) {
    throw new Error(`${paths.kingdomId}: psro-verify summary is incomplete.`);
  }
  const nativeVerification: NativeVerificationSummary = { top: summaries[0]!, reservoir: summaries[1]!, matrix: summaries[2]!,
    psro: psro as NativeVerificationSummary['psro'], binarySha256: sha256File(options.binary) };

  const goldfish = readGoldfishReservoir(paths.reservoirFile, paths.kingdomId,
    { ...options.goldfishReadOptions, top: paths.topFile });
  const initial = readMatrixSet(paths.initialMatrixDir, native.kingdom.cards.map((card) => card.id),
    nativeRuleFingerprint(paths.kingdomId, 30, 200), goldfish.header.checksum, Number(psro.matrixSize) - Number(psro.admissions));
  const sourceCrcs = [goldfish.header.checksum,
    initial.pairs.length ? fs.readFileSync(path.join(paths.initialMatrixDir, 'pairs.hgm')).readUInt32LE(24) : 0,
    fs.readFileSync(path.join(paths.initialMatrixDir, 'purchases.hgm')).readUInt32LE(24), initial.matrix.rowCrc32];
  const checkpoint = decodeCheckpoint(path.join(paths.psroDir, 'checkpoint.hpc'), native.ruleFingerprint, sourceCrcs);
  validateDecisions(path.join(paths.psroDir, 'decisions.hpd'), native.ruleFingerprint, sourceCrcs, checkpoint);
  if (checkpoint.search !== psro.searches || checkpoint.admissions !== psro.admissions
    || checkpoint.matrixNumbers.length !== psro.matrixSize) throw new Error(`${paths.kingdomId}: native summary and checkpoint differ.`);

  const psroMatrixFiles = ['pairs.hgm', 'purchases.hgm', 'matrix.hgm'].map((name) => path.join(paths.psroDir, name));
  const present = psroMatrixFiles.filter((file) => fs.existsSync(file));
  if (checkpoint.admissions === 0 && present.length || checkpoint.admissions > 0 && present.length !== 3) {
    throw new Error(`${paths.kingdomId}: final PSRO HGM presence differs from admission count.`);
  }
  const final = checkpoint.admissions === 0 ? initial : readMatrixSet(paths.psroDir,
    native.kingdom.cards.map((card) => card.id), native.ruleFingerprint, goldfish.header.checksum, checkpoint.matrixNumbers.length);
  if (final.matrix.strategyNumbers.some((number, index) => number !== checkpoint.matrixNumbers[index]
    || !sameF64Bits(final.matrix.weights[index]!, checkpoint.matrixWeights[index]!))) {
    throw new Error(`${paths.kingdomId}: final matrix does not preserve the checkpoint witness.`);
  }
  const byNumber = new Map(goldfish.records.map((record) => [record.strategyNumber, record]));
  if (final.matrix.strategyNumbers.some((number) => !byNumber.has(number))) throw new Error(`${paths.kingdomId}: final strategy is absent from the reservoir.`);
  const root = path.resolve(path.dirname(path.dirname(paths.topFile)));
  const hashed = sourceHashes(scientificFiles(paths, final.files), root);
  return { kingdomId: paths.kingdomId, kingdomName: kingdom.name, startingHealth: kingdom.startingHealth,
    cardIds: native.kingdom.cards.map((card) => card.id), goldfish,
    completion: { complete: true, searchCount: checkpoint.search, admissionCount: checkpoint.admissions,
      matrixGeneration: checkpoint.generation, cleanSearchCount: 2, finalStrategyNumbers: checkpoint.matrixNumbers,
      finalWeights: checkpoint.matrixWeights }, finalMatrixSource: checkpoint.admissions === 0 ? 'initial-matrix' : 'psro-expanded-matrix',
    pairs: final.pairs, purchases: final.purchases, matrix: final.matrix, sourceFiles: hashed.hashes,
    evidenceSetSha256: hashed.digest, nativeVerification };
}
