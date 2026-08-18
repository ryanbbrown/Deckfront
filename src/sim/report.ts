import type { CalibrationResult } from './calibration';
import type { SeedFinding } from './seedPopulation';
import { formatStrategy } from './strategy';
import type { PairRecord, TelemetryAggregate, TournamentResult } from './types';

export type ExperimentMode = 'smoke' | 'full';
export type StopReason = 'generations' | 'deadline' | 'error' | 'running';

export interface RunLimits {
  candidates: number;
  leaders: number;
  generations: number;
  sharedSeeds: number;
  deadlineMinutes: number;
  stateLimit: number;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
}

export interface GenerationLine {
  generation: number;
  partial: boolean;
  matchCount: number;
  overflowCount: number;
  elapsedMs: number;
  leaders: { strategyId: string; score: number; completedGames: number; abortedGames: number }[];
  scores: Record<string, number>;
}

/**
 * Everything the report says, as data. Times and elapsed are passed in rather than read from the
 * clock, so rendering the same run twice gives the same bytes and a table can be asserted inline.
 */
export interface RunSummary {
  kingdomId: string;
  kingdomName: string;
  mode: ExperimentMode;
  seed: number;
  limits: RunLimits;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  stopReason: StopReason;
  error: string | null;
  evolutionMatches: number;
  evolutionAborted: number;
  tournamentMatches: number;
  tournamentAborted: number;
  generations: GenerationLine[];
  seedFindings: SeedFinding[];
  /** Hash id to the baseline name it repaired from, for every fixed baseline in this kingdom. */
  strategyLabels: Record<string, string>;
  finalLeaderIds: string[];
  evolutionTelemetry: TelemetryAggregate;
  tournament: TournamentResult | null;
  tournamentComplete: boolean;
  calibration: CalibrationResult | null;
  blockers: string[];
}

/**
 * Attack cards by family. Aim and Feint are deliberately absent: neither deals damage, and counting
 * setup cards made the families asymmetric, because the mage list has no setup card to count. A
 * leader with three Aim, one Volley, and two Heavy Blow would otherwise read as ranged though melee
 * dealt most of its damage.
 */
export const ATTACK_FAMILIES = {
  melee: ['drive', 'flurry', 'heavyBlow', 'strike'],
  ranged: ['volley', 'quickShot', 'steadyShot', 'shot'],
  mage: ['arcBolt', 'fireball', 'starfire']
} as const;

export type Family = keyof typeof ATTACK_FAMILIES | 'mixed' | 'none';

/**
 * The family of the attack cards a leader **acquired** — starting build plus purchases, the same
 * definition the calibration gate uses. Counting purchases alone would label every leader that keeps
 * its attacks in the 12-money starting build as `none` while its deck is pure melee.
 *
 * One family holding more than half the attack cards names the leader. Anything else with an attack
 * is mixed, and a leader that acquired no attack is `none`.
 */
export function classifyLeader(acquisitions: Readonly<Record<string, number>>): Family {
  const counts = { melee: 0, ranged: 0, mage: 0 };
  for (const family of ['melee', 'ranged', 'mage'] as const) {
    for (const cardId of ATTACK_FAMILIES[family]) counts[family] += acquisitions[cardId] ?? 0;
  }
  const total = counts.melee + counts.ranged + counts.mage;
  if (total === 0) return 'none';
  for (const family of ['melee', 'ranged', 'mage'] as const) {
    if (counts[family] * 2 > total) return family;
  }
  return 'mixed';
}

function fixed(value: number, places = 3): string {
  return value.toFixed(places);
}

/** Percentages read as `—` rather than `0.0%` when nothing was played, so an empty cell is visible. */
function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function sortedEntries(counts: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(counts).sort(([left, leftCount], [right, rightCount]) =>
    rightCount - leftCount || (left < right ? -1 : left > right ? 1 : 0));
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  if (!rows.length) return ['_No data._'];
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ];
}

function mergeTelemetry(left: TelemetryAggregate, right: TelemetryAggregate | null): TelemetryAggregate {
  if (!right) return left;
  const counts = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
    const into = { ...a };
    for (const [key, amount] of Object.entries(b)) into[key] = (into[key] ?? 0) + amount;
    return into;
  };
  return {
    ...left,
    damageByCard: counts(left.damageByCard, right.damageByCard),
    playsByCard: counts(left.playsByCard, right.playsByCard),
    deadDraws: {
      range: left.deadDraws.range + right.deadDraws.range,
      mana: left.deadDraws.mana + right.deadDraws.mana,
      setup: left.deadDraws.setup + right.deadDraws.setup,
      total: left.deadDraws.total + right.deadDraws.total
    },
    turnsToWin: {
      total: left.turnsToWin.total + right.turnsToWin.total,
      count: left.turnsToWin.count + right.turnsToWin.count
    }
  };
}

function label(summary: RunSummary, strategyId: string): string {
  const baseline = summary.strategyLabels[strategyId];
  return baseline ? `${strategyId} (${baseline})` : strategyId;
}

function header(summary: RunSummary): string[] {
  const { limits } = summary;
  const matches = summary.evolutionMatches + summary.tournamentMatches;
  const aborted = summary.evolutionAborted + summary.tournamentAborted;
  const rows: string[][] = [
    ['Kingdom', `${summary.kingdomName} (\`${summary.kingdomId}\`)`],
    ['Mode', summary.mode],
    ['Run seed', String(summary.seed)],
    ['Candidates', String(limits.candidates)],
    ['Leaders kept', String(limits.leaders)],
    ['Generations asked for', String(limits.generations)],
    ['Generations run', String(summary.generations.length)],
    ['Shared seeds', String(limits.sharedSeeds)],
    ['Turn limit per player', String(limits.turnLimitPerPlayer)],
    ['Action cap per turn', String(limits.actionCapPerTurn)],
    ['Action-search state limit', String(limits.stateLimit)],
    ['Deadline', `${limits.deadlineMinutes} minutes`],
    ['Started', summary.startedAt],
    ['Finished', summary.finishedAt],
    ['Elapsed', `${fixed(summary.elapsedMs / 60000, 1)} minutes`],
    ['Stop reason', summary.stopReason],
    ['Matches', `${matches} (${summary.evolutionMatches} evolution, ${summary.tournamentMatches} tournament)`],
    ['Aborted matches', `${aborted}`],
    // An action-search overflow is an explicit result: without it a run where most matches aborted
    // renders as a normal, credible one.
    ['Action-search overflow rate', percent(aborted, matches)],
    ['Tournament complete', summary.tournamentComplete ? 'yes' : 'no'],
    ['Throughput', matches && summary.elapsedMs ? `${fixed(matches / (summary.elapsedMs / 1000), 1)} matches/s` : '—']
  ];
  if (summary.calibration) {
    rows.push(['Calibration (rigged melee)', summary.calibration.passed ? 'PASS' : 'FAIL']);
  }
  const lines = [
    `# Balance search: ${summary.kingdomName} (${summary.mode})`,
    '',
    ...table(['Field', 'Value'], rows)
  ];
  if (summary.error) lines.push('', `**The run stopped on an error:** ${summary.error}`);
  if (!summary.tournamentComplete) {
    lines.push('', '**The final tournament did not finish.** The ranking, the pairwise table, and any'
      + ' calibration verdict below are taken from an incomplete round robin and are not final.');
  }
  for (const blocker of summary.blockers) lines.push('', `**Blocker:** ${blocker}`);
  return lines;
}

function calibrationSection(summary: RunSummary): string[] {
  if (!summary.calibration) return [];
  const result = summary.calibration;
  return [
    '',
    '## Calibration',
    '',
    'This kingdom re-prices Heavy Blow to 3 money for 6 damage. The search is expected to find it. The',
    'threshold, the kingdom, and its strategies are never tuned to make this pass.',
    '',
    ...table(['Check', 'Value'], [
      ['Result', result.passed ? 'PASS' : 'FAIL'],
      ['Top final leader', label(summary, result.topStrategyId)],
      ['Heavy Blow acquired by the top leader', String(result.topStrategyCopies)],
      ['Final leaders that acquired Heavy Blow', `${result.leadersWhoAcquired} of ${result.leaderCount}`]
    ])
  ];
}

function seedingSection(summary: RunSummary): string[] {
  const findings = summary.seedFindings;
  const lines = ['', '## Seeding', ''];
  if (!findings.length) {
    lines.push('Every fixed baseline seeded into this kingdom intact.');
    return lines;
  }
  const degenerate = findings.filter((finding) => finding.degenerate);
  lines.push(
    `This kingdom sells only part of what ${findings.length} of the five fixed baselines were built`
    + ' around, so those seeds enter generation 1 cut down. Generation-1 scores here carry less signal'
    + ' than later generations, which are measured against evolved leaders.',
    ''
  );
  lines.push(...table(['Baseline', 'Build cards lost', 'Agenda entries lost', 'Left with no agenda'],
    findings.map((finding) => [
      finding.baselineId, String(finding.buildDropped), String(finding.agendaDropped),
      finding.degenerate ? 'yes' : 'no'
    ])));
  if (degenerate.length) {
    lines.push('', `${degenerate.map((finding) => `\`${finding.baselineId}\``).join(', ')} seeded with no`
      + ' agenda at all, so it began the run with nothing to buy.');
  }
  return lines;
}

function rankingSection(summary: RunSummary): string[] {
  const tournament = summary.tournament;
  if (!tournament) return ['', '## Final ranking', '', '_The tournament did not run._'];
  const finalLeaders = new Set(summary.finalLeaderIds);
  return [
    '', '## Final ranking', '',
    'Mean score per completed game in the final round robin. Source: tournament.', '',
    ...table(['Rank', 'Strategy', 'Final leader', 'Score', 'Completed', 'Aborted'],
      tournament.ranking.map((entry, index) => [
        String(index + 1), label(summary, entry.strategy.id),
        finalLeaders.has(entry.strategy.id) ? 'yes' : 'no',
        fixed(entry.score), String(entry.completedGames), String(entry.abortedGames)
      ]))
  ];
}

function pairwiseSection(summary: RunSummary): string[] {
  const tournament = summary.tournament;
  if (!tournament) return [];
  const order = tournament.ranking.map((entry) => entry.strategy.id);
  const short = (id: string): string => id.replace('sg-', '');
  const rows = order.map((left) => [
    short(left),
    ...order.map((right) => {
      if (left === right) return '—';
      const record: PairRecord | undefined = tournament.pairs[left]?.[right];
      if (!record || record.played === 0) return '·';
      return percent(record.wins + record.draws * 0.5, record.played);
    })
  ]);
  return [
    '', '## Pairwise win rate', '',
    'Row against column, counting a draw as half a win, over the games that completed. `·` is a pair'
    + ' the deadline left unplayed. Source: tournament.', '',
    ...table(['', ...order.map(short)], rows)
  ];
}

function cardSection(summary: RunSummary): string[] {
  const tournament = summary.tournament;
  if (!tournament) return [];
  const leaders = tournament.ranking.filter((entry) => summary.finalLeaderIds.includes(entry.strategy.id));
  const chosen = leaders.length ? leaders : tournament.ranking.slice(0, summary.limits.leaders);
  const inclusion: Record<string, number> = {};
  const copies: Record<string, number> = {};
  let games = 0;
  for (const entry of chosen) {
    const acquired = tournament.telemetry.acquisitionsByStrategy[entry.strategy.id] ?? {};
    games += entry.completedGames + entry.abortedGames;
    for (const [cardId, count] of Object.entries(acquired)) {
      inclusion[cardId] = (inclusion[cardId] ?? 0) + 1;
      copies[cardId] = (copies[cardId] ?? 0) + count;
    }
  }
  const families = chosen.map((entry) =>
    classifyLeader(tournament.telemetry.acquisitionsByStrategy[entry.strategy.id] ?? {}));
  const familyCounts: Record<Family, number> = { melee: 0, ranged: 0, mage: 0, mixed: 0, none: 0 };
  for (const family of families) familyCounts[family] += 1;

  return [
    '', '## Cards the leaders acquired', '',
    `Acquisition is the starting build plus purchases, over ${games} leader games in the tournament.`
    + ' Source: tournament.', '',
    ...table(['Card', 'Leaders', 'Copies per game'],
      sortedEntries(copies).map(([cardId, count]) => [
        cardId, `${inclusion[cardId] ?? 0} of ${chosen.length}`, fixed(games ? count / games : 0, 2)
      ])),
    '', '## Family representation', '',
    'A leader belongs to the family holding more than half its acquired attack cards; anything else'
    + ' with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted,'
    + ' because neither deals damage.', '',
    ...table(['Family', 'Leaders'],
      (['melee', 'ranged', 'mage', 'mixed', 'none'] as const).map((family) =>
        [family, String(familyCounts[family])])),
    '',
    ...chosen.map((entry, index) => `- ${label(summary, entry.strategy.id)}: ${families[index]}`)
  ];
}

function matchSection(summary: RunSummary): string[] {
  const all = mergeTelemetry(summary.evolutionTelemetry, summary.tournament?.telemetry ?? null);
  const dead = all.deadDraws;
  const other = dead.total - dead.range - dead.mana;
  return [
    '', '## Turns to win and damage', '',
    'Every match in the run, evolution and tournament together. Source: all matches.', '',
    ...table(['Measure', 'Value'], [
      ['Games with a winner', String(all.turnsToWin.count)],
      ['Mean turns to win', all.turnsToWin.count ? fixed(all.turnsToWin.total / all.turnsToWin.count, 2) : '—']
    ]),
    '',
    ...table(['Card', 'Damage', 'Plays', 'Damage per play'],
      sortedEntries(all.damageByCard).map(([cardId, damage]) => {
        const plays = all.playsByCard[cardId] ?? 0;
        return [cardId, String(damage), String(plays), plays ? fixed(damage / plays, 2) : '—'];
      })),
    '', '## Dead draws', '',
    'A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported'
    + ' plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of'
    + ' `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all'
    + ' matches.', '',
    ...table(['Cause', 'Count'], [
      ['range', String(dead.range)],
      ['mana', String(dead.mana)],
      ['other', String(other)],
      ['total', String(dead.total)],
      ['setup (not in total)', String(dead.setup)]
    ])
  ];
}

function orientationSection(summary: RunSummary): string[] {
  const tournament = summary.tournament;
  if (!tournament) return [];
  const cells = tournament.telemetry.byOrientation;
  const played = (record: PairRecord): number => record.played;
  const firstOchre = cells.firstOchre.normal;
  const firstOchreSwapped = cells.firstOchre.swapped;
  const firstIndigo = cells.firstIndigo.normal;
  const firstIndigoSwapped = cells.firstIndigo.swapped;

  const moverWins = firstOchre.wins + firstOchreSwapped.wins + firstIndigo.losses + firstIndigoSwapped.losses;
  const moverDraws = firstOchre.draws + firstOchreSwapped.draws + firstIndigo.draws + firstIndigoSwapped.draws;
  const moverPlayed = played(firstOchre) + played(firstOchreSwapped) + played(firstIndigo) + played(firstIndigoSwapped);

  const normalPlayed = played(firstOchre) + played(firstIndigo);
  const normalWins = firstOchre.wins + firstIndigo.wins;
  const normalDraws = firstOchre.draws + firstIndigo.draws;
  const swappedPlayed = played(firstOchreSwapped) + played(firstIndigoSwapped);
  const swappedWins = firstOchreSwapped.wins + firstIndigoSwapped.wins;
  const swappedDraws = firstOchreSwapped.draws + firstIndigoSwapped.draws;

  return [
    '', '## First-player and arena-side advantage', '',
    'Leader against leader is the fair comparison, so both come from the tournament. Arena-side'
    + ' advantage is ochre\'s win rate with `swapSides: false` against `swapSides: true`; ochre starts'
    + ' at position 2 when false and position 3 when true.', '',
    ...table(['Measure', 'Games', 'Win rate'], [
      ['Player who moved first', String(moverPlayed), percent(moverWins + moverDraws * 0.5, moverPlayed)],
      ['Ochre, swapSides false', String(normalPlayed), percent(normalWins + normalDraws * 0.5, normalPlayed)],
      ['Ochre, swapSides true', String(swappedPlayed), percent(swappedWins + swappedDraws * 0.5, swappedPlayed)]
    ])
  ];
}

function generationSection(summary: RunSummary): string[] {
  return [
    '', '## Generations', '',
    ...table(['Generation', 'Matches', 'Aborted', 'Best score', 'Seconds', 'Partial'],
      summary.generations.map((line) => [
        String(line.generation), String(line.matchCount), String(line.overflowCount),
        line.leaders[0] ? fixed(line.leaders[0].score) : '—',
        fixed(line.elapsedMs / 1000, 1), line.partial ? 'yes' : 'no'
      ]))
  ];
}

function strategySection(summary: RunSummary): string[] {
  const tournament = summary.tournament;
  if (!tournament) return [];
  const top = tournament.ranking.slice(0, 3);
  if (!top.length) return [];
  return [
    '', '## The top leaders', '',
    ...top.flatMap((entry) => ['```', formatStrategy(entry.strategy), '```', ''])
  ];
}

/**
 * A pure function of the summary. Every table is ordered by a rule, never by object insertion, so two
 * renderings of one run are byte-equal.
 *
 * Findings are stated as measurements. Only rigged melee has a pass-or-fail check; no other kingdom's
 * result is described as a failure.
 */
export function renderReport(summary: RunSummary): string {
  return [
    ...header(summary),
    ...calibrationSection(summary),
    ...seedingSection(summary),
    ...rankingSection(summary),
    ...pairwiseSection(summary),
    ...cardSection(summary),
    ...matchSection(summary),
    ...orientationSection(summary),
    ...generationSection(summary),
    ...strategySection(summary)
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
