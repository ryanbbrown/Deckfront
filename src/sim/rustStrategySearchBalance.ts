import { cardDefinition } from '../game';
import { SUPPORT_TOLERANCE, equilibriumGroupWeightRange } from './equilibrium';
import { summarizeEquilibriumWeightedCells } from './lotteryAcquisition';
import { classifyStrategyDamage } from './strategyDamage';
import { compareUtf16 } from './utf16';
import type {
  RustDamageFamily, RustPairEvidence, RustStrategySearchKingdomEvidence
} from './rustStrategySearchEvidence';

export const RUST_BALANCE_ANALYSIS_SCHEMA_VERSION = 2;
export const RUST_BALANCE_ANALYSIS_PROTOCOL = 'rust-strategy-search-balance-v2';
export const RUST_DAMAGE_FAMILIES: readonly RustDamageFamily[] = ['treasure', 'mana', 'melee', 'ranged', 'engine'];
const TELEMETRY_BASIS = 'stored equilibrium lottery versus itself; diagonal included; rates are per player side' as const;
const AUDIT_BASIS = 'unweighted full-Matrix observed counts' as const;

export interface RustStrategySearchExecutionProvenance {
  ordinal: number;
  stage: 'goldfish' | 'matrix' | 'psro' | 'self-play-telemetry';
  coveredKingdomIds: string[];
  gitCommit?: string;
  sourceDigest?: string;
  deploymentDigest?: string;
  report: { path: string; sha256: string };
  binarySha256?: string;
  binarySha256UnavailableReason?: string;
}

export interface RustStrategySearchSourceProvenanceV2 {
  schemaVersion: 2;
  protocol: 'rust-strategy-search-source-provenance-v2';
  kingdomIds: string[];
  scientificImplementationCommits: { goldfish: string; matrix: string; psro: string; selfPlayTelemetry: string };
  currentVerifierAndBackfillBinarySha256: string;
  executions: RustStrategySearchExecutionProvenance[];
  provenanceFileSha256?: string;
  verifierBinarySha256?: string;
}

export interface RustBalanceEvidenceLimits {
  matrixDiagonal: {
    payoff: 'fixed-50-percent';
    sameStrategyTelemetry: 'available-separate-from-payoff';
    playerSidesPerStrategy: 500;
  };
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
  equilibriumOpponentAcquisitions: Array<{ cardId: string; copiesPerPlayerSide: number }>;
  equilibriumOpponentFamilyDamage: Array<{ family: RustDamageFamily; damagePerPlayerSide: number; share: number }>;
}

export interface RustArchetypeBalanceRow {
  archetype: string;
  strategyIds: string[];
  selectedShare: number;
  minimumFeasibleShare: number;
  maximumFeasibleShare: number;
  rangeWidth: number;
}

export interface RustAuditStrategyTelemetry {
  strategyNumber: number;
  offDiagonal: {
    opponentCount: number;
    playerSides: number;
    purchases: Array<{ cardId: string; copies: number }>;
    familyDamage: Array<{ family: RustDamageFamily; damage: number }>;
  };
  diagonal: {
    playerSides: 500;
    firstPlayerSides: 250;
    secondPlayerSides: 250;
    purchases: Array<{ cardId: string; copies: number }>;
    familyDamage: Array<{ family: RustDamageFamily; damage: number }>;
  };
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
  telemetryBasis: typeof TELEMETRY_BASIS;
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
    equilibriumAcquisitionRate: number;
    equilibriumSelectionRate: number;
    equilibriumMeanOwnedCopies: number;
    expectedAcquiredCopiesPerPlayerSide: number;
    evidenceBasis: typeof TELEMETRY_BASIS;
  }>;
  familyDamage: Array<{
    family: RustDamageFamily;
    expectedDamagePerPlayerSide: number;
    share: number;
    evidenceBasis: typeof TELEMETRY_BASIS;
  }>;
  auditTelemetry: { basis: typeof AUDIT_BASIS; strategies: RustAuditStrategyTelemetry[] };
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
  telemetryBasis: typeof TELEMETRY_BASIS;
  archetypes: Array<{ archetype: string; selectedShare: number; meanMinimumFeasibleShare: number;
    meanMaximumFeasibleShare: number; selectedKingdomCount: number; materialKingdomCount: number;
    feasibleKingdomCount: number }>;
  supportSize: DistributionSummary;
  effectiveSize: DistributionSummary;
  cards: Array<{ cardId: string; offeredKingdomCount: number; positiveUsageKingdomCount: number;
    meanEquilibriumAcquisitionRate: number; meanEquilibriumSelectionRate: number;
    meanEquilibriumOwnedCopies: number; meanExpectedAcquiredCopiesPerPlayerSide: number }>;
  familyDamage: Array<{ family: RustDamageFamily; meanExpectedDamagePerPlayerSide: number;
    meanKingdomShare: number }>;
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
  equilibriumCardCopiesPerPlayerSide: RustBalanceOutlierEntry[];
  equilibriumFamilyDamagePerPlayerSide: RustBalanceOutlierEntry[];
}

export interface RustBalanceAnalysisV2 {
  schemaVersion: 2;
  protocol: 'rust-strategy-search-balance-v2';
  scope: {
    suiteId: 'balance-smoke-v1';
    sourceSuiteId: 'balance-suite-v4';
    kingdomIds: string[];
    kingdomCount: number;
    payoffSeedCount: 75;
    telemetrySeedCount: 125;
    gamesPerOffDiagonalPair: 250;
    playerSidesPerDiagonalStrategy: 500;
    telemetryPolicy: 'full-ordered-matrix-including-diagonal';
    kingdomWeighting: 'equal';
    evidenceBases: [typeof TELEMETRY_BASIS, 'paired-game-score-only', typeof AUDIT_BASIS];
  };
  evidenceLimits: RustBalanceEvidenceLimits;
  provenance: RustStrategySearchSourceProvenanceV2;
  kingdoms: RustKingdomBalanceAnalysis[];
  crossKingdom: RustCrossKingdomBalanceAnalysis;
  outliers: RustBalanceOutliers;
}

export const RUST_BALANCE_EVIDENCE_LIMITS: RustBalanceEvidenceLimits = Object.freeze({
  matrixDiagonal: { payoff: 'fixed-50-percent', sameStrategyTelemetry: 'available-separate-from-payoff',
    playerSidesPerStrategy: 500 },
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
function countStarting(strategy: { startingBuild: readonly string[] }, cardId: string): number {
  return strategy.startingBuild.filter((id) => id === cardId).length;
}

function buildKingdom(evidence: RustStrategySearchKingdomEvidence): RustKingdomBalanceAnalysis {
  const numbers = evidence.matrix.strategyNumbers, ids = numbers.map((number) => `gf-${number}`);
  const payoff = evidence.matrix.percentages.map((row) => row.map((value) => (value - 50) / 50));
  const weights = Object.fromEntries(ids.map((id, index) => [id, evidence.matrix.weights[index]!]));
  const records = recordByStrategy(evidence);
  const purchaseByCell = new Map(evidence.purchases.map((row) => [`${row.strategyNumber}:${row.opponentNumber}`, row]));
  const diagonal = new Map(evidence.selfPlay.map((row) => [row.strategyNumber, row]));
  if (evidence.selfPlay.length !== numbers.length || diagonal.size !== numbers.length) {
    throw new Error(`${evidence.kingdomId}: same-strategy telemetry does not cover the final Matrix.`);
  }

  const acquisitionCells: Record<string, Record<string, Record<string, number>>> = {};
  const damageCells: Record<string, Record<string, Record<string, number>>> = {};
  for (const [actingIndex, actingNumber] of numbers.entries()) {
    const actingId = ids[actingIndex]!;
    acquisitionCells[actingId] = {}; damageCells[actingId] = {};
    for (const [opponentIndex, opponentNumber] of numbers.entries()) {
      const opponentId = ids[opponentIndex]!;
      if (actingNumber === opponentNumber) {
        const row = diagonal.get(actingNumber)!;
        acquisitionCells[actingId]![opponentId] = Object.fromEntries(evidence.cardIds.map((cardId) => [cardId,
          ((row.firstPlayer.purchases[cardId] ?? 0) + (row.secondPlayer.purchases[cardId] ?? 0)) / 500]));
        damageCells[actingId]![opponentId] = Object.fromEntries(RUST_DAMAGE_FAMILIES.map((family) => [family,
          (row.firstPlayer.familyDamage[family] + row.secondPlayer.familyDamage[family]) / 500]));
      } else {
        const row = purchaseByCell.get(`${actingNumber}:${opponentNumber}`);
        if (!row) throw new Error(`${evidence.kingdomId}: missing telemetry cell ${actingNumber},${opponentNumber}.`);
        acquisitionCells[actingId]![opponentId] = Object.fromEntries(evidence.cardIds.map((cardId) =>
          [cardId, (row.purchases[cardId] ?? 0) / row.playerGames]));
        damageCells[actingId]![opponentId] = Object.fromEntries(RUST_DAMAGE_FAMILIES.map((family) =>
          [family, row.familyDamage[family] / row.playerGames]));
      }
    }
  }
  const acquisitions = summarizeEquilibriumWeightedCells({ strategyIds: ids, weights, cells: acquisitionCells });
  const damage = summarizeEquilibriumWeightedCells({ strategyIds: ids, weights, cells: damageCells });

  const archetypeById = new Map(ids.map((id, index) => {
    const record = records.get(numbers[index]!);
    if (!record) throw new Error(`${evidence.kingdomId}: missing final strategy ${numbers[index]}.`);
    return [id, classifyStrategyDamage({ startingBuild: record.strategy.startingBuild,
      acquisitionRates: acquisitions.byActingStrategy[id] ?? {} })];
  }));
  const strategies: RustStrategyBalanceRow[] = numbers.map((number, index) => {
    const id = ids[index]!, record = records.get(number)!;
    const selectedWeight = evidence.matrix.weights[index]!;
    const selectedLotteryScorePercent = sum(evidence.matrix.percentages[index]!
      .map((value, column) => value * evidence.matrix.weights[column]!));
    const familyRates = damage.byActingStrategy[id] ?? {};
    const familyTotal = sum(RUST_DAMAGE_FAMILIES.map((family) => familyRates[family] ?? 0));
    return { strategyNumber: number, strategyId: id, goldfishRank: record.rank,
      selectedWeight, supportMember: selectedWeight > SUPPORT_TOLERANCE, selectedLotteryScorePercent,
      feasibleWeightRange: equilibriumGroupWeightRange(ids, payoff, 0, [id]), archetype: archetypeById.get(id)!,
      startingBuild: [...record.strategy.startingBuild], buySteps: record.strategy.buyPlan.flatMap((slot) => slot.kind === 'buy'
        ? [{ cardId: slot.cardId, desiredCount: slot.desiredCount }] : []),
      equilibriumOpponentAcquisitions: evidence.cardIds.map((cardId) => ({ cardId,
        copiesPerPlayerSide: acquisitions.byActingStrategy[id]?.[cardId] ?? 0 })),
      equilibriumOpponentFamilyDamage: RUST_DAMAGE_FAMILIES.map((family) => ({ family,
        damagePerPlayerSide: familyRates[family] ?? 0,
        share: familyTotal ? (familyRates[family] ?? 0) / familyTotal : 0 })) };
  });
  const archetypeNames = [...new Set(strategies.map((row) => row.archetype))].sort();
  const archetypes = archetypeNames.map((archetype): RustArchetypeBalanceRow => {
    const strategyIds = ids.filter((id) => archetypeById.get(id) === archetype);
    const selectedShare = sum(strategyIds.map((id) => weights[id] ?? 0));
    const range = equilibriumGroupWeightRange(ids, payoff, 0, strategyIds);
    return { archetype, strategyIds, selectedShare, minimumFeasibleShare: range.minimum,
      maximumFeasibleShare: range.maximum, rangeWidth: range.maximum - range.minimum };
  });
  if (Math.abs(sum(archetypes.map((row) => row.selectedShare)) - 1) > 1e-7
    || strategies.some((row) => row.selectedWeight < row.feasibleWeightRange.minimum - 1e-7
      || row.selectedWeight > row.feasibleWeightRange.maximum + 1e-7)
    || archetypes.some((row) => row.selectedShare < row.minimumFeasibleShare - 1e-7
      || row.selectedShare > row.maximumFeasibleShare + 1e-7)) {
    throw new Error(`${evidence.kingdomId}: selected witness lies outside a feasible range.`);
  }

  const pairs = evidence.pairs.map((pair) => {
    const counts = byteCounts(pair);
    return { firstStrategyNumber: pair.firstStrategyNumber, secondStrategyNumber: pair.secondStrategyNumber,
      percent75: sum(pair.points.slice(0, 75)) / 3, percent125: sum(pair.points) / (125 * 4) * 100, byteCounts: counts };
  });
  const totalByteCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const pair of pairs) addCounts(totalByteCounts, pair.byteCounts);

  const cards = evidence.cardIds.map((cardId) => {
    const equilibriumAcquisitionRate = sum(strategies.map((strategy) => strategy.selectedWeight
      * Number((acquisitions.byActingStrategy[strategy.strategyId]?.[cardId] ?? 0) > 0)));
    const equilibriumSelectionRate = sum(strategies.map((strategy) => strategy.selectedWeight
      * Number(countStarting(strategy, cardId) > 0
        || (acquisitions.byActingStrategy[strategy.strategyId]?.[cardId] ?? 0) > 0)));
    const equilibriumMeanOwnedCopies = sum(strategies.map((strategy) => strategy.selectedWeight
      * (countStarting(strategy, cardId) + (acquisitions.byActingStrategy[strategy.strategyId]?.[cardId] ?? 0))));
    return { cardId, equilibriumAcquisitionRate, equilibriumSelectionRate, equilibriumMeanOwnedCopies,
      expectedAcquiredCopiesPerPlayerSide: acquisitions.expected[cardId] ?? 0, evidenceBasis: TELEMETRY_BASIS };
  });
  const expectedDamageTotal = sum(RUST_DAMAGE_FAMILIES.map((family) => damage.expected[family] ?? 0));
  const familyDamage = RUST_DAMAGE_FAMILIES.map((family) => ({ family,
    expectedDamagePerPlayerSide: damage.expected[family] ?? 0,
    share: expectedDamageTotal ? (damage.expected[family] ?? 0) / expectedDamageTotal : 0,
    evidenceBasis: TELEMETRY_BASIS }));

  const auditStrategies = numbers.map((number): RustAuditStrategyTelemetry => {
    const offDiagonal = evidence.purchases.filter((row) => row.strategyNumber === number);
    const self = diagonal.get(number)!;
    return { strategyNumber: number, offDiagonal: { opponentCount: offDiagonal.length,
      playerSides: sum(offDiagonal.map((row) => row.playerGames)),
      purchases: evidence.cardIds.map((cardId) => ({ cardId,
        copies: sum(offDiagonal.map((row) => row.purchases[cardId] ?? 0)) })),
      familyDamage: RUST_DAMAGE_FAMILIES.map((family) => ({ family,
        damage: sum(offDiagonal.map((row) => row.familyDamage[family])) })) },
    diagonal: { playerSides: 500, firstPlayerSides: 250, secondPlayerSides: 250,
      purchases: evidence.cardIds.map((cardId) => ({ cardId,
        copies: (self.firstPlayer.purchases[cardId] ?? 0) + (self.secondPlayer.purchases[cardId] ?? 0) })),
      familyDamage: RUST_DAMAGE_FAMILIES.map((family) => ({ family,
        damage: self.firstPlayer.familyDamage[family] + self.secondPlayer.familyDamage[family] })) } };
  });
  const maximumAdvantage = Math.max(...payoff.map((row) => sum(row.map((value, column) =>
    value * evidence.matrix.weights[column]!))));
  return { kingdom: { id: evidence.kingdomId, name: evidence.kingdomName, startingHealth: evidence.startingHealth,
    offeredCards: evidence.cardIds.map((id) => { const card = cardDefinition(id); return { id, name: card.name,
      cost: card.cost, family: card.family, mechanic: card.mechanic }; }) },
  completion: { nativeVerified: true, searches: evidence.completion.searchCount, admissions: evidence.completion.admissionCount,
    matrixGeneration: evidence.completion.matrixGeneration, cleanSearches: 2,
    finalMatrixSource: evidence.finalMatrixSource, finalStrategyCount: numbers.length },
  equilibrium: { selectedWitness: numbers.map((number, index) => ({ strategyNumber: number,
    strategyId: ids[index]!, weight: evidence.matrix.weights[index]! })),
    supportSize: strategies.filter((row) => row.supportMember).length,
    effectiveSize: 1 / sum(evidence.matrix.weights.map((weight) => weight * weight)), maximumAdvantage },
  telemetryBasis: TELEMETRY_BASIS, strategies, archetypes,
  pairedScoreEvidence: { payoffSeedCount: 75, telemetrySeedCount: 125,
    percentages75: evidence.matrix.percentages.map((row) => [...row]), byteCounts: totalByteCounts,
    byteTwoShare: totalByteCounts[2] / sum(totalByteCounts), pairs }, cards, familyDamage,
  auditTelemetry: { basis: AUDIT_BASIS, strategies: auditStrategies },
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
      return row ? [row] : []; });
    return { cardId, offeredKingdomCount: rows.length,
      positiveUsageKingdomCount: rows.filter((row) => row.expectedAcquiredCopiesPerPlayerSide > 0).length,
      meanEquilibriumAcquisitionRate: mean(rows.map((row) => row.equilibriumAcquisitionRate)),
      meanEquilibriumSelectionRate: mean(rows.map((row) => row.equilibriumSelectionRate)),
      meanEquilibriumOwnedCopies: mean(rows.map((row) => row.equilibriumMeanOwnedCopies)),
      meanExpectedAcquiredCopiesPerPlayerSide: mean(rows.map((row) => row.expectedAcquiredCopiesPerPlayerSide)) };
  });
  const familyDamage = RUST_DAMAGE_FAMILIES.map((family) => {
    const rows = kingdoms.map((kingdom) => kingdom.familyDamage.find((row) => row.family === family)!);
    return { family, meanExpectedDamagePerPlayerSide: mean(rows.map((row) => row.expectedDamagePerPlayerSide)),
      meanKingdomShare: mean(rows.map((row) => row.share)) };
  });
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const kingdom of kingdoms) addCounts(counts, kingdom.pairedScoreEvidence.byteCounts);
  return { telemetryBasis: TELEMETRY_BASIS, archetypes,
    supportSize: distribution(kingdoms, (kingdom) => kingdom.equilibrium.supportSize),
    effectiveSize: distribution(kingdoms, (kingdom) => kingdom.equilibrium.effectiveSize), cards, familyDamage,
    pairedScoreEvidence: { byteCounts: counts, byteTwoShare: counts[2] / sum(counts),
      maximumAbsoluteSkew75: Math.max(...kingdoms.flatMap((kingdom) => kingdom.pairedScoreEvidence.pairs
        .map((pair) => Math.abs(pair.percent75 - 50)))),
      maximumAbsoluteSkew125: Math.max(...kingdoms.flatMap((kingdom) => kingdom.pairedScoreEvidence.pairs
        .map((pair) => Math.abs(pair.percent125 - 50)))) } };
}

function outliers(kingdoms: readonly RustKingdomBalanceAnalysis[]): RustBalanceOutliers {
  const pairs = kingdoms.flatMap((kingdom) => kingdom.pairedScoreEvidence.pairs.map((pair) => ({
    kingdomId: kingdom.kingdom.id, strategyNumber: pair.firstStrategyNumber,
    opponentNumber: pair.secondStrategyNumber, pair })));
  const archetypeRangeWidth = kingdoms.flatMap((kingdom) => kingdom.archetypes.map((row) => ({
    kingdomId: kingdom.kingdom.id, archetype: row.archetype, metric: row.rangeWidth
  }))).sort((left, right) => right.metric - left.metric || compareUtf16(left.kingdomId, right.kingdomId)
    || compareUtf16(left.archetype, right.archetype)).slice(0, 10);
  const effective = kingdoms.map((kingdom) => ({ kingdomId: kingdom.kingdom.id, metric: kingdom.equilibrium.effectiveSize }));
  const cardRows = kingdoms.flatMap((kingdom) => kingdom.cards.map((card) => ({ kingdomId: kingdom.kingdom.id,
    cardId: card.cardId, metric: card.expectedAcquiredCopiesPerPlayerSide })));
  const familyRows = kingdoms.flatMap((kingdom) => kingdom.familyDamage.map((row) => ({ kingdomId: kingdom.kingdom.id,
    family: row.family, metric: row.expectedDamagePerPlayerSide })));
  return { evidenceBasis: 'deterministic-ranked-review-queues',
    pairScoreSkew125: top(pairs.map((row) => ({ kingdomId: row.kingdomId, strategyNumber: row.strategyNumber,
      opponentNumber: row.opponentNumber, metric: Math.abs(row.pair.percent125 - 50) }))),
    pairScoreSkew75: top(pairs.map((row) => ({ kingdomId: row.kingdomId, strategyNumber: row.strategyNumber,
      opponentNumber: row.opponentNumber, metric: Math.abs(row.pair.percent75 - 50) }))),
    archetypeRangeWidth, lowestEffectiveSize: top(effective, 'low'), highestEffectiveSize: top(effective),
    pointByteTwoShare: top(kingdoms.map((kingdom) => ({ kingdomId: kingdom.kingdom.id,
      metric: kingdom.pairedScoreEvidence.byteTwoShare }))),
    equilibriumCardCopiesPerPlayerSide: top(cardRows), equilibriumFamilyDamagePerPlayerSide: top(familyRows) };
}

function finite(value: unknown, heldPath = 'analysis'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${heldPath} contains a non-finite number.`);
  if (Array.isArray(value)) value.forEach((entry, index) => finite(entry, `${heldPath}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) finite(entry, `${heldPath}.${key}`);
}

export function buildRustBalanceAnalysis(evidence: readonly RustStrategySearchKingdomEvidence[],
  provenance: RustStrategySearchSourceProvenanceV2): RustBalanceAnalysisV2 {
  if (!evidence.length || evidence.length !== provenance.kingdomIds.length
    || evidence.some((row, index) => row.kingdomId !== provenance.kingdomIds[index])
    || new Set(provenance.kingdomIds).size !== provenance.kingdomIds.length) {
    throw new Error('Analysis evidence order differs from provenance.');
  }
  const kingdoms = evidence.map(buildKingdom);
  const analysis: RustBalanceAnalysisV2 = { schemaVersion: 2, protocol: RUST_BALANCE_ANALYSIS_PROTOCOL,
    scope: { suiteId: 'balance-smoke-v1', sourceSuiteId: 'balance-suite-v4', kingdomIds: [...provenance.kingdomIds],
      kingdomCount: kingdoms.length, payoffSeedCount: 75, telemetrySeedCount: 125,
      gamesPerOffDiagonalPair: 250, playerSidesPerDiagonalStrategy: 500,
      telemetryPolicy: 'full-ordered-matrix-including-diagonal', kingdomWeighting: 'equal',
      evidenceBases: [TELEMETRY_BASIS, 'paired-game-score-only', AUDIT_BASIS] },
    evidenceLimits: RUST_BALANCE_EVIDENCE_LIMITS, provenance, kingdoms,
    crossKingdom: crossKingdom(kingdoms), outliers: outliers(kingdoms) };
  finite(analysis);
  return analysis;
}

export function stringifyRustBalanceAnalysis(analysis: RustBalanceAnalysisV2): string {
  finite(analysis);
  return `${JSON.stringify(analysis, null, 2)}\n`;
}
