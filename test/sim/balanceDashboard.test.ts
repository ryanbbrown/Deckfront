import { describe, expect, it } from 'vitest';
import {
  damageRows,
  escapeHtml,
  evolutionRows,
  firstPlayerRate,
  loadDashboardRun,
  overviewMetrics,
  pairwiseRate,
  purchasePlan,
  renderDashboard,
  selectedHeatmapIds,
  validateDashboardRun
} from '../../scripts/write_balance_dashboard';
import type { Strategy } from '../../src/sim/strategy';
import { ids, makeDashboardRun, makeFiveDashboardRuns } from './fixtures/balance-dashboard';

describe('balance dashboard data', () => {
  it('rejects a missing, incomplete, errored, blocked, lower-limit, or aborted run', async () => {
    await expect(loadDashboardRun('/missing-root', 'current-duel'))
      .rejects.toThrow('missing a required full-run artifact');

    const incomplete = makeDashboardRun();
    incomplete.generations[4]!.partial = true;
    expect(() => validateDashboardRun(incomplete)).toThrow('missing or partial generation');

    const errored = makeDashboardRun();
    errored.run.error = 'search failed';
    expect(() => validateDashboardRun(errored)).toThrow('stopped with an error');

    const blocked = makeDashboardRun();
    blocked.run.blockers.push('tournament stopped');
    expect(() => validateDashboardRun(blocked)).toThrow('has blockers');

    const lowerLimit = makeDashboardRun();
    lowerLimit.run.limits.sharedSeeds = 8;
    expect(() => validateDashboardRun(lowerLimit)).toThrow('incompatible limit sharedSeeds');

    const tournamentAbort = makeDashboardRun();
    tournamentAbort.run.tournamentAborted = 1;
    expect(() => validateDashboardRun(tournamentAbort)).toThrow('has tournament aborts');

    const tournamentCellAbort = makeDashboardRun();
    tournamentCellAbort.tournament.pairs[ids[0]]![ids[1]]!.aborted = 1;
    expect(() => validateDashboardRun(tournamentCellAbort)).toThrow('has aborted games');

    const selectedLeaderAbort = makeDashboardRun();
    selectedLeaderAbort.run.evolutionAborted = 1;
    selectedLeaderAbort.generations[8]!.leaders[0]!.abortedGames = 1;
    expect(() => validateDashboardRun(selectedLeaderAbort)).toThrow('selected a leader with aborted games');

    const isolatedEvolutionAbort = makeDashboardRun();
    isolatedEvolutionAbort.run.evolutionAborted = 7;
    expect(() => validateDashboardRun(isolatedEvolutionAbort)).not.toThrow();
  });

  it('uses wins, draws, aborts, and asymmetric orientation cells in overview formulas', () => {
    const data = makeDashboardRun();
    data.run.evolutionAborted = 5;
    data.run.tournamentAborted = 5;
    const metrics = overviewMetrics(data);
    // Two telemetry sets: 1,440 completed turns across 180 won games, then divide by two players.
    expect(metrics.meanTurnsPerPlayer).toBe(4);
    // 200 attempted - 10 aborted = 190 completed; 180 wins leave 10 draws.
    expect(metrics.drawRate).toBeCloseTo(10 / 190);
    expect(metrics.abortedRate).toBe(0.05);
    // Ochre-first points: 7 + 7. Indigo-first points: 7 + 7. Forty games total.
    expect(metrics.firstPlayerWinRate).toBe(0.7);

    const cells = data.telemetry.tournament.byOrientation;
    cells.firstOchre.normal = { played: 0, wins: 0, draws: 0, losses: 0, aborted: 9 };
    cells.firstOchre.swapped = { played: 0, wins: 0, draws: 0, losses: 0, aborted: 9 };
    cells.firstIndigo.normal = { played: 0, wins: 0, draws: 0, losses: 0, aborted: 9 };
    cells.firstIndigo.swapped = { played: 0, wins: 0, draws: 0, losses: 0, aborted: 9 };
    expect(firstPlayerRate(cells)).toBeNull();
    data.telemetry.evolution.turnsToWin = { total: 0, count: 0 };
    data.telemetry.tournament.turnsToWin = { total: 0, count: 0 };
    data.run.evolutionMatches = data.run.evolutionAborted;
    data.run.tournamentMatches = data.run.tournamentAborted;
    expect(overviewMetrics(data).meanTurnsPerPlayer).toBeNull();
    expect(overviewMetrics(data).drawRate).toBeNull();
  });

  it('subtracts starting copies without reordering finite purchase steps', () => {
    const strategy: Strategy = {
      id: 'test-only',
      startingBuild: ['volley', 'aim', 'volley'],
      buyAgenda: [
        { cardId: 'volley', desiredCount: 5 },
        { cardId: 'aim', desiredCount: 2 },
        { cardId: 'footwork', desiredCount: 2 }
      ],
      repeatPurchase: 'footwork'
    };
    expect(purchasePlan(strategy)).toEqual([
      { cardId: 'volley', count: 3 },
      { cardId: 'aim', count: 1 },
      { cardId: 'footwork', count: 2 }
    ]);
  });

  it('rejects obsolete strategy fields, Copper, unavailable cards, and no-op finite steps', () => {
    const obsolete = makeDashboardRun();
    Object.assign(obsolete.strategies[0]!.strategy, { preferredRange: 'Far' });
    expect(() => validateDashboardRun(obsolete)).toThrow('incompatible fields');

    const finiteCopper = makeDashboardRun();
    finiteCopper.strategies[0]!.strategy.buyAgenda[0]!.cardId = 'copper';
    expect(() => validateDashboardRun(finiteCopper)).toThrow('buys Copper');

    const repeatCopper = makeDashboardRun();
    repeatCopper.strategies[0]!.strategy.repeatPurchase = 'copper';
    expect(() => validateDashboardRun(repeatCopper)).toThrow('repeats a Copper purchase');

    const unavailable = makeDashboardRun();
    unavailable.strategies[0]!.strategy.startingBuild[0] = 'missingCard';
    expect(() => validateDashboardRun(unavailable)).toThrow('unavailable card missingCard');

    const noOp = makeDashboardRun();
    noOp.strategies[0]!.strategy.buyAgenda[0]!.desiredCount = 1;
    expect(() => validateDashboardRun(noOp)).toThrow('needs no purchase');
  });

  it('accepts a consistent calibration failure and rejects missing or inconsistent evidence', () => {
    const failed = makeDashboardRun('rigged-melee');
    expect(() => validateDashboardRun(failed)).not.toThrow();

    const missing = makeDashboardRun('rigged-melee');
    missing.run.calibration = null;
    expect(() => validateDashboardRun(missing)).toThrow('must record a calibration result');

    const inconsistent = makeDashboardRun('rigged-melee');
    inconsistent.run.calibration!.passed = true;
    expect(() => validateDashboardRun(inconsistent)).toThrow('inconsistent result');
  });

  it('tracks exact generation ids, carryover, final overlap, and champion final rank', () => {
    const rows = evolutionRows(makeDashboardRun());
    expect(rows[0]).toEqual({
      generation: 1,
      leaderIds: [ids[1], ids[2], ids[3], ids[4], ids[5]],
      carryover: null,
      finalOverlap: 4,
      championId: ids[1],
      championRank: 3
    });
    expect(rows[1]).toMatchObject({
      leaderIds: [ids[0], ids[1], ids[2], ids[3], ids[4]],
      carryover: 4,
      finalOverlap: 5,
      championId: ids[0],
      championRank: 2
    });
  });

  it('deduplicates a final leader that is also a named fixed seed', () => {
    expect(selectedHeatmapIds(makeDashboardRun())).toEqual([
      ids[2], ids[0], ids[1], ids[3], ids[4], ids[5]
    ]);
  });

  it('calculates pairwise scores and marks self and missing cells', () => {
    const data = makeDashboardRun();
    data.tournament.pairs[ids[0]]![ids[1]] = { played: 8, wins: 3, draws: 2, losses: 3, aborted: 12 };
    expect(pairwiseRate(data, ids[0], ids[1])).toBe(0.5);
    expect(pairwiseRate(data, ids[0], ids[0])).toBe('self');
    delete data.tournament.pairs[ids[0]]![ids[1]];
    expect(pairwiseRate(data, ids[0], ids[1])).toBeNull();
  });

  it('puts damage from an unknown attack card in the other family', () => {
    expect(damageRows(makeDashboardRun().telemetry)).toContainEqual({
      family: 'other', cardId: 'mysteryAttack', damage: 200, plays: 40
    });
  });

  it('rejects missing and unknown ids across all saved artifacts', () => {
    const mutations: ((data: ReturnType<typeof makeDashboardRun>) => void)[] = [
      (data) => { data.run.finalLeaderIds[0] = 'sg-unknown'; },
      (data) => { data.generations[0]!.leaders[0]!.strategyId = 'sg-unknown'; },
      (data) => { data.tournament.ranking[0]!.strategyId = 'sg-unknown'; },
      (data) => { data.tournament.entrants[0] = 'sg-unknown'; },
      (data) => { data.tournament.pairs[ids[0]]!['sg-unknown'] = data.tournament.pairs[ids[0]]![ids[1]]!; },
      (data) => { delete data.tournament.pairs[ids[0]]![ids[1]]; }
    ];
    for (const mutate of mutations) {
      const data = makeDashboardRun();
      mutate(data);
      expect(() => validateDashboardRun(data)).toThrow(/unknown|non-entrant|missing|match generation 32/);
    }
  });
});

describe('balance dashboard rendering', () => {
  it('renders ranked leaders with one column per finite step and an uncounted repeat purchase', () => {
    const runs = makeFiveDashboardRuns();
    runs[2]!.run.evolutionAborted = 7;
    const html = renderDashboard(runs);
    expect(html).toContain('<th>Step 1</th><th>Step 2</th><th>Step 3</th><th>Repeat purchase</th>');
    expect(html).toContain('<th scope="row">1</th><td>80.0%</td>');
    expect(html).toContain('volley ×2');
    expect(html).toContain('heavyBlow ×3');
    expect(html).toContain('feint ×2');
    expect(html).toContain('footwork ×1');
    expect(html).toContain('<td>channel</td>');
    expect(html).not.toContain('channel ×');
    expect(html).not.toMatch(/copper ×/i);
    expect(html).not.toContain('Planned family');
    expect(html).not.toContain('Acquired family');
    expect(html).not.toContain('<th>Range</th>');
    expect(html).not.toContain('<td>0.800</td>');
    expect(html).toContain('This is not raw win percentage.');
    expect(html).toContain('<span class="calibration fail">FAIL</span>');
    expect(html).toContain('Rigged Melee calibration: FAIL');
    expect(html).toContain('2 of 5 final leaders acquired Heavy Blow');
    expect(html).toContain('The fixed melee seed ranked 6 at 30.0%. The best final leader ranked 1 at 80.0%.');
    expect(html).toContain('7 (3.5000%)');
  });

  it('escapes artifact text and shows exact generation identities', () => {
    const runs = makeFiveDashboardRuns();
    runs[0]!.run.kingdomName = '<img src=x onerror=alert(1)>';
    runs[0]!.strategies[0]!.seed = '"seed" <unsafe>';
    const html = renderDashboard(runs);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"seed" <unsafe>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;seed&quot; &lt;unsafe&gt;');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(html).toContain('Five leaders');
    expect(html).toContain('Carryover');
    expect(html).toContain('Final overlap');
  });

  it('renders a champion outside the tournament and identical bytes for identical input', () => {
    const runs = makeFiveDashboardRuns();
    const data = runs[0]!;
    data.generations[0]!.leaders = [ids[5], ids[1], ids[2], ids[3], ids[4]]
      .map((strategyId, index) => ({
        strategyId,
        score: 1 - index / 10,
        completedPairings: 5,
        completedGames: 500,
        abortedGames: 0
      }));
    data.tournament.ranking = data.tournament.ranking.filter((entry) => entry.strategyId !== ids[5]);
    data.tournament.entrants = data.tournament.entrants.filter((id) => id !== ids[5]);
    delete data.tournament.pairs[ids[5]];
    for (const row of Object.values(data.tournament.pairs)) delete row[ids[5]];
    delete data.telemetry.tournament.acquisitionsByStrategy[ids[5]];
    data.tournament.pairsExpected = 10;
    data.tournament.pairsPlayed = 10;
    data.strategies[5]!.seed = null;
    const first = renderDashboard(runs);
    expect(first).toContain('not in tournament');
    expect(renderDashboard(runs)).toBe(first);
    expect(first).not.toMatch(/https?:\/\//);
  });
});
