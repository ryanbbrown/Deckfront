import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ATTACK_FAMILIES } from '../src/sim/report';
import { identify, type Strategy } from '../src/sim/strategy';
import type { PairRecord, TelemetryAggregate } from '../src/sim/types';

export const KINGDOM_IDS = [
  'current-duel',
  'three-way-open',
  'three-way-engine',
  'range-rich-mixed',
  'rigged-melee'
] as const;

const EXPECTED_LIMITS = {
  candidates: 100,
  leaders: 5,
  generations: 32,
  sharedSeeds: 25,
  deadlineMinutes: 420,
  stateLimit: 20_000,
  workers: 10,
  turnLimitPerPlayer: 30,
  actionCapPerTurn: 200
} as const;

type AttackFamily = keyof typeof ATTACK_FAMILIES;
type DashboardFamily = AttackFamily | 'other';

export interface RunFile {
  kingdomId: string;
  kingdomName: string;
  mode: string;
  seed: number;
  limits: Record<string, number>;
  stopReason: string;
  error: string | null;
  generationsRun: number;
  evolutionMatches: number;
  evolutionAborted: number;
  tournamentMatches: number;
  tournamentAborted: number;
  tournamentComplete: boolean;
  blockers: string[];
  finalLeaderIds: string[];
  kingdom: { id: string; name: string; cost?: number }[];
  calibration: {
    passed: boolean;
    topStrategyId: string;
    topStrategyCopies: number;
    leadersWhoAcquired: number;
    leaderCount: number;
  } | null;
}

export interface GenerationLine {
  generation: number;
  partial: boolean;
  leaders: {
    strategyId: string;
    score: number;
    completedPairings: number;
    completedGames: number;
    abortedGames: number;
  }[];
}

export interface StrategyRecord {
  id: string;
  seed: string | null;
  source: string;
  strategy: Strategy;
}

export interface RankingEntry {
  strategyId: string;
  score: number;
  completedPairings: number;
  completedGames: number;
  abortedGames: number;
}

export interface TournamentFile {
  entrants: string[];
  pairs: Record<string, Record<string, PairRecord>>;
  ranking: RankingEntry[];
  partial: boolean;
  pairsPlayed: number;
  pairsExpected: number;
  matches: number;
  calibration: unknown;
}

export interface TelemetryFile {
  evolution: TelemetryAggregate;
  tournament: TelemetryAggregate;
}

export interface DashboardRun {
  run: RunFile;
  generations: GenerationLine[];
  strategies: StrategyRecord[];
  telemetry: TelemetryFile;
  tournament: TournamentFile;
}

export interface OverviewMetrics {
  meanTurnsPerPlayer: number | null;
  drawRate: number | null;
  firstPlayerWinRate: number | null;
  abortedRate: number | null;
  dominantDamageFamily: DashboardFamily | null;
  dominantDamageShare: number | null;
}

export interface EvolutionRow {
  generation: number;
  leaderIds: string[];
  carryover: number | null;
  finalOverlap: number;
  championId: string;
  championRank: number | null;
}

export interface DamageRow {
  family: DashboardFamily;
  cardId: string;
  damage: number;
  plays: number;
}

const DAMAGE_ORDER: DashboardFamily[] = ['melee', 'ranged', 'mage', 'other'];

function addTelemetry(left: TelemetryAggregate, right: TelemetryAggregate): TelemetryAggregate {
  const addMap = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
    const result = { ...a };
    for (const [key, value] of Object.entries(b)) result[key] = (result[key] ?? 0) + value;
    return result;
  };
  return {
    acquisitionsByStrategy: { ...left.acquisitionsByStrategy, ...right.acquisitionsByStrategy },
    damageByCard: addMap(left.damageByCard, right.damageByCard),
    playsByCard: addMap(left.playsByCard, right.playsByCard),
    deadDraws: {
      range: left.deadDraws.range + right.deadDraws.range,
      mana: left.deadDraws.mana + right.deadDraws.mana,
      setup: left.deadDraws.setup + right.deadDraws.setup,
      total: left.deadDraws.total + right.deadDraws.total
    },
    turnsToWin: {
      total: left.turnsToWin.total + right.turnsToWin.total,
      count: left.turnsToWin.count + right.turnsToWin.count
    },
    byOrientation: left.byOrientation
  };
}

function familyForCard(cardId: string): AttackFamily | null {
  for (const family of ['melee', 'ranged', 'mage'] as const) {
    if ((ATTACK_FAMILIES[family] as readonly string[]).includes(cardId)) return family;
  }
  return null;
}

export function purchasePlan(strategy: Strategy): { cardId: string; count: number }[] {
  const startingCounts = new Map<string, number>();
  for (const cardId of strategy.startingBuild) {
    startingCounts.set(cardId, (startingCounts.get(cardId) ?? 0) + 1);
  }
  return strategy.buyAgenda.flatMap((entry) => {
    const count = Math.max(0, entry.desiredCount - (startingCounts.get(entry.cardId) ?? 0));
    return count ? [{ cardId: entry.cardId, count }] : [];
  });
}

function strategyMap(data: DashboardRun): Map<string, StrategyRecord> {
  return new Map(data.strategies.map((entry) => [entry.id, entry]));
}

function rankingMap(data: DashboardRun): Map<string, { rank: number; entry: RankingEntry }> {
  return new Map(data.tournament.ranking.map((entry, index) => [entry.strategyId, { rank: index + 1, entry }]));
}

export function firstPlayerRate(byOrientation: TelemetryAggregate['byOrientation']): number | null {
  const records = [
    { record: byOrientation.firstOchre.normal, firstWins: byOrientation.firstOchre.normal.wins },
    { record: byOrientation.firstOchre.swapped, firstWins: byOrientation.firstOchre.swapped.wins },
    { record: byOrientation.firstIndigo.normal, firstWins: byOrientation.firstIndigo.normal.losses },
    { record: byOrientation.firstIndigo.swapped, firstWins: byOrientation.firstIndigo.swapped.losses }
  ];
  const played = records.reduce((sum, item) => sum + item.record.played, 0);
  if (played === 0) return null;
  const points = records.reduce((sum, item) => sum + item.firstWins + item.record.draws * 0.5, 0);
  return points / played;
}

export function damageRows(telemetry: TelemetryFile): DamageRow[] {
  const combined = addTelemetry(telemetry.evolution, telemetry.tournament);
  return Object.entries(combined.damageByCard).map<DamageRow>(([cardId, damage]) => ({
    family: familyForCard(cardId) ?? 'other',
    cardId,
    damage,
    plays: combined.playsByCard[cardId] ?? 0
  })).sort((a, b) => DAMAGE_ORDER.indexOf(a.family) - DAMAGE_ORDER.indexOf(b.family)
    || b.damage - a.damage || a.cardId.localeCompare(b.cardId));
}

export function overviewMetrics(data: DashboardRun): OverviewMetrics {
  const combined = addTelemetry(data.telemetry.evolution, data.telemetry.tournament);
  const completed = data.run.evolutionMatches + data.run.tournamentMatches
    - data.run.evolutionAborted - data.run.tournamentAborted;
  const attempted = data.run.evolutionMatches + data.run.tournamentMatches;
  const wins = combined.turnsToWin.count;
  const familyDamage = new Map<DashboardFamily, number>();
  for (const row of damageRows(data.telemetry)) {
    familyDamage.set(row.family, (familyDamage.get(row.family) ?? 0) + row.damage);
  }
  const totalDamage = [...familyDamage.values()].reduce((sum, amount) => sum + amount, 0);
  const dominant = [...familyDamage.entries()].sort((a, b) => b[1] - a[1]
    || DAMAGE_ORDER.indexOf(a[0]) - DAMAGE_ORDER.indexOf(b[0]))[0];
  return {
    meanTurnsPerPlayer: wins ? combined.turnsToWin.total / wins / 2 : null,
    drawRate: completed ? (completed - wins) / completed : null,
    firstPlayerWinRate: firstPlayerRate(data.telemetry.tournament.byOrientation),
    abortedRate: attempted ? (data.run.evolutionAborted + data.run.tournamentAborted) / attempted : null,
    dominantDamageFamily: dominant?.[0] ?? null,
    dominantDamageShare: dominant && totalDamage ? dominant[1] / totalDamage : null
  };
}

export function evolutionRows(data: DashboardRun): EvolutionRow[] {
  const ranks = rankingMap(data);
  const final = new Set(data.run.finalLeaderIds);
  return data.generations.map((generation, index) => {
    const ids = generation.leaders.map((leader) => leader.strategyId);
    const previous = index ? new Set(data.generations[index - 1]!.leaders.map((leader) => leader.strategyId)) : null;
    const championId = ids[0]!;
    return {
      generation: generation.generation,
      leaderIds: ids,
      carryover: previous ? ids.filter((id) => previous.has(id)).length : null,
      finalOverlap: ids.filter((id) => final.has(id)).length,
      championId,
      championRank: ranks.get(championId)?.rank ?? null
    };
  });
}

export function selectedHeatmapIds(data: DashboardRun): string[] {
  const final = new Set(data.run.finalLeaderIds);
  const finalRanked = data.tournament.ranking.map((entry) => entry.strategyId).filter((id) => final.has(id));
  const seeds = data.strategies.filter((entry) => entry.seed !== null)
    .sort((a, b) => a.seed!.localeCompare(b.seed!)).map((entry) => entry.id);
  return [...new Set([...finalRanked, ...seeds])];
}

export function pairwiseRate(data: DashboardRun, rowId: string, columnId: string): number | null | 'self' {
  if (rowId === columnId) return 'self';
  const cell = data.tournament.pairs[rowId]?.[columnId];
  if (!cell || cell.played === 0) return null;
  return (cell.wins + cell.draws * 0.5) / cell.played;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), `${label} must be an object.`);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} has incompatible fields: ${actual.join(', ')}.`);
}

function validateStrategyShape(strategy: Strategy, cards: ReadonlyMap<string, { cost?: number }>, label: string): void {
  record(strategy, label);
  exactKeys(strategy, ['id', 'startingBuild', 'buyAgenda', 'repeatPurchase'], label);
  assert(typeof strategy.id === 'string' && strategy.id.length > 0, `${label} needs an id.`);
  assert(Array.isArray(strategy.startingBuild) && strategy.startingBuild.every((card) => typeof card === 'string'),
    `${label} has an incompatible starting build.`);
  assert(Array.isArray(strategy.buyAgenda), `${label} has an incompatible finite purchase plan.`);
  assert(typeof strategy.repeatPurchase === 'string', `${label} has an incompatible repeated purchase.`);
  const startingCounts = new Map<string, number>();
  for (const cardId of strategy.startingBuild) {
    assert(cards.has(cardId), `${label} starting build names unavailable card ${cardId}.`);
    startingCounts.set(cardId, (startingCounts.get(cardId) ?? 0) + 1);
  }
  const finite = new Set<string>();
  for (const [index, entry] of strategy.buyAgenda.entries()) {
    record(entry, `${label} finite step ${index + 1}`);
    exactKeys(entry, ['cardId', 'desiredCount'], `${label} finite step ${index + 1}`);
    assert(entry.cardId !== 'copper', `${label} finite step ${index + 1} buys Copper.`);
    assert(typeof entry.cardId === 'string' && cards.has(entry.cardId),
      `${label} finite step ${index + 1} names an unavailable card.`);
    assert(Number.isInteger(entry.desiredCount) && entry.desiredCount > 0,
      `${label} finite step ${index + 1} needs a positive whole count.`);
    assert(entry.desiredCount > (startingCounts.get(entry.cardId) ?? 0),
      `${label} finite step ${index + 1} needs no purchase after the starting build.`);
    assert(!finite.has(entry.cardId), `${label} repeats finite purchase ${entry.cardId}.`);
    finite.add(entry.cardId);
  }
  assert(strategy.repeatPurchase !== 'copper', `${label} repeats a Copper purchase.`);
  const repeat = cards.get(strategy.repeatPurchase);
  assert(repeat, `${label} repeats unavailable card ${strategy.repeatPurchase}.`);
  assert(typeof repeat.cost === 'number' && repeat.cost > 0,
    `${label} repeated purchase must have a positive cost.`);
  assert(identify(strategy).id === strategy.id, `${label} id does not match its executable plan.`);
}

function validateTelemetry(value: TelemetryAggregate, label: string): void {
  record(value, label);
  record(value.turnsToWin, `${label}.turnsToWin`);
  record(value.byOrientation, `${label}.byOrientation`);
  for (const first of ['firstOchre', 'firstIndigo'] as const) {
    record(value.byOrientation[first], `${label}.byOrientation.${first}`);
    for (const side of ['normal', 'swapped'] as const) {
      const cell = value.byOrientation[first][side];
      record(cell, `${label}.byOrientation.${first}.${side}`);
      assert(cell.played === cell.wins + cell.draws + cell.losses,
        `${label}.byOrientation.${first}.${side} has an incompatible played count.`);
    }
  }
}

export function validateDashboardRun(data: DashboardRun, expectedKingdomId?: string): void {
  const id = data.run.kingdomId;
  assert(!expectedKingdomId || id === expectedKingdomId,
    `Expected kingdom ${expectedKingdomId}, found ${id}.`);
  assert((KINGDOM_IDS as readonly string[]).includes(id), `Unknown kingdom ${id}.`);
  assert(data.run.mode === 'full' && data.run.seed === 1, `${id} must be a full run with seed 1.`);
  for (const [key, value] of Object.entries(EXPECTED_LIMITS)) {
    assert(data.run.limits[key] === value, `${id} has incompatible limit ${key}.`);
  }
  assert(data.run.stopReason === 'generations', `${id} did not finish all generations.`);
  assert(data.run.error === null, `${id} stopped with an error.`);
  assert(data.run.generationsRun === 32 && data.generations.length === 32,
    `${id} must contain 32 generations.`);
  assert(data.generations.every((line, index) => line.generation === index + 1 && !line.partial),
    `${id} has a missing or partial generation.`);
  assert(data.run.finalLeaderIds.length === 5 && new Set(data.run.finalLeaderIds).size === 5,
    `${id} must contain five distinct final leaders.`);
  assert(data.run.blockers.length === 0, `${id} has blockers.`);
  assert(data.run.tournamentAborted === 0, `${id} has tournament aborts.`);
  assert(data.run.tournamentComplete && !data.tournament.partial,
    `${id} has an incomplete tournament.`);
  assert(data.tournament.pairsPlayed === data.tournament.pairsExpected,
    `${id} has missing tournament pairings.`);
  validateTelemetry(data.telemetry.evolution, `${id} evolution telemetry`);
  validateTelemetry(data.telemetry.tournament, `${id} tournament telemetry`);
  const cards = new Map(data.run.kingdom.map((card) => [card.id, card]));
  assert(cards.size === data.run.kingdom.length, `${id} repeats a card in its resolved market.`);
  const records = new Map<string, StrategyRecord>();
  for (const strategy of data.strategies) {
    assert(strategy.id === strategy.strategy.id, `${id} strategy wrapper id does not match its definition.`);
    assert(!records.has(strategy.id), `${id} repeats strategy ${strategy.id}.`);
    validateStrategyShape(strategy.strategy, cards, `${id} strategy ${strategy.id}`);
    records.set(strategy.id, strategy);
  }
  const known = (strategyId: string, place: string): void => {
    assert(records.has(strategyId), `${id} ${place} names unknown strategy ${strategyId}.`);
  };
  for (const strategyId of data.run.finalLeaderIds) known(strategyId, 'final leaders');
  for (const generation of data.generations) {
    assert(generation.leaders.length === 5, `${id} generation ${generation.generation} does not have five leaders.`);
    assert(new Set(generation.leaders.map((leader) => leader.strategyId)).size === 5,
      `${id} generation ${generation.generation} repeats a leader.`);
    for (const leader of generation.leaders) {
      known(leader.strategyId, `generation ${generation.generation}`);
      assert(leader.abortedGames === 0,
        `${id} generation ${generation.generation} selected a leader with aborted games.`);
    }
  }
  assert(data.generations.at(-1)!.leaders.map((leader) => leader.strategyId)
    .every((strategyId, index) => strategyId === data.run.finalLeaderIds[index]),
  `${id} final leaders do not match generation 32.`);
  const entrants = new Set(data.tournament.entrants);
  assert(entrants.size === data.tournament.entrants.length, `${id} repeats a tournament entrant.`);
  for (const strategyId of entrants) known(strategyId, 'tournament entrants');
  assert(data.tournament.ranking.length === entrants.size, `${id} ranking does not cover every entrant.`);
  for (const entry of data.tournament.ranking) {
    known(entry.strategyId, 'ranking');
    assert(entrants.has(entry.strategyId), `${id} ranking includes non-entrant ${entry.strategyId}.`);
  }
  assert(new Set(data.tournament.ranking.map((entry) => entry.strategyId)).size === entrants.size,
    `${id} ranking repeats or omits an entrant.`);
  const rankedIds = new Set(data.tournament.ranking.map((entry) => entry.strategyId));
  for (const strategyId of data.run.finalLeaderIds) {
    assert(entrants.has(strategyId) && rankedIds.has(strategyId),
      `${id} final leader ${strategyId} is missing from the tournament.`);
  }
  for (const strategyId of Object.keys(data.telemetry.tournament.acquisitionsByStrategy)) {
    known(strategyId, 'tournament acquisitions');
    assert(entrants.has(strategyId), `${id} tournament acquisitions include non-entrant ${strategyId}.`);
  }
  if (id === 'rigged-melee') {
    const calibration = data.run.calibration;
    assert(calibration, 'rigged-melee must record a calibration result.');
    assert(calibration.leaderCount === data.run.finalLeaderIds.length,
      'rigged-melee calibration has an incompatible leader count.');
    const rankedFinal = data.tournament.ranking.find((entry) => data.run.finalLeaderIds.includes(entry.strategyId));
    assert(rankedFinal?.strategyId === calibration.topStrategyId,
      'rigged-melee calibration names the wrong top final leader.');
    const copies = (strategyId: string): number =>
      data.telemetry.tournament.acquisitionsByStrategy[strategyId]?.heavyBlow ?? 0;
    assert(copies(calibration.topStrategyId) === calibration.topStrategyCopies,
      'rigged-melee calibration has the wrong top leader Heavy Blow count.');
    const leadersWhoAcquired = data.run.finalLeaderIds.filter((strategyId) => copies(strategyId) > 0).length;
    assert(leadersWhoAcquired === calibration.leadersWhoAcquired,
      'rigged-melee calibration has the wrong acquired-leader count.');
    const passed = calibration.topStrategyCopies > 0
      || calibration.leadersWhoAcquired * 10 >= calibration.leaderCount * 8;
    assert(passed === calibration.passed, 'rigged-melee calibration has an inconsistent result.');
  } else {
    assert(data.run.calibration === null, `${id} must not record a rigged-melee calibration.`);
  }
  for (const [rowId, row] of Object.entries(data.tournament.pairs)) {
    assert(entrants.has(rowId), `${id} pairwise row names non-entrant ${rowId}.`);
    for (const [columnId, cell] of Object.entries(row)) {
      assert(entrants.has(columnId), `${id} pairwise cell names non-entrant ${columnId}.`);
      assert(rowId !== columnId, `${id} pairwise data contains a diagonal cell.`);
      assert(cell.aborted === 0, `${id} pairwise ${rowId}/${columnId} has aborted games.`);
      assert(cell.played === cell.wins + cell.draws + cell.losses,
        `${id} pairwise ${rowId}/${columnId} has an incompatible played count.`);
    }
  }
  for (const rowId of entrants) for (const columnId of entrants) {
    if (rowId !== columnId) assert(data.tournament.pairs[rowId]?.[columnId],
      `${id} pairwise cell ${rowId}/${columnId} is missing.`);
  }
}

export function validateDashboardRuns(runs: readonly DashboardRun[]): void {
  assert(runs.length === KINGDOM_IDS.length, `Expected ${KINGDOM_IDS.length} kingdoms, found ${runs.length}.`);
  assert(new Set(runs.map((data) => data.run.kingdomId)).size === runs.length, 'Kingdom ids must be unique.');
  KINGDOM_IDS.forEach((id, index) => validateDashboardRun(runs[index]!, id));
}

function parseJson<T>(text: string, path: string): T {
  try { return JSON.parse(text) as T; } catch { throw new Error(`${path} is not valid JSON.`); }
}

export async function loadDashboardRun(root: string, kingdomId: string): Promise<DashboardRun> {
  const directory = `${root}/.experiments/${kingdomId}/full`;
  const names = ['run.json', 'generations.jsonl', 'strategies.json', 'telemetry.json', 'tournament.json'] as const;
  let texts: string[];
  try { texts = await Promise.all(names.map((name) => readFile(`${directory}/${name}`, 'utf8'))); }
  catch (error) { throw new Error(`${kingdomId} is missing a required full-run artifact.`, { cause: error }); }
  const generations = texts[1]!.trim().split('\n').filter(Boolean)
    .map((line, index) => parseJson<GenerationLine>(line, `${names[1]} line ${index + 1}`));
  const strategiesFile = parseJson<{ strategies: StrategyRecord[] }>(texts[2]!, names[2]);
  const data: DashboardRun = {
    run: parseJson<RunFile>(texts[0]!, names[0]),
    generations,
    strategies: strategiesFile.strategies,
    telemetry: parseJson<TelemetryFile>(texts[3]!, names[3]),
    tournament: parseJson<TournamentFile>(texts[4]!, names[4])
  };
  validateDashboardRun(data, kingdomId);
  return data;
}

export function escapeHtml(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function shortId(id: string): string {
  return id.replace(/^sg-/, '').slice(0, 6);
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null, places = 2): string {
  return value === null ? '—' : value.toFixed(places);
}

function formatAborts(data: DashboardRun): string {
  const aborted = data.run.evolutionAborted + data.run.tournamentAborted;
  const attempted = data.run.evolutionMatches + data.run.tournamentMatches;
  return `${aborted.toLocaleString('en-US')} (${attempted ? ((aborted / attempted) * 100).toFixed(4) : '—'}%)`;
}

function strategyLabel(data: DashboardRun, id: string): string {
  const item = strategyMap(data).get(id);
  return item?.seed ? `${item.seed} · ${shortId(id)}` : shortId(id);
}

function calibrationBadge(data: DashboardRun): string {
  if (!data.run.calibration) return '—';
  const status = data.run.calibration.passed ? 'PASS' : 'FAIL';
  return `<span class="calibration ${data.run.calibration.passed ? 'pass' : 'fail'}">${status}</span>`;
}

function overviewSection(runs: readonly DashboardRun[]): string {
  const rows = runs.map((data) => {
    const metrics = overviewMetrics(data);
    return `<tr><th scope="row"><a href="#${escapeHtml(data.run.kingdomId)}">${escapeHtml(data.run.kingdomName)}</a></th>
      <td>${formatNumber(metrics.meanTurnsPerPlayer)}</td><td>${formatPercent(metrics.drawRate)}</td>
      <td>${formatPercent(metrics.firstPlayerWinRate)}</td>
      <td>${formatAborts(data)}</td>
      <td><span class="pill ${metrics.dominantDamageFamily}">${escapeHtml(metrics.dominantDamageFamily ?? '—')}</span> ${formatPercent(metrics.dominantDamageShare)}</td>
      <td><span class="complete">32/32 · complete</span></td><td>${calibrationBadge(data)}</td></tr>`;
  }).join('\n');
  return `<section id="overview"><div class="section-head"><div><p class="eyebrow">Five full searches · run seed 1</p><h2>Balance overview</h2></div><p class="lede">The same shared tactical pilot played every strategy. Only the starting build and purchase plan varied.</p></div>
    <div class="table-wrap"><table class="overview"><thead><tr><th>Kingdom</th><th>Turns / player</th><th>Draw rate</th><th>First-player score</th><th>Aborted</th><th>Dominant damage</th><th>Run</th><th>Calibration</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="formula">Turns use won games. Draws use all completed matches. First-player score uses tournament games; draws count as half a win. Aborted matches show count and rate; all saved aborts are evolution search overflows.</p></section>`;
}

function leaderTable(data: DashboardRun): string {
  const strategies = strategyMap(data);
  const final = new Set(data.run.finalLeaderIds);
  const ranked = data.tournament.ranking
    .map((entry, index) => ({ entry, rank: index + 1 }))
    .filter(({ entry }) => final.has(entry.strategyId));
  const maxSteps = Math.max(...ranked.map(({ entry }) => purchasePlan(strategies.get(entry.strategyId)!.strategy).length));
  const stepHeaders = Array.from({ length: maxSteps }, (_, index) => `<th>Step ${index + 1}</th>`).join('');
  const rows = ranked.map(({ entry, rank }) => {
    const id = entry.strategyId;
    const item = strategies.get(id)!;
    const starting = item.strategy.startingBuild.join(', ') || 'none';
    const plan = purchasePlan(item.strategy);
    const steps = Array.from({ length: maxSteps }, (_, index) => {
      const step = plan[index];
      return `<td>${step ? `${escapeHtml(step.cardId)} ×${step.count}` : '—'}</td>`;
    }).join('');
    return `<tr><th scope="row">${rank}</th><td>${formatPercent(entry.score)}</td>
      <td class="mono">${escapeHtml(shortId(id))}</td><td>${escapeHtml(starting)}</td>${steps}
      <td>${escapeHtml(item.strategy.repeatPurchase)}</td></tr>`;
  }).join('\n');
  return `<h3>Final leaders</h3><p class="ranking-definition"><strong>Tournament score:</strong> for each opponent, (wins + half draws) / completed games; then average opponents equally. This is not raw win percentage.</p><div class="table-wrap"><table class="leaders"><thead><tr><th>Rank</th><th>Tournament score</th><th>Strategy</th><th>Starting build</th>${stepHeaders}<th>Repeat purchase</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function heatmap(data: DashboardRun): string {
  const ids = selectedHeatmapIds(data);
  const head = ids.map((id) => `<th title="${escapeHtml(strategyLabel(data, id))}">${escapeHtml(shortId(id))}</th>`).join('');
  const rows = ids.map((rowId) => `<tr><th title="${escapeHtml(strategyLabel(data, rowId))}">${escapeHtml(strategyLabel(data, rowId))}</th>${ids.map((columnId) => {
    const rate = pairwiseRate(data, rowId, columnId);
    if (rate === 'self') return '<td class="self">—</td>';
    if (rate === null) return '<td class="missing">·</td>';
    const heat = Math.round(rate * 100);
    return `<td class="heat" style="--heat:${heat}" title="${escapeHtml(strategyLabel(data, rowId))} against ${escapeHtml(strategyLabel(data, columnId))}: ${formatPercent(rate)}">${formatPercent(rate)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div><h3>Compact matchup heatmap</h3><p class="note">Row against column. Draws count as half a win. <strong>·</strong> means missing; the diagonal is not played.</p><div class="table-wrap heat-wrap"><table class="heatmap"><thead><tr><th>Row / Column</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function evolutionView(data: DashboardRun): string {
  const rows = evolutionRows(data).map((row) => `<tr><td>${row.generation}</td><td class="leader-ids">${row.leaderIds.map((id) => `<span>${escapeHtml(shortId(id))}</span>`).join('')}</td><td class="mono">${escapeHtml(shortId(row.championId))}</td><td>${row.carryover === null ? '—' : `${row.carryover}/5`}</td><td>${row.finalOverlap}/5</td><td>${row.championRank ?? '<span class="muted">not in tournament</span>'}</td></tr>`).join('');
  return `<div><h3>Generation movement</h3><p class="note">Leader ids stay in generation rank order. Carryover is exact identity from the prior generation. Final overlap counts leaders also in generation 32.</p><div class="table-wrap evolution-wrap"><table class="evolution"><thead><tr><th>Gen</th><th>Five leaders</th><th>Champion</th><th>Carryover</th><th>Final overlap</th><th>Champion final rank</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function damageView(data: DashboardRun): string {
  const rows = damageRows(data.telemetry);
  const total = rows.reduce((sum, row) => sum + row.damage, 0);
  const families = new Map<DashboardFamily, { damage: number; plays: number }>();
  for (const row of rows) {
    const current = families.get(row.family) ?? { damage: 0, plays: 0 };
    current.damage += row.damage;
    current.plays += row.plays;
    families.set(row.family, current);
  }
  const familyRows = [...families.entries()].sort((a, b) => DAMAGE_ORDER.indexOf(a[0]) - DAMAGE_ORDER.indexOf(b[0]))
    .map(([family, value]) => `<tr><th><span class="pill ${family}">${family}</span></th><td>${value.damage.toLocaleString('en-US')}</td><td>${formatPercent(total ? value.damage / total : null)}</td><td>${value.plays.toLocaleString('en-US')}</td></tr>`).join('');
  const cardRows = rows.map((row) => `<tr><th>${escapeHtml(row.cardId)}</th><td><span class="pill ${row.family}">${row.family}</span></td><td>${row.damage.toLocaleString('en-US')}</td><td>${row.plays.toLocaleString('en-US')}</td><td>${row.plays ? (row.damage / row.plays).toFixed(2) : '—'}</td></tr>`).join('');
  return `<div><h3>Kingdom-wide damage mix</h3><p class="note">All strategies and all matches. This is not per-strategy damage.</p><div class="damage-grid"><table><thead><tr><th>Family</th><th>Damage</th><th>Share</th><th>Plays</th></tr></thead><tbody>${familyRows}</tbody></table><table><thead><tr><th>Card</th><th>Family</th><th>Damage</th><th>Plays</th><th>Damage / play</th></tr></thead><tbody>${cardRows}</tbody></table></div></div>`;
}

function calibrationView(data: DashboardRun): string {
  const result = data.run.calibration;
  if (!result) return '';
  const final = new Set(data.run.finalLeaderIds);
  const bestFinal = data.tournament.ranking.find((entry) => final.has(entry.strategyId))!;
  const bestFinalRank = data.tournament.ranking.indexOf(bestFinal) + 1;
  const meleeSeed = data.strategies.find((entry) => entry.seed === 'melee');
  const meleeRanking = meleeSeed
    ? data.tournament.ranking.find((entry) => entry.strategyId === meleeSeed.id)
    : null;
  const meleeRank = meleeRanking ? data.tournament.ranking.indexOf(meleeRanking) + 1 : null;
  const drift = !result.passed && meleeSeed && meleeRanking && meleeRank
    ? `<p>The fixed melee seed ranked ${meleeRank} at ${formatPercent(meleeRanking.score)}. The best final leader ranked ${bestFinalRank} at ${formatPercent(bestFinal.score)}. Evolution ended with a weaker final leader set than this retained benchmark.</p>`
    : '';
  return `<div class="calibration-card ${result.passed ? 'pass' : 'fail'}"><h3>Rigged Melee calibration: ${result.passed ? 'PASS' : 'FAIL'}</h3><p>Top final leader <span class="mono">${escapeHtml(shortId(result.topStrategyId))}</span> acquired ${result.topStrategyCopies} Heavy Blow. ${result.leadersWhoAcquired} of ${result.leaderCount} final leaders acquired Heavy Blow.</p>${drift}</div>`;
}

function kingdomSection(data: DashboardRun): string {
  const metrics = overviewMetrics(data);
  return `<section class="kingdom" id="${escapeHtml(data.run.kingdomId)}"><div class="section-head"><div><p class="eyebrow">${escapeHtml(data.run.kingdomId)}</p><h2>${escapeHtml(data.run.kingdomName)}</h2></div><div class="statline"><span><b>${formatNumber(metrics.meanTurnsPerPlayer)}</b> turns / player</span><span><b>${formatPercent(metrics.firstPlayerWinRate)}</b> first-player wins</span><span><b>${formatPercent(metrics.drawRate)}</b> draws</span></div></div>
    ${calibrationView(data)}${leaderTable(data)}<div class="two-up">${heatmap(data)}${evolutionView(data)}</div>${damageView(data)}</section>`;
}

function evidenceSection(runs: readonly DashboardRun[]): string {
  const metrics = runs.map((data) => ({ data, metrics: overviewMetrics(data) }));
  const turns = metrics.map(({ metrics: item }) => item.meanTurnsPerPlayer).filter((value): value is number => value !== null);
  const draws = metrics.map(({ metrics: item }) => item.drawRate).filter((value): value is number => value !== null);
  const firstPlayer = metrics.map(({ metrics: item }) => item.firstPlayerWinRate)
    .filter((value): value is number => value !== null);
  const dominantCounts = new Map<DashboardFamily, number>();
  for (const { metrics: item } of metrics) if (item.dominantDamageFamily) {
    dominantCounts.set(item.dominantDamageFamily, (dominantCounts.get(item.dominantDamageFamily) ?? 0) + 1);
  }
  const damageSummary = [...dominantCounts.entries()].sort((a, b) => DAMAGE_ORDER.indexOf(a[0])
    - DAMAGE_ORDER.indexOf(b[0])).map(([family, count]) => `${family} in ${count}`).join(', ') || 'none';
  return `<section id="evidence"><div class="section-head"><div><p class="eyebrow">What this baseline supports</p><h2>Evidence and limits</h2></div></div><div class="evidence-grid">
    <article><h3>Game length</h3><p>Won games average ${Math.min(...turns).toFixed(2)} to ${Math.max(...turns).toFixed(2)} completed turns per player across the five kingdoms.</p></article>
    <article><h3>Draws</h3><p>Draw rates range from ${formatPercent(Math.min(...draws))} to ${formatPercent(Math.max(...draws))} across completed matches.</p></article>
    <article><h3>First player</h3><p>First-player tournament scores range from ${formatPercent(Math.min(...firstPlayer))} to ${formatPercent(Math.max(...firstPlayer))}.</p></article>
    <article><h3>Damage families</h3><p>The largest kingdom-wide damage family is ${escapeHtml(damageSummary)} of the five kingdoms.</p></article>
    <article><h3>Telemetry limit</h3><p>Damage and mana telemetry is not split by strategy. Kingdom-wide damage does not prove which purchase plan caused it.</p></article>
    <article><h3>Calibration</h3><p>Rigged Melee recorded ${runs.find((data) => data.run.kingdomId === 'rigged-melee')!.run.calibration!.passed ? 'PASS' : 'FAIL'}. The kingdom section compares its final leaders with the fixed melee benchmark.</p></article>
  </div></section>`;
}

const STYLES = `
:root{color-scheme:dark;--bg:#0c1016;--panel:#141a22;--line:#2a3544;--text:#eef4fb;--muted:#9aabba;--accent:#edc06b;--melee:#e86c67;--ranged:#5aa8e8;--mage:#a986e8;--other:#8b98a5}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 80% 0,#162334 0,transparent 35rem),var(--bg);color:var(--text);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}main{width:min(1800px,100%);margin:auto;padding:36px clamp(14px,3vw,48px) 80px}header{padding:44px 0 28px;border-bottom:1px solid var(--line)}h1{font:700 clamp(34px,5vw,68px)/.95 ui-serif,Georgia,serif;letter-spacing:-.04em;margin:8px 0 18px;max-width:900px}h2{font:700 clamp(25px,3vw,40px)/1 ui-serif,Georgia,serif;letter-spacing:-.025em;margin:4px 0}h3{font-size:15px;margin:26px 0 6px;color:#fff}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:var(--accent);font-size:11px;font-weight:700;margin:0}.intro,.lede{max-width:800px;color:var(--muted);font-size:15px}.jump{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}.jump a{color:var(--text);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:7px 11px;background:#111821}.jump a:hover{border-color:var(--accent)}section{padding:42px 0;border-bottom:1px solid var(--line);scroll-margin-top:18px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:22px}.section-head .lede{margin:0}.ranking-definition{max-width:920px;margin:0 0 10px;padding:9px 11px;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);color:#d9e3ec;font-size:12px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px;background:rgba(20,26,34,.88);-webkit-overflow-scrolling:touch}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 11px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}thead th{position:sticky;top:0;background:#202a36;color:#b9c7d4;white-space:nowrap;font-size:10px;text-transform:uppercase;letter-spacing:.08em}tbody tr:last-child>*{border-bottom:0}tbody tr:hover{background:#1a222d}a{color:#8fc8f5}.overview{min-width:980px}.leaders{min-width:1050px}.leaders td{white-space:nowrap}.formula,.note{color:var(--muted);font-size:11px;margin:9px 0}.melee{--family:var(--melee)}.ranged{--family:var(--ranged)}.mage{--family:var(--mage)}.other{--family:var(--other)}.pill{display:inline-block;border:1px solid color-mix(in srgb,var(--family) 70%,#fff 10%);background:color-mix(in srgb,var(--family) 22%,transparent);color:color-mix(in srgb,var(--family) 72%,#fff);padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase}.complete{color:#79d1a1}.calibration{font-weight:800}.calibration.pass{color:#79d1a1}.calibration.fail{color:#ff8b94}.calibration-card{margin:0 0 24px;padding:14px 16px;border:1px solid;border-radius:10px;background:var(--panel)}.calibration-card.pass{border-color:#3f7e5b}.calibration-card.fail{border-color:#a3424b;background:#24171c}.calibration-card h3{margin:0 0 7px}.calibration-card p{margin:4px 0;color:#d8e1e9}.statline{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.statline span{padding:7px 10px;background:var(--panel);border:1px solid var(--line);border-radius:7px;color:var(--muted)}.statline b{color:var(--text)}.two-up{display:grid;grid-template-columns:minmax(0,1fr);gap:22px}.heatmap{min-width:760px}.heatmap th,.heatmap td{text-align:center;padding:7px}.heatmap tbody th{text-align:left;white-space:nowrap}.heat{background:color-mix(in srgb,#54b97a calc(var(--heat)*.65%),#b84b53 calc((100 - var(--heat))*.65%));color:#fff;font-weight:700}.self{background:#222b36;color:#687687}.missing{background:#301e22;color:#ff8b94}.evolution-wrap{max-height:540px}.evolution{min-width:920px}.leader-ids{white-space:nowrap}.leader-ids span{display:inline-block;margin-right:8px;color:#dce8f4;font-weight:700}.mono{font-weight:700;color:#dce8f4}.muted{color:var(--muted)}.damage-grid{display:grid;grid-template-columns:minmax(340px,.65fr) minmax(520px,1.35fr);gap:16px;overflow:auto}.damage-grid table{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}.evidence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.evidence-grid article{padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:10px}.evidence-grid h3{margin:0 0 8px;color:var(--accent)}.evidence-grid p{margin:0;color:var(--muted)}footer{padding:30px 0;color:var(--muted);font-size:11px}@media(max-width:1100px){.evidence-grid{grid-template-columns:repeat(2,1fr)}.section-head{align-items:start;flex-direction:column}.statline{justify-content:flex-start}}@media(max-width:620px){main{padding:22px 10px 60px}header{padding-top:20px}.evidence-grid{grid-template-columns:1fr}.damage-grid{display:block}.damage-grid table{min-width:520px;margin-bottom:12px}.statline span{flex:1 1 45%}th,td{padding:7px 8px}}
`;

export function renderDashboard(runs: readonly DashboardRun[]): string {
  validateDashboardRuns(runs);
  const nav = runs.map((data) => `<a href="#${escapeHtml(data.run.kingdomId)}">${escapeHtml(data.run.kingdomName)}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hexdeck balance baseline</title><style>${STYLES}</style></head>
<body><main><header><p class="eyebrow">Hexdeck · shared-pilot baseline</p><h1>Five kingdoms before the first balance pass</h1><p class="intro">Five complete design-maximum searches. Every strategy uses the same tactical pilot, so the final tables compare only starting builds and purchase plans.</p><nav class="jump"><a href="#overview">Overview</a>${nav}<a href="#evidence">Evidence &amp; limits</a></nav></header>
${overviewSection(runs)}${runs.map(kingdomSection).join('')}${evidenceSection(runs)}
<footer>Source: five full simulator runs, run seed 1, 32 generations, 100-game pairing maximum, 30 turns per player, shared tactical pilot. Generated by scripts/write_balance_dashboard.ts. No balance values changed.</footer></main></body></html>
`;
}

export async function writeBalanceDashboard(root = process.cwd()): Promise<void> {
  const runs = await Promise.all(KINGDOM_IDS.map((id) => loadDashboardRun(root, id)));
  const html = renderDashboard(runs);
  await writeFile(`${root}/.html/balance-baseline.html`, html, 'utf8');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  writeBalanceDashboard().then(() => {
    process.stdout.write('Wrote .html/balance-baseline.html from five complete full-run artifact sets.\n');
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
