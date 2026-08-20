import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  MATERIAL_WEIGHT, NEAR_COMPETITIVE_SCORE, buildBalanceReportModel, loadArtifactSet, renderBalanceReport
} from '../../scripts/generate_balance_report';
import type { ArtifactSet } from '../../scripts/generate_balance_report';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { emptyAggregate } from '../../src/sim/pairing';
import { rulesFingerprint } from '../../src/sim/rulesFingerprint';
import { identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { TelemetryAggregate } from '../../src/sim/types';

function strategy(build: string[], agenda: [string, number][], repeat: string): Strategy {
  return identify({ id: '', startingBuild: build,
    buyAgenda: agenda.map(([cardId, desiredCount]) => ({ cardId, desiredCount })), repeatPurchase: repeat });
}

function telemetry(options: {
  games?: number; draws?: number; firstWins?: number; winningTurns?: number; wins?: number;
  acquisitions?: Record<string, Record<string, number>>;
} = {}): TelemetryAggregate {
  const result = emptyAggregate();
  const games = options.games ?? 100, draws = options.draws ?? 0, firstWins = options.firstWins ?? 50;
  const firstOchreGames = games / 2, firstIndigoGames = games / 2;
  result.byOrientation.firstOchre.normal.played = firstOchreGames / 2;
  result.byOrientation.firstOchre.swapped.played = firstOchreGames / 2;
  result.byOrientation.firstIndigo.normal.played = firstIndigoGames / 2;
  result.byOrientation.firstIndigo.swapped.played = firstIndigoGames / 2;
  result.byOrientation.firstOchre.normal.wins = firstWins / 2;
  result.byOrientation.firstOchre.swapped.wins = firstWins / 2;
  result.byOrientation.firstIndigo.normal.draws = draws / 2;
  result.byOrientation.firstIndigo.swapped.draws = draws / 2;
  const firstIndigoWins = 0;
  result.byOrientation.firstIndigo.normal.losses = firstIndigoWins / 2;
  result.byOrientation.firstIndigo.swapped.losses = firstIndigoWins / 2;
  result.turnsToWin = { total: options.winningTurns ?? 800, count: options.wins ?? games - draws };
  result.acquisitionsByStrategy = options.acquisitions ?? {};
  return result;
}

function artifact(options: {
  kingdomId?: string; strategies: Strategy[]; weights: number[]; payoffs: number[][];
  crossTelemetry?: TelemetryAggregate;
}): ArtifactSet {
  const kingdomId = options.kingdomId ?? 'current-duel';
  const protocol = matrixProtocol(kingdomId, [11], 30, 200);
  const cells = [];
  for (let row = 0; row < options.strategies.length; row += 1) {
    for (let column = row + 1; column < options.strategies.length; column += 1) {
      cells.push({ rowId: options.strategies[row]!.id, columnId: options.strategies[column]!.id,
        key: `${row}-${column}`, blocks: [{ seed: 11, score: (options.payoffs[row]![column]! + 1) / 2,
          played: 100, aborted: 0 }], complete: true, centeredPayoff: options.payoffs[row]![column]!,
        matches: 100, telemetry: options.crossTelemetry ?? telemetry() });
    }
  }
  const weights = Object.fromEntries(options.strategies.map((entry, index) => [entry.id, options.weights[index]!]));
  return {
    run: { schemaVersion: 3, rulesFingerprint: rulesFingerprint(kingdomId), valid: true, kingdomId,
      kingdomName: kingdomId === 'rigged-melee' ? 'Rigged Melee' : 'Current Duel', mode: 'full', seed: 1,
      limits: { turnLimitPerPlayer: 30, actionCapPerTurn: 200 }, finishedAt: '2026-08-19T00:00:00.000Z',
      elapsedMs: 1000, stopReason: 'response-exhausted', matches: 100, aborted: 0 },
    matrix: { protocol, strategies: options.strategies, cells, complete: true,
      centeredPayoffs: options.payoffs,
      equilibrium: { strategyIds: options.strategies.map((entry) => entry.id), weights } },
    strategies: options.strategies
  };
}

function selfPlay(kingdomId: string, entries: [Strategy, TelemetryAggregate][]): Map<string, ReadonlyMap<string, TelemetryAggregate>> {
  return new Map([[kingdomId, new Map(entries.map(([entry, value]) => [entry.id, value]))]]);
}

describe('balance report calculations', () => {
  it('uses normalized unequal lottery weights for scores and telemetry numerators', () => {
    const left = strategy(['footwork'], [['footwork', 2]], 'footwork');
    const right = strategy(['volley'], [['volley', 3]], 'volley');
    const cross = telemetry({ games: 100, draws: 20, firstWins: 60, winningTurns: 600, wins: 80,
      acquisitions: { [left.id]: { footwork: 100 }, [right.id]: { volley: 300 } } });
    const input = artifact({ strategies: [left, right], weights: [0.25, 0.75],
      payoffs: [[0, 0.2], [-0.2, 0]], crossTelemetry: cross });
    const model = buildBalanceReportModel([input], selfPlay('current-duel', [
      [left, telemetry({ games: 100, draws: 10, firstWins: 50, winningTurns: 800, wins: 90,
        acquisitions: { [left.id]: { footwork: 200 } } })],
      [right, telemetry({ games: 100, draws: 0, firstWins: 40, winningTurns: 1000, wins: 100,
        acquisitions: { [right.id]: { volley: 200 } } })]
    ]));
    const kingdom = model.kingdoms[0]!;
    expect(kingdom.strategies.map((entry) => [entry.id, entry.weight, entry.score])).toEqual([
      [right.id, 0.75, 0.475], [left.id, 0.25, 0.575]
    ]);
    expect(kingdom.matchupScores).toEqual([[0.5, 0.4], [0.6, 0.5]]);
    expect(kingdom.lotteryTelemetry).toMatchObject({ games: 100, drawRate: 0.08125,
      firstPlayerWinRate: 0.48125, firstPlayerScore: 0.521875 });
    expect(kingdom.lotteryTelemetry.winnerTurnsPerPlayer).toBeCloseTo(837.5 / 91.875 / 2, 10);
    expect(kingdom.lotteryTelemetry.acquisitionsPerGame).toEqual({ footwork: 0.5, volley: 2.25 });
  });

  it('includes exact threshold values and excludes values just below them', () => {
    const material = strategy(['footwork'], [], 'footwork');
    const boundaryWeight = strategy(['aim'], [], 'aim');
    const boundaryScore = strategy(['drive'], [], 'drive');
    const belowScore = strategy(['channel'], [], 'channel');
    const weights = [0.998, MATERIAL_WEIGHT, 0.000999, 0.000001];
    const payoffs = [
      [0, 0, 0.04, 0.0402], [0, 0, 0.04, 0.0402], [-0.04, -0.04, 0, 0], [-0.0402, -0.0402, 0, 0]
    ];
    const input = artifact({ strategies: [material, boundaryWeight, boundaryScore, belowScore], weights, payoffs });
    const model = buildBalanceReportModel([input], selfPlay('current-duel', [
      [material, telemetry()], [boundaryWeight, telemetry()]
    ]));
    expect(NEAR_COMPETITIVE_SCORE).toBe(0.48);
    expect(model.kingdoms[0]!.strategies.map((entry) => [entry.id, entry.status])).toEqual([
      [material.id, 'Lottery'], [boundaryWeight.id, 'Lottery'], [boundaryScore.id, 'Near 50%']
    ]);
    expect(model.kingdoms[0]!.strategies[0]!.weight).toBeCloseTo(0.998 / 0.999, 12);
    expect(model.kingdoms[0]!.strategies[1]!.weight).toBeCloseTo(0.001 / 0.999, 12);
    expect(model.kingdoms[0]!.strategies[2]!.score).toBeCloseTo(0.48, 12);
  });

  it('excludes calibration card use and keeps plan use separate from acquired evidence', () => {
    const planned = strategy(['footwork'], [], 'footwork');
    const normal = artifact({ strategies: [planned], weights: [1], payoffs: [[0]] });
    const calibrationPlan = strategy(['heavyBlow'], [], 'heavyBlow');
    const calibration = artifact({ kingdomId: 'rigged-melee', strategies: [calibrationPlan], weights: [1], payoffs: [[0]] });
    const model = buildBalanceReportModel([normal, calibration], new Map([
      ['current-duel', new Map([[planned.id, telemetry({ acquisitions: { [planned.id]: { volley: 2 } } })]])],
      ['rigged-melee', new Map([[calibrationPlan.id, telemetry({ acquisitions: { [calibrationPlan.id]: { heavyBlow: 2 } } })]])]
    ]));
    const footwork = model.cards.find((entry) => entry.cardId === 'footwork')!;
    const volley = model.cards.find((entry) => entry.cardId === 'volley')!;
    const heavyBlow = model.cards.find((entry) => entry.cardId === 'heavyBlow')!;
    expect(footwork).toMatchObject({ buildPlans: 1, agendaPlans: 0, repeatPlans: 1, acquiredStrategies: 0 });
    expect(volley).toMatchObject({ buildPlans: 0, agendaPlans: 0, repeatPlans: 0, acquiredStrategies: 1 });
    expect(heavyBlow).toMatchObject({ buildPlans: 0, agendaPlans: 0, repeatPlans: 0, acquiredStrategies: 0 });
  });

  it('renders required labels and is byte-identical in this and a fresh process', () => {
    const only = strategy(['footwork'], [['footwork', 2]], 'footwork');
    const model = buildBalanceReportModel([artifact({ strategies: [only], weights: [1], payoffs: [[0]] })],
      selfPlay('current-duel', [[only, telemetry()]]));
    const html = renderBalanceReport(model);
    expect(html).toContain('What the current runs show');
    expect(html).toContain('Near 50%');
    expect(html).toContain('Action-card use across normal kingdoms');
    expect(html).toContain('Purchase 1');
    const script = `import {renderBalanceReport} from './scripts/generate_balance_report.ts';process.stdout.write(renderBalanceReport(JSON.parse(process.argv[1])))`;
    const fresh = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script,
      JSON.stringify(model)], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
    expect(fresh).toBe(html);
  });
});

describe('balance artifact validation', () => {
  function writeArtifact(root: string): string {
    const one = strategy(['footwork'], [], 'footwork');
    const input = artifact({ strategies: [one], weights: [1], payoffs: [[0]] });
    const directory = path.join(root, '.experiments/current-duel/full');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(input.run));
    fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify(input.matrix));
    fs.writeFileSync(path.join(directory, 'strategies.json'), JSON.stringify({ strategies: [{ strategy: one, source: 'test' }] }));
    const aggregate = emptyAggregate();
    fs.writeFileSync(path.join(directory, 'telemetry.json'), JSON.stringify({ matrix: aggregate, screening: aggregate,
      confirmation: aggregate, diagnostic: aggregate, total: aggregate }));
    return directory;
  }

  it('accepts a complete current full artifact set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-valid-'));
    writeArtifact(root);
    expect(loadArtifactSet(root, 'current-duel').strategies).toHaveLength(1);
  });

  it.each([
    ['unsupported schema', (value: Record<string, unknown>) => { value.schemaVersion = 2; }, 'schemaVersion'],
    ['non-full mode', (value: Record<string, unknown>) => { value.mode = 'smoke'; }, 'mode'],
    ['invalid run', (value: Record<string, unknown>) => { value.valid = false; }, 'valid'],
    ['missing fingerprint', (value: Record<string, unknown>) => { delete value.rulesFingerprint; }, 'rulesFingerprint'],
    ['mismatched fingerprint', (value: Record<string, unknown>) => {
      (value.rulesFingerprint as Record<string, unknown>).hash = 'wrong';
    }, 'fingerprint mismatch']
  ])('rejects %s', (_name, mutate, expected) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-invalid-'));
    const directory = writeArtifact(root);
    const file = path.join(directory, 'run.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    mutate(value); fs.writeFileSync(file, JSON.stringify(value));
    expect(() => loadArtifactSet(root, 'current-duel')).toThrow(expected);
  });

  it('rejects missing runs, incomplete matrices, and inconsistent strategy ids', () => {
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-missing-'));
    expect(() => loadArtifactSet(missing, 'current-duel')).toThrow('Missing balance-report input');
    const incomplete = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-incomplete-'));
    let directory = writeArtifact(incomplete);
    let matrix = JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8'));
    matrix.complete = false; fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify(matrix));
    expect(() => loadArtifactSet(incomplete, 'current-duel')).toThrow('complete');
    const inconsistent = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-balance-identity-'));
    directory = writeArtifact(inconsistent);
    matrix = JSON.parse(fs.readFileSync(path.join(directory, 'matrix.json'), 'utf8'));
    matrix.strategies[0].id = 'sg-wrong'; matrix.equilibrium.strategyIds[0] = 'sg-wrong';
    matrix.equilibrium.weights = { 'sg-wrong': 1 };
    fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify(matrix));
    expect(() => loadArtifactSet(inconsistent, 'current-duel')).toThrow('inconsistent content');
  });
});
