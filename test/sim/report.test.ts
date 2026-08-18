import { describe, expect, it } from 'vitest';
import { classifyLeader, renderReport } from '../../src/sim/report';
import type { RunSummary } from '../../src/sim/report';
import type { Strategy } from '../../src/sim/strategy';
import type { PairRecord, ScoredStrategy, TelemetryAggregate, TournamentResult } from '../../src/sim/types';
import { strategy } from './fixtures';

function record(over: Partial<PairRecord> = {}): PairRecord {
  return { played: 0, wins: 0, draws: 0, losses: 0, aborted: 0, ...over };
}

function telemetry(over: Partial<TelemetryAggregate> = {}): TelemetryAggregate {
  return {
    acquisitionsByStrategy: {},
    damageByCard: {},
    playsByCard: {},
    deadDraws: { range: 0, mana: 0, setup: 0, total: 0 },
    turnsToWin: { total: 0, count: 0 },
    byOrientation: {
      firstOchre: { normal: record(), swapped: record() },
      firstIndigo: { normal: record(), swapped: record() }
    },
    ...over
  };
}

const alpha: Strategy = strategy({ id: 'sg-alpha', startingBuild: ['heavyBlow'], preferredRange: 'Close' });
const beta: Strategy = strategy({ id: 'sg-beta', startingBuild: ['volley'], preferredRange: 'Far' });

function scored(plan: Strategy, score: number, completed: number): ScoredStrategy {
  return { strategy: plan, score, completedGames: completed, abortedGames: 0 };
}

function tournament(over: Partial<TournamentResult> = {}): TournamentResult {
  return {
    entrants: [alpha, beta],
    pairs: {
      'sg-alpha': { 'sg-beta': record({ played: 4, wins: 3, losses: 1 }) },
      'sg-beta': { 'sg-alpha': record({ played: 4, wins: 1, losses: 3 }) }
    },
    ranking: [scored(alpha, 0.75, 4), scored(beta, 0.25, 4)],
    telemetry: telemetry({
      acquisitionsByStrategy: {
        'sg-alpha': { heavyBlow: 8, footwork: 4 },
        'sg-beta': { volley: 4, aim: 4 }
      },
      damageByCard: { heavyBlow: 48, volley: 20 },
      playsByCard: { heavyBlow: 8, volley: 5 },
      byOrientation: {
        firstOchre: { normal: record({ played: 1, wins: 1 }), swapped: record({ played: 1, wins: 1 }) },
        firstIndigo: { normal: record({ played: 1, losses: 1 }), swapped: record({ played: 1, draws: 1 }) }
      }
    }),
    partial: false,
    pairsPlayed: 1,
    pairsExpected: 1,
    calibration: { finalLeaders: [], acquisitionsByStrategy: {} },
    ...over
  };
}

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    kingdomId: 'current-duel',
    kingdomName: 'Current Duel',
    mode: 'smoke',
    seed: 7,
    limits: {
      candidates: 6, leaders: 2, generations: 1, sharedSeeds: 1, deadlineMinutes: 30,
      stateLimit: 20000, turnLimitPerPlayer: 100, actionCapPerTurn: 200
    },
    startedAt: '2026-08-18T09:00:00.000Z',
    finishedAt: '2026-08-18T09:01:00.000Z',
    elapsedMs: 60_000,
    stopReason: 'generations',
    error: null,
    evolutionMatches: 40,
    evolutionAborted: 0,
    tournamentMatches: 4,
    tournamentAborted: 0,
    generations: [{
      generation: 1, partial: false, matchCount: 40, overflowCount: 0, elapsedMs: 12_500,
      leaders: [{ strategyId: 'sg-alpha', score: 0.75, completedGames: 4, abortedGames: 0 }],
      scores: { 'sg-alpha': 0.75, 'sg-beta': 0.25 }
    }],
    seedFindings: [],
    strategyLabels: { 'sg-beta': 'ranged-standard' },
    finalLeaderIds: ['sg-alpha'],
    evolutionTelemetry: telemetry({
      damageByCard: { heavyBlow: 12 },
      playsByCard: { heavyBlow: 2 },
      deadDraws: { range: 5, mana: 3, setup: 2, total: 9 },
      turnsToWin: { total: 30, count: 4 }
    }),
    tournament: tournament(),
    tournamentComplete: true,
    calibration: null,
    blockers: [],
    ...over
  };
}

const EXPECTED = `# Balance search: Current Duel (smoke)

| Field | Value |
| --- | --- |
| Kingdom | Current Duel (\`current-duel\`) |
| Mode | smoke |
| Run seed | 7 |
| Candidates | 6 |
| Leaders kept | 2 |
| Generations asked for | 1 |
| Generations run | 1 |
| Shared seeds | 1 |
| Turn limit per player | 100 |
| Action cap per turn | 200 |
| Action-search state limit | 20000 |
| Deadline | 30 minutes |
| Started | 2026-08-18T09:00:00.000Z |
| Finished | 2026-08-18T09:01:00.000Z |
| Elapsed | 1.0 minutes |
| Stop reason | generations |
| Matches | 44 (40 evolution, 4 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 0.7 matches/s |

## Seeding

Every fixed baseline seeded into this kingdom intact.

## Final ranking

Mean score per completed game in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Completed | Aborted |
| --- | --- | --- | --- | --- | --- |
| 1 | sg-alpha | yes | 0.750 | 4 | 0 |
| 2 | sg-beta (ranged-standard) | no | 0.250 | 4 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. \`·\` is a pair the deadline left unplayed. Source: tournament.

|  | alpha | beta |
| --- | --- | --- |
| alpha | — | 75.0% |
| beta | 25.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 4 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| heavyBlow | 1 of 1 | 2.00 |
| footwork | 1 of 1 | 1.00 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is \`none\`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 1 |
| ranged | 0 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-alpha: melee

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 4 |
| Mean turns to win | 7.50 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| heavyBlow | 60 | 10 | 6.00 |
| volley | 20 | 5 | 4.00 |

## Dead draws

A dead draw is a card in hand that could not be played. \`setup\` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of \`total\`, unlike the other causes. \`other\` is \`total\` minus \`range\` and \`mana\`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 5 |
| mana | 3 |
| other | 1 |
| total | 9 |
| setup (not in total) | 2 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with \`swapSides: false\` against \`swapSides: true\`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 4 | 87.5% |
| Ochre, swapSides false | 2 | 50.0% |
| Ochre, swapSides true | 2 | 75.0% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 40 | 0 | 0.750 | 12.5 | no |

## The top leaders

\`\`\`
sg-alpha
  build: heavyBlow
  agenda: none
  treasure: gold -> silver
  range: Close
  weights: damage 0, preferredRange 0, cardsDrawn 0, moneyGained 0, trashed 0, reclaimed 0, discarded 0, unspentMana 0, opponentOutOfAttackRange 0
  trash: none
  reclaim: none
  discard: none
\`\`\`

\`\`\`
sg-beta
  build: volley
  agenda: none
  treasure: gold -> silver
  range: Far
  weights: damage 0, preferredRange 0, cardsDrawn 0, moneyGained 0, trashed 0, reclaimed 0, discarded 0, unspentMana 0, opponentOutOfAttackRange 0
  trash: none
  reclaim: none
  discard: none
\`\`\`
`;

describe('rendering the report', () => {
  it('renders a complete run, table by table', () => {
    expect(renderReport(summary())).toBe(EXPECTED);
  });

  it('renders the same bytes twice', () => {
    expect(renderReport(summary())).toBe(renderReport(summary()));
  });

  // The gate is the one pass-or-fail check in the goal, so it appears only where there is one.
  it('shows the calibration section only when the kingdom has a gate', () => {
    expect(renderReport(summary())).not.toContain('## Calibration');
    const gated = renderReport(summary({
      kingdomId: 'rigged-melee', kingdomName: 'Rigged Melee',
      calibration: { passed: true, topStrategyId: 'sg-alpha', topStrategyCopies: 8, leadersWhoAcquired: 1, leaderCount: 1 }
    }));
    expect(gated).toContain('## Calibration');
    expect(gated).toContain('| Calibration (rigged melee) | PASS |');
    expect(gated).toContain('| Heavy Blow acquired by the top leader | 8 |');
  });

  it('names the seeds a kingdom cut down, and says what it means for generation 1', () => {
    const rendered = renderReport(summary({
      seedFindings: [
        { baselineId: 'mage-standard', strategyId: 'sg-mage', buildDropped: 3, agendaDropped: 4, degenerate: true },
        { baselineId: 'engine-draw', strategyId: 'sg-engine', buildDropped: 1, agendaDropped: 2, degenerate: false }
      ]
    }));
    expect(rendered).toContain('2 of the five fixed baselines');
    expect(rendered).toContain('Generation-1 scores here carry less signal');
    expect(rendered).toContain('| mage-standard | 3 | 4 | yes |');
    expect(rendered).toContain('`mage-standard` seeded with no agenda at all');
  });

  it('says in the header when the tournament did not finish, and marks unplayed pairs', () => {
    const rendered = renderReport(summary({
      tournamentComplete: false,
      blockers: ['The final tournament played 1 of 3 pairs before the deadline.'],
      tournament: tournament({ partial: true, pairsPlayed: 1, pairsExpected: 3, pairs: { 'sg-alpha': {}, 'sg-beta': {} } })
    }));
    expect(rendered).toContain('**The final tournament did not finish.**');
    expect(rendered).toContain('**Blocker:** The final tournament played 1 of 3 pairs');
    expect(rendered).toContain('| alpha | — | · |');
  });

  it('renders a run with no tournament and a high overflow rate without throwing', () => {
    const rendered = renderReport(summary({
      tournament: null, tournamentComplete: false, finalLeaderIds: [],
      evolutionAborted: 38, stopReason: 'error', error: 'the search overflowed'
    }));
    expect(rendered).toContain('| Action-search overflow rate | 86.4% |');
    expect(rendered).toContain('**The run stopped on an error:** the search overflowed');
    expect(rendered).toContain('_The tournament did not run._');
    expect(rendered).not.toContain('## Pairwise win rate');
  });
});

describe('classifying a leader by the attacks it acquired', () => {
  const cases: [string, Record<string, number>, string][] = [
    ['a melee majority', { heavyBlow: 2, volley: 1 }, 'melee'],
    ['an even two-family split', { volley: 2, heavyBlow: 2 }, 'mixed'],
    ['a three-family split', { volley: 2, heavyBlow: 2, arcBolt: 1 }, 'mixed'],
    ['no attack at all', { footwork: 4, silver: 2 }, 'none'],
    ['a mage majority', { fireball: 2, arcBolt: 2, volley: 1 }, 'mage'],
    // Aim is setup, not damage. Counting it would label this leader ranged though melee dealt more.
    ['setup cards that are not attacks', { aim: 3, feint: 2, volley: 1, heavyBlow: 2 }, 'melee']
  ];
  for (const [name, acquisitions, expected] of cases) {
    it(`calls ${name} ${expected}`, () => {
      expect(classifyLeader(acquisitions)).toBe(expected);
    });
  }

  it('gives the same answer for a starting build as for the same cards bought', () => {
    // Acquisition is starting build plus purchases, so the two are one number by the time it is read.
    expect(classifyLeader({ heavyBlow: 3 })).toBe('melee');
    expect(classifyLeader({ heavyBlow: 1, drive: 2 })).toBe('melee');
  });
});
