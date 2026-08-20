import { formatStrategy } from './strategy';
import type { Strategy } from './strategy';
import type { EquilibriumResult } from './equilibrium';
import type { MatrixSnapshot } from './payoffMatrix';
import type { IterationEvent, RestartAgreement } from './psro';
import type { RestartStatus } from './psro';
import type { TelemetryAggregate } from './types';
import type { RulesFingerprint } from './rulesFingerprint';

export type ExperimentMode = 'smoke' | 'full';
export interface RunSummary {
  schemaVersion: 4;
  rulesFingerprint: RulesFingerprint;
  valid: boolean;
  kingdomId: string; kingdomName: string; mode: ExperimentMode; seed: number;
  limits: Record<string, number>; startedAt: string; finishedAt: string; elapsedMs: number;
  stopReason: string; error: string | null; matches: number; aborted: number;
  matrix: MatrixSnapshot | null; equilibrium: EquilibriumResult | null;
  strategies: Strategy[]; iterations: IterationEvent[]; restartAgreement: RestartAgreement[];
  telemetry: TelemetryAggregate;
  weightIntervals: Record<string, { lower: number; upper: number }>;
  warnings: string[];
  restartStatuses: RestartStatus[];
  restartMixtures: { restart: number; stopReason: string; completed: boolean; weights: Record<string, number> | null }[];
  finalFailures: { mean: number | null; interval: { lower: number; upper: number } | null;
    blocks: number; reason: string | null }[];
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
  for (const warning of summary.warnings) lines.push('', `**Diagnostic warning:** ${warning}`);
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
      'Candidate', 'Absolute mean', 'Paired improvement', 'Interval type', '95% interval', 'Blocks', 'Result'],
      summary.iterations.map((event) => [String(event.restart), String(event.attempt),
        event.response?.objective ?? 'empty', event.response
          ? `${event.response.sources.actual}/${event.response.sources.requested}` : '—',
        event.response ? `${event.response.sources.local} / ${event.response.sources.random}` : '—',
        event.response ? String(event.response.sources.duplicateRejections) : '—',
        event.response?.candidateId ?? '—',
        event.response?.heldOutMean === null || !event.response ? '—' : fixed(event.response.heldOutMean),
        event.response?.improvement === null || !event.response ? '—' : fixed(event.response.improvement),
        event.response ? (event.response.objective === 'niche' ? 'paired improvement' : 'absolute mean') : '—',
        event.response?.interval ? `${fixed(event.response.interval.lower)}–${fixed(event.response.interval.upper)}` : '—',
        event.response ? String(event.response.confirmSchedule.blocks.length) : '—',
        event.admittedStrategyId ? 'admitted' : event.response?.failureReason ?? 'not admitted'])), '',
    `Niche searches are discovery only. ${niche.length} niche searches ran; the final weights always come from the global equilibrium.`);
  const unionGlobal = summary.iterations.filter((event) => event.restart === 'union'
    && event.response?.objective === 'global');
  let lastAdmission = -1;
  for (let index = 0; index < unionGlobal.length; index += 1) {
    if (unionGlobal[index]!.response?.admitted) lastAdmission = index;
  }
  const afterAdmission = unionGlobal.slice(lastAdmission + 1);
  const gapEvidence = [...afterAdmission].reverse().findIndex((event) => event.response?.admitted) === -1
    ? afterAdmission.filter((event) => !event.response?.admitted) : [];
  if (gapEvidence.length) {
    const measured = gapEvidence.filter((event) => event.response?.heldOutMean !== null && event.response?.interval);
    const largest = measured.length
      ? Math.max(...measured.map((event) => Math.max(0, event.response!.heldOutMean! - 0.5))) : 0;
    const intervals = measured.map((event) => `${fixed(event.response!.interval!.lower)}–${fixed(event.response!.interval!.upper)}`).join(', ') || 'none';
    lines.push('', `Final observed oracle gap: ${fixed(largest)} from ${gapEvidence.length} held-out search(es)`
      + ` with interval(s) ${intervals} and block count(s) ${gapEvidence.map((event) => event.response?.confirmSchedule.blocks.length ?? 0).join(', ')}.`
      + ' This is observed search evidence, not exact exploitability.');
  } else {
    lines.push('', unionGlobal.length
      ? 'No final oracle gap was measured after the latest union admission.'
      : 'No union response search ran, so no final oracle gap was measured.');
  }
  lines.push('', '## Restart completion', '',
    `Requested ${summary.restartStatuses.length}; started ${summary.restartStatuses.filter((status) => status.state !== 'skipped').length};`
      + ` completed ${summary.restartStatuses.filter((status) => status.state === 'completed').length};`
      + ` skipped ${summary.restartStatuses.filter((status) => status.state === 'skipped').length}.`, '',
    ...table(['Restart', 'State', 'Stop reason', 'Matrix size'], summary.restartStatuses.map((status) => [
      String(status.restart), status.state, status.stopReason, String(status.matrixSize)
    ])));
  if (summary.restartAgreement.length) lines.push('', '## Restart agreement', '',
    'Restart mixtures can use preliminary early-stopped cells. These values are diagnostic; the final union uses full cells.', '',
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
  lines.push('', '## Strategies', '');
  for (const strategy of summary.strategies) lines.push('```', formatStrategy(strategy), '```', '');
  return `${lines.join('\n')}\n`;
}
