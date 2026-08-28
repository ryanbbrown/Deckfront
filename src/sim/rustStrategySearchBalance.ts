import { cardDefinition } from '../game';
import { SUPPORT_TOLERANCE, equilibriumGroupWeightRange } from './equilibrium';
import { classifyStrategyDamage } from './strategyDamage';
import { compareUtf16 } from './utf16';
import type {
  RustDamageFamily, RustPairEvidence, RustStrategySearchKingdomEvidence
} from './rustStrategySearchEvidence';

export const RUST_BALANCE_ANALYSIS_SCHEMA_VERSION = 1;
export const RUST_BALANCE_ANALYSIS_PROTOCOL = 'rust-strategy-search-balance-v1';
export const RUST_DAMAGE_FAMILIES: readonly RustDamageFamily[] = ['treasure', 'mana', 'melee', 'ranged', 'engine'];

export interface RustStrategySearchExecutionProvenance {
  ordinal: number;
  stage: 'goldfish' | 'matrix' | 'psro';
  coveredKingdomIds: string[];
  gitCommit?: string;
  sourceDigest?: string;
  deploymentDigest?: string;
  report: { path: string; sha256: string };
  binarySha256?: string;
  binarySha256UnavailableReason?: string;
}

export interface RustStrategySearchSourceProvenanceV1 {
  schemaVersion: 1;
  protocol: 'rust-strategy-search-source-provenance-v1';
  kingdomIds: string[];
  scientificImplementationCommits: { goldfish: string; matrix: string; psro: string };
  currentReleaseBinaries: { matrixSha256: string; psroSha256: string };
  executions: RustStrategySearchExecutionProvenance[];
  provenanceFileSha256?: string;
  verifierBinarySha256?: string;
}

export interface RustBalanceEvidenceLimits {
  diagonalSelfPlay: { available: false; matrixPayoff: 'fixed-50-percent'; purchases: 'absent'; familyDamage: 'absent' };
  pairedPointByteTwo: { exactWinDrawLossAvailable: false; meaning: 'one-win-one-loss-or-two-draws' };
  exactFirstPlayerWinRateAvailable: false;
  cardPlayCountsAvailable: false;
  perCardDamageAvailable: false;
  turnsToWinAvailable: false;
}

export interface RustBalanceRange { minimum: number; maximum: number }

export interface RustStrategyBalanceRow {
  strategyNumber: number;
  strategyId: string;
  goldfishRank: number;
  selectedWeight: number;
  supportMember: boolean;
  selectedLotteryScorePercent: number;
  feasibleWeightRange: RustBalanceRange;
  archetype: string;
  startingBuild: string[];
  buySteps: Array<{ cardId: string; desiredCount: number }>;
  offDiagonalOpponentCount: number;
  playerGames: number;
  purchases: Array<{ cardId: string; copies: number; copiesPerPlayerGame: number }>;
  familyDamage: Array<{ family: RustDamageFamily; damage: number; damagePerPlayerGame: number; share: number }>;
}

export interface RustArchetypeBalanceRow {
  archetype: string;
  strategyIds: string[];
  selectedShare: number;
  minimumFeasibleShare: number;
  maximumFeasibleShare: number;
  rangeWidth: number;
}

export interface RustKingdomBalanceAnalysis {
  kingdom: { id: string; name: string; startingHealth: number; offeredCards: Array<{
    id: string; name: string; cost: number; family: string; mechanic: string
  }> };
  completion: {
    nativeVerified: true;
    searches: number;
    admissions: number;
    matrixGeneration: number;
    cleanSearches: 2;
    finalMatrixSource: 'initial-matrix' | 'psro-expanded-matrix';
    finalStrategyCount: number;
  };
  equilibrium: {
    selectedWitness: Array<{ strategyNumber: number; strategyId: string; weight: number }>;
    supportSize: number;
    effectiveSize: number;
    maximumAdvantage: number;
  };
  strategies: RustStrategyBalanceRow[];
  archetypes: RustArchetypeBalanceRow[];
  pairedScoreEvidence: {
    payoffSeedCount: 75;
    telemetrySeedCount: 125;
    percentages75: number[][];
    byteCounts: [number, number, number, number, number];
    byteTwoShare: number;
    pairs: Array<{ firstStrategyNumber: number; secondStrategyNumber: number;
      percent75: number; percent125: number; byteCounts: [number, number, number, number, number] }>;
  };
  cards: Array<{
    cardId: string;
    totalCopies: number;
    playerGames: number;
    copiesPerPlayerGame: number;
    strategiesWithPurchases: number;
    selectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame: number;
    evidenceBasis: 'off-diagonal-full-matrix-acquisitions';
  }>;
  familyDamage: Array<{
    family: RustDamageFamily;
    totalDamage: number;
    playerGames: number;
    damagePerPlayerGame: number;
    share: number;
    selectedStrategyUniformOffDiagonalOpponentDamagePerPlayerGame: number;
  }>;
  evidenceLimits: RustBalanceEvidenceLimits;
  sourceFiles: RustStrategySearchKingdomEvidence['sourceFiles'];
  evidenceSetSha256: string;
}

export interface DistributionSummary {
  minimum: number;
  median: number;
  mean: number;
  maximum: number;
  values: Array<{ kingdomId: string; value: number }>;
}

export interface RustCrossKingdomBalanceAnalysis {
  archetypes: Array<{ archetype: string; selectedShare: number; meanMinimumFeasibleShare: number;
    meanMaximumFeasibleShare: number; selectedKingdomCount: number; materialKingdomCount: number;
    feasibleKingdomCount: number }>;
  supportSize: DistributionSummary;
  effectiveSize: DistributionSummary;
  cards: Array<{ cardId: string; offeredKingdomCount: number; positiveUsageKingdomCount: number;
    totalCopies: number; playerGames: number; copiesPerPlayerGame: number;
    meanOfferingKingdomCopiesPerPlayerGame: number;
    meanSelectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame: number }>;
  familyDamage: Array<{ family: RustDamageFamily; totalDamage: number; playerGames: number;
    damagePerPlayerGame: number; meanKingdomShare: number;
    meanSelectedStrategyUniformOffDiagonalOpponentDamagePerPlayerGame: number }>;
  pairedScoreEvidence: { byteCounts: [number, number, number, number, number]; byteTwoShare: number;
    maximumAbsoluteSkew75: number; maximumAbsoluteSkew125: number };
}

export interface RustBalanceOutlierEntry {
  kingdomId: string;
  metric: number;
  strategyNumber?: number;
  opponentNumber?: number;
  cardId?: string;
  family?: RustDamageFamily;
}

export interface RustBalanceOutliers {
  evidenceBasis: 'deterministic-ranked-review-queues';
  pairScoreSkew125: RustBalanceOutlierEntry[];
  pairScoreSkew75: RustBalanceOutlierEntry[];
  archetypeRangeWidth: Array<RustBalanceOutlierEntry & { archetype: string }>;
  lowestEffectiveSize: RustBalanceOutlierEntry[];
  highestEffectiveSize: RustBalanceOutlierEntry[];
  pointByteTwoShare: RustBalanceOutlierEntry[];
  cardCopiesPerPlayerGame: RustBalanceOutlierEntry[];
  familyDamagePerPlayerGame: RustBalanceOutlierEntry[];
  telemetryWeightingDifference: RustBalanceOutlierEntry[];
}

export interface RustBalanceAnalysisV1 {
  schemaVersion: 1;
  protocol: 'rust-strategy-search-balance-v1';
  scope: {
    suiteId: 'balance-smoke-v1';
    sourceSuiteId: 'balance-suite-v4';
    kingdomIds: string[];
    kingdomCount: number;
    payoffSeedCount: 75;
    telemetrySeedCount: 125;
    gamesPerPair: 250;
    pairPolicy: 'off-diagonal-upper-triangle';
    kingdomWeighting: 'equal';
    evidenceBases: ['off-diagonal-full-matrix-acquisitions', 'played-card-family-damage', 'paired-game-score-only'];
  };
  evidenceLimits: RustBalanceEvidenceLimits;
  provenance: RustStrategySearchSourceProvenanceV1;
  kingdoms: RustKingdomBalanceAnalysis[];
  crossKingdom: RustCrossKingdomBalanceAnalysis;
  outliers: RustBalanceOutliers;
}

export const RUST_BALANCE_EVIDENCE_LIMITS: RustBalanceEvidenceLimits = Object.freeze({
  diagonalSelfPlay: { available: false, matrixPayoff: 'fixed-50-percent', purchases: 'absent', familyDamage: 'absent' },
  pairedPointByteTwo: { exactWinDrawLossAvailable: false, meaning: 'one-win-one-loss-or-two-draws' },
  exactFirstPlayerWinRateAvailable: false, cardPlayCountsAvailable: false,
  perCardDamageAvailable: false, turnsToWinAvailable: false
} as const);

function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function mean(values: readonly number[]): number { return values.length ? sum(values) / values.length : 0; }
function byteCounts(pair: RustPairEvidence): [number, number, number, number, number] {
  const result: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const point of pair.points) result[point]! += 1;
  return result;
}
function addCounts(left: [number, number, number, number, number], right: readonly number[]): void {
  for (let index = 0; index < 5; index += 1) left[index]! += right[index]!;
}
function recordByStrategy(evidence: RustStrategySearchKingdomEvidence) {
  return new Map(evidence.goldfish.records.map((record) => [record.strategyNumber, record]));
}
function distribution(rows: readonly RustKingdomBalanceAnalysis[], value: (row: RustKingdomBalanceAnalysis) => number): DistributionSummary {
  const values = rows.map((row) => ({ kingdomId: row.kingdom.id, value: value(row) }));
  const sorted = values.map((entry) => entry.value).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { minimum: sorted[0]!, median, mean: mean(sorted), maximum: sorted.at(-1)!, values };
}
function selectedTelemetry(strategyRows: readonly RustStrategyBalanceRow[], cardId: string): number {
  return sum(strategyRows.map((strategy) => strategy.selectedWeight
    * (strategy.purchases.find((card) => card.cardId === cardId)?.copiesPerPlayerGame ?? 0)));
}
function selectedFamilyTelemetry(strategyRows: readonly RustStrategyBalanceRow[], family: RustDamageFamily): number {
  return sum(strategyRows.map((strategy) => strategy.selectedWeight
    * (strategy.familyDamage.find((held) => held.family === family)?.damagePerPlayerGame ?? 0)));
}

function buildKingdom(evidence: RustStrategySearchKingdomEvidence): RustKingdomBalanceAnalysis {
  const numbers = evidence.matrix.strategyNumbers, ids = numbers.map((number) => `gf-${number}`);
  const payoff = evidence.matrix.percentages.map((row) => row.map((value) => (value - 50) / 50));
  const records = recordByStrategy(evidence), purchaseRows = new Map<number, typeof evidence.purchases>();
  for (const row of evidence.purchases) purchaseRows.set(row.strategyNumber, [...(purchaseRows.get(row.strategyNumber) ?? []), row]);
  const preliminary = numbers.map((number, index) => {
    const record = records.get(number);
    if (!record) throw new Error(`${evidence.kingdomId}: missing final strategy ${number}.`);
    const rows = purchaseRows.get(number) ?? [], playerGames = rows.length * 250;
    if (!rows.length || rows.length !== numbers.length - 1) throw new Error(`${evidence.kingdomId}: incomplete purchase rows for ${number}.`);
    const cardTotals = Object.fromEntries(evidence.cardIds.map((cardId) => [cardId,
      sum(rows.map((row) => row.purchases[cardId] ?? 0))]));
    const familyTotals = Object.fromEntries(RUST_DAMAGE_FAMILIES.map((family) => [family,
      sum(rows.map((row) => row.familyDamage[family]))])) as Record<RustDamageFamily, number>;
    const damageTotal = sum(Object.values(familyTotals));
    const acquisitionRates = Object.fromEntries(evidence.cardIds.map((cardId) => [cardId, cardTotals[cardId]! / playerGames]));
    return { number, index, record, rows, playerGames, cardTotals, familyTotals,
      archetype: classifyStrategyDamage({ startingBuild: record.strategy.startingBuild, acquisitionRates }), damageTotal };
  });
  const archetypeById = new Map(preliminary.map((row) => [`gf-${row.number}`, row.archetype]));
  const strategies: RustStrategyBalanceRow[] = preliminary.map((row) => {
    const selectedWeight = evidence.matrix.weights[row.index]!;
    const selectedLotteryScorePercent = sum(evidence.matrix.percentages[row.index]!
      .map((value, column) => value * evidence.matrix.weights[column]!));
    const range = equilibriumGroupWeightRange(ids, payoff, 0, [`gf-${row.number}`]);
    return { strategyNumber: row.number, strategyId: `gf-${row.number}`, goldfishRank: row.record.rank,
      selectedWeight, supportMember: selectedWeight > SUPPORT_TOLERANCE, selectedLotteryScorePercent,
      feasibleWeightRange: range, archetype: row.archetype, startingBuild: [...row.record.strategy.startingBuild],
      buySteps: row.record.strategy.buyPlan.flatMap((slot) => slot.kind === 'buy'
        ? [{ cardId: slot.cardId, desiredCount: slot.desiredCount }] : []),
      offDiagonalOpponentCount: row.rows.length, playerGames: row.playerGames,
      purchases: evidence.cardIds.map((cardId) => ({ cardId, copies: row.cardTotals[cardId]!,
        copiesPerPlayerGame: row.cardTotals[cardId]! / row.playerGames })),
      familyDamage: RUST_DAMAGE_FAMILIES.map((family) => ({ family, damage: row.familyTotals[family],
        damagePerPlayerGame: row.familyTotals[family] / row.playerGames,
        share: row.damageTotal ? row.familyTotals[family] / row.damageTotal : 0 })) };
  });
  const archetypeNames = [...new Set(preliminary.map((row) => row.archetype))].sort();
  const archetypes = archetypeNames.map((archetype): RustArchetypeBalanceRow => {
    const strategyIds = ids.filter((id) => archetypeById.get(id) === archetype);
    const selectedShare = sum(strategyIds.map((id) => evidence.matrix.weights[ids.indexOf(id)]!));
    const range = equilibriumGroupWeightRange(ids, payoff, 0, strategyIds);
    return { archetype, strategyIds, selectedShare, minimumFeasibleShare: range.minimum,
      maximumFeasibleShare: range.maximum, rangeWidth: range.maximum - range.minimum };
  });
  if (Math.abs(sum(archetypes.map((row) => row.selectedShare)) - 1) > 1e-7
    || strategies.some((row) => row.selectedWeight < row.feasibleWeightRange.minimum - 1e-7
      || row.selectedWeight > row.feasibleWeightRange.maximum + 1e-7)
    || archetypes.some((row) => row.selectedShare < row.minimumFeasibleShare - 1e-7
      || row.selectedShare > row.maximumFeasibleShare + 1e-7)) throw new Error(`${evidence.kingdomId}: selected witness lies outside a feasible range.`);

  const pairs = evidence.pairs.map((pair) => {
    const counts = byteCounts(pair);
    return { firstStrategyNumber: pair.firstStrategyNumber, secondStrategyNumber: pair.secondStrategyNumber,
      percent75: sum(pair.points.slice(0, 75)) / 3, percent125: sum(pair.points) / (125 * 4) * 100, byteCounts: counts };
  });
  const totalByteCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const pair of pairs) addCounts(totalByteCounts, pair.byteCounts);
  const totalPlayerGames = sum(strategies.map((row) => row.playerGames));
  const cards = evidence.cardIds.map((cardId) => {
    const totalCopies = sum(strategies.map((row) => row.purchases.find((card) => card.cardId === cardId)!.copies));
    return { cardId, totalCopies, playerGames: totalPlayerGames, copiesPerPlayerGame: totalCopies / totalPlayerGames,
      strategiesWithPurchases: strategies.filter((row) => row.purchases.find((card) => card.cardId === cardId)!.copies > 0).length,
      selectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame: selectedTelemetry(strategies, cardId),
      evidenceBasis: 'off-diagonal-full-matrix-acquisitions' as const };
  });
  const totalDamage = sum(strategies.flatMap((row) => row.familyDamage.map((held) => held.damage)));
  const familyDamage = RUST_DAMAGE_FAMILIES.map((family) => {
    const held = sum(strategies.map((row) => row.familyDamage.find((entry) => entry.family === family)!.damage));
    return { family, totalDamage: held, playerGames: totalPlayerGames, damagePerPlayerGame: held / totalPlayerGames,
      share: totalDamage ? held / totalDamage : 0,
      selectedStrategyUniformOffDiagonalOpponentDamagePerPlayerGame: selectedFamilyTelemetry(strategies, family) };
  });
  const maximumAdvantage = Math.max(...payoff.map((row) => sum(row.map((value, column) => value * evidence.matrix.weights[column]!))));
  return { kingdom: { id: evidence.kingdomId, name: evidence.kingdomName, startingHealth: evidence.startingHealth,
    offeredCards: evidence.cardIds.map((id) => { const card = cardDefinition(id); return { id, name: card.name, cost: card.cost,
      family: card.family, mechanic: card.mechanic }; }) },
  completion: { nativeVerified: true, searches: evidence.completion.searchCount, admissions: evidence.completion.admissionCount,
    matrixGeneration: evidence.completion.matrixGeneration, cleanSearches: 2,
    finalMatrixSource: evidence.finalMatrixSource, finalStrategyCount: numbers.length },
  equilibrium: { selectedWitness: numbers.map((number, index) => ({ strategyNumber: number, strategyId: `gf-${number}`,
    weight: evidence.matrix.weights[index]! })), supportSize: strategies.filter((row) => row.supportMember).length,
    effectiveSize: 1 / sum(evidence.matrix.weights.map((weight) => weight * weight)), maximumAdvantage },
  strategies, archetypes, pairedScoreEvidence: { payoffSeedCount: 75, telemetrySeedCount: 125,
    percentages75: evidence.matrix.percentages.map((row) => [...row]), byteCounts: totalByteCounts,
    byteTwoShare: totalByteCounts[2] / sum(totalByteCounts), pairs }, cards, familyDamage,
  evidenceLimits: RUST_BALANCE_EVIDENCE_LIMITS, sourceFiles: evidence.sourceFiles,
  evidenceSetSha256: evidence.evidenceSetSha256 };
}

function top(rows: RustBalanceOutlierEntry[], direction: 'high' | 'low' = 'high'): RustBalanceOutlierEntry[] {
  return [...rows].sort((left, right) => (direction === 'high' ? right.metric - left.metric : left.metric - right.metric)
    || compareUtf16(left.kingdomId, right.kingdomId) || (left.strategyNumber ?? -1) - (right.strategyNumber ?? -1)
    || (left.opponentNumber ?? -1) - (right.opponentNumber ?? -1) || compareUtf16(left.cardId ?? '', right.cardId ?? '')
    || compareUtf16(left.family ?? '', right.family ?? '')).slice(0, 10);
}

function crossKingdom(kingdoms: readonly RustKingdomBalanceAnalysis[]): RustCrossKingdomBalanceAnalysis {
  const archetypeNames = [...new Set(kingdoms.flatMap((kingdom) => kingdom.archetypes.map((row) => row.archetype)))].sort();
  const archetypes = archetypeNames.map((archetype) => {
    const rows = kingdoms.map((kingdom) => kingdom.archetypes.find((row) => row.archetype === archetype)
      ?? { selectedShare: 0, minimumFeasibleShare: 0, maximumFeasibleShare: 0 });
    return { archetype, selectedShare: mean(rows.map((row) => row.selectedShare)),
      meanMinimumFeasibleShare: mean(rows.map((row) => row.minimumFeasibleShare)),
      meanMaximumFeasibleShare: mean(rows.map((row) => row.maximumFeasibleShare)),
      selectedKingdomCount: rows.filter((row) => row.selectedShare > SUPPORT_TOLERANCE).length,
      materialKingdomCount: rows.filter((row) => row.selectedShare >= 0.2).length,
      feasibleKingdomCount: rows.filter((row) => row.maximumFeasibleShare > SUPPORT_TOLERANCE).length };
  });
  const cardIds = [...new Set(kingdoms.flatMap((kingdom) => kingdom.cards.map((card) => card.cardId)))].sort();
  const cards = cardIds.map((cardId) => {
    const rows = kingdoms.flatMap((kingdom) => { const row = kingdom.cards.find((card) => card.cardId === cardId);
      return row ? [{ kingdom, row }] : []; });
    const totalCopies = sum(rows.map(({ row }) => row.totalCopies)), playerGames = sum(rows.map(({ row }) => row.playerGames));
    return { cardId, offeredKingdomCount: rows.length, positiveUsageKingdomCount: rows.filter(({ row }) => row.totalCopies > 0).length,
      totalCopies, playerGames, copiesPerPlayerGame: totalCopies / playerGames,
      meanOfferingKingdomCopiesPerPlayerGame: mean(rows.map(({ row }) => row.copiesPerPlayerGame)),
      meanSelectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame:
        mean(rows.map(({ row }) => row.selectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame)) };
  });
  const familyDamage = RUST_DAMAGE_FAMILIES.map((family) => {
    const rows = kingdoms.map((kingdom) => kingdom.familyDamage.find((row) => row.family === family)!);
    const totalDamage = sum(rows.map((row) => row.totalDamage)), playerGames = sum(rows.map((row) => row.playerGames));
    return { family, totalDamage, playerGames, damagePerPlayerGame: totalDamage / playerGames,
      meanKingdomShare: mean(rows.map((row) => row.share)),
      meanSelectedStrategyUniformOffDiagonalOpponentDamagePerPlayerGame:
        mean(rows.map((row) => row.selectedStrategyUniformOffDiagonalOpponentDamagePerPlayerGame)) };
  });
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const kingdom of kingdoms) addCounts(counts, kingdom.pairedScoreEvidence.byteCounts);
  return { archetypes, supportSize: distribution(kingdoms, (kingdom) => kingdom.equilibrium.supportSize),
    effectiveSize: distribution(kingdoms, (kingdom) => kingdom.equilibrium.effectiveSize), cards, familyDamage,
    pairedScoreEvidence: { byteCounts: counts, byteTwoShare: counts[2] / sum(counts),
      maximumAbsoluteSkew75: Math.max(...kingdoms.flatMap((kingdom) => kingdom.pairedScoreEvidence.pairs.map((pair) => Math.abs(pair.percent75 - 50)))),
      maximumAbsoluteSkew125: Math.max(...kingdoms.flatMap((kingdom) => kingdom.pairedScoreEvidence.pairs.map((pair) => Math.abs(pair.percent125 - 50)))) } };
}

function outliers(kingdoms: readonly RustKingdomBalanceAnalysis[]): RustBalanceOutliers {
  const pairs = kingdoms.flatMap((kingdom) => kingdom.pairedScoreEvidence.pairs.map((pair) => ({ kingdomId: kingdom.kingdom.id,
    strategyNumber: pair.firstStrategyNumber, opponentNumber: pair.secondStrategyNumber, pair })));
  const archetypeRangeWidth = kingdoms.flatMap((kingdom) => kingdom.archetypes.map((row) => ({
    kingdomId: kingdom.kingdom.id, archetype: row.archetype, metric: row.rangeWidth
  }))).sort((left, right) => right.metric - left.metric || compareUtf16(left.kingdomId, right.kingdomId)
    || compareUtf16(left.archetype, right.archetype)).slice(0, 10);
  const effective = kingdoms.map((kingdom) => ({ kingdomId: kingdom.kingdom.id, metric: kingdom.equilibrium.effectiveSize }));
  const cardRows = kingdoms.flatMap((kingdom) => kingdom.cards.map((card) => ({ kingdomId: kingdom.kingdom.id,
    cardId: card.cardId, metric: card.copiesPerPlayerGame })));
  const familyRows = kingdoms.flatMap((kingdom) => kingdom.familyDamage.map((row) => ({ kingdomId: kingdom.kingdom.id,
    family: row.family, metric: row.damagePerPlayerGame })));
  const telemetryDifference = kingdoms.flatMap((kingdom) => kingdom.cards.map((card) => ({ kingdomId: kingdom.kingdom.id,
    cardId: card.cardId, metric: Math.abs(card.selectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame - card.copiesPerPlayerGame) })));
  return { evidenceBasis: 'deterministic-ranked-review-queues',
    pairScoreSkew125: top(pairs.map((row) => ({ kingdomId: row.kingdomId, strategyNumber: row.strategyNumber,
      opponentNumber: row.opponentNumber, metric: Math.abs(row.pair.percent125 - 50) }))),
    pairScoreSkew75: top(pairs.map((row) => ({ kingdomId: row.kingdomId, strategyNumber: row.strategyNumber,
      opponentNumber: row.opponentNumber, metric: Math.abs(row.pair.percent75 - 50) }))),
    archetypeRangeWidth, lowestEffectiveSize: top(effective, 'low'), highestEffectiveSize: top(effective),
    pointByteTwoShare: top(kingdoms.map((kingdom) => ({ kingdomId: kingdom.kingdom.id,
      metric: kingdom.pairedScoreEvidence.byteTwoShare }))), cardCopiesPerPlayerGame: top(cardRows),
    familyDamagePerPlayerGame: top(familyRows), telemetryWeightingDifference: top(telemetryDifference) };
}

function finite(value: unknown, path = 'analysis'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
  if (Array.isArray(value)) value.forEach((entry, index) => finite(entry, `${path}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) finite(entry, `${path}.${key}`);
}

export function buildRustBalanceAnalysis(evidence: readonly RustStrategySearchKingdomEvidence[],
  provenance: RustStrategySearchSourceProvenanceV1): RustBalanceAnalysisV1 {
  if (!evidence.length || evidence.length !== provenance.kingdomIds.length
    || evidence.some((row, index) => row.kingdomId !== provenance.kingdomIds[index])
    || new Set(provenance.kingdomIds).size !== provenance.kingdomIds.length) throw new Error('Analysis evidence order differs from provenance.');
  const kingdoms = evidence.map(buildKingdom);
  const analysis: RustBalanceAnalysisV1 = { schemaVersion: 1, protocol: RUST_BALANCE_ANALYSIS_PROTOCOL,
    scope: { suiteId: 'balance-smoke-v1', sourceSuiteId: 'balance-suite-v4', kingdomIds: [...provenance.kingdomIds],
      kingdomCount: kingdoms.length, payoffSeedCount: 75, telemetrySeedCount: 125, gamesPerPair: 250,
      pairPolicy: 'off-diagonal-upper-triangle', kingdomWeighting: 'equal', evidenceBases:
      ['off-diagonal-full-matrix-acquisitions', 'played-card-family-damage', 'paired-game-score-only'] },
    evidenceLimits: RUST_BALANCE_EVIDENCE_LIMITS, provenance, kingdoms,
    crossKingdom: crossKingdom(kingdoms), outliers: outliers(kingdoms) };
  finite(analysis);
  return analysis;
}

export function stringifyRustBalanceAnalysis(analysis: RustBalanceAnalysisV1): string {
  finite(analysis);
  return `${JSON.stringify(analysis, null, 2)}\n`;
}
