import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { CARDS, cardDefinition, kingdomMarket } from '../src/game';
import { CURATED_KINGDOM_IDS } from '../src/sim/kingdoms';
import { GAMES_PER_SEED, playPairing } from '../src/sim/pairing';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { canonicalStrategy, identify, isInfinite } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import type { TelemetryAggregate } from '../src/sim/types';

export const MATERIAL_WEIGHT = 0.001;
export const NEAR_COMPETITIVE_SCORE = 0.48;

export type CardFamily = 'Engine' | 'Melee' | 'Ranged' | 'Mage' | 'Treasure';

const numberRecord = z.record(z.string(), z.number());
const pairRecordSchema = z.object({ played: z.number(), wins: z.number(), draws: z.number(),
  losses: z.number(), aborted: z.number() });
const telemetrySchema = z.object({
  acquisitionsByStrategy: z.record(z.string(), numberRecord), damageByCard: numberRecord,
  playsByCard: numberRecord,
  deadDraws: z.object({ range: z.number(), mana: z.number(), setup: z.number(), total: z.number() }),
  turnsToWin: z.object({ total: z.number(), count: z.number() }),
  byOrientation: z.object({
    firstOchre: z.object({ normal: pairRecordSchema, swapped: pairRecordSchema }),
    firstIndigo: z.object({ normal: pairRecordSchema, swapped: pairRecordSchema })
  })
});
const buyPlanSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inactive') }),
  z.object({ kind: z.literal('buy'), cardId: z.string(), desiredCount: z.number().int().positive() }),
  z.object({ kind: z.literal('stop'), threshold: z.number().int().nonnegative() })
]);
const strategySchema = z.object({ id: z.string(), startingBuild: z.array(z.string()),
  buyPlan: z.array(buyPlanSlotSchema).length(10) });
const runSchema = z.looseObject({
  schemaVersion: z.literal(5), rulesFingerprint: z.object({ version: z.literal(2), hash: z.string(), rules: z.unknown() }),
  valid: z.literal(true), kingdomId: z.string(), kingdomName: z.string(), mode: z.literal('full'),
  seed: z.number().int(), limits: z.record(z.string(), z.number()), finishedAt: z.string(),
  elapsedMs: z.number().nonnegative(), stopReason: z.string(), matches: z.number().nonnegative(), aborted: z.number().nonnegative()
});
const equilibriumSchema = z.looseObject({ strategyIds: z.array(z.string()), weights: numberRecord });
const matrixCellSchema = z.object({
  rowId: z.string(), columnId: z.string(), key: z.string(),
  blocks: z.array(z.object({ seed: z.number(), score: z.number(), played: z.number(), aborted: z.number() })),
  complete: z.boolean(), centeredPayoff: z.number(), matches: z.number(), telemetry: telemetrySchema
});
const matrixSchema = z.looseObject({
  protocol: z.object({ kingdomId: z.string(), cards: z.unknown(), seeds: z.array(z.number().int()),
    turnLimitPerPlayer: z.number().int(), actionCapPerTurn: z.number().int(),
    orientationProtocol: z.string(), rulesFingerprint: z.string() }),
  strategies: z.array(strategySchema), cells: z.array(matrixCellSchema), complete: z.literal(true),
  centeredPayoffs: z.array(z.array(z.number())), equilibrium: equilibriumSchema
});
const strategiesSchema = z.object({ strategies: z.array(z.object({ strategy: strategySchema, source: z.string() })) });
const telemetryFileSchema = z.object({ matrix: telemetrySchema, screening: telemetrySchema,
  confirmation: telemetrySchema, total: telemetrySchema });

type ParsedRun = z.infer<typeof runSchema>;
type ParsedMatrix = z.infer<typeof matrixSchema>;

export interface ArtifactSet { run: ParsedRun; matrix: ParsedMatrix; strategies: Strategy[] }

export interface StrategyReport {
  id: string;
  status: 'Lottery' | 'Near 50%' | '40% viable';
  weight: number;
  score: number;
  startingBuild: string[];
  purchaseSteps: { cardId: string; remaining: number; infinite: boolean }[];
  families: CardFamily[];
  acquiredCards: string[];
  acquisitionRates: Record<string, number>;
}

export interface LotteryTelemetryReport {
  games: number;
  drawRate: number;
  firstPlayerWinRate: number;
  firstPlayerScore: number;
  winnerTurnsPerPlayer: number | null;
  acquisitionsPerGame: Record<string, number>;
}

export interface KingdomReport {
  id: string;
  name: string;
  seed: number;
  finishedAt: string;
  elapsedMs: number;
  matches: number;
  stopReason: string;
  discoveredStrategies: number;
  matrixCells: number;
  rulesFingerprint: string;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  materialCount: number;
  nearCount: number;
  effectiveLotterySize: number;
  acquiredFamilyShares: Record<'Engine' | 'Melee' | 'Ranged' | 'Mage', number>;
  strategies: StrategyReport[];
  matchupScores: number[][];
  lotteryTelemetry: LotteryTelemetryReport;
}

export interface CardUseReport {
  cardId: string;
  name: string;
  family: CardFamily;
  availableKingdoms: number;
  buildPlans: number;
  buyPlans: number;
  infinitePlans: number;
  acquiredStrategies: number;
  averageMaterialWeight: number;
  usedKingdoms: string[];
}

export interface BalanceReportModel { kingdoms: KingdomReport[]; cards: CardUseReport[] }

function parseFile<T>(file: string, schema: z.ZodType<T>): T {
  if (!fs.existsSync(file)) throw new Error(`Missing balance-report input: ${file}`);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid balance-report input ${file}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function sameStrategy(left: Strategy, right: Strategy): boolean {
  return left.id === right.id && canonicalStrategy(left) === canonicalStrategy(right);
}

export function loadArtifactSet(root: string, kingdomId: string): ArtifactSet {
  return loadArtifactDirectory(path.join(root, '.experiments', kingdomId, 'full'), kingdomId);
}

export function loadArtifactDirectory(directory: string, kingdomId: string): ArtifactSet {
  const run = parseFile(path.join(directory, 'run.json'), runSchema);
  const matrix = parseFile(path.join(directory, 'matrix.json'), matrixSchema);
  const listed = parseFile(path.join(directory, 'strategies.json'), strategiesSchema).strategies.map((entry) => entry.strategy);
  parseFile(path.join(directory, 'telemetry.json'), telemetryFileSchema);
  if (run.kingdomId !== kingdomId || matrix.protocol.kingdomId !== kingdomId) {
    throw new Error(`Artifact kingdom mismatch for ${kingdomId}.`);
  }
  const expected = rulesFingerprint(kingdomId, matrix.protocol.turnLimitPerPlayer, matrix.protocol.actionCapPerTurn);
  if (run.rulesFingerprint.hash !== expected.hash || matrix.protocol.rulesFingerprint !== expected.hash
    || JSON.stringify(run.rulesFingerprint.rules) !== JSON.stringify(expected.rules)) {
    throw new Error(`Rules fingerprint mismatch for ${kingdomId}: expected ${expected.hash}, run has ${run.rulesFingerprint.hash}, matrix has ${matrix.protocol.rulesFingerprint}.`);
  }
  if (run.rulesFingerprint.hash !== rulesFingerprint(kingdomId).hash) {
    throw new Error(`The ${kingdomId} run does not use the current turn and action limits.`);
  }
  if (run.limits.turnLimitPerPlayer !== matrix.protocol.turnLimitPerPlayer
    || run.limits.actionCapPerTurn !== matrix.protocol.actionCapPerTurn) {
    throw new Error(`Run limits do not match the matrix protocol for ${kingdomId}.`);
  }
  const matrixIds = matrix.strategies.map((strategy) => strategy.id);
  if (new Set(matrixIds).size !== matrixIds.length) throw new Error(`Duplicate strategy id in ${kingdomId} matrix.`);
  for (const strategy of matrix.strategies) {
    if (identify(strategy).id !== strategy.id) throw new Error(`Strategy ${strategy.id} has inconsistent content in ${kingdomId}.`);
  }
  if (listed.length !== matrix.strategies.length || listed.some((entry, index) => !sameStrategy(entry, matrix.strategies[index]!))) {
    throw new Error(`Strategy list does not match the matrix for ${kingdomId}.`);
  }
  if (matrix.equilibrium.strategyIds.length !== matrixIds.length
    || matrix.equilibrium.strategyIds.some((id, index) => id !== matrixIds[index])) {
    throw new Error(`Equilibrium strategy ids do not match the matrix for ${kingdomId}.`);
  }
  if (matrix.centeredPayoffs.length !== matrixIds.length
    || matrix.centeredPayoffs.some((row) => row.length !== matrixIds.length)) {
    throw new Error(`Payoff matrix dimensions do not match its strategies for ${kingdomId}.`);
  }
  const expectedCells = matrixIds.length * (matrixIds.length - 1) / 2;
  if (matrix.cells.length !== expectedCells || matrix.cells.some((cell) => !cell.complete)) {
    throw new Error(`Full matrix is incomplete for ${kingdomId}: expected ${expectedCells} complete cells.`);
  }
  const known = new Set(matrixIds);
  if (matrix.cells.some((cell) => !known.has(cell.rowId) || !known.has(cell.columnId))) {
    throw new Error(`A matrix cell has an unknown strategy id for ${kingdomId}.`);
  }
  return { run, matrix, strategies: matrix.strategies };
}

function materialWeights(artifact: ArtifactSet): Map<string, number> {
  const entries = artifact.strategies.map((strategy) => [strategy.id,
    artifact.matrix.equilibrium.weights[strategy.id] ?? 0] as const).filter(([, weight]) => weight >= MATERIAL_WEIGHT);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) throw new Error(`No strategy meets the ${(MATERIAL_WEIGHT * 100).toFixed(1)}% material threshold in ${artifact.run.kingdomId}.`);
  return new Map(entries.map(([id, weight]) => [id, weight / total]));
}

function scoreAgainst(artifact: ArtifactSet, strategyIndex: number, weights: ReadonlyMap<string, number>): number {
  const centered = artifact.strategies.reduce((sum, opponent, opponentIndex) =>
    sum + (weights.get(opponent.id) ?? 0) * artifact.matrix.centeredPayoffs[strategyIndex]![opponentIndex]!, 0);
  return (centered + 1) / 2;
}

export function family(cardId: string): CardFamily {
  const card = cardDefinition(cardId);
  if (card.type === 'treasure') return 'Treasure';
  return card.family === 'engine' ? 'Engine' : card.family === 'melee' ? 'Melee'
    : card.family === 'ranged' ? 'Ranged' : 'Mage';
}

function strategyFamilies(strategy: Strategy): CardFamily[] {
  const order: CardFamily[] = ['Engine', 'Melee', 'Ranged', 'Mage', 'Treasure'];
  const cards = [...strategy.startingBuild,
    ...strategy.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [slot.cardId] : [])];
  const found = new Set(cards.map(family));
  return order.filter((entry) => found.has(entry));
}

function purchaseSteps(strategy: Strategy): { cardId: string; remaining: number; infinite: boolean }[] {
  const inBuild: Record<string, number> = {};
  for (const cardId of strategy.startingBuild) inBuild[cardId] = (inBuild[cardId] ?? 0) + 1;
  return strategy.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [{
    cardId: slot.cardId, infinite: isInfinite(slot),
    remaining: Math.max(0, slot.desiredCount - (inBuild[slot.cardId] ?? 0))
  }] : []);
}

function cellFor(artifact: ArtifactSet, leftId: string, rightId: string): z.infer<typeof matrixCellSchema> {
  const cell = artifact.matrix.cells.find((entry) =>
    (entry.rowId === leftId && entry.columnId === rightId) || (entry.rowId === rightId && entry.columnId === leftId));
  if (!cell) throw new Error(`Missing matrix cell ${leftId} versus ${rightId} in ${artifact.run.kingdomId}.`);
  return cell;
}

interface WeightedTelemetry {
  gameWeight: number;
  draws: number;
  firstWins: number;
  firstDraws: number;
  winningTurnTotal: number;
  winningTurnCount: number;
  acquisitions: Record<string, number>;
  acquisitionGameWeight: number;
}

function telemetryNumbers(telemetry: TelemetryAggregate): Omit<WeightedTelemetry, 'gameWeight' | 'acquisitionGameWeight'> & { games: number } {
  const records = Object.values(telemetry.byOrientation).flatMap((entry) => Object.values(entry));
  const games = records.reduce((sum, record) => sum + record.played, 0);
  const draws = records.reduce((sum, record) => sum + record.draws, 0);
  const firstWins = telemetry.byOrientation.firstOchre.normal.wins
    + telemetry.byOrientation.firstOchre.swapped.wins
    + telemetry.byOrientation.firstIndigo.normal.losses
    + telemetry.byOrientation.firstIndigo.swapped.losses;
  const acquisitions: Record<string, number> = {};
  for (const counts of Object.values(telemetry.acquisitionsByStrategy)) {
    for (const [cardId, amount] of Object.entries(counts)) acquisitions[cardId] = (acquisitions[cardId] ?? 0) + amount;
  }
  return { games, draws, firstWins, firstDraws: draws, winningTurnTotal: telemetry.turnsToWin.total,
    winningTurnCount: telemetry.turnsToWin.count, acquisitions };
}

function mergeWeighted(into: WeightedTelemetry, telemetry: TelemetryAggregate, weight: number): void {
  const values = telemetryNumbers(telemetry);
  into.gameWeight += values.games * weight;
  into.draws += values.draws * weight;
  into.firstWins += values.firstWins * weight;
  into.firstDraws += values.firstDraws * weight;
  into.winningTurnTotal += values.winningTurnTotal * weight;
  into.winningTurnCount += values.winningTurnCount * weight;
  into.acquisitionGameWeight += values.games * weight;
  for (const [cardId, amount] of Object.entries(values.acquisitions)) {
    into.acquisitions[cardId] = (into.acquisitions[cardId] ?? 0) + amount * weight;
  }
}

function finalLotteryTelemetry(
  artifact: ArtifactSet, weights: ReadonlyMap<string, number>, selfPlay: ReadonlyMap<string, TelemetryAggregate>
): LotteryTelemetryReport {
  const material = artifact.strategies.filter((strategy) => weights.has(strategy.id));
  const weighted: WeightedTelemetry = { gameWeight: 0, draws: 0, firstWins: 0, firstDraws: 0,
    winningTurnTotal: 0, winningTurnCount: 0, acquisitions: {}, acquisitionGameWeight: 0 };
  for (let row = 0; row < material.length; row += 1) {
    const left = material[row]!, leftWeight = weights.get(left.id)!;
    const mirror = selfPlay.get(left.id);
    if (!mirror) throw new Error(`Missing self-play telemetry for ${artifact.run.kingdomId} strategy ${left.id}.`);
    mergeWeighted(weighted, mirror, leftWeight * leftWeight);
    for (let column = row + 1; column < material.length; column += 1) {
      const right = material[column]!, pairWeight = 2 * leftWeight * weights.get(right.id)!;
      mergeWeighted(weighted, cellFor(artifact, left.id, right.id).telemetry, pairWeight);
    }
  }
  return {
    games: weighted.gameWeight,
    drawRate: weighted.gameWeight ? weighted.draws / weighted.gameWeight : 0,
    firstPlayerWinRate: weighted.gameWeight ? weighted.firstWins / weighted.gameWeight : 0,
    firstPlayerScore: weighted.gameWeight ? (weighted.firstWins + weighted.firstDraws / 2) / weighted.gameWeight : 0,
    winnerTurnsPerPlayer: weighted.winningTurnCount
      ? (weighted.winningTurnTotal + weighted.winningTurnCount) / weighted.winningTurnCount / 2 : null,
    acquisitionsPerGame: Object.fromEntries(Object.entries(weighted.acquisitions)
      .map(([id, amount]) => [id, weighted.acquisitionGameWeight ? amount / weighted.acquisitionGameWeight : 0]))
  };
}

function strategyAcquisitionRates(
  artifact: ArtifactSet, strategyId: string, material: readonly { strategy: Strategy; weight: number }[],
  selfPlay: ReadonlyMap<string, TelemetryAggregate>
): Record<string, number> {
  const totals: Record<string, number> = {};
  let weightedGames = 0;
  for (const opponent of material) {
    let telemetry: TelemetryAggregate, divisor = 1;
    if (strategyId === opponent.strategy.id) {
      telemetry = selfPlay.get(strategyId)!; divisor = 2;
    } else telemetry = cellFor(artifact, strategyId, opponent.strategy.id).telemetry;
    const games = telemetryNumbers(telemetry).games;
    weightedGames += games * opponent.weight;
    for (const [cardId, amount] of Object.entries(telemetry.acquisitionsByStrategy[strategyId] ?? {})) {
      totals[cardId] = (totals[cardId] ?? 0) + amount / divisor * opponent.weight;
    }
  }
  return Object.fromEntries(Object.entries(totals).filter(([, amount]) => amount > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cardId, amount]) => [cardId, weightedGames ? amount / weightedGames : 0]));
}

function acquiredFamilyShares(strategies: readonly { acquisitionRates: Record<string, number> }[]): Record<'Engine' | 'Melee' | 'Ranged' | 'Mage', number> {
  const totals = { Engine: 0, Melee: 0, Ranged: 0, Mage: 0 };
  for (const strategy of strategies) for (const [cardId, rate] of Object.entries(strategy.acquisitionRates)) {
    const cardFamily = family(cardId);
    if (cardFamily !== 'Treasure') totals[cardFamily] += rate;
  }
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return total ? { Engine: totals.Engine / total, Melee: totals.Melee / total,
    Ranged: totals.Ranged / total, Mage: totals.Mage / total } : totals;
}

export function buildBalanceReportModel(
  artifacts: readonly ArtifactSet[], selfPlayByKingdom: ReadonlyMap<string, ReadonlyMap<string, TelemetryAggregate>>,
  options: { competitiveScore?: number; competitiveStatus?: 'Near 50%' | '40% viable' } = {}
): BalanceReportModel {
  const competitiveScore = options.competitiveScore ?? NEAR_COMPETITIVE_SCORE;
  const competitiveStatus = options.competitiveStatus ?? 'Near 50%';
  const kingdoms: KingdomReport[] = artifacts.map((artifact) => {
    const weights = materialWeights(artifact);
    const scored = artifact.strategies.map((strategy, index) => ({ strategy, index,
      weight: weights.get(strategy.id) ?? 0, score: scoreAgainst(artifact, index, weights) }));
    const viable = scored.filter((entry) => entry.weight > 0 || entry.score >= competitiveScore)
      .sort((left, right) => right.weight - left.weight || right.score - left.score || left.strategy.id.localeCompare(right.strategy.id));
    const material = scored.filter((entry) => entry.weight > 0);
    const selfPlay = selfPlayByKingdom.get(artifact.run.kingdomId);
    if (!selfPlay) throw new Error(`Missing self-play map for ${artifact.run.kingdomId}.`);
    const strategies: StrategyReport[] = viable.map((entry) => {
      const acquisitionRates = strategyAcquisitionRates(artifact, entry.strategy.id, material, selfPlay);
      return {
      id: entry.strategy.id, status: entry.weight > 0 ? 'Lottery' : competitiveStatus, weight: entry.weight,
      score: entry.score, startingBuild: entry.strategy.startingBuild,
      purchaseSteps: purchaseSteps(entry.strategy),
      families: strategyFamilies(entry.strategy), acquiredCards: Object.keys(acquisitionRates), acquisitionRates
    }; });
    const indexById = new Map(artifact.strategies.map((strategy, index) => [strategy.id, index]));
    const matchupScores = strategies.map((row) => strategies.map((column) => {
      if (row.id === column.id) return 0.5;
      return (artifact.matrix.centeredPayoffs[indexById.get(row.id)!]![indexById.get(column.id)!]! + 1) / 2;
    }));
    return {
      id: artifact.run.kingdomId, name: artifact.run.kingdomName,
      seed: artifact.run.seed, finishedAt: artifact.run.finishedAt, elapsedMs: artifact.run.elapsedMs,
      matches: artifact.run.matches, stopReason: artifact.run.stopReason,
      discoveredStrategies: artifact.strategies.length, matrixCells: artifact.matrix.cells.length,
      rulesFingerprint: artifact.run.rulesFingerprint.hash,
      turnLimitPerPlayer: artifact.matrix.protocol.turnLimitPerPlayer,
      actionCapPerTurn: artifact.matrix.protocol.actionCapPerTurn,
      materialCount: material.length, nearCount: viable.length - material.length,
      effectiveLotterySize: 1 / [...weights.values()].reduce((sum, weight) => sum + weight * weight, 0),
      acquiredFamilyShares: acquiredFamilyShares(strategies),
      strategies, matchupScores,
      lotteryTelemetry: finalLotteryTelemetry(artifact, weights, selfPlay)
    };
  });

  const normal = kingdoms;
  const cards = Object.values(CARDS).filter((card) => card.type === 'action').map((card): CardUseReport => {
    let availableKingdoms = 0, buildPlans = 0, buyPlans = 0, infinitePlans = 0, acquiredStrategies = 0;
    let materialWeight = 0;
    const usedKingdoms: string[] = [];
    for (const kingdom of normal) {
      const available = kingdomMarket(kingdom.id).some((entry) => entry.id === card.id);
      if (available) availableKingdoms += 1;
      let used = false;
      for (const strategy of kingdom.strategies) {
        const inBuild = strategy.startingBuild.includes(card.id);
        const inPlan = strategy.purchaseSteps.some((entry) => entry.cardId === card.id);
        const inInfinite = strategy.purchaseSteps.some((entry) => entry.infinite && entry.cardId === card.id);
        if (inBuild) buildPlans += 1;
        if (inPlan) buyPlans += 1;
        if (inInfinite) infinitePlans += 1;
        if (strategy.acquiredCards.includes(card.id)) acquiredStrategies += 1;
        if (inBuild || inPlan || inInfinite) {
          used = true;
          if (strategy.status === 'Lottery') materialWeight += strategy.weight;
        }
      }
      if (used) usedKingdoms.push(kingdom.name);
    }
    return { cardId: card.id, name: card.name, family: family(card.id), availableKingdoms,
      buildPlans, buyPlans, infinitePlans, acquiredStrategies,
      averageMaterialWeight: availableKingdoms ? materialWeight / availableKingdoms : 0, usedKingdoms };
  }).sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name));
  return { kingdoms, cards };
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function percent(value: number, places = 1): string { return `${(value * 100).toFixed(places)}%`; }
function number(value: number, places = 2): string { return value.toFixed(places); }
function integer(value: number): string { return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function cardName(id: string): string { return cardDefinition(id).name; }
function table(headers: readonly string[], rows: readonly (readonly string[])[], className = ''): string {
  return `<div class="table-scroll"><table class="${className}"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function strategyLabel(index: number): string { return `S${index + 1}`; }

export function renderBalanceReport(model: BalanceReportModel): string {
  const normal = model.kingdoms;
  const multiple = normal.filter((kingdom) => kingdom.strategies.length >= 2).length;
  const multipleFamilies = normal.filter((kingdom) => new Set(kingdom.strategies.map((strategy) => strategy.families.join(' + '))).size >= 2).length;
  const availableUnused = model.cards.filter((card) => card.availableKingdoms > 0
    && card.buildPlans + card.buyPlans + card.infinitePlans === 0).map((card) => card.name);
  const summaryRows = model.kingdoms.map((kingdom) => [escape(kingdom.name),
    String(kingdom.materialCount), String(kingdom.nearCount), String(kingdom.strategies.length),
    number(kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0), percent(kingdom.lotteryTelemetry.drawRate),
    percent(kingdom.lotteryTelemetry.firstPlayerScore)]);
  const kingdomSections = model.kingdoms.map((kingdom) => {
    const maxSteps = Math.max(0, ...kingdom.strategies.map((strategy) => strategy.purchaseSteps.length));
    const strategyRows = kingdom.strategies.map((strategy, index) => {
      const steps = Array.from({ length: maxSteps }, (_, step) => {
        const entry = strategy.purchaseSteps[step];
        return entry ? `${escape(cardName(entry.cardId))} ×${entry.infinite ? '∞' : entry.remaining}` : '—';
      });
      return [`<span class="key">${strategyLabel(index)}</span><br><code>${escape(strategy.id)}</code>`,
        strategy.status, strategy.status === 'Lottery' ? percent(strategy.weight, 2) : '—', percent(strategy.score, 1),
        strategy.startingBuild.length ? strategy.startingBuild.map((id) => escape(cardName(id))).join(', ') : 'None',
        ...steps, escape(strategy.families.join(' + ')),
        strategy.acquiredCards.length ? strategy.acquiredCards.map((id) => escape(cardName(id))).join(', ') : 'None'];
    });
    const matchupRows = kingdom.strategies.map((strategy, row) => [
      `<span class="key">${strategyLabel(row)}</span>`,
      ...kingdom.matchupScores[row]!.map((score, column) => row === column ? '50.0% mirror' : percent(score))
    ]);
    const acquisitions = Object.entries(kingdom.lotteryTelemetry.acquisitionsPerGame)
      .filter(([, amount]) => amount > 0.005).sort((left, right) => right[1] - left[1])
      .map(([id, amount]) => `${escape(cardName(id))} ${number(amount)}`).join(', ') || 'None';
    return `<section id="${escape(kingdom.id)}"><h2>${escape(kingdom.name)}</h2>
      <p class="evidence">Seed ${kingdom.seed} · ${kingdom.discoveredStrategies} discovered strategies · ${kingdom.matrixCells} matrix cells · ${integer(kingdom.matches)} search games · ${number(kingdom.elapsedMs / 1000, 1)} seconds · ${escape(kingdom.stopReason)} · rules <code>${escape(kingdom.rulesFingerprint)}</code> · ${kingdom.turnLimitPerPlayer} turns/player · ${kingdom.actionCapPerTurn} actions/turn</p>
      <div class="metrics"><div><strong>${kingdom.materialCount}</strong><span>lottery strategies</span></div><div><strong>${kingdom.nearCount}</strong><span>other near-50% strategies</span></div><div><strong>${number(kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0)}</strong><span>turns/player in wins</span></div><div><strong>${percent(kingdom.lotteryTelemetry.firstPlayerScore)}</strong><span>first-player score</span></div></div>
      <h3>Viable strategy plans</h3>
      ${table(['Key', 'Status', 'Lottery weight', 'Score vs lottery', 'Starting build',
        ...Array.from({ length: maxSteps }, (_, index) => `Purchase ${index + 1}`), 'Plan families', 'Acquired in evaluation'], strategyRows)}
      <h3>Viable-strategy matchups</h3><p>Each cell is the row strategy’s score against the column strategy. A draw counts as half a win.</p>
      ${table(['Row', ...kingdom.strategies.map((_strategy, index) => strategyLabel(index))], matchupRows, 'matrix')}
      <h3>Final-lottery play</h3><p>Draws: ${percent(kingdom.lotteryTelemetry.drawRate)}. First-player wins: ${percent(kingdom.lotteryTelemetry.firstPlayerWinRate)}. First-player score including half credit for draws: ${percent(kingdom.lotteryTelemetry.firstPlayerScore)}. Mean winner turn: ${number(kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0)} turns per player. Weighted evaluated games: ${number(kingdom.lotteryTelemetry.games, 1)}.</p><p>Mean cards acquired per game: ${acquisitions}.</p></section>`;
  }).join('\n');
  const cardRows = model.cards.map((card) => [escape(card.name), card.family, String(card.availableKingdoms),
    String(card.buildPlans), String(card.buyPlans), String(card.infinitePlans), String(card.acquiredStrategies),
    percent(card.averageMaterialWeight), card.usedKingdoms.length ? escape(card.usedKingdoms.join(', ')) : '—']);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Four-kingdom diagnostic report</title><style>
:root{color-scheme:light;--ink:#17231d;--muted:#56625c;--line:#ccd6d0;--paper:#f7f5ef;--panel:#fff;--accent:#096b4b;--soft:#e8f2ed}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.48 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1440px;margin:auto;padding:36px 28px 72px}h1{font-size:clamp(30px,4vw,52px);line-height:1.05;margin:0 0 12px}h2{font-size:29px;margin:0 0 8px}h3{font-size:18px;margin:28px 0 8px}p{max-width:85ch;margin:8px 0;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;margin:24px 0}.lead{font-size:18px}.findings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}.finding,.metrics>div{background:var(--soft);border-radius:9px;padding:14px}.finding strong,.metrics strong{display:block;font-size:27px;color:var(--accent)}.finding span,.metrics span{display:block;color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}.table-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;white-space:nowrap;background:#fff}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #e4e9e6;vertical-align:top}th{position:sticky;top:0;background:#edf3ef;color:#304039;font-size:12px;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}.matrix td:not(:first-child),.matrix th:not(:first-child){text-align:right}.key{display:inline-block;background:var(--accent);color:#fff;border-radius:4px;padding:1px 6px;font-weight:700}.tag{font-size:12px;color:#864900;background:#fff0d5;border-radius:999px;padding:4px 8px;vertical-align:middle}.evidence{font-size:13px;max-width:none}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.definitions li{margin:8px 0}@media(max-width:720px){main{padding:22px 12px 48px}section{padding:16px;margin:14px 0}.findings,.metrics{grid-template-columns:1fr 1fr}h2{font-size:24px}}@media(max-width:430px){.findings,.metrics{grid-template-columns:1fr}}
</style></head><body><main><header><h1>Four-kingdom diagnostic report</h1><p class="lead">This report shows competitive strategy diversity and card use in the four hand-built diagnostic kingdoms.</p></header>
<section><h2>What the current runs show</h2><div class="findings"><div class="finding"><strong>${multiple} of ${normal.length}</strong><span>diagnostic kingdoms have at least two viable strategies</span></div><div class="finding"><strong>${multipleFamilies} of ${normal.length}</strong><span>diagnostic kingdoms have at least two distinct plan-family combinations</span></div><div class="finding"><strong>${availableUnused.length}</strong><span>available action cards appear in no viable plan</span></div></div><p>${availableUnused.length ? `Available cards with no viable plan: ${escape(availableUnused.join(', '))}.` : 'Every available action card appears in at least one viable plan in this sample.'}</p>${table(['Kingdom', 'Lottery', 'Near 50%', 'Viable total', 'Win turns/player', 'Draws', 'First-player score'], summaryRows)}</section>
<section class="definitions"><h2>How to read this report</h2><ul><li><strong>Lottery strategy:</strong> at least 0.1% of the final equilibrium after smaller weights are removed and the remaining weights are normalized.</li><li><strong>Near-50% strategy:</strong> less than 0.1% lottery weight and at least 48% score against the material lottery. This two-point band is a provisional screen, not proof of equal strength.</li><li><strong>Viable strategy:</strong> either a lottery strategy or a near-50% strategy.</li><li><strong>Final lottery:</strong> the hardest discovered mix for one strategy to beat. The report scores all discovered strategies against the material part of that mix.</li><li><strong>Plan use:</strong> a card in the starting build, finite purchase plan, or repeat purchase. Acquired use is separate and comes from evaluated games.</li></ul><p>Four normal curated kingdoms are an initial sample. They cannot establish card health across a broad kingdom corpus.</p></section>
${kingdomSections}
<section><h2>Action-card use across diagnostic kingdoms</h2><p>Counts cover viable strategies only. Each card counts once per strategy in each plan field. Average lottery weight is the share of material lottery plans that use the card, averaged over kingdoms where the card is available.</p>${table(['Card', 'Family', 'Available kingdoms', 'Build plans', 'Rung plans', 'Repeating rungs', 'Acquired strategies', 'Average lottery weight', 'Used in viable plans'], cardRows)}</section>
</main></body></html>\n`;
}

export function selfPlayFor(artifact: ArtifactSet): Map<string, TelemetryAggregate> {
  const weights = materialWeights(artifact);
  const results = new Map<string, TelemetryAggregate>();
  for (const strategy of artifact.strategies.filter((entry) => weights.has(entry.id))) {
    const pairing = playPairing(strategy, strategy, {
      kingdomId: artifact.run.kingdomId, seeds: artifact.matrix.protocol.seeds,
      turnLimitPerPlayer: artifact.matrix.protocol.turnLimitPerPlayer,
      actionCapPerTurn: artifact.matrix.protocol.actionCapPerTurn
    });
    if (pairing.record.aborted
      || pairing.matches !== artifact.matrix.protocol.seeds.length * GAMES_PER_SEED) {
      throw new Error(`Invalid self-play for ${artifact.run.kingdomId} strategy ${strategy.id}.`);
    }
    results.set(strategy.id, pairing.telemetry);
  }
  return results;
}

export function generateBalanceReport(root: string, output = path.join(root, '.html', 'balance-report.html')): BalanceReportModel {
  const artifacts = CURATED_KINGDOM_IDS.map((kingdomId) => loadArtifactSet(root, kingdomId));
  const selfPlay = new Map(artifacts.map((artifact) => [artifact.run.kingdomId, selfPlayFor(artifact)]));
  const model = buildBalanceReportModel(artifacts, selfPlay);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderBalanceReport(model));
  return model;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const output = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
    const model = generateBalanceReport(process.cwd(), output);
    process.stdout.write(`Wrote ${output ?? path.join(process.cwd(), '.html', 'balance-report.html')} from ${model.kingdoms.length} full runs.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
