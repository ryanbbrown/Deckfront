import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { createMatrixCellCache, matrixProtocol, PayoffMatrix } from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import type { PairingRunner } from './pairingRunner';
import { randomUniqueStrategies } from './randomStrategy';
import { runResponseSearch } from './responseOracle';
import type { ResponseResult } from './responseOracle';
import { namespaceSeeds } from './seedNamespaces';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export interface PsroConfig {
  kingdomId: string; seed: number; restarts: number; initialStrategies: number; candidates: number;
  iterations: number; nicheAdditions: number; seeds: number; unionIterations: number;
  turnLimitPerPlayer: number; actionCapPerTurn: number; stateLimit: number;
  searchDeadline?: number | undefined; finalDeadline?: number | undefined;
  onEvent?: ((event: IterationEvent) => void) | undefined;
}
export interface IterationEvent {
  restart: number | 'union'; attempt: number; matrixSize: number;
  mixtureBefore: Record<string, number>; response: ResponseResult | null;
  admittedStrategyId: string | null; elapsedMs: number;
}
export interface RestartResult {
  restart: number; strategies: Strategy[]; matrix: MatrixSnapshot; equilibrium: EquilibriumResult;
  events: IterationEvent[]; stopReason: string; globalFailures: number; nicheDiscoveries: string[];
}
export interface RestartAgreement {
  left: number; right: number; totalVariation: number; supportOverlap: number; leftWorstCounter: number;
  rightWorstCounter: number;
}
export interface PsroResult {
  valid: boolean; restarts: RestartResult[]; strategies: Strategy[]; matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult | null; events: IterationEvent[]; finalFailures: ResponseResult[];
  restartAgreement: RestartAgreement[]; matches: number; stopReason: string;
}

function solveSnapshot(snapshot: MatrixSnapshot): EquilibriumResult {
  if (snapshot.centeredPayoffs.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new Error('Cannot solve a matrix with missing cells.');
  }
  return solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
}

export function rectifiedNiches(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult): { focal: Strategy; weights: Record<string, number> }[] {
  return snapshot.strategies.flatMap((focal, focalIndex) => {
    if ((equilibrium.weights[focal.id] ?? 0) <= 0) return [];
    const weights: Record<string, number> = {};
    for (let opponentIndex = 0; opponentIndex < snapshot.strategies.length; opponentIndex += 1) {
      const opponent = snapshot.strategies[opponentIndex]!;
      if (opponent.id !== focal.id && (equilibrium.weights[opponent.id] ?? 0) > 0
        && snapshot.centeredPayoffs[focalIndex]![opponentIndex]! >= -1e-7) {
        weights[opponent.id] = equilibrium.weights[opponent.id]!;
      }
    }
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    if (!(total > 0)) return [];
    for (const id of Object.keys(weights)) weights[id] = weights[id]! / total;
    return [{ focal, weights }];
  }).sort((a, b) => a.focal.id.localeCompare(b.focal.id));
}

async function runRestart(
  config: PsroConfig, restart: number, runner: PairingRunner, cache: ReturnType<typeof createMatrixCellCache>,
  protocol: ReturnType<typeof matrixProtocol>, now: () => number
): Promise<RestartResult> {
  const initialSeed = namespaceSeeds(config.seed, 'initialization', 1, restart, 0)[0]!;
  const initial = randomUniqueStrategies(config.kingdomId, initialSeed, config.initialStrategies);
  if (!initial.strategies.length) throw new Error(`Restart ${restart} generated no initial strategies.`);
  const matrix = new PayoffMatrix(protocol, runner, cache);
  for (const strategy of initial.strategies) matrix.addStrategy(strategy);
  await matrix.fillAll(true, config.searchDeadline);
  const events: IterationEvent[] = [];
  const nicheDiscoveries: string[] = [];
  let failures = 0;
  let nicheAdmissions = 0;
  let triedNiches = new Set<string>();
  let stopReason = 'iteration-limit';
  for (let attempt = 0; attempt < config.iterations; attempt += 1) {
    if (config.searchDeadline !== undefined && now() >= config.searchDeadline) { stopReason = 'search-deadline'; break; }
    const started = now();
    const snapshot = matrix.snapshot();
    const equilibrium = solveSnapshot(snapshot);
    const global = await runResponseSearch({
      objective: 'global', targetWeights: equilibrium.weights, strategies: snapshot.strategies,
      kingdomId: config.kingdomId, runSeed: config.seed, restart, attempt,
      candidateCount: config.candidates, blocks: config.seeds,
      turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn,
      stateLimit: config.stateLimit, runner, deadline: config.searchDeadline
    });
    let admitted: Strategy | null = null;
    if (global.result?.admitted && global.candidate) admitted = global.candidate;
    if (admitted) {
      await matrix.addRow(admitted, true, config.searchDeadline);
      failures = 0; triedNiches = new Set();
      const event = { restart, attempt, matrixSize: matrix.entrants().length,
        mixtureBefore: equilibrium.weights, response: global.result,
        admittedStrategyId: admitted.id, elapsedMs: now() - started } satisfies IterationEvent;
      events.push(event); config.onEvent?.(event);
    } else {
      failures += 1;
      const globalEvent = { restart, attempt, matrixSize: matrix.entrants().length,
        mixtureBefore: equilibrium.weights, response: global.result,
        admittedStrategyId: null, elapsedMs: now() - started } satisfies IterationEvent;
      events.push(globalEvent); config.onEvent?.(globalEvent);
      if (nicheAdmissions < config.nicheAdditions) {
        const niche = rectifiedNiches(snapshot, equilibrium).find((entry) => !triedNiches.has(entry.focal.id));
        if (niche) {
          triedNiches.add(niche.focal.id);
          const nicheResult = await runResponseSearch({
            objective: 'niche', focal: niche.focal, targetWeights: niche.weights,
            strategies: snapshot.strategies, kingdomId: config.kingdomId, runSeed: config.seed,
            restart, attempt, candidateCount: config.candidates, blocks: config.seeds,
            turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn,
            stateLimit: config.stateLimit, runner, deadline: config.searchDeadline
          });
          if (nicheResult.result?.admitted && nicheResult.candidate) {
            admitted = nicheResult.candidate;
            await matrix.addRow(admitted, true, config.searchDeadline);
            nicheDiscoveries.push(admitted.id); nicheAdmissions += 1; failures = 0; triedNiches = new Set();
          }
          const nicheEvent = { restart, attempt, matrixSize: matrix.entrants().length,
            mixtureBefore: equilibrium.weights, response: nicheResult.result,
            admittedStrategyId: admitted?.id ?? null, elapsedMs: now() - started } satisfies IterationEvent;
          events.push(nicheEvent); config.onEvent?.(nicheEvent);
        }
      }
    }
    if (!admitted && failures >= 2) {
      const remaining = rectifiedNiches(matrix.snapshot(), solveSnapshot(matrix.snapshot()))
        .some((entry) => !triedNiches.has(entry.focal.id));
      if (!remaining || nicheAdmissions >= config.nicheAdditions) { stopReason = 'response-exhausted'; break; }
    }
  }
  const snapshot = matrix.snapshot();
  return { restart, strategies: snapshot.strategies, matrix: snapshot, equilibrium: solveSnapshot(snapshot),
    events, stopReason, globalFailures: failures, nicheDiscoveries };
}

function agreement(restarts: readonly RestartResult[], union: MatrixSnapshot): RestartAgreement[] {
  const pairs: RestartAgreement[] = [];
  const ids = union.strategies.map((strategy) => strategy.id);
  const worst = (restart: RestartResult): number => Math.max(0, ...ids.map((id, row) => {
    return ids.reduce((sum, opponentId, column) => sum
      + (restart.equilibrium.weights[opponentId] ?? 0) * union.centeredPayoffs[row]![column]!, 0);
  }));
  for (let left = 0; left < restarts.length; left += 1) for (let right = left + 1; right < restarts.length; right += 1) {
    const a = restarts[left]!, b = restarts[right]!;
    const totalVariation = 0.5 * ids.reduce((sum, id) => sum
      + Math.abs((a.equilibrium.weights[id] ?? 0) - (b.equilibrium.weights[id] ?? 0)), 0);
    const supportA = new Set(Object.entries(a.equilibrium.maximumEquilibriumWeight).filter((entry) => entry[1] > 1e-6).map(([id]) => id));
    const supportB = new Set(Object.entries(b.equilibrium.maximumEquilibriumWeight).filter((entry) => entry[1] > 1e-6).map(([id]) => id));
    const overlap = [...supportA].filter((id) => supportB.has(id)).length;
    const unionSize = new Set([...supportA, ...supportB]).size;
    pairs.push({ left, right, totalVariation, supportOverlap: unionSize ? overlap / unionSize : 1,
      leftWorstCounter: worst(a), rightWorstCounter: worst(b) });
  }
  return pairs;
}

export async function runPsro(config: PsroConfig, runner: PairingRunner, now = Date.now): Promise<PsroResult> {
  const matrixSeeds = namespaceSeeds(config.seed, 'matrix', config.seeds);
  const protocol = matrixProtocol(config.kingdomId, matrixSeeds, config.turnLimitPerPlayer,
    config.actionCapPerTurn, config.stateLimit);
  const cache = createMatrixCellCache();
  const restarts: RestartResult[] = [];
  for (let restart = 0; restart < config.restarts; restart += 1) {
    if (config.searchDeadline !== undefined && now() >= config.searchDeadline) break;
    restarts.push(await runRestart(config, restart, runner, cache, protocol, now));
  }
  const unionStrategies = new Map<string, Strategy>();
  for (const restart of restarts) for (const strategy of restart.strategies) {
    if (!unionStrategies.has(canonicalStrategy(strategy))) unionStrategies.set(canonicalStrategy(strategy), strategy);
  }
  if (!unionStrategies.size) throw new Error('No restart completed before the search deadline.');
  const matrix = new PayoffMatrix(protocol, runner, cache);
  for (const strategy of unionStrategies.values()) matrix.addStrategy(strategy);
  await matrix.topUpAll(config.finalDeadline);
  let snapshot = matrix.snapshot();
  if (!snapshot.complete) return { valid: false, restarts, strategies: snapshot.strategies, matrix: snapshot,
    equilibrium: null, events: restarts.flatMap((restart) => restart.events), finalFailures: [],
    restartAgreement: [], matches: matrix.matches, stopReason: 'partial-union' };
  let equilibrium = solveSnapshot(snapshot);
  const beforeUnion = agreement(restarts, snapshot);
  const unionEvents: IterationEvent[] = [];
  const finalFailures: ResponseResult[] = [];
  for (let attempt = 0; attempt < config.unionIterations; attempt += 1) {
    if (config.finalDeadline !== undefined && now() >= config.finalDeadline) break;
    const started = now();
    const mixtureBefore = equilibrium.weights;
    const response = await runResponseSearch({
      objective: 'global', targetWeights: equilibrium.weights, strategies: snapshot.strategies,
      kingdomId: config.kingdomId, runSeed: config.seed, restart: config.restarts, attempt,
      candidateCount: config.candidates, blocks: config.seeds,
      turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn,
      stateLimit: config.stateLimit, runner, deadline: config.finalDeadline
    });
    if (response.result && !response.result.admitted) finalFailures.push(response.result);
    let admitted: Strategy | null = null;
    if (response.result?.admitted && response.candidate) {
      admitted = response.candidate; await matrix.addRow(admitted, false, config.finalDeadline);
      snapshot = matrix.snapshot();
      if (!snapshot.complete) break;
      equilibrium = solveSnapshot(snapshot); finalFailures.length = 0;
    }
    const event = { restart: 'union', attempt, matrixSize: matrix.entrants().length,
      mixtureBefore, response: response.result,
      admittedStrategyId: admitted?.id ?? null, elapsedMs: now() - started } satisfies IterationEvent;
    unionEvents.push(event); config.onEvent?.(event);
    if (finalFailures.length >= 2) break;
  }
  snapshot = matrix.snapshot();
  const valid = snapshot.complete;
  return { valid, restarts, strategies: snapshot.strategies, matrix: snapshot,
    equilibrium: valid ? solveSnapshot(snapshot) : null,
    events: [...restarts.flatMap((restart) => restart.events), ...unionEvents], finalFailures,
    restartAgreement: beforeUnion,
    matches: [...cache.values()].reduce((sum, cell) => sum + cell.matches, 0)
      + [...restarts.flatMap((restart) => restart.events), ...unionEvents]
        .reduce((sum, event) => sum + (event.response?.matches ?? 0), 0),
    stopReason: valid ? (finalFailures.length >= 2 ? 'response-exhausted' : 'limit') : 'partial-union' };
}
