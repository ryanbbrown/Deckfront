import { formatStrategy } from './strategy';
import type { Strategy } from './strategy';
import type { EquilibriumResult } from './equilibrium';
import type { MatrixSnapshot } from './payoffMatrix';
import type { IterationEvent, RestartAgreement } from './psro';
import type { TelemetryAggregate } from './types';

export type ExperimentMode = 'smoke' | 'full';
export interface CalibrationDiagnostic {
  heavyBlowInPositiveWeightStrategy: boolean;
  benchmarkId: string;
  mean: number;
  interval: { lower: number; upper: number };
  observedAdvantage: number;
}
export interface RunSummary {
  schemaVersion: 2;
  valid: boolean;
  kingdomId: string; kingdomName: string; mode: ExperimentMode; seed: number;
  limits: Record<string, number>; startedAt: string; finishedAt: string; elapsedMs: number;
  stopReason: string; error: string | null; matches: number; aborted: number;
  matrix: MatrixSnapshot | null; equilibrium: EquilibriumResult | null;
  strategies: Strategy[]; iterations: IterationEvent[]; restartAgreement: RestartAgreement[];
  calibration: CalibrationDiagnostic | null; telemetry: TelemetryAggregate;
  weightIntervals: Record<string, { lower: number; upper: number }>;
}

function fixed(value: number, places = 3): string { return value.toFixed(places); }
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)];
}

export function renderReport(summary: RunSummary): string {
  const orientation = summary.telemetry.byOrientation;
  const records = Object.values(orientation).flatMap((first) => Object.values(first));
  const played = records.reduce((sum, record) => sum + record.played, 0);
  const draws = records.reduce((sum, record) => sum + record.draws, 0);
  const firstMoverWins = orientation.firstOchre.normal.wins + orientation.firstOchre.swapped.wins
    + orientation.firstIndigo.normal.losses + orientation.firstIndigo.swapped.losses;
  const firstMoverDraws = records.reduce((sum, record) => sum + record.draws, 0);
  const firstMoverScore = played ? (firstMoverWins + firstMoverDraws * 0.5) / played : 0;
  const ochreWins = records.reduce((sum, record) => sum + record.wins, 0);
  const ochreScore = played ? (ochreWins + draws * 0.5) / played : 0;
  const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;
  const lines = [`# PSRO balance search: ${summary.kingdomName} (${summary.mode})`, '',
    ...table(['Field', 'Value'], [
      ['Valid final union', summary.valid ? 'yes' : 'no'], ['Stop reason', summary.stopReason],
      ['Discovered strategies', String(summary.strategies.length)], ['Matches', String(summary.matches)],
      ['Aborted matches', String(summary.aborted)],
      ['Mechanical game bound before diagnostics', String(summary.limits.gameBoundBeforeDiagnostics)],
      ['Elapsed', `${fixed(summary.elapsedMs / 1000, 1)} seconds`],
      ['Throughput', summary.elapsedMs ? `${fixed(summary.matches / (summary.elapsedMs / 1000), 1)} games/s` : '—']
    ])];
  if (summary.error) lines.push('', `**Invalid run:** ${summary.error}`);
  lines.push('', '## Maximum-support equilibrium', '',
    'Weights are the canonical maximum-support equilibrium of the complete discovered-strategy matrix.'
      + ' They are not raw win rates. A zero weight does not prove that a strategy can never be useful.', '');
  if (!summary.equilibrium) lines.push('_No final equilibrium exists because the union matrix is incomplete._');
  else lines.push(...table(['Strategy', 'Weight', 'Maximum possible weight', 'Bootstrap 95% interval'],
    summary.equilibrium.strategyIds.map((id) => {
      const interval = summary.weightIntervals[id];
      return [id, fixed(summary.equilibrium!.weights[id] ?? 0),
        fixed(summary.equilibrium!.maximumEquilibriumWeight[id] ?? 0),
        interval ? `${fixed(interval.lower)}–${fixed(interval.upper)}` : '—'];
    })), '', ...table(['Solver measure', 'Value'], [
      ['Matrix value', fixed(summary.equilibrium.value, 8)],
      ['Maximum known pure-strategy advantage', fixed(summary.equilibrium.maximumKnownAdvantage, 8)],
      ...Object.entries(summary.equilibrium.residuals).map(([name, value]) => [name, fixed(value, 10)])
    ]));
  if (summary.matrix) {
    const ids = summary.matrix.strategies.map((strategy) => strategy.id);
    lines.push('', '## Complete matchup matrix', '', 'Centered payoff for row against column. `+1` is all wins; `-1` is all losses.', '',
      ...table(['', ...ids], ids.map((id, row) => [id, ...ids.map((_other, column) =>
        Number.isFinite(summary.matrix!.centeredPayoffs[row]![column]!)
          ? fixed(summary.matrix!.centeredPayoffs[row]![column]!) : '·')])));
  }
  const niche = summary.iterations.filter((event) => event.response?.objective === 'niche');
  lines.push('', '## Response searches', '',
    ...table(['Restart', 'Attempt', 'Objective', 'Candidates', 'Local / random', 'Duplicate rejects',
      'Candidate', 'Held-out mean', '95% interval', 'Admitted'],
      summary.iterations.map((event) => [String(event.restart), String(event.attempt),
        event.response?.objective ?? 'empty', event.response
          ? `${event.response.sources.actual}/${event.response.sources.requested}` : '—',
        event.response ? `${event.response.sources.local} / ${event.response.sources.random}` : '—',
        event.response ? String(event.response.sources.duplicateRejections) : '—',
        event.response?.candidateId ?? '—',
        event.response ? fixed(event.response.heldOutMean) : '—',
        event.response ? `${fixed(event.response.interval.lower)}–${fixed(event.response.interval.upper)}` : '—',
        event.admittedStrategyId ? 'yes' : 'no'])), '',
    `Niche searches are discovery only. ${niche.length} niche searches ran; the final weights always come from the global equilibrium.`);
  const unionGlobal = summary.iterations.filter((event) => event.restart === 'union'
    && event.response?.objective === 'global');
  const trailingFailures = unionGlobal.filter((event) => !event.response!.admitted).slice(-2);
  const gapEvidence = trailingFailures.length ? trailingFailures : unionGlobal.slice(-1);
  if (gapEvidence.length) {
    const largest = Math.max(...gapEvidence.map((event) => Math.max(0, event.response!.heldOutMean - 0.5)));
    const intervals = gapEvidence.map((event) => `${fixed(event.response!.interval.lower)}–${fixed(event.response!.interval.upper)}`).join(', ');
    lines.push('', `Final observed oracle gap: ${fixed(largest)} from ${gapEvidence.length} held-out search(es)`
      + ` with interval(s) ${intervals}. This is observed search evidence, not exact exploitability.`);
  }
  if (summary.restartAgreement.length) lines.push('', '## Restart agreement', '',
    ...table(['Restarts', 'Total-variation distance', 'Support overlap', 'Left worst counter', 'Right worst counter'],
      summary.restartAgreement.map((entry) => [`${entry.left}/${entry.right}`, fixed(entry.totalVariation),
        fixed(entry.supportOverlap), fixed(entry.leftWorstCounter), fixed(entry.rightWorstCounter)])));
  if (summary.matrix) {
    const closeThreshold = 0.05;
    const close: string[] = [];
    for (let left = 0; left < summary.matrix.strategies.length; left += 1) {
      for (let right = left + 1; right < summary.matrix.strategies.length; right += 1) {
        const maximum = Math.max(...summary.matrix.centeredPayoffs[left]!.map((value, index) =>
          Math.abs(value - summary.matrix!.centeredPayoffs[right]![index]!)));
        if (maximum <= closeThreshold) close.push(`${summary.matrix.strategies[left]!.id}/${summary.matrix.strategies[right]!.id}`);
      }
    }
    lines.push('', '## Payoff-row similarity flag', '',
      `Threshold: maximum absolute centered-payoff difference ≤ ${fixed(closeThreshold, 2)}. This flag never removes a strategy.`, '',
      close.length ? close.join(', ') : '_No close payoff rows._');
  }
  lines.push('', '## Match telemetry', '',
    ...table(['Measure', 'Value'], [
      ['Games with a winner', String(summary.telemetry.turnsToWin.count)],
      ['Mean turns to win', summary.telemetry.turnsToWin.count
        ? fixed(summary.telemetry.turnsToWin.total / summary.telemetry.turnsToWin.count) : '—'],
      ['Range dead draws', String(summary.telemetry.deadDraws.range)],
      ['Mana dead draws', String(summary.telemetry.deadDraws.mana)],
      ['Draw / turn-limit rate', played ? percent(draws / played) : '—'],
      ['First-mover score', played ? percent(firstMoverScore) : '—'],
      ['Ochre-seat score', played ? percent(ochreScore) : '—']
    ]), '', ...table(['Card', 'Damage', 'Plays'], Object.keys(summary.telemetry.damageByCard).sort()
      .map((card) => [card, String(summary.telemetry.damageByCard[card]),
        String(summary.telemetry.playsByCard[card] ?? 0)])));
  const acquiredRows = Object.entries(summary.telemetry.acquisitionsByStrategy)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([strategyId, cards]) => Object.entries(cards).sort(([left], [right]) => left.localeCompare(right))
      .map(([card, count]) => [strategyId, card, String(count)]));
  lines.push('', '### Acquisitions by strategy', '', ...table(['Strategy', 'Card', 'Copies'], acquiredRows));
  if (summary.calibration) lines.push('', '## Rigged-melee diagnostic', '',
    ...table(['Measure', 'Value'], [
      ['Positive-weight strategy acquired Heavy Blow', summary.calibration.heavyBlowInPositiveWeightStrategy ? 'yes' : 'no'],
      ['Fixed melee benchmark', summary.calibration.benchmarkId],
      ['Benchmark mean against final mixture', fixed(summary.calibration.mean)],
      ['Benchmark 95% interval', `${fixed(summary.calibration.interval.lower)}–${fixed(summary.calibration.interval.upper)}`],
      ['Observed advantage', fixed(summary.calibration.observedAdvantage)]
    ]));
  lines.push('', '## Strategies', '');
  for (const strategy of summary.strategies) lines.push('```', formatStrategy(strategy), '```', '');
  return `${lines.join('\n')}\n`;
}
