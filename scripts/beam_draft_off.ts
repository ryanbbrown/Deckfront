/**
 * Experimental draft-off double oracle with a structured, diverse beam best response.
 *
 * Candidate generation is separate from the independent staged sweep in scripts/sweep.ts.
 *
 *   npx tsx scripts/beam_draft_off.ts --game .data/quick-current-duel.json \
 *     --out .data/beam-draft-off.json --workers 12
 *   npx tsx scripts/beam_draft_off.ts --game .data/quick-current-duel.json \
 *     --out .data/beam-draft-off-with-sweep.json --workers 12 --sweep
 */
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ALWAYS_AVAILABLE_ACTION_IDS, SeededRandom, cardDefinition, registerKingdom } from '../src/game';
import type { CardFamily, Kingdom } from '../src/game';
import { solveEquilibrium } from '../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { kingdomFacts, repairStrategy } from '../src/sim/mutation';
import { matrixProtocol, PayoffMatrix } from '../src/sim/payoffMatrix';
import type { MatrixSnapshot } from '../src/sim/payoffMatrix';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingRunner } from '../src/sim/pairingRunner';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { STRATIFIED_ADMISSIONS_PER_LANE, STRATIFIED_BEAM_LANES } from '../src/sim/stratifiedBeam';
import type { BeamLaneConfig, BeamLaneId } from '../src/sim/stratifiedBeam';
import {
  BUY_PLAN_SLOTS, INFINITE_COUNT, canonicalStrategy, fixedBuyPlan, formatStrategy
} from '../src/sim/strategy';
import type { BuyPlanSlot, Strategy } from '../src/sim/strategy';
import { headToHead, seedRange } from './headToHead';
import type { HeadToHeadScore, WeightedOpponent } from './headToHead';
import { sweepAgainst } from './sweep';

const FINITE_COUNTS = [1, 2, 3, 4, 5] as const;
const STOP_THRESHOLDS = [2, 4, 6] as const;
const DEFAULT_STAGE_SEEDS = [1, 2, 4] as const;
const DEFAULT_CONFIRM_SEEDS = 12;
const DEFAULT_MATRIX_SEEDS = 8;
const DEFAULT_ITERATIONS = 3;
const DEFAULT_MAX_ACTIVE_SLOTS = 8;
const DEFAULT_EARLY_STOP_DELTA = 0.002;
const DEFAULT_EARLY_STOP_PATIENCE = 2;

export interface BeamCandidate { floorKey: string; strategy: Strategy }
export interface ScoredBeamCandidate extends BeamCandidate { mean: number }
export interface BeamGrammar {
  /** Cards that can appear in a purchase ladder. Defaults to the full kingdom market. */
  purchaseIds?: readonly string[];
  /** Infinite terminal floors. Defaults to no-buy plus every allowed purchase. */
  floorIds?: readonly string[];
}

export { STRATIFIED_ADMISSIONS_PER_LANE, STRATIFIED_BEAM_LANES } from '../src/sim/stratifiedBeam';
export type { BeamLaneConfig, BeamLaneId } from '../src/sim/stratifiedBeam';

const LANE_FAMILIES: Record<Exclude<BeamLaneId, 'unrestricted'>, CardFamily> = {
  mage: 'mana', melee: 'melee', ranged: 'ranged'
};
const DAMAGE_MECHANICS: Record<Exclude<BeamLaneId, 'unrestricted'>, ReadonlySet<string>> = {
  mage: new Set(['spell', 'discharge', 'cascade', 'overload']),
  melee: new Set(['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush']),
  ranged: new Set(['ranged', 'repellingShot', 'longshot', 'salvageShot', 'precisionShot', 'volley'])
};

/** Restricts a pure lane to its family and neutral support, with real family damage as every floor. */
export function pureLaneGrammar(
  kingdomId: string, laneId: Exclude<BeamLaneId, 'unrestricted'>
): BeamGrammar | null {
  const family = LANE_FAMILIES[laneId];
  const alwaysAvailable = new Set(ALWAYS_AVAILABLE_ACTION_IDS);
  const purchaseIds = kingdomFacts(kingdomId).purchaseIds.filter((cardId) => {
    const card = cardDefinition(cardId);
    return card.family === family || card.family === 'engine' || card.family === 'treasure'
      || alwaysAvailable.has(cardId);
  });
  const floorIds = purchaseIds.filter((cardId) => {
    const card = cardDefinition(cardId);
    return card.family === family && DAMAGE_MECHANICS[laneId].has(card.mechanic);
  });
  return floorIds.length ? { purchaseIds, floorIds } : null;
}

export function laneGrammar(kingdomId: string, laneId: BeamLaneId): BeamGrammar | null {
  return laneId === 'unrestricted' ? {} : pureLaneGrammar(kingdomId, laneId);
}

function activeSlots(strategy: Strategy): BuyPlanSlot[] {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
}

function grammarPurchaseIds(kingdomId: string, grammar: BeamGrammar): string[] {
  const available = new Set(kingdomFacts(kingdomId).purchaseIds);
  const requested = grammar.purchaseIds ?? [...available];
  const purchaseIds = [...new Set(requested)].sort();
  for (const cardId of purchaseIds) {
    if (!available.has(cardId)) throw new Error(`Beam purchase ${cardId} is not available in ${kingdomId}.`);
  }
  return purchaseIds;
}

/** The no-buy floor and one infinite floor for every purchasable card. */
export function beamFloors(kingdomId: string, grammar: BeamGrammar = {}): BeamCandidate[] {
  const purchaseIds = grammarPurchaseIds(kingdomId, grammar);
  const floorIds = grammar.floorIds === undefined ? ['no-buy', ...purchaseIds] : [...new Set(grammar.floorIds)].sort();
  if (!floorIds.length) throw new Error('A beam grammar needs at least one floor.');
  for (const cardId of floorIds) {
    if (cardId !== 'no-buy' && !purchaseIds.includes(cardId)) {
      throw new Error(`Beam floor ${cardId} is not an allowed purchase in ${kingdomId}.`);
    }
  }
  return floorIds.map((cardId) => ({
    floorKey: cardId,
    strategy: repairStrategy(kingdomId, {
      id: '', startingBuild: [], buyPlan: fixedBuyPlan([cardId === 'no-buy'
        ? { kind: 'stop', threshold: 0 }
        : { kind: 'buy', cardId, desiredCount: INFINITE_COUNT }])
    })
  }));
}

/** Adds one structural ladder slot at every position before the terminal floor. */
export function expandBeamCandidate(
  kingdomId: string, candidate: BeamCandidate, maxActiveSlots = BUY_PLAN_SLOTS,
  grammar: BeamGrammar = {}
): BeamCandidate[] {
  const slots = activeSlots(candidate.strategy);
  const terminal = slots.at(-1)!;
  const prefix = slots.slice(0, -1);
  const proposals: Strategy[] = [candidate.strategy];
  const insert = (slot: BuyPlanSlot, index: number): void => {
    proposals.push({ ...candidate.strategy,
      buyPlan: fixedBuyPlan([...prefix.slice(0, index), slot, ...prefix.slice(index), terminal]) });
  };
  if (slots.length < maxActiveSlots) for (let index = 0; index <= prefix.length; index += 1) {
    for (const cardId of grammarPurchaseIds(kingdomId, grammar)) {
      for (const desiredCount of FINITE_COUNTS) insert({ kind: 'buy', cardId, desiredCount }, index);
    }
    for (const threshold of STOP_THRESHOLDS) insert({ kind: 'stop', threshold }, index);
  }
  const seen = new Set<string>();
  return proposals.flatMap((proposal) => {
    const strategy = repairStrategy(kingdomId, { ...proposal, startingBuild: [] });
    const form = canonicalStrategy(strategy);
    if (seen.has(form)) return [];
    seen.add(form);
    return [{ floorKey: candidate.floorKey, strategy }];
  });
}

/** Keeps the best global scores after reserving places for every surviving floor. */
export function retainDiverseBeam(
  scored: readonly ScoredBeamCandidate[], width: number, minimumPerFloor = 1
): ScoredBeamCandidate[] {
  const ordered = [...scored].sort((left, right) =>
    right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  const byFloor = new Map<string, ScoredBeamCandidate[]>();
  for (const entry of ordered) {
    const group = byFloor.get(entry.floorKey) ?? [];
    group.push(entry);
    byFloor.set(entry.floorKey, group);
  }
  const retained: ScoredBeamCandidate[] = [];
  const held = new Set<string>();
  const add = (entry: ScoredBeamCandidate): void => {
    const form = canonicalStrategy(entry.strategy);
    if (held.has(form) || retained.length >= width) return;
    held.add(form);
    retained.push(entry);
  };
  for (let rank = 0; rank < minimumPerFloor; rank += 1) {
    const choices: ScoredBeamCandidate[] = [];
    for (const group of byFloor.values()) {
      const entry = group[rank];
      if (entry) choices.push(entry);
    }
    choices.sort((left, right) =>
      right.mean - left.mean || left.floorKey.localeCompare(right.floorKey));
    for (const entry of choices) add(entry);
  }
  for (const entry of ordered) add(entry);
  return retained.sort((left, right) =>
    right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
}

function uniqueCandidates(candidates: Iterable<BeamCandidate>): BeamCandidate[] {
  const seen = new Set<string>();
  const unique: BeamCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.floorKey}:${canonicalStrategy(candidate.strategy)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function weightedTarget(snapshot: MatrixSnapshot, weights: Record<string, number>): WeightedOpponent[] {
  return snapshot.strategies.flatMap((strategy) => {
    const weight = weights[strategy.id] ?? 0;
    return weight > 0 ? [{ strategy, weight }] : [];
  });
}

function solveSnapshot(snapshot: MatrixSnapshot) {
  return solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
}

export interface BeamSearchOptions {
  iteration: number;
  maxSlots: number;
  lanes?: readonly BeamLaneConfig[];
  report: (message: string) => void;
}
export interface BeamStage {
  lane: BeamLaneId;
  depth: number;
  candidates: number;
  retained: number;
  best: number;
}
export interface LaneFinalist { lane: BeamLaneId; strategy: Strategy }

export function deduplicateLaneFinalists(finalists: readonly LaneFinalist[]): LaneFinalist[] {
  const seen = new Set<string>();
  return finalists.filter((finalist) => {
    const form = canonicalStrategy(finalist.strategy);
    if (seen.has(form)) return false;
    seen.add(form);
    return true;
  });
}

export function selectLaneResponses(
  confirmed: readonly HeadToHeadScore[], finalists: readonly LaneFinalist[],
  knownForms: ReadonlySet<string>, admissionsPerLane = STRATIFIED_ADMISSIONS_PER_LANE
): HeadToHeadScore[] {
  const laneByForm = new Map(finalists.map((entry) => [canonicalStrategy(entry.strategy), entry.lane]));
  const admittedByLane = new Map<BeamLaneId, number>();
  return confirmed.filter((entry) => {
    const form = canonicalStrategy(entry.strategy);
    const lane = laneByForm.get(form);
    if (!lane || entry.mean <= 0.5 || knownForms.has(form)) return false;
    const admitted = admittedByLane.get(lane) ?? 0;
    if (admitted >= admissionsPerLane) return false;
    admittedByLane.set(lane, admitted + 1);
    return true;
  });
}

async function searchLane(
  runner: PairingRunner, kingdomId: string, target: readonly WeightedOpponent[],
  config: BeamLaneConfig, grammar: BeamGrammar, options: BeamSearchOptions
): Promise<{ finalists: LaneFinalist[]; stages: BeamStage[] }> {
  let beam = beamFloors(kingdomId, grammar).map((entry) => ({ ...entry, mean: 0.5 }));
  const stages: BeamStage[] = [];
  let previousBest = 0.5;
  let stagnantStages = 0;
  for (let depth = 0; depth < options.maxSlots - 1; depth += 1) {
    const candidates = uniqueCandidates(beam.flatMap((entry) =>
      expandBeamCandidate(kingdomId, entry, options.maxSlots, grammar)));
    const seedCount = DEFAULT_STAGE_SEEDS[Math.min(depth, DEFAULT_STAGE_SEEDS.length - 1)]!;
    const seeds = seedRange(100 + options.iteration * 10_000 + depth * 100, seedCount);
    options.report(`${config.id} beam depth ${depth + 1}: scoring ${candidates.length} candidates on ${seeds.length} seeds`);
    const scores = await headToHead(
      runner, kingdomId, candidates.map((entry) => entry.strategy), target, seeds, 2_000,
      undefined, { startingDraftEnabled: false }
    );
    const byId = new Map(scores.map((score) => [score.strategy.id, score]));
    beam = retainDiverseBeam(candidates.map((candidate) => ({
      ...candidate, mean: byId.get(candidate.strategy.id)!.mean
    })), config.width);
    const best = beam[0]?.mean ?? 0.5;
    stages.push({ lane: config.id, depth: depth + 1, candidates: candidates.length,
      retained: beam.length, best });
    stagnantStages = best - previousBest < DEFAULT_EARLY_STOP_DELTA ? stagnantStages + 1 : 0;
    previousBest = best;
    if (depth + 1 >= DEFAULT_STAGE_SEEDS.length && stagnantStages >= DEFAULT_EARLY_STOP_PATIENCE) {
      options.report(`stopping ${config.id} beam after ${depth + 1} depths without material improvement`);
      break;
    }
  }
  return { finalists: beam.slice(0, config.finalists)
    .map((entry) => ({ lane: config.id, strategy: entry.strategy })), stages };
}

export async function beamBestResponses(
  runner: PairingRunner, kingdomId: string, target: readonly WeightedOpponent[], options: BeamSearchOptions
): Promise<{ confirmed: HeadToHeadScore[]; stages: BeamStage[]; finalists: LaneFinalist[] }> {
  const laneResults: { finalists: LaneFinalist[]; stages: BeamStage[] }[] = [];
  for (const config of options.lanes ?? STRATIFIED_BEAM_LANES) {
    const grammar = laneGrammar(kingdomId, config.id);
    if (!grammar) {
      options.report(`skipping ${config.id} beam: the kingdom has no ${config.id} damage card`);
      continue;
    }
    laneResults.push(await searchLane(runner, kingdomId, target, config, grammar, options));
  }
  const finalists = deduplicateLaneFinalists(laneResults.flatMap((result) => result.finalists));
  const heldOutSeeds = seedRange(5_000 + options.iteration * 10_000, DEFAULT_CONFIRM_SEEDS);
  options.report(`confirming ${finalists.length} deduplicated lane finalists on ${heldOutSeeds.length} held-out seeds`);
  const confirmed = await headToHead(
    runner, kingdomId, finalists.map((entry) => entry.strategy), target, heldOutSeeds,
    Math.max(1, finalists.length), undefined, { startingDraftEnabled: false }
  );
  confirmed.sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return { confirmed, stages: laneResults.flatMap((result) => result.stages), finalists };
}

function bootstrap(values: readonly number[]): { lower: number; upper: number } {
  const random = new SeededRandom(0x5eed1234);
  const means = Array.from({ length: 2_000 }, () => {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[random.nextInt(values.length)]!;
    return total / values.length;
  }).sort((left, right) => left - right);
  return { lower: means[Math.floor(means.length * 0.025)]!,
    upper: means[Math.floor(means.length * 0.975)]! };
}

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(option(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

async function main(): Promise<void> {
  const gameFile = option('game') ?? (() => { throw new Error('Pass --game <game.json>.'); })();
  const outFile = option('out') ?? '.data/beam-draft-off.json';
  const workers = positiveInteger('workers', 12);
  const iterations = positiveInteger('iterations', DEFAULT_ITERATIONS);
  const maxSlots = positiveInteger('max-slots', DEFAULT_MAX_ACTIVE_SLOTS);
  if (maxSlots > BUY_PLAN_SLOTS) throw new Error(`--max-slots cannot exceed ${BUY_PLAN_SLOTS}.`);
  const runSweep = process.argv.includes('--sweep');
  const record = JSON.parse(fs.readFileSync(gameFile, 'utf8')) as {
    kingdom: Kingdom;
    suiteVersion?: unknown;
    startingDraftEnabled?: unknown;
  };
  if (record.startingDraftEnabled !== undefined && record.startingDraftEnabled !== false) {
    throw new Error('The draft-off beam search requires startingDraftEnabled: false.');
  }
  registerKingdom(record.kingdom);
  const kingdomId = record.kingdom.id;
  const runner = new WorkerPairingRunner(
    workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: record.kingdom },
    ['--import', 'tsx']
  );
  const report = (message: string): void => console.log(`  ${message}`);
  const started = Date.now();
  let terminating = false;
  const terminate = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (terminating) return;
    terminating = true;
    process.stderr.write(`Stopping beam workers after ${signal}.\n`);
    void runner.close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  const onInterrupt = (): void => terminate('SIGINT');
  const onTerminate = (): void => terminate('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const matrix = new PayoffMatrix(matrixProtocol(
      kingdomId, seedRange(40_000, DEFAULT_MATRIX_SEEDS), TURN_LIMIT_PER_PLAYER,
      ACTION_CAP_PER_TURN, false
    ), runner);
    for (const entry of beamFloors(kingdomId)) matrix.addStrategy(entry.strategy);
    report(`filling initial ${matrix.entrants().length}-strategy floor matrix`);
    await matrix.fillAll(false);
    const iterationResults: unknown[] = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const before = matrix.snapshot();
      const equilibrium = solveSnapshot(before);
      const target = weightedTarget(before, equilibrium.weights);
      const search = await beamBestResponses(runner, kingdomId, target, {
        iteration, maxSlots, lanes: STRATIFIED_BEAM_LANES, report
      });
      const known = new Set(before.strategies.map(canonicalStrategy));
      const laneByForm = new Map(search.finalists.map((entry) => [canonicalStrategy(entry.strategy), entry.lane]));
      const responses = selectLaneResponses(search.confirmed, search.finalists, known);
      iterationResults.push({
        iteration, equilibrium, stages: search.stages,
        confirmed: search.confirmed.map((entry) => ({
          lane: laneByForm.get(canonicalStrategy(entry.strategy)),
          strategy: entry.strategy, mean: entry.mean, blockScores: entry.blockScores, matches: entry.matches
        })),
        admittedStrategyIds: responses.map((entry) => entry.strategy.id),
        admittedLanes: responses.map((entry) => laneByForm.get(canonicalStrategy(entry.strategy)))
      });
      if (!responses.length) break;
      for (const response of responses) {
        const lane = laneByForm.get(canonicalStrategy(response.strategy));
        report(`admitting ${lane} response ${response.strategy.id} at held-out mean ${response.mean.toFixed(4)}`);
        await matrix.addRow(response.strategy, false);
      }
    }
    const snapshot = matrix.snapshot();
    const equilibrium = solveSnapshot(snapshot);
    const targetMixture = weightedTarget(snapshot, equilibrium.weights);
    console.log('\nfinal mixture');
    for (const entry of targetMixture) {
      console.log(`weight ${entry.weight.toFixed(6)}\n${formatStrategy(entry.strategy)}`);
    }
    const independentSweep = runSweep
      ? await sweepAgainst(runner, kingdomId, targetMixture, bootstrap,
        (message) => report(`sweep: ${message}`), { startingDraftEnabled: false })
      : null;
    const output = {
      schemaVersion: 1,
      experiment: 'draft-off-diverse-beam-double-oracle',
      ...(typeof record.suiteVersion === 'string' ? { suiteVersion: record.suiteVersion } : {}),
      kingdom: record.kingdom,
      rulesFingerprint: rulesFingerprint(
        kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false
      ),
      config: { startingDraftEnabled: false, workers, iterations, maxSlots,
        lanes: STRATIFIED_BEAM_LANES, admissionsPerLane: STRATIFIED_ADMISSIONS_PER_LANE,
        stageSeeds: DEFAULT_STAGE_SEEDS, confirmationSeeds: DEFAULT_CONFIRM_SEEDS,
        matrixSeeds: DEFAULT_MATRIX_SEEDS, earlyStopDelta: DEFAULT_EARLY_STOP_DELTA,
        earlyStopPatience: DEFAULT_EARLY_STOP_PATIENCE, sweep: runSweep },
      elapsedMs: Date.now() - started,
      iterations: iterationResults,
      matrix: snapshot,
      equilibrium,
      targetMixture,
      independentSweep
    };
    fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`written: ${outFile}`);
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    await runner.close();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) await main();
