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
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { solveEquilibrium } from '../src/sim/equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { kingdomFacts, repairStrategy } from '../src/sim/mutation';
import { matrixProtocol, PayoffMatrix } from '../src/sim/payoffMatrix';
import type { MatrixSnapshot } from '../src/sim/payoffMatrix';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import type { PairingRunner } from '../src/sim/pairingRunner';
import {
  INFINITE_COUNT, canonicalStrategy, fixedBuyPlan, formatStrategy
} from '../src/sim/strategy';
import type { BuyPlanSlot, Strategy } from '../src/sim/strategy';
import { headToHead, seedRange } from './headToHead';
import type { HeadToHeadScore, WeightedOpponent } from './headToHead';
import { sweepAgainst } from './sweep';

const FINITE_COUNTS = [1, 2, 4] as const;
const STOP_THRESHOLDS = [2, 4, 6] as const;
const DEFAULT_STAGE_SEEDS = [1, 2, 4] as const;
const DEFAULT_CONFIRM_SEEDS = 12;
const DEFAULT_MATRIX_SEEDS = 8;
const DEFAULT_BEAM_WIDTH = 64;
const DEFAULT_CONFIRM_COUNT = 8;
const DEFAULT_ITERATIONS = 3;

export interface BeamCandidate { floorKey: string; strategy: Strategy }
export interface ScoredBeamCandidate extends BeamCandidate { mean: number }

function activeSlots(strategy: Strategy): BuyPlanSlot[] {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
}

/** The no-buy floor and one infinite floor for every purchasable card. */
export function beamFloors(kingdomId: string): BeamCandidate[] {
  const noBuy = repairStrategy(kingdomId, {
    id: '', startingBuild: [], buyPlan: fixedBuyPlan([{ kind: 'stop', threshold: 0 }])
  });
  return [
    { floorKey: 'no-buy', strategy: noBuy },
    ...[...kingdomFacts(kingdomId).purchaseIds].sort().map((cardId) => ({
      floorKey: cardId,
      strategy: repairStrategy(kingdomId, {
        id: '', startingBuild: [],
        buyPlan: fixedBuyPlan([{ kind: 'buy', cardId, desiredCount: INFINITE_COUNT }])
      })
    }))
  ];
}

/** Adds one structural ladder slot at every position before the terminal floor. */
export function expandBeamCandidate(kingdomId: string, candidate: BeamCandidate): BeamCandidate[] {
  const slots = activeSlots(candidate.strategy);
  const terminal = slots.at(-1)!;
  const prefix = slots.slice(0, -1);
  const proposals: Strategy[] = [candidate.strategy];
  const insert = (slot: BuyPlanSlot, index: number): void => {
    proposals.push({ ...candidate.strategy,
      buyPlan: fixedBuyPlan([...prefix.slice(0, index), slot, ...prefix.slice(index), terminal]) });
  };
  for (let index = 0; index <= prefix.length; index += 1) {
    for (const cardId of kingdomFacts(kingdomId).purchaseIds) {
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

interface BeamSearchOptions {
  width: number;
  confirmCount: number;
  iteration: number;
  report: (message: string) => void;
}

async function beamBestResponses(
  runner: PairingRunner, kingdomId: string, target: readonly WeightedOpponent[], options: BeamSearchOptions
): Promise<{ confirmed: HeadToHeadScore[]; stages: { depth: number; candidates: number; retained: number }[] }> {
  let beam = beamFloors(kingdomId).map((entry) => ({ ...entry, mean: 0.5 }));
  const stages: { depth: number; candidates: number; retained: number }[] = [];
  for (let depth = 0; depth < DEFAULT_STAGE_SEEDS.length; depth += 1) {
    const candidates = uniqueCandidates(beam.flatMap((entry) => expandBeamCandidate(kingdomId, entry)));
    const seeds = seedRange(100 + options.iteration * 10_000 + depth * 100, DEFAULT_STAGE_SEEDS[depth]!);
    options.report(`beam depth ${depth + 1}: scoring ${candidates.length} candidates on ${seeds.length} seeds`);
    const scores = await headToHead(
      runner, kingdomId, candidates.map((entry) => entry.strategy), target, seeds, 2_000,
      undefined, { startingDraftEnabled: false }
    );
    const byId = new Map(scores.map((score) => [score.strategy.id, score]));
    beam = retainDiverseBeam(candidates.map((candidate) => ({
      ...candidate, mean: byId.get(candidate.strategy.id)!.mean
    })), options.width);
    stages.push({ depth: depth + 1, candidates: candidates.length, retained: beam.length });
  }
  const finalists = beam.slice(0, options.confirmCount).map((entry) => entry.strategy);
  const heldOutSeeds = seedRange(5_000 + options.iteration * 10_000, DEFAULT_CONFIRM_SEEDS);
  options.report(`confirming ${finalists.length} beam finalists on ${heldOutSeeds.length} held-out seeds`);
  const confirmed = await headToHead(
    runner, kingdomId, finalists, target, heldOutSeeds, options.confirmCount,
    undefined, { startingDraftEnabled: false }
  );
  confirmed.sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return { confirmed, stages };
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
  const width = positiveInteger('beam-width', DEFAULT_BEAM_WIDTH);
  const confirmCount = positiveInteger('confirm-count', DEFAULT_CONFIRM_COUNT);
  const runSweep = process.argv.includes('--sweep');
  const record = JSON.parse(fs.readFileSync(gameFile, 'utf8')) as { kingdom: Kingdom };
  registerKingdom(record.kingdom);
  const kingdomId = record.kingdom.id;
  const floorCount = beamFloors(kingdomId).length;
  if (width < floorCount) {
    throw new Error(`--beam-width must be at least ${floorCount} to retain every floor.`);
  }
  const runner = new WorkerPairingRunner(
    workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: record.kingdom },
    ['--import', 'tsx']
  );
  const report = (message: string): void => console.log(`  ${message}`);
  const started = Date.now();
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
        width, confirmCount, iteration, report
      });
      const known = new Set(before.strategies.map(canonicalStrategy));
      const response = search.confirmed.find((entry) =>
        entry.mean > 0.5 && !known.has(canonicalStrategy(entry.strategy)));
      iterationResults.push({
        iteration, equilibrium, stages: search.stages,
        confirmed: search.confirmed.map((entry) => ({
          strategy: entry.strategy, mean: entry.mean, blockScores: entry.blockScores, matches: entry.matches
        })), admittedStrategyId: response?.strategy.id ?? null
      });
      if (!response) break;
      report(`admitting ${response.strategy.id} at held-out mean ${response.mean.toFixed(4)}`);
      await matrix.addRow(response.strategy, false);
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
      kingdom: record.kingdom,
      config: { startingDraftEnabled: false, iterations, width, confirmCount,
        stageSeeds: DEFAULT_STAGE_SEEDS, confirmationSeeds: DEFAULT_CONFIRM_SEEDS,
        matrixSeeds: DEFAULT_MATRIX_SEEDS },
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
    await runner.close();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) await main();
