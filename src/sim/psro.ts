import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { runFinalSearch } from './finalSearch';
import type { FinalSearchOutcome } from './finalSearch';
import {
  DeadlineInterruptionError, InvalidEvaluationError, createMatrixCellCache, matrixProtocol, PayoffMatrix
} from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import type { PairingRunner } from './pairingRunner';
import { randomUniqueStrategies } from './randomStrategy';
import { runResponseSearch } from './responseOracle';
import type { ResponseResult } from './responseOracle';
import {
  RACE_TOTAL_SEEDS, assertDisjointSeedNamespaces, finalSearchSeedNamespaces, namespaceSeeds
} from './seedNamespaces';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

export interface PsroConfig {
  kingdomId: string; seed: number; restarts: number; initialStrategies: number; candidates: number;
  iterations: number; seeds: number; unionIterations: number;
  turnLimitPerPlayer: number; actionCapPerTurn: number;
  searchDeadline?: number | undefined; finalDeadline?: number | undefined;
  onEvent?: ((event: IterationEvent) => void) | undefined;
  responseSearch?: typeof runResponseSearch | undefined;
  finalSearch?: typeof runFinalSearch | undefined;
}
export interface IterationEvent {
  restart: number | 'union' | 'final'; attempt: number; matrixSize: number;
  mixtureBefore: Record<string, number>; response: ResponseResult | null;
  admittedStrategyId: string | null; elapsedMs: number;
}
export interface RestartResult {
  restart: number; strategies: Strategy[]; matrix: MatrixSnapshot; equilibrium: EquilibriumResult | null;
  events: IterationEvent[]; stopReason: string; globalFailures: number;
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
  restartStatuses: RestartStatus[]; failure: PsroFailure | null; seedNamespaces: Record<string, number[]>;
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

async function runRestart(
  config: PsroConfig, restart: number, runner: PairingRunner, cache: ReturnType<typeof createMatrixCellCache>,
  protocol: ReturnType<typeof matrixProtocol>, now: () => number,
  reserveSeeds: (label: string, seeds: readonly number[]) => void
): Promise<RestartResult> {
  const initialSeed = namespaceSeeds(config.seed, 'initialization', 1, restart, 0)[0]!;
  reserveSeeds(`initialization:${restart}`, [initialSeed]);
  const initial = randomUniqueStrategies(config.kingdomId, initialSeed, config.initialStrategies);
  if (!initial.strategies.length) throw new Error(`Restart ${restart} generated no initial strategies.`);
  const matrix = new PayoffMatrix(protocol, runner, cache);
  for (const strategy of initial.strategies) matrix.addStrategy(strategy);
  const events: IterationEvent[] = [];
  let failures = 0;
  let stopReason = 'iteration-limit';
  let lastEquilibrium: EquilibriumResult | null = null;
  const partial = (reason: string): RestartResult => {
    const snapshot = matrix.snapshot();
    const equilibrium = lastEquilibrium
      && lastEquilibrium.strategyIds.length === snapshot.strategies.length ? lastEquilibrium : null;
    return { restart, strategies: snapshot.strategies, matrix: snapshot,
      equilibrium, events, stopReason: reason,
      globalFailures: failures, completed: equilibrium !== null };
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
    reserveSeeds(`global-race:${restart}:${attempt}`, namespaceSeeds(config.seed, 'global-race',
      RACE_TOTAL_SEEDS, restart, attempt));
    reserveSeeds(`global-confirm:${restart}:${attempt}`, namespaceSeeds(config.seed, 'global-confirm',
      config.seeds, restart, attempt));
    reserveSeeds(`bootstrap:global:${restart}:${attempt}`, namespaceSeeds(config.seed, 'bootstrap',
      1, restart, attempt));
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
      failures = 0;
    } else {
      failures += 1;
      const globalEvent = { restart, attempt, matrixSize: matrix.entrants().length,
        mixtureBefore: equilibrium.weights, response: global.result,
        admittedStrategyId: null, elapsedMs: now() - started } satisfies IterationEvent;
      events.push(globalEvent); config.onEvent?.(globalEvent);
    }
    if (!admitted && failures >= 4) { stopReason = 'response-exhausted'; break; }
  }
  const snapshot = matrix.snapshot();
  return { restart, strategies: snapshot.strategies, matrix: snapshot, equilibrium: solveSnapshot(snapshot),
    events, stopReason, globalFailures: failures, completed: true };
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
  const seedNamespaces: Record<string, number[]> = { matrix: [...matrixSeeds] };
  const reserveSeeds = (label: string, seeds: readonly number[]): void => {
    seedNamespaces[label] = [...seeds];
    assertDisjointSeedNamespaces(seedNamespaces);
  };
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
      matches: matches(events), stopReason, restartStatuses, failure, seedNamespaces };
  };

  for (let restart = 0; restart < config.restarts; restart += 1) {
    if (config.searchDeadline !== undefined && now() >= config.searchDeadline) {
      for (let skipped = restart; skipped < config.restarts; skipped += 1) {
        restartStatuses.push({ restart: skipped, state: 'skipped', stopReason: 'search-deadline', matrixSize: 0 });
      }
      break;
    }
    try {
      const result = await runRestart(config, restart, runner, cache, protocol, now, reserveSeeds);
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
  const addToMatrix = async (strategy: Strategy): Promise<PsroResult | null> => {
    try { await matrix.addRow(strategy, false, config.finalDeadline); }
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
    return null;
  };
  let unionAttempt = 0;
  let finalAttempt = 0;
  const stopReason = 'final-search-passed';
  while (true) {
    let consecutiveFailures = 0;
    for (let pass = 0; pass < config.unionIterations && consecutiveFailures < 2; pass += 1) {
      if (config.finalDeadline !== undefined && now() >= config.finalDeadline) {
        return invalid(matrix, 'search-deadline', null, unionEvents, finalFailures);
      }
      const attempt = unionAttempt++;
      reserveSeeds(`global-race:union:${attempt}`, namespaceSeeds(config.seed, 'global-race',
        RACE_TOTAL_SEEDS, config.restarts, attempt));
      reserveSeeds(`global-confirm:union:${attempt}`, namespaceSeeds(config.seed, 'global-confirm',
        config.seeds, config.restarts, attempt));
      reserveSeeds(`bootstrap:global:union:${attempt}`, namespaceSeeds(config.seed, 'bootstrap',
        1, config.restarts, attempt));
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
      const admitted = response.result?.admitted && response.candidate ? response.candidate : null;
      const event = { restart: 'union', attempt,
        matrixSize: matrix.entrants().length + (admitted ? 1 : 0),
        mixtureBefore, response: response.result,
        admittedStrategyId: admitted?.id ?? null, elapsedMs: now() - started } satisfies IterationEvent;
      unionEvents.push(event); config.onEvent?.(event);
      if (!admitted) { consecutiveFailures += 1; continue; }
      const failed = await addToMatrix(admitted);
      if (failed) return failed;
      consecutiveFailures = 0;
    }
    if (config.finalDeadline !== undefined && now() >= config.finalDeadline) {
      return invalid(matrix, 'search-deadline', null, unionEvents, finalFailures);
    }
    const finalSeeds = finalSearchSeedNamespaces(config.seed, finalAttempt);
    for (const [name, seeds] of Object.entries(finalSeeds)) reserveSeeds(`final:${finalAttempt}:${name}`, seeds);
    const started = now();
    const mixtureBefore = equilibrium.weights;
    let response: FinalSearchOutcome;
    try {
      response = await (config.finalSearch ?? runFinalSearch)({
        targetWeights: equilibrium.weights, strategies: snapshot.strategies,
        kingdomId: config.kingdomId, seeds: finalSeeds,
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
    const admitted = response.result.admitted && response.candidate ? response.candidate : null;
    const event = { restart: 'final', attempt: finalAttempt++,
      matrixSize: matrix.entrants().length + (admitted ? 1 : 0), mixtureBefore,
      response: response.result, admittedStrategyId: admitted?.id ?? null,
      elapsedMs: now() - started } satisfies IterationEvent;
    unionEvents.push(event); config.onEvent?.(event);
    if (!admitted) { finalFailures.push(response.result); break; }
    const failed = await addToMatrix(admitted);
    if (failed) return failed;
  }
  snapshot = matrix.snapshot();
  const valid = snapshot.complete;
  const events = [...allEvents(), ...unionEvents];
  return { valid, restarts, strategies: snapshot.strategies, matrix: snapshot,
    equilibrium: valid ? equilibrium : null,
    events, finalFailures,
    restartAgreement: beforeUnion,
    matches: matches(events), restartStatuses, failure: null, seedNamespaces,
    stopReason: valid ? stopReason : 'partial-union' };
}
