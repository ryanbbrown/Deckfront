import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import rawManifest from './balance-suite-manifest.json' with { type: 'json' };
import { CARDS, VARIABLE_ACTION_IDS, findKingdom, registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { defaultExperimentOptions } from './experimentConfig';
import { runExperiment } from './experiment';
import { WorkerPairingRunner } from './pairingRunner';
import { rulesFingerprint } from './rulesFingerprint';
import { stableHash } from './strategy';

export type BalanceSuiteSplit = 'tuning' | 'validation';

export interface BalanceSuiteDesign {
  cardCountMinimum: number;
  cardCountMaximum: number;
  pairCountMinimum: number;
  pairCountMaximum: number;
  pairCountStandardDeviation: number;
  largestOverlap: number;
}

export interface BalanceSuiteKingdom extends Kingdom { split: BalanceSuiteSplit }

export interface BalanceSuiteManifest {
  suiteVersion: string;
  generatorVersion: string;
  eligibleCardIds: string[];
  kingdomSize: number;
  splits: { name: BalanceSuiteSplit; seed: number; size: number; design: BalanceSuiteDesign }[];
  kingdoms: BalanceSuiteKingdom[];
}

export interface BalanceSuiteSpec {
  suiteVersion: string;
  generatorVersion: string;
  eligibleCardIds: readonly string[];
  kingdomSize: number;
  splits: readonly { name: BalanceSuiteSplit; seed: number; size: number }[];
}

export interface BalanceSuiteBatchOptions {
  root: string;
  kingdomIds?: readonly string[];
  concurrency?: number;
  workersPerExperiment?: number;
  onProgress?: ((progress: { kingdomId: string; status: 'skipped' | 'completed' | 'failed';
    finished: number; total: number }) => void) | undefined;
}

export interface BalanceSuiteRunRequest { kingdomId: string; outDir: string; workers: number; root: string }
export type BalanceSuiteRunAdapter = (request: BalanceSuiteRunRequest) => Promise<void>;
export interface BalanceSuiteBatchResult { skipped: string[]; completed: string[]; failed: { kingdomId: string; error: string }[] }
export interface BalanceSuiteValidation {
  valid: boolean;
  complete: number;
  matches: number;
  aborted: number;
  elapsedMs: number;
  failures: { kingdomId: string; reason: string }[];
}

export const BALANCE_SUITE_SPEC: BalanceSuiteSpec = Object.freeze({
  suiteVersion: 'balance-suite-v2', generatorVersion: 'balanced-swaps-v1',
  eligibleCardIds: Object.freeze([...VARIABLE_ACTION_IDS].sort()),
  kingdomSize: 10,
  splits: Object.freeze([
    Object.freeze({ name: 'tuning' as const, seed: 0x51a7c3d9, size: 80 }),
    Object.freeze({ name: 'validation' as const, seed: 0xc04f82b1, size: 20 })
  ])
});

class Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 1; }
  next(): number {
    let value = this.state;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }
  int(maximum: number): number { return Math.floor(this.next() * maximum); }
  shuffle<T>(input: readonly T[]): T[] {
    const result = [...input];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(index + 1);
      [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
  }
}

function pairId(left: string, right: string): string { return left < right ? `${left}|${right}` : `${right}|${left}`; }
function overlap(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.reduce((count, card) => count + Number(rightSet.has(card)), 0);
}
function isDamage(cardId: string): boolean {
  return ['melee', 'drive', 'flurry', 'ranged', 'repellingShot', 'volley', 'spell']
    .includes(CARDS[cardId]!.mechanic);
}
function pairCounts(rows: readonly (readonly string[])[], eligible: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) counts.set(pairId(eligible[left]!, eligible[right]!), 0);
  }
  for (const row of rows) for (let left = 0; left < row.length; left += 1) {
    for (let right = left + 1; right < row.length; right += 1) {
      const key = pairId(row[left]!, row[right]!); counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}
function pairObjective(rows: readonly (readonly string[])[], eligible: readonly string[]): number {
  let total = 0;
  for (const count of pairCounts(rows, eligible).values()) total += count * count;
  return total;
}
function validRows(rows: readonly (readonly string[])[], kingdomSize: number): boolean {
  const keys = new Set<string>();
  for (let row = 0; row < rows.length; row += 1) {
    if (rows[row]!.length !== kingdomSize || new Set(rows[row]).size !== kingdomSize
      || !rows[row]!.some(isDamage)) return false;
    const key = [...rows[row]!].sort().join('|');
    if (keys.has(key)) return false;
    keys.add(key);
    for (let previous = 0; previous < row; previous += 1) if (overlap(rows[row]!, rows[previous]!) > 8) return false;
  }
  return true;
}

function initialRows(
  eligible: readonly string[], size: number, kingdomSize: number, random: Random,
  forbidden: readonly (readonly string[])[]
): string[][] {
  const totalSlots = size * kingdomSize;
  const base = Math.floor(totalSlots / eligible.length), extras = totalSlots % eligible.length;
  const extraCards = new Set(random.shuffle(eligible).slice(0, extras));
  const remaining = new Map(eligible.map((card) => [card, base + Number(extraCards.has(card))]));
  const rows: string[][] = [];
  const pairs = new Map<string, number>();
  for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
    const rowsAfter = size - rowIndex - 1;
    let best: string[] | null = null, bestScore = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const forced = eligible.filter((card) => (remaining.get(card) ?? 0) > rowsAfter);
      if (forced.length > kingdomSize) throw new Error('Balance-suite card counts cannot fit distinct piles.');
      const chosen = new Set(forced);
      if (![...chosen].some(isDamage)) {
        const damage = random.shuffle(eligible.filter((card) => isDamage(card) && (remaining.get(card) ?? 0) > 0
          && !chosen.has(card)))[0];
        if (damage) chosen.add(damage);
      }
      while (chosen.size < kingdomSize) {
        const candidates = eligible.filter((card) => (remaining.get(card) ?? 0) > 0 && !chosen.has(card));
        if (!candidates.length) break;
        candidates.sort((left, right) => {
          const leftPenalty = [...chosen].reduce((sum, card) => sum + (pairs.get(pairId(left, card)) ?? 0), 0);
          const rightPenalty = [...chosen].reduce((sum, card) => sum + (pairs.get(pairId(right, card)) ?? 0), 0);
          const leftScore = (remaining.get(left) ?? 0) * 20 - leftPenalty * 3 + random.next();
          const rightScore = (remaining.get(right) ?? 0) * 20 - rightPenalty * 3 + random.next();
          return rightScore - leftScore || left.localeCompare(right);
        });
        chosen.add(candidates[0]!);
      }
      const candidate = [...chosen].sort();
      if (candidate.length !== kingdomSize || !candidate.some(isDamage)
        || [...forbidden, ...rows].some((row) => overlap(row, candidate) > 8)) continue;
      const score = candidate.reduce((sum, left, leftIndex) => sum + candidate.slice(leftIndex + 1)
        .reduce((inner, right) => inner + (pairs.get(pairId(left, right)) ?? 0), 0), 0);
      if (score < bestScore || (score === bestScore && candidate.join('|') < (best?.join('|') ?? ''))) {
        best = candidate; bestScore = score;
      }
    }
    if (!best) throw new Error(`Could not construct balance-suite kingdom ${rowIndex + 1}.`);
    rows.push(best);
    for (const card of best) remaining.set(card, remaining.get(card)! - 1);
    for (let left = 0; left < best.length; left += 1) for (let right = left + 1; right < best.length; right += 1) {
      const key = pairId(best[left]!, best[right]!); pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  if ([...remaining.values()].some((count) => count !== 0)) throw new Error('Balance-suite card allocation is incomplete.');
  return rows;
}

function optimizeRows(
  rows: string[][], eligible: readonly string[], kingdomSize: number, random: Random,
  forbidden: readonly (readonly string[])[]
): void {
  let objective = pairObjective(rows, eligible);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const leftIndex = random.int(rows.length), rightIndex = random.int(rows.length);
    if (leftIndex === rightIndex) continue;
    const left = rows[leftIndex]!, right = rows[rightIndex]!;
    const leftCardIndex = random.int(kingdomSize), rightCardIndex = random.int(kingdomSize);
    const leftCard = left[leftCardIndex]!, rightCard = right[rightCardIndex]!;
    if (leftCard === rightCard || left.includes(rightCard) || right.includes(leftCard)) continue;
    left[leftCardIndex] = rightCard; right[rightCardIndex] = leftCard;
    left.sort(); right.sort();
    const changedValid = left.some(isDamage) && right.some(isDamage)
      && forbidden.every((row) => overlap(left, row) <= 8 && overlap(right, row) <= 8)
      && rows.every((row, index) => (index === leftIndex || index === rightIndex)
        || (overlap(left, row) <= 8 && overlap(right, row) <= 8))
      && !rows.some((row, index) => index !== leftIndex && [...row].sort().join('|') === left.join('|'))
      && !rows.some((row, index) => index !== rightIndex && [...row].sort().join('|') === right.join('|'));
    if (!changedValid) {
      left[left.indexOf(rightCard)] = leftCard; right[right.indexOf(leftCard)] = rightCard;
      left.sort(); right.sort(); continue;
    }
    const next = pairObjective(rows, eligible);
    if (next < objective) objective = next;
    else {
      left[left.indexOf(rightCard)] = leftCard; right[right.indexOf(leftCard)] = rightCard;
      left.sort(); right.sort();
    }
  }
}

export function measureBalanceSuiteDesign(
  rows: readonly (readonly string[])[], eligible: readonly string[]
): BalanceSuiteDesign {
  const cards = new Map(eligible.map((card) => [card, 0]));
  for (const row of rows) for (const card of row) cards.set(card, (cards.get(card) ?? 0) + 1);
  const pairs = [...pairCounts(rows, eligible).values()];
  const mean = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  let largestOverlap = 0;
  for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
    largestOverlap = Math.max(largestOverlap, overlap(rows[left]!, rows[right]!));
  }
  return {
    cardCountMinimum: Math.min(...cards.values()), cardCountMaximum: Math.max(...cards.values()),
    pairCountMinimum: Math.min(...pairs), pairCountMaximum: Math.max(...pairs),
    pairCountStandardDeviation: Math.sqrt(pairs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pairs.length),
    largestOverlap
  };
}

export function generateBalanceSuite(spec: BalanceSuiteSpec): BalanceSuiteManifest {
  if (new Set(spec.eligibleCardIds).size !== spec.eligibleCardIds.length || spec.kingdomSize < 1
    || spec.kingdomSize > spec.eligibleCardIds.length) throw new Error('Invalid balance-suite design input.');
  const kingdoms: BalanceSuiteKingdom[] = [], splits: BalanceSuiteManifest['splits'] = [];
  const priorRows: string[][] = [];
  for (const split of spec.splits) {
    const random = new Random(split.seed);
    const rows = initialRows(spec.eligibleCardIds, split.size, spec.kingdomSize, random, priorRows);
    optimizeRows(rows, spec.eligibleCardIds, spec.kingdomSize, random, priorRows);
    if (!validRows(rows, spec.kingdomSize)) throw new Error(`Generated ${split.name} kingdoms violate the design.`);
    rows.forEach((cards, index) => kingdoms.push({
      id: `balance-${split.name}-${String(index + 1).padStart(3, '0')}`,
      name: `Balance ${split.name === 'tuning' ? 'Tuning' : 'Validation'} ${String(index + 1).padStart(3, '0')}`,
      split: split.name, startingHealth: 40,
      actionPiles: cards.map((cardId) => ({ cardId, count: 10 }))
    }));
    splits.push({ ...split, design: measureBalanceSuiteDesign(rows, spec.eligibleCardIds) });
    priorRows.push(...rows.map((row) => [...row]));
  }
  const allSets = kingdoms.map((kingdom) => kingdom.actionPiles.map((pile) => pile.cardId));
  if (new Set(allSets.map((cards) => [...cards].sort().join('|'))).size !== kingdoms.length) {
    throw new Error('The balance-suite splits contain a duplicate kingdom.');
  }
  for (let left = 0; left < allSets.length; left += 1) for (let right = left + 1; right < allSets.length; right += 1) {
    if (overlap(allSets[left]!, allSets[right]!) > 8) throw new Error('Two balance-suite kingdoms share more than eight piles.');
  }
  return { suiteVersion: spec.suiteVersion, generatorVersion: spec.generatorVersion,
    eligibleCardIds: [...spec.eligibleCardIds], kingdomSize: spec.kingdomSize, splits, kingdoms };
}

function validateManifest(input: BalanceSuiteManifest): BalanceSuiteManifest {
  if (input.suiteVersion !== BALANCE_SUITE_SPEC.suiteVersion
    || input.generatorVersion !== BALANCE_SUITE_SPEC.generatorVersion
    || JSON.stringify(input.eligibleCardIds) !== JSON.stringify(BALANCE_SUITE_SPEC.eligibleCardIds)
    || input.kingdomSize !== BALANCE_SUITE_SPEC.kingdomSize
    || input.kingdoms.length !== BALANCE_SUITE_SPEC.splits.reduce((sum, split) => sum + split.size, 0)) {
    throw new Error('The committed balance-suite manifest does not match the current suite specification.');
  }
  return input;
}

export const BALANCE_SUITE_MANIFEST: BalanceSuiteManifest = validateManifest(rawManifest as BalanceSuiteManifest);
const kingdomById = new Map(BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => [kingdom.id, kingdom]));

function register(): void {
  for (const definition of BALANCE_SUITE_MANIFEST.kingdoms) {
    const { id, name, startingHealth, actionPiles } = definition;
    registerKingdom({ id, name, startingHealth, actionPiles });
  }
}
function hasKingdom(kingdomId: string): boolean { return kingdomById.has(kingdomId); }
function runRoot(root: string): string {
  return path.join(root, '.experiments', 'balance-suite', BALANCE_SUITE_MANIFEST.suiteVersion);
}
function runDirectory(root: string, kingdomId: string): string { return path.join(runRoot(root), kingdomId, 'full'); }

interface RunEvidence { valid: boolean; matches: number; aborted: number; elapsedMs: number; reason: string }
function inspectRun(root: string, kingdomId: string): RunEvidence {
  const directory = runDirectory(root, kingdomId);
  try {
    const run = JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8')) as Record<string, unknown>;
    const matrix = JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8')) as Record<string, unknown>;
    const fingerprint = rulesFingerprint(kingdomId).hash;
    const runFingerprint = (run.rulesFingerprint as { hash?: unknown } | undefined)?.hash;
    const protocolFingerprint = (matrix.protocol as { rulesFingerprint?: unknown } | undefined)?.rulesFingerprint;
    const valid = run.schemaVersion === 5 && run.valid === true && run.mode === 'full'
      && run.kingdomId === kingdomId && runFingerprint === fingerprint && protocolFingerprint === fingerprint
      && run.aborted === 0
      && matrix.complete === true && matrix.equilibrium !== null && Array.isArray(matrix.strategies)
      && Array.isArray(matrix.cells)
      && matrix.cells.length === matrix.strategies.length * (matrix.strategies.length - 1) / 2
      && matrix.cells.every((cell) => (cell as { complete?: unknown }).complete === true);
    return { valid, matches: typeof run.matches === 'number' ? run.matches : 0,
      aborted: typeof run.aborted === 'number' ? run.aborted : 0,
      elapsedMs: typeof run.elapsedMs === 'number' ? run.elapsedMs : 0,
      reason: valid ? 'complete' : 'artifact is incomplete, invalid, or stale' };
  } catch (error) {
    return { valid: false, matches: 0, aborted: 0, elapsedMs: 0,
      reason: error instanceof Error ? error.message : String(error) };
  }
}

async function defaultRun(request: BalanceSuiteRunRequest): Promise<void> {
  const runner = new WorkerPairingRunner(request.workers,
    pathToFileURL(path.join(request.root, 'dist-sim', 'experiment.mjs')));
  const summary = await runExperiment(defaultExperimentOptions(request.kingdomId, 'full', request.workers),
    request.outDir, { pairingRunner: runner });
  if (!summary.valid) throw new Error(summary.error ?? summary.stopReason);
}

async function runBatch(
  options: BalanceSuiteBatchOptions, adapter: BalanceSuiteRunAdapter = defaultRun
): Promise<BalanceSuiteBatchResult> {
  register();
  const ids = [...(options.kingdomIds ?? BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => kingdom.id))];
  for (const id of ids) if (!hasKingdom(id)) throw new Error(`Unknown balance-suite kingdom ${id}.`);
  const concurrency = options.concurrency ?? 2, workers = options.workersPerExperiment ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(workers) || workers < 1) {
    throw new Error('Batch concurrency and worker counts must be positive whole numbers.');
  }
  const result: BalanceSuiteBatchResult = { skipped: [], completed: [], failed: [] };
  let finished = 0;
  const queue = ids.filter((id) => {
    if (!inspectRun(options.root, id).valid) return true;
    result.skipped.push(id); finished += 1;
    options.onProgress?.({ kingdomId: id, status: 'skipped', finished, total: ids.length });
    return false;
  });
  const statusPath = path.join(runRoot(options.root), 'status.json');
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const writeStatus = (): void => {
    const temporary = `${statusPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ suiteVersion: BALANCE_SUITE_MANIFEST.suiteVersion,
      manifestHash: stableHash(JSON.stringify(BALANCE_SUITE_MANIFEST)), ...result }, null, 2)}\n`);
    fs.renameSync(temporary, statusPath);
  };
  writeStatus();
  let cursor = 0;
  const work = async (): Promise<void> => {
    for (;;) {
      const index = cursor; cursor += 1;
      const kingdomId = queue[index];
      if (!kingdomId) return;
      try {
        await adapter({ kingdomId, outDir: runDirectory(options.root, kingdomId), workers, root: options.root });
        const evidence = inspectRun(options.root, kingdomId);
        if (!evidence.valid) throw new Error(evidence.reason);
        result.completed.push(kingdomId);
      } catch (error) {
        result.failed.push({ kingdomId, error: error instanceof Error ? error.message : String(error) });
      }
      finished += 1;
      options.onProgress?.({ kingdomId, status: result.failed.some((failure) => failure.kingdomId === kingdomId)
        ? 'failed' : 'completed', finished, total: ids.length });
      writeStatus();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, work));
  result.skipped.sort(); result.completed.sort(); result.failed.sort((left, right) => left.kingdomId.localeCompare(right.kingdomId));
  writeStatus();
  return result;
}

function validateRuns(root: string): BalanceSuiteValidation {
  register();
  const failures: BalanceSuiteValidation['failures'] = [];
  let complete = 0, matches = 0, aborted = 0, elapsedMs = 0;
  for (const kingdom of BALANCE_SUITE_MANIFEST.kingdoms) {
    const evidence = inspectRun(root, kingdom.id);
    if (!evidence.valid) failures.push({ kingdomId: kingdom.id, reason: evidence.reason });
    else { complete += 1; matches += evidence.matches; aborted += evidence.aborted; elapsedMs += evidence.elapsedMs; }
  }
  return { valid: failures.length === 0 && aborted === 0, complete, matches, aborted, elapsedMs, failures };
}

export const balanceSuite = Object.freeze({
  manifest: BALANCE_SUITE_MANIFEST,
  generate: generateBalanceSuite,
  measure: measureBalanceSuiteDesign,
  register,
  hasKingdom,
  runDirectory,
  runBatch,
  validateRuns,
  findKingdom: (kingdomId: string): Kingdom | null => hasKingdom(kingdomId) ? findKingdom(kingdomId) : null
});
