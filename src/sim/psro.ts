import { SUPPORT_TOLERANCE, solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import {
  DeadlineInterruptionError, InvalidEvaluationError, createMatrixCellCache, matrixProtocol, PayoffMatrix
} from './payoffMatrix';
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
  turnLimitPerPlayer: number; actionCapPerTurn: number;
  searchDeadline?: number | undefined; finalDeadline?: number | undefined;
  onEvent?: ((event: IterationEvent) => void) | undefined;
  responseSearch?: typeof runResponseSearch | undefined;
}
export interface IterationEvent {
  restart: number | 'union'; attempt: number; matrixSize: number;
  mixtureBefore: Record<string, number>; response: ResponseResult | null;
  admittedStrategyId: string | null; elapsedMs: number;
}
export interface RestartResult {
  restart: number; strategies: Strategy[]; matrix: MatrixSnapshot; equilibrium: EquilibriumResult | null;
  events: IterationEvent[]; stopReason: string; globalFailures: number; nicheDiscoveries: string[];
  completed: boolean;
}
export interface RestartStatus {
  restart: number; state: 'completed' | 'interrupted' | 'skipped'; stopReason: string; matrixSize: number;
}
export interface PsroFailure { kind: 'simulator-abort' | 'solver-error'; message: string; detail: Record<string, unknown> }
export interface RestartAgreement {
  left: number; right: number; totalVariation: number; supportOverlap: number; leftWorstCounter: number;
  rightWorstCounter: number;
}
export interface PsroResult {
  valid: boolean; restarts: RestartResult[]; strategies: Strategy[]; matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult | null; events: IterationEvent[]; finalFailures: ResponseResult[];
  restartAgreement: RestartAgreement[]; matches: number; stopReason: string;
  restartStatuses: RestartStatus[]; failure: PsroFailure | null;
}

class RestartFailureError extends Error {
  constructor(readonly failure: PsroFailure, readonly restartResult: RestartResult) { super(failure.message); }
}

function solveSnapshot(snapshot: MatrixSnapshot): EquilibriumResult {
  if (snapshot.centeredPayoffs.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new Error('Cannot solve a matrix with missing cells.');
  }
  return solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
}

export function rectifiedNiches(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult): { focal: Strategy; weights: Record<string, number> }[] {
  return snapshot.strategies.flatMap((focal, focalIndex) => {
    if ((equilibrium.weights[focal.id] ?? 0) <= SUPPORT_TOLERANCE) return [];
    const weights: Record<string, number> = {};
    for (let opponentIndex = 0; opponentIndex < snapshot.strategies.length; opponentIndex += 1) {
      const opponent = snapshot.strategies[opponentIndex]!;
      if (opponent.id !== focal.id && (equilibrium.weights[opponent.id] ?? 0) > SUPPORT_TOLERANCE
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
  const events: IterationEvent[] = [];
  const nicheDiscoveries: string[] = [];
  let failures = 0;
  let nicheAdmissions = 0;
  let triedNiches = new Set<string>();
  let stopReason = 'iteration-limit';
  let lastEquilibrium: EquilibriumResult | null = null;
  const partial = (reason: string): RestartResult => {
    const snapshot = matrix.snapshot();
    const equilibrium = lastEquilibrium
      && lastEquilibrium.strategyIds.length === snapshot.strategies.length ? lastEquilibrium : null;
    return { restart, strategies: snapshot.strategies, matrix: snapshot,
      equilibrium, events, stopReason: reason,
      globalFailures: failures, nicheDiscoveries, completed: equilibrium !== null };
  };
  try {
    await matrix.fillAll(true, config.searchDeadline);
  for (let attempt = 0; attempt < config.iterations; attempt += 1) {
    if (config.searchDeadline !== undefined && now() >= config.searchDeadline) { stopReason = 'search-deadline'; break; }
    const started = now();
    const snapshot = matrix.snapshot();
    const equilibrium = solveSnapshot(snapshot);
    lastEquilibrium = equilibrium;
    const search = config.responseSearch ?? runResponseSearch;
    const global = await search({
      objective: 'global', targetWeights: equilibrium.weights, strategies: snapshot.strategies,
      kingdomId: config.kingdomId, runSeed: config.seed, restart, attempt,
      candidateCount: config.candidates, blocks: config.seeds,
      turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn,
      runner, deadline: config.searchDeadline
    });
    let admitted: Strategy | null = null;
    if (global.result?.admitted && global.candidate) admitted = global.candidate;
    if (admitted) {
      const event = { restart, attempt, matrixSize: matrix.entrants().length + 1,
        mixtureBefore: equilibrium.weights, response: global.result,
        admittedStrategyId: admitted.id, elapsedMs: now() - started } satisfies IterationEvent;
      events.push(event); config.onEvent?.(event);
      await matrix.addRow(admitted, true, config.searchDeadline);
      failures = 0; triedNiches = new Set();
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
          const nicheResult = await search({
            objective: 'niche', focal: niche.focal, targetWeights: niche.weights,
            strategies: snapshot.strategies, kingdomId: config.kingdomId, runSeed: config.seed,
            restart, attempt, candidateCount: config.candidates, blocks: config.seeds,
            turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn,
            runner, deadline: config.searchDeadline
          });
          if (nicheResult.result?.admitted && nicheResult.candidate) {
            admitted = nicheResult.candidate;
            const nicheEvent = { restart, attempt, matrixSize: matrix.entrants().length + 1,
              mixtureBefore: equilibrium.weights, response: nicheResult.result,
              admittedStrategyId: admitted.id, elapsedMs: now() - started } satisfies IterationEvent;
            events.push(nicheEvent); config.onEvent?.(nicheEvent);
            await matrix.addRow(admitted, true, config.searchDeadline);
            nicheDiscoveries.push(admitted.id); nicheAdmissions += 1; failures = 0; triedNiches = new Set();
          } else {
            const nicheEvent = { restart, attempt, matrixSize: matrix.entrants().length,
              mixtureBefore: equilibrium.weights, response: nicheResult.result,
              admittedStrategyId: null, elapsedMs: now() - started } satisfies IterationEvent;
            events.push(nicheEvent); config.onEvent?.(nicheEvent);
          }
        }
      }
    }
    if (!admitted && failures >= 2) {
      const stopSnapshot = matrix.snapshot();
      const stopEquilibrium = solveSnapshot(stopSnapshot);
      const remaining = rectifiedNiches(stopSnapshot, stopEquilibrium)
        .some((entry) => !triedNiches.has(entry.focal.id));
      if (!remaining || nicheAdmissions >= config.nicheAdditions) { stopReason = 'response-exhausted'; break; }
    }
  }
  const snapshot = matrix.snapshot();
  return { restart, strategies: snapshot.strategies, matrix: snapshot, equilibrium: solveSnapshot(snapshot),
    events, stopReason, globalFailures: failures, nicheDiscoveries, completed: true };
  } catch (error) {
    if (error instanceof DeadlineInterruptionError) return partial('search-deadline');
    const result = partial(error instanceof InvalidEvaluationError ? 'simulator-abort' : 'solver-error');
    const failure: PsroFailure = error instanceof InvalidEvaluationError
      ? { kind: 'simulator-abort', message: error.message, detail: error.detail }
      : { kind: 'solver-error', message: error instanceof Error ? error.message : String(error), detail: {} };
    throw new RestartFailureError(failure, result);
  }
}

function agreement(restarts: readonly RestartResult[], union: MatrixSnapshot): RestartAgreement[] {
  const pairs: RestartAgreement[] = [];
  const ids = union.strategies.map((strategy) => strategy.id);
  const worst = (restart: RestartResult): number => Math.max(0, ...ids.map((id, row) => {
    return ids.reduce((sum, opponentId, column) => sum
      + (restart.equilibrium?.weights[opponentId] ?? 0) * union.centeredPayoffs[row]![column]!, 0);
  }));
  const solved = restarts.filter((restart) => restart.equilibrium !== null);
  for (let left = 0; left < solved.length; left += 1) for (let right = left + 1; right < solved.length; right += 1) {
    const a = solved[left]!, b = solved[right]!;
    const totalVariation = 0.5 * ids.reduce((sum, id) => sum
      + Math.abs((a.equilibrium!.weights[id] ?? 0) - (b.equilibrium!.weights[id] ?? 0)), 0);
    const supportA = new Set(Object.entries(a.equilibrium!.maximumEquilibriumWeight).filter((entry) => entry[1] > 1e-6).map(([id]) => id));
    const supportB = new Set(Object.entries(b.equilibrium!.maximumEquilibriumWeight).filter((entry) => entry[1] > 1e-6).map(([id]) => id));
    const overlap = [...supportA].filter((id) => supportB.has(id)).length;
    const unionSize = new Set([...supportA, ...supportB]).size;
    pairs.push({ left: a.restart, right: b.restart, totalVariation, supportOverlap: unionSize ? overlap / unionSize : 1,
      leftWorstCounter: worst(a), rightWorstCounter: worst(b) });
  }
  return pairs;
}

export async function runPsro(config: PsroConfig, runner: PairingRunner, now = Date.now): Promise<PsroResult> {
  const matrixSeeds = namespaceSeeds(config.seed, 'matrix', config.seeds);
  const protocol = matrixProtocol(config.kingdomId, matrixSeeds, config.turnLimitPerPlayer,
    config.actionCapPerTurn);
  const cache = createMatrixCellCache();
  const restarts: RestartResult[] = [];
  const restartStatuses: RestartStatus[] = [];
  const allEvents = (): IterationEvent[] => restarts.flatMap((restart) => restart.events);
  const matches = (events: readonly IterationEvent[]): number => [...cache.values()]
    .reduce((sum, cell) => sum + cell.matches, 0)
      + events.reduce((sum, event) => sum + (event.response?.matches ?? 0), 0);
  const evidenceMatrix = (): PayoffMatrix => {
    const matrix = new PayoffMatrix(protocol, runner, cache);
    const forms = new Set<string>();
    for (const restart of restarts) for (const strategy of restart.strategies) {
      const form = canonicalStrategy(strategy);
      if (!forms.has(form)) { forms.add(form); matrix.addStrategy(strategy); }
    }
    return matrix;
  };
  const invalid = (
    matrix: PayoffMatrix, stopReason: string, failure: PsroFailure | null,
    unionEvents: readonly IterationEvent[] = [], finalFailures: readonly ResponseResult[] = []
  ): PsroResult => {
    const events = [...allEvents(), ...unionEvents];
    const snapshot = matrix.snapshot();
    return { valid: false, restarts, strategies: snapshot.strategies, matrix: snapshot,
      equilibrium: null, events, finalFailures: [...finalFailures], restartAgreement: [],
      matches: matches(events), stopReason, restartStatuses, failure };
  };

  for (let restart = 0; restart < config.restarts; restart += 1) {
    if (config.searchDeadline !== undefined && now() >= config.searchDeadline) {
      for (let skipped = restart; skipped < config.restarts; skipped += 1) {
        restartStatuses.push({ restart: skipped, state: 'skipped', stopReason: 'search-deadline', matrixSize: 0 });
      }
      break;
    }
    try {
      const result = await runRestart(config, restart, runner, cache, protocol, now);
      restarts.push(result);
      restartStatuses.push({ restart, state: result.stopReason === 'search-deadline' ? 'interrupted' : 'completed',
        stopReason: result.stopReason, matrixSize: result.strategies.length });
      if (result.stopReason === 'search-deadline') {
        for (let skipped = restart + 1; skipped < config.restarts; skipped += 1) {
          restartStatuses.push({ restart: skipped, state: 'skipped', stopReason: 'search-deadline', matrixSize: 0 });
        }
        break;
      }
    } catch (error) {
      if (!(error instanceof RestartFailureError)) throw error;
      restarts.push(error.restartResult);
      restartStatuses.push({ restart, state: 'interrupted', stopReason: error.failure.kind,
        matrixSize: error.restartResult.strategies.length });
      for (let skipped = restart + 1; skipped < config.restarts; skipped += 1) {
        restartStatuses.push({ restart: skipped, state: 'skipped', stopReason: error.failure.kind, matrixSize: 0 });
      }
      return invalid(evidenceMatrix(), error.failure.kind, error.failure);
    }
  }
  const matrix = evidenceMatrix();
  if (!matrix.entrants().length) {
    return invalid(matrix, 'partial-union', null);
  }
  try {
    await matrix.topUpAll(config.finalDeadline);
  } catch (error) {
    if (error instanceof DeadlineInterruptionError) return invalid(matrix, 'partial-union', null);
    if (error instanceof InvalidEvaluationError) {
      return invalid(matrix, 'simulator-abort', {
        kind: 'simulator-abort', message: error.message, detail: error.detail
      });
    }
    return invalid(matrix, 'solver-error', {
      kind: 'solver-error', message: error instanceof Error ? error.message : String(error), detail: {}
    });
  }
  let snapshot = matrix.snapshot();
  if (!snapshot.complete) return invalid(matrix, 'partial-union', null);
  let equilibrium: EquilibriumResult;
  try { equilibrium = solveSnapshot(snapshot); }
  catch (error) {
    return invalid(matrix, 'solver-error', {
      kind: 'solver-error', message: error instanceof Error ? error.message : String(error), detail: {}
    });
  }
  const beforeUnion = agreement(restarts, snapshot);
  const unionEvents: IterationEvent[] = [];
  const finalFailures: ResponseResult[] = [];
  for (let attempt = 0; attempt < config.unionIterations; attempt += 1) {
    if (config.finalDeadline !== undefined && now() >= config.finalDeadline) break;
    const started = now();
    const mixtureBefore = equilibrium.weights;
    let response: Awaited<ReturnType<typeof runResponseSearch>>;
    try {
      const search = config.responseSearch ?? runResponseSearch;
      response = await search({
        objective: 'global', targetWeights: equilibrium.weights, strategies: snapshot.strategies,
        kingdomId: config.kingdomId, runSeed: config.seed, restart: config.restarts, attempt,
        candidateCount: config.candidates, blocks: config.seeds,
        turnLimitPerPlayer: config.turnLimitPerPlayer, actionCapPerTurn: config.actionCapPerTurn,
        runner, deadline: config.finalDeadline
      });
    } catch (error) {
      if (error instanceof DeadlineInterruptionError) {
        return invalid(matrix, 'partial-union', null, unionEvents, finalFailures);
      }
      if (error instanceof InvalidEvaluationError) {
        return invalid(matrix, 'simulator-abort', {
          kind: 'simulator-abort', message: error.message, detail: error.detail
        }, unionEvents, finalFailures);
      }
      return invalid(matrix, 'solver-error', {
        kind: 'solver-error', message: error instanceof Error ? error.message : String(error), detail: {}
      }, unionEvents, finalFailures);
    }
    if (response.result && !response.result.admitted) finalFailures.push(response.result);
    let admitted: Strategy | null = null;
    if (response.result?.admitted && response.candidate) {
      admitted = response.candidate;
    }
    const event = { restart: 'union', attempt,
      matrixSize: matrix.entrants().length + (admitted ? 1 : 0),
      mixtureBefore, response: response.result,
      admittedStrategyId: admitted?.id ?? null, elapsedMs: now() - started } satisfies IterationEvent;
    unionEvents.push(event); config.onEvent?.(event);
    if (admitted) {
      try { await matrix.addRow(admitted, false, config.finalDeadline); }
      catch (error) {
        if (error instanceof DeadlineInterruptionError) {
          return invalid(matrix, 'partial-union', null, unionEvents, finalFailures);
        }
        if (error instanceof InvalidEvaluationError) {
          return invalid(matrix, 'simulator-abort', {
            kind: 'simulator-abort', message: error.message, detail: error.detail
          }, unionEvents, finalFailures);
        }
        return invalid(matrix, 'solver-error', {
          kind: 'solver-error', message: error instanceof Error ? error.message : String(error), detail: {}
        }, unionEvents, finalFailures);
      }
      snapshot = matrix.snapshot();
      if (!snapshot.complete) return invalid(matrix, 'partial-union', null, unionEvents, finalFailures);
      try { equilibrium = solveSnapshot(snapshot); }
      catch (error) {
        return invalid(matrix, 'solver-error', {
          kind: 'solver-error', message: error instanceof Error ? error.message : String(error), detail: {}
        }, unionEvents, finalFailures);
      }
      finalFailures.length = 0;
    }
    if (finalFailures.length >= 2) break;
  }
  snapshot = matrix.snapshot();
  const valid = snapshot.complete;
  const events = [...allEvents(), ...unionEvents];
  return { valid, restarts, strategies: snapshot.strategies, matrix: snapshot,
    equilibrium: valid ? equilibrium : null,
    events, finalFailures,
    restartAgreement: beforeUnion,
    matches: matches(events), restartStatuses, failure: null,
    stopReason: valid ? (finalFailures.length >= 2 ? 'response-exhausted' : 'limit') : 'partial-union' };
}
