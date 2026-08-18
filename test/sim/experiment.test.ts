import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetKingdoms } from '../../src/game';
import { experimentDir, main } from '../../src/sim/cli';
import type { ExperimentOptions } from '../../src/sim/cli';
import { evolve } from '../../src/sim/evolution';
import { runExperiment } from '../../src/sim/experiment';
import { emptyAggregate } from '../../src/sim/pairing';
import { seedStrategies } from '../../src/sim/seedPopulation';
import type { Strategy } from '../../src/sim/strategy';
import { roundRobin } from '../../src/sim/tournament';
import type { GenerationResult, ScoredStrategy, TournamentResult } from '../../src/sim/types';

afterEach(() => { resetKingdoms(); });

/** Every file-writing test works in a temporary directory, never in the repository's `.experiments`. */
function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-experiment-'));
}

const KINGDOM = 'range-rich-mixed';

function options(over: Partial<ExperimentOptions> = {}): ExperimentOptions {
  return {
    kingdomId: KINGDOM, mode: 'smoke', seed: 3, candidates: 5, leaders: 1,
    generations: 1, sharedSeeds: 1, deadlineMinutes: 30, stateLimit: 20000, ...over
  };
}

function scored(plan: Strategy): ScoredStrategy {
  return { strategy: plan, score: 1, completedGames: 4, abortedGames: 0 };
}

/** A generation that costs no matches, for the tests that are about the output and not the search. */
function fakeGeneration(leaders: readonly Strategy[]): GenerationResult {
  return {
    generation: 1, partial: false, leaders: leaders.map(scored), scores: { [leaders[0]!.id]: 1 },
    matchCount: 4, overflowCount: 0, elapsedMs: 5, telemetry: emptyAggregate()
  };
}

function fakeEvolve(leaders: readonly Strategy[], before?: (result: GenerationResult) => void): typeof evolve {
  return (_config, onGeneration) => {
    const result = fakeGeneration(leaders);
    before?.(result);
    onGeneration(result);
    return [result];
  };
}

function fakeTournament(entrants: readonly Strategy[]): typeof roundRobin {
  return (): TournamentResult => ({
    entrants: [...entrants], pairs: {}, ranking: entrants.map(scored), telemetry: emptyAggregate(),
    partial: false, pairsPlayed: 1, pairsExpected: 1,
    calibration: { finalLeaders: [], acquisitionsByStrategy: {} }
  });
}

describe('writing an experiment', () => {
  it('writes run.json with the resolved kingdom before the first generation ends', () => {
    const dir = tempDir();
    const leaders = seedStrategies(KINGDOM).slice(0, 2);
    let early: Record<string, unknown> | null = null;
    // Read from inside the search, before the first generation is reported: a run.json written only
    // after `evolve` returns would leave a killed run with no record of what it was running.
    const watching = fakeEvolve(leaders, () => {
      early = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) as Record<string, unknown>;
    });

    runExperiment(options(), dir, { evolve: watching, roundRobin: fakeTournament(leaders) });

    expect(early).not.toBeNull();
    const record = early as unknown as { kingdomId: string; stopReason: string; kingdom: { id: string }[] };
    expect(record.kingdomId).toBe(KINGDOM);
    expect(record.stopReason).toBe('running');
    expect(record.kingdom.map((definition) => definition.id)).toContain('quickShot');
  });

  it('clears the artifacts of a previous run', () => {
    const dir = tempDir();
    const leaders = seedStrategies(KINGDOM).slice(0, 2);
    fs.writeFileSync(path.join(dir, 'generations.jsonl'), '{"generation":99}\n');
    fs.writeFileSync(path.join(dir, 'stale.json'), '{}');

    runExperiment(options(), dir, { evolve: fakeEvolve(leaders), roundRobin: fakeTournament(leaders) });

    expect(fs.existsSync(path.join(dir, 'stale.json'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'generations.jsonl'), 'utf8')).not.toContain('"generation":99');
    expect(fs.readFileSync(path.join(dir, 'generations.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('records an error, still writes the report, and reports a non-zero exit code', () => {
    const root = tempDir();
    const failing: typeof evolve = () => { throw new Error('the population could not be filled'); };

    const code = main(['--kingdom', KINGDOM, '--mode', 'smoke'], root, { evolve: failing });

    expect(code).toBe(1);
    const dir = experimentDir(root, KINGDOM, 'smoke');
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) as { stopReason: string; error: string };
    expect(record.stopReason).toBe('error');
    expect(record.error).toBe('the population could not be filled');
    expect(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')).toContain('the population could not be filled');
  });

  it('stops evolution on the deadline and leaves every generation line valid JSON', () => {
    const dir = tempDir();
    // Two seconds of the injected clock per pairing, against a one-minute budget whose evolution
    // share is 48 seconds, so the deadline lands inside a generation rather than on a boundary.
    let clock = 0;
    const summary = runExperiment(
      options({ generations: 5, deadlineMinutes: 1 }), dir,
      { now: () => (clock += 2000), roundRobin: fakeTournament(seedStrategies(KINGDOM).slice(0, 2)) }
    );

    expect(summary.stopReason).toBe('deadline');
    expect(summary.generations.length).toBeGreaterThan(1);
    expect(summary.generations.length).toBeLessThan(5);
    expect(summary.generations.at(-1)!.partial).toBe(true);
    expect(summary.generations.slice(0, -1).every((line) => !line.partial)).toBe(true);

    const lines = fs.readFileSync(path.join(dir, 'generations.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(summary.generations.length);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect((JSON.parse(lines.at(-1)!) as { partial: boolean }).partial).toBe(true);
  });

  it('marks a tournament the deadline cut short, and says so in the report', () => {
    const dir = tempDir();
    let clock = 0;
    const leaders = seedStrategies(KINGDOM).slice(0, 2);
    // Evolution costs nothing here, so the clock is spent entirely inside the round robin.
    const summary = runExperiment(
      options({ deadlineMinutes: 1 }), dir,
      { now: () => (clock += 20_000), evolve: fakeEvolve(leaders) }
    );

    expect(summary.tournamentComplete).toBe(false);
    expect(summary.tournament!.partial).toBe(true);
    expect(summary.tournament!.pairsPlayed).toBeLessThan(summary.tournament!.pairsExpected);
    expect(summary.blockers[0]).toContain('before the deadline');
    const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
    expect(report).toContain('**The final tournament did not finish.**');
    expect(report).toContain('| Tournament complete | no |');
  });

  it('records the gate refusing when every final leader is a fixed baseline', () => {
    const dir = tempDir();
    const baselines = seedStrategies('rigged-melee').slice(0, 2);
    const summary = runExperiment(
      options({ kingdomId: 'rigged-melee' }), dir,
      { evolve: fakeEvolve(baselines), roundRobin: roundRobin }
    );

    expect(summary.calibration).toBeNull();
    expect(summary.blockers.join(' ')).toContain('no evolved final leader');
    // The rest of the run survives: a search that failed to beat its baselines is a result to read.
    expect(summary.stopReason).toBe('generations');
    expect(fs.existsSync(path.join(dir, 'tournament.json'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')).toContain('**Blocker:**');
  });

  it('leaves the calibration section out of a kingdom that has no gate', () => {
    const dir = tempDir();
    const leaders = seedStrategies(KINGDOM).slice(0, 2);
    const summary = runExperiment(options(), dir, {
      evolve: fakeEvolve(leaders), roundRobin: fakeTournament(leaders)
    });
    expect(summary.calibration).toBeNull();
    expect(summary.blockers).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')).not.toContain('## Calibration');
  });

  it('runs end to end from the command line into a mode-specific directory', () => {
    const root = tempDir();
    const argv = ['--kingdom', KINGDOM, '--mode', 'smoke', '--candidates', '5', '--leaders', '1',
      '--generations', '1', '--seeds', '1'];

    expect(main(argv, root)).toBe(0);

    const dir = experimentDir(root, KINGDOM, 'smoke');
    expect(dir.endsWith(path.join('.experiments', KINGDOM, 'smoke'))).toBe(true);
    for (const file of ['run.json', 'generations.jsonl', 'tournament.json', 'strategies.json', 'telemetry.json', 'report.md']) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) as {
      stopReason: string; mode: string; limits: { candidates: number }; tournamentComplete: boolean;
    };
    expect(record.stopReason).toBe('generations');
    expect(record.mode).toBe('smoke');
    expect(record.limits.candidates).toBe(5);
    expect(record.tournamentComplete).toBe(true);

    const strategies = JSON.parse(fs.readFileSync(path.join(dir, 'strategies.json'), 'utf8')) as {
      strategies: { id: string; source: string; text: string }[];
    };
    expect(strategies.strategies.some((entry) => entry.source === 'baseline')).toBe(true);
    expect(strategies.strategies.every((entry) => entry.text.startsWith(entry.id))).toBe(true);

    const telemetry = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(telemetry).sort()).toEqual(['evolution', 'tournament']);
  });
});
