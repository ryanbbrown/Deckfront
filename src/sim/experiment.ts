import fs from 'node:fs';
import path from 'node:path';
import { SeededRandom, kingdomMarket, kingdomOf } from '../game';
import { SEED_LABELS, SEED_STRATEGIES } from './baselines';
import { solveEquilibrium } from './equilibrium';
import {
  ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER, UNION_DEADLINE_RESERVE, conservativeGameBound
} from './experimentConfig';
import type { ExperimentOptions } from './experimentConfig';
import { CALIBRATION_KINGDOM_ID } from './kingdoms';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from './mixtureEvaluation';
import { InvalidEvaluationError } from './payoffMatrix';
import { emptyAggregate, mergeAggregate } from './pairing';
import { InlinePairingRunner } from './pairingRunner';
import type { PairingRunner } from './pairingRunner';
import { runPsro } from './psro';
import type { PsroResult } from './psro';
import type { IterationEvent } from './psro';
import { renderReport } from './report';
import type { CalibrationDiagnostic, RunSummary } from './report';
import { assertDisjointSeedNamespaces, configuredSeedNamespaces, namespaceSeeds } from './seedNamespaces';
import type { TelemetryAggregate } from './types';

export interface ExperimentDeps {
  now?: (() => number) | undefined;
  pairingRunner?: PairingRunner | undefined;
  runPsro?: typeof runPsro | undefined;
  weightIntervals?: typeof calculateWeightIntervals | undefined;
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function writeText(file: string, value: string): void {
  const temporary = `${file}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file);
}
function prepareDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory, { recursive: true });
}
function iterationRecord(event: IterationEvent): unknown {
  if (!event.response) return event;
  const response: Record<string, unknown> = { ...event.response };
  delete response.telemetry;
  delete response.screenTelemetry;
  delete response.confirmationTelemetry;
  return { ...event, response };
}
function allTelemetry(result: PsroResult): TelemetryAggregate {
  const aggregate = emptyAggregate();
  for (const cell of result.matrix.cells) mergeAggregate(aggregate, cell.telemetry);
  for (const event of result.events) if (event.response) mergeAggregate(aggregate, event.response.telemetry);
  return aggregate;
}
function aborts(telemetry: TelemetryAggregate): number {
  let total = 0;
  for (const first of Object.values(telemetry.byOrientation)) {
    for (const side of Object.values(first)) total += side.aborted;
  }
  return total;
}
export function calculateWeightIntervals(
  result: PsroResult, seed: number, options: {
    deadline?: number | undefined; now?: (() => number) | undefined;
    solve?: typeof solveEquilibrium | undefined; samples?: number | undefined;
  } = {}
): { intervals: Record<string, { lower: number; upper: number }>; warnings: string[]; samplesCompleted: number } {
  if (!result.equilibrium || !result.matrix.complete) return { intervals: {}, warnings: [], samplesCompleted: 0 };
  const ids = result.matrix.strategies.map((strategy) => strategy.id);
  const index = new Map(ids.map((id, position) => [id, position]));
  const random = new SeededRandom(seed);
  const samples: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const warnings: string[] = [];
  const now = options.now ?? Date.now;
  const solve = options.solve ?? solveEquilibrium;
  const requestedSamples = options.samples ?? 200;
  let samplesCompleted = 0;
  for (let sample = 0; sample < requestedSamples; sample += 1) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      warnings.push(`Weight-interval bootstrap stopped at ${samplesCompleted} of ${requestedSamples} samples at the deadline.`);
      break;
    }
    const payoff = ids.map(() => ids.map(() => 0));
    for (const cell of result.matrix.cells) {
      let total = 0;
      for (let block = 0; block < cell.blocks.length; block += 1) {
        total += 2 * cell.blocks[random.nextInt(cell.blocks.length)]!.score - 1;
      }
      const value = total / cell.blocks.length;
      const row = index.get(cell.rowId)!, column = index.get(cell.columnId)!;
      payoff[row]![column] = value; payoff[column]![row] = -value;
    }
    let solved: ReturnType<typeof solveEquilibrium>;
    try { solved = solve(ids, payoff); }
    catch (error) {
      warnings.push(`Weight-interval bootstrap stopped after a solver failure: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    for (const id of ids) samples[id]!.push(solved.weights[id] ?? 0);
    samplesCompleted += 1;
  }
  if (!samplesCompleted) return { intervals: {}, warnings, samplesCompleted };
  const intervals = Object.fromEntries(ids.map((id) => {
    const values = samples[id]!.sort((a, b) => a - b);
    const lower = values[Math.floor(values.length * 0.025)]!;
    const upper = values[Math.max(0, Math.ceil(values.length * 0.975) - 1)]!;
    return [id, { lower, upper }];
  }));
  return { intervals, warnings, samplesCompleted };
}
async function calibrationDiagnostic(
  options: ExperimentOptions, result: PsroResult, runner: PairingRunner
): Promise<{ diagnostic: CalibrationDiagnostic; telemetry: TelemetryAggregate; matches: number } | null> {
  if (options.kingdomId !== CALIBRATION_KINGDOM_ID || !result.equilibrium) return null;
  const labels = SEED_LABELS[CALIBRATION_KINGDOM_ID]!;
  const meleeIndex = labels.indexOf('melee');
  const benchmark = SEED_STRATEGIES[CALIBRATION_KINGDOM_ID]![meleeIndex]!;
  const seeds = namespaceSeeds(options.seed, 'diagnostic', options.seeds);
  const schedule = mixtureSchedule(result.equilibrium.weights, seeds, seeds[0]! ^ 0xc71f3a2d);
  const strategies = new Map(result.strategies.map((strategy) => [strategy.id, strategy]));
  const [evaluated] = await evaluateCandidates([benchmark], strategies, schedule, runner, {
    kingdomId: options.kingdomId, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
    actionCapPerTurn: ACTION_CAP_PER_TURN
  });
  const interval = percentileBootstrapMean(evaluated!.blockScores,
    namespaceSeeds(options.seed, 'bootstrap', 1, options.restarts + 1, 0)[0]!);
  const telemetry = allTelemetry(result);
  const heavyBlowInPositiveWeightStrategy = result.strategies.some((strategy) =>
    (result.equilibrium!.weights[strategy.id] ?? 0) > 0
      && (strategy.startingBuild.includes('heavyBlow')
        || (telemetry.acquisitionsByStrategy[strategy.id]?.heavyBlow ?? 0) > 0));
  return { diagnostic: { benchmarkId: benchmark.id, mean: evaluated!.mean, interval,
    observedAdvantage: Math.max(0, evaluated!.mean - 0.5), heavyBlowInPositiveWeightStrategy },
    telemetry: evaluated!.telemetry, matches: evaluated!.matches };
}

export async function runExperiment(
  options: ExperimentOptions, outDir: string, deps: ExperimentDeps = {}
): Promise<RunSummary> {
  const runner = deps.pairingRunner ?? new InlinePairingRunner();
  try { return await runWithRunner(options, outDir, deps, runner); }
  finally { await runner.close(); }
}

async function runWithRunner(
  options: ExperimentOptions, outDir: string, deps: ExperimentDeps, runner: PairingRunner
): Promise<RunSummary> {
  const now = deps.now ?? Date.now;
  const started = now();
  const deadline = started + options.deadlineMinutes * 60_000;
  const searchDeadline = started + Math.round(options.deadlineMinutes * 60_000 * (1 - UNION_DEADLINE_RESERVE));
  prepareDirectory(outDir);
  const base: RunSummary = {
    schemaVersion: 2, valid: false, kingdomId: options.kingdomId, kingdomName: kingdomOf(options.kingdomId).name,
    mode: options.mode, seed: options.seed,
    limits: {
      restarts: options.restarts, initialStrategies: options.initialStrategies,
      candidates: options.candidates, iterations: options.iterations,
      nicheAdditions: options.nicheAdditions, seeds: options.seeds,
      unionIterations: options.unionIterations, deadlineMinutes: options.deadlineMinutes,
      workers: options.workers,
      turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
      gameBoundBeforeDiagnostics: conservativeGameBound(options)
    },
    startedAt: new Date(started).toISOString(), finishedAt: new Date(started).toISOString(), elapsedMs: 0,
    stopReason: 'running', error: null, matches: 0, aborted: 0, matrix: null, equilibrium: null,
    strategies: [], iterations: [], restartAgreement: [], calibration: null,
    telemetry: emptyAggregate(), weightIntervals: {}, warnings: [], restartStatuses: [],
    restartMixtures: [], finalFailures: []
  };
  const runPath = path.join(outDir, 'run.json');
  const iterationsPath = path.join(outDir, 'iterations.jsonl');
  writeText(iterationsPath, '');
  writeJson(runPath, { ...base, kingdom: kingdomMarket(options.kingdomId), seedNamespaces: { derivation: 'run:phase:restart:attempt:block' } });
  let summary = base;
  const completedEvents: IterationEvent[] = [];
  try {
    const phaseSeeds = configuredSeedNamespaces(options);
    assertDisjointSeedNamespaces(phaseSeeds);
    const execute = deps.runPsro ?? runPsro;
    const result = await execute({
      kingdomId: options.kingdomId, seed: options.seed, restarts: options.restarts,
      initialStrategies: options.initialStrategies, candidates: options.candidates,
      iterations: options.iterations, nicheAdditions: options.nicheAdditions, seeds: options.seeds,
      unionIterations: options.unionIterations, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN, searchDeadline,
      finalDeadline: deadline, onEvent: (event) => {
        completedEvents.push(event);
        fs.appendFileSync(iterationsPath, `${JSON.stringify(iterationRecord(event))}\n`);
      }
    }, runner, now);
    const gameBound = conservativeGameBound(options);
    if (result.matches > gameBound) {
      throw new Error(`PSRO played ${result.matches} games, above its mechanical bound of ${gameBound}.`);
    }
    const telemetry = allTelemetry(result);
    const calibrationResult = result.valid ? await calibrationDiagnostic(options, result, runner) : null;
    if (calibrationResult) mergeAggregate(telemetry, calibrationResult.telemetry);
    const weightDiagnostic = (deps.weightIntervals ?? calculateWeightIntervals)(result,
      namespaceSeeds(options.seed, 'bootstrap', 1, options.restarts + 2, 0)[0]!,
      { deadline, now });
    const finished = now();
    summary = { ...base, valid: result.valid, finishedAt: new Date(finished).toISOString(),
      elapsedMs: finished - started, stopReason: result.stopReason,
      error: result.failure ? `${result.failure.message} ${JSON.stringify(result.failure.detail)}` : null,
      matches: result.matches + (calibrationResult?.matches ?? 0),
      aborted: aborts(telemetry), matrix: result.matrix, equilibrium: result.equilibrium,
      strategies: result.strategies, iterations: result.events,
      restartAgreement: result.restartAgreement, calibration: calibrationResult?.diagnostic ?? null,
      telemetry, weightIntervals: weightDiagnostic.intervals, warnings: weightDiagnostic.warnings,
      restartStatuses: result.restartStatuses,
      restartMixtures: result.restarts.map((restart) => ({ restart: restart.restart,
        stopReason: restart.stopReason, completed: restart.completed,
        weights: restart.equilibrium?.weights ?? null })),
      finalFailures: result.finalFailures.map((failure) => ({ mean: failure.heldOutMean,
        interval: failure.interval, blocks: failure.confirmSchedule.blocks.length,
        reason: failure.failureReason })) };
    writeText(iterationsPath, result.events.map((event) => JSON.stringify(iterationRecord(event))).join('\n')
      + (result.events.length ? '\n' : ''));
    writeJson(path.join(outDir, 'matrix.json'), { ...result.matrix, equilibrium: result.equilibrium });
    const nicheIds = new Set(result.restarts.flatMap((restart) => restart.nicheDiscoveries));
    const admitted = new Set(result.events.map((event) => event.admittedStrategyId).filter(Boolean));
    writeJson(path.join(outDir, 'strategies.json'), { strategies: result.strategies.map((strategy) => ({
      strategy, source: nicheIds.has(strategy.id) ? 'rectified-niche'
        : admitted.has(strategy.id) ? 'global-response' : 'automatic-initialization'
    })) });
    const matrixTelemetry = emptyAggregate();
    for (const cell of result.matrix.cells) mergeAggregate(matrixTelemetry, cell.telemetry);
    const screenTelemetry = emptyAggregate();
    const confirmationTelemetry = emptyAggregate();
    for (const event of result.events) if (event.response) {
      mergeAggregate(screenTelemetry, event.response.screenTelemetry);
      mergeAggregate(confirmationTelemetry, event.response.confirmationTelemetry);
    }
    writeJson(path.join(outDir, 'telemetry.json'), {
      matrix: matrixTelemetry, screening: screenTelemetry, confirmation: confirmationTelemetry,
      diagnostic: calibrationResult?.telemetry ?? emptyAggregate(), total: telemetry
    });
    writeJson(runPath, { ...summary, matrix: undefined, telemetry: undefined, iterations: undefined,
      kingdom: kingdomMarket(options.kingdomId), seedNamespaces: phaseSeeds });
  } catch (error) {
    const finished = now();
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof InvalidEvaluationError ? ` ${JSON.stringify(error.detail)}` : '';
    summary = { ...base, finishedAt: new Date(finished).toISOString(), elapsedMs: finished - started,
      stopReason: 'error', error: `${message}${detail}`,
      iterations: completedEvents };
    writeJson(path.join(outDir, 'matrix.json'), { complete: false, equilibrium: null });
    writeJson(path.join(outDir, 'strategies.json'), { strategies: [] });
    writeJson(path.join(outDir, 'telemetry.json'), summary.telemetry);
    writeJson(runPath, { ...summary, matrix: undefined, telemetry: undefined, iterations: undefined,
      kingdom: kingdomMarket(options.kingdomId) });
  }
  writeText(path.join(outDir, 'report.md'), renderReport(summary));
  return summary;
}
