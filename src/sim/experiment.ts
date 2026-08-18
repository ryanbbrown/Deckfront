import fs from 'node:fs';
import path from 'node:path';
import { kingdomMarket, kingdomOf } from '../game';
import { checkRiggedMelee } from './calibration';
import type { ExperimentOptions } from './cli';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './cli';
import { evolve, retainedLeaders } from './evolution';
import { CALIBRATION_KINGDOM_ID } from './kingdoms';
import { emptyAggregate, mergeAggregate } from './pairing';
import { renderReport } from './report';
import type { GenerationLine, RunSummary } from './report';
import { baselineLabels, seedFindings, seedStrategies } from './seedPopulation';
import { formatStrategy } from './strategy';
import type { Strategy } from './strategy';
import { roundRobin } from './tournament';
import type { GenerationResult, TelemetryAggregate, TournamentResult } from './types';

/**
 * The share of the deadline held back for the final tournament. It is the single most expensive step,
 * and a run that reports no ranking, no pairwise table, and no calibration result is the worst
 * outcome for an unattended goal.
 */
export const TOURNAMENT_RESERVE = 0.2;

export interface ExperimentDeps {
  now?: (() => number) | undefined;
  evolve?: typeof evolve | undefined;
  roundRobin?: typeof roundRobin | undefined;
}

/** Written to a temporary name and renamed, so a kill never leaves a half-written JSON file. */
function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function writeText(file: string, text: string): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

/** A second run must not append to the first run's `generations.jsonl` or leave its artifacts behind. */
function prepareDirectory(outDir: string): void {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

function generationLine(result: GenerationResult): GenerationLine {
  return {
    generation: result.generation,
    partial: result.partial,
    matchCount: result.matchCount,
    overflowCount: result.overflowCount,
    elapsedMs: result.elapsedMs,
    leaders: result.leaders.map((entry) => ({
      strategyId: entry.strategy.id,
      score: entry.score,
      completedGames: entry.completedGames,
      abortedGames: entry.abortedGames
    })),
    scores: result.scores
  };
}

function abortedInTournament(telemetry: TelemetryAggregate): number {
  let aborted = 0;
  for (const first of ['firstOchre', 'firstIndigo'] as const) {
    for (const side of ['normal', 'swapped'] as const) aborted += telemetry.byOrientation[first][side].aborted;
  }
  return aborted;
}

function runRecord(summary: RunSummary, resolvedKingdom: unknown): unknown {
  return {
    kingdomId: summary.kingdomId,
    kingdomName: summary.kingdomName,
    mode: summary.mode,
    seed: summary.seed,
    limits: summary.limits,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    elapsedMs: summary.elapsedMs,
    stopReason: summary.stopReason,
    error: summary.error,
    generationsRun: summary.generations.length,
    evolutionMatches: summary.evolutionMatches,
    evolutionAborted: summary.evolutionAborted,
    tournamentMatches: summary.tournamentMatches,
    tournamentAborted: summary.tournamentAborted,
    tournamentComplete: summary.tournamentComplete,
    calibration: summary.calibration,
    blockers: summary.blockers,
    seedFindings: summary.seedFindings,
    finalLeaderIds: summary.finalLeaderIds,
    // The resolved definitions, not the kingdom record and its override map: only the resolved form
    // keeps a committed report reproducible against a later change to a canonical card value.
    kingdom: resolvedKingdom
  };
}

function tournamentRecord(result: TournamentResult): unknown {
  return {
    entrants: result.entrants.map((entrant) => entrant.id),
    partial: result.partial,
    pairsPlayed: result.pairsPlayed,
    pairsExpected: result.pairsExpected,
    pairs: result.pairs,
    ranking: result.ranking.map((entry) => ({
      strategyId: entry.strategy.id,
      score: entry.score,
      completedGames: entry.completedGames,
      abortedGames: entry.abortedGames
    })),
    calibration: result.calibration
  };
}

/** Keeps the first appearance of each strategy, so the caller's order decides precedence. */
function dedupeById(strategies: readonly Strategy[]): Strategy[] {
  const seen = new Set<string>();
  return strategies.filter((strategy) => {
    if (seen.has(strategy.id)) return false;
    seen.add(strategy.id);
    return true;
  });
}

function strategyRecord(strategies: readonly { source: string; strategy: Strategy }[], labels: Map<string, string>): unknown {
  return {
    strategies: strategies.map(({ source, strategy }) => ({
      id: strategy.id,
      baseline: labels.get(strategy.id) ?? null,
      source,
      text: formatStrategy(strategy),
      strategy
    }))
  };
}

/**
 * Runs one experiment and writes every artifact under `outDir`.
 *
 * Output survives a limit: `run.json` is written before the first generation, `generations.jsonl` is
 * appended as each generation finishes, and an error is recorded rather than thrown, so a full run
 * that hits a blocker still leaves a readable report. The caller decides the exit code from
 * `stopReason`.
 */
export function runExperiment(options: ExperimentOptions, outDir: string, deps: ExperimentDeps = {}): RunSummary {
  const now = deps.now ?? Date.now;
  const runEvolution = deps.evolve ?? evolve;
  const runTournament = deps.roundRobin ?? roundRobin;

  const startedAtMs = now();
  const budgetMs = options.deadlineMinutes * 60_000;
  const evolutionDeadline = startedAtMs + Math.round(budgetMs * (1 - TOURNAMENT_RESERVE));
  const tournamentDeadline = startedAtMs + budgetMs;
  const labels = baselineLabels(options.kingdomId);

  const summary: RunSummary = {
    kingdomId: options.kingdomId,
    kingdomName: kingdomOf(options.kingdomId).name,
    mode: options.mode,
    seed: options.seed,
    limits: {
      candidates: options.candidates,
      leaders: options.leaders,
      generations: options.generations,
      sharedSeeds: options.sharedSeeds,
      deadlineMinutes: options.deadlineMinutes,
      stateLimit: options.stateLimit,
      turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN
    },
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(startedAtMs).toISOString(),
    elapsedMs: 0,
    stopReason: 'running',
    error: null,
    evolutionMatches: 0,
    evolutionAborted: 0,
    tournamentMatches: 0,
    tournamentAborted: 0,
    generations: [],
    seedFindings: seedFindings(options.kingdomId),
    strategyLabels: Object.fromEntries(labels),
    finalLeaderIds: [],
    evolutionTelemetry: emptyAggregate(),
    tournament: null,
    tournamentComplete: false,
    calibration: null,
    blockers: []
  };

  const runFile = path.join(outDir, 'run.json');
  const resolvedKingdom = kingdomMarket(options.kingdomId);
  prepareDirectory(outDir);
  writeJson(runFile, runRecord(summary, resolvedKingdom));

  const generationsFile = path.join(outDir, 'generations.jsonl');
  // Every leader of every generation, for `strategies.json`. The tournament takes a smaller set.
  const everyLeader: { source: string; strategy: Strategy }[] = [];
  const seen = new Set<string>();
  const remember = (source: string, strategy: Strategy): void => {
    if (seen.has(strategy.id)) return;
    seen.add(strategy.id);
    everyLeader.push({ source, strategy });
  };

  try {
    const results = runEvolution({
      kingdomId: options.kingdomId,
      seed: options.seed,
      candidates: options.candidates,
      leaders: options.leaders,
      generations: options.generations,
      sharedSeeds: options.sharedSeeds,
      turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN,
      stateLimit: options.stateLimit,
      deadline: evolutionDeadline,
      now
    }, (result) => {
      summary.generations.push(generationLine(result));
      summary.evolutionMatches += result.matchCount;
      summary.evolutionAborted += result.overflowCount;
      mergeAggregate(summary.evolutionTelemetry, result.telemetry);
      fs.appendFileSync(generationsFile, `${JSON.stringify(generationLine(result))}\n`);
    });

    const finalLeaders = results.at(-1)?.leaders.map((entry) => entry.strategy) ?? [];
    summary.finalLeaderIds = finalLeaders.map((leader) => leader.id);
    summary.stopReason = results.length === options.generations && !results.at(-1)?.partial
      ? 'generations'
      : 'deadline';

    const retained = retainedLeaders(results);
    const baselines = seedStrategies(options.kingdomId);

    // Source precedence, so the label carries the strongest claim on a strategy that has several.
    for (const leader of finalLeaders) remember('final', leader);
    for (const leader of retained) remember('retained', leader);
    for (const result of results) for (const entry of result.leaders) remember('leader', entry.strategy);
    for (const seed of baselines) remember('baseline', seed);

    // The tournament takes the final leaders, one best leader per generation, and the fixed
    // baselines — not every leader of every generation, which grows quadratically with the
    // generation count. Final leaders come first because `roundRobin` walks pairs in this order and
    // stops at the deadline, and the calibration gate reads exactly the final leaders' matches: a
    // truncated tournament must cost precision, never the verdict.
    const entrants = dedupeById([...finalLeaders, ...retained, ...baselines]);

    const tournament = runTournament(entrants, {
      kingdomId: options.kingdomId,
      seed: options.seed,
      sharedSeeds: options.sharedSeeds,
      turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN,
      stateLimit: options.stateLimit,
      finalLeaderIds: summary.finalLeaderIds,
      deadline: tournamentDeadline,
      now
    });
    summary.tournament = tournament;
    summary.tournamentComplete = !tournament.partial;
    summary.tournamentMatches = tournament.pairsPlayed * options.sharedSeeds * 4;
    summary.tournamentAborted = abortedInTournament(tournament.telemetry);
    if (tournament.partial) {
      // The deadline stopped the run, whatever evolution managed. Reporting `generations` here would
      // claim the run finished the work it was asked for.
      summary.stopReason = 'deadline';
      summary.blockers.push(`The final tournament played ${tournament.pairsPlayed} of`
        + ` ${tournament.pairsExpected} pairs before the deadline, so the ranking and any calibration`
        + ' verdict below are not final.');
    }

    if (options.kingdomId === CALIBRATION_KINGDOM_ID) {
      // The gate throws when every final leader is a fixed baseline. That is a result — the search
      // never beat its own yardstick — and an unattended run must record it, not die on it.
      try {
        summary.calibration = checkRiggedMelee(tournament.calibration);
      } catch (error) {
        const survivors = summary.finalLeaderIds
          .map((id) => summary.strategyLabels[id] ?? id).join(', ') || 'none';
        summary.blockers.push('The calibration gate has no evolved final leader to judge:'
          + ` ${error instanceof Error ? error.message : String(error)}`
          + ` The leaders that survived were ${survivors}.`);
      }
    }

    writeJson(path.join(outDir, 'tournament.json'), tournamentRecord(tournament));
    writeJson(path.join(outDir, 'telemetry.json'), {
      evolution: summary.evolutionTelemetry,
      tournament: tournament.telemetry
    });
  } catch (error) {
    summary.stopReason = 'error';
    summary.error = error instanceof Error ? error.message : String(error);
  }

  const finishedAtMs = now();
  summary.finishedAt = new Date(finishedAtMs).toISOString();
  summary.elapsedMs = finishedAtMs - startedAtMs;

  writeJson(path.join(outDir, 'strategies.json'), strategyRecord(everyLeader, labels));
  writeText(path.join(outDir, 'report.md'), renderReport(summary));
  writeJson(runFile, runRecord(summary, resolvedKingdom));
  return summary;
}
