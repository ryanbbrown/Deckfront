import { cardDefinition } from '../game';
import { equilibriumGroupWeightRange } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { damageFamily, classifyStrategyDamage, DAMAGE_FAMILIES } from './strategyDamage';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { TelemetryAggregate } from './types';
import { compareUtf16 } from './utf16';

export interface ProductBlockEvidence {
  seed: number;
  opponentId: string;
  score: number;
  matches: 4;
  telemetry: TelemetryAggregate;
}

export interface FullCandidateEvidence {
  strategy: Strategy;
  blocks: ProductBlockEvidence[];
  candidateTelemetryId?: string;
}

function validCounts(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && Object.values(value).every((count) =>
    Number.isSafeInteger(count) && count >= 0);
}

export function validateTelemetryAggregate(telemetry: unknown, expectedMatches: number): telemetry is TelemetryAggregate {
  try {
    if (!telemetry || typeof telemetry !== 'object' || !Number.isSafeInteger(expectedMatches)
      || expectedMatches < 4 || expectedMatches % 4) return false;
    const held = telemetry as TelemetryAggregate;
    if (!validCounts(held.damageByCard) || !validCounts(held.playsByCard)
      || !validCounts(held.deadDraws) || held.deadDraws.range + held.deadDraws.mana > held.deadDraws.total
      || !Number.isSafeInteger(held.turnsToWin?.total) || held.turnsToWin.total < 0
      || !Number.isSafeInteger(held.turnsToWin?.count) || held.turnsToWin.count < 0
      || held.turnsToWin.count > expectedMatches || !held.planPositionPurchasesByStrategy) return false;
    for (const group of [held.acquisitionsByStrategy, held.planPositionPurchasesByStrategy]) {
      if (!group || typeof group !== 'object' || Object.values(group).some((counts) => !validCounts(counts))) return false;
    }
    let played = 0;
    for (const first of ['firstOchre', 'firstIndigo'] as const) for (const side of ['normal', 'swapped'] as const) {
      const record = held.byOrientation?.[first]?.[side];
      if (!record || !Object.values(record).every((count) => Number.isSafeInteger(count) && count >= 0)
        || record.wins + record.draws + record.losses !== record.played || record.aborted !== 0
        || record.played !== expectedMatches / 4) return false;
      played += record.played;
    }
    return played === expectedMatches;
  } catch { return false; }
}

export function validateProductBlockEvidence(block: unknown, expected?: {
  seed: number; opponentId: string; candidateTelemetryId: string;
}): block is ProductBlockEvidence {
  try {
    if (!block || typeof block !== 'object') return false;
    const held = block as ProductBlockEvidence;
    if (!Number.isSafeInteger(held.seed) || held.matches !== 4 || !Number.isFinite(held.score)
      || held.score < 0 || held.score > 1 || !held.opponentId
      || !validateTelemetryAggregate(held.telemetry, 4)
      || (expected && (held.seed !== expected.seed || held.opponentId !== expected.opponentId))) return false;
    return !expected || !!held.telemetry.acquisitionsByStrategy[expected.candidateTelemetryId];
  } catch { return false; }
}

export function validateFullCandidateEvidence(evidence: unknown, expected?: {
  strategy: Strategy; blocks: readonly { seed: number; opponentId: string }[];
}): evidence is FullCandidateEvidence {
  try {
    if (!evidence || typeof evidence !== 'object') return false;
    const held = evidence as FullCandidateEvidence;
    if (!held.strategy || !Array.isArray(held.blocks) || !held.blocks.length
      || (expected && (canonicalStrategy(held.strategy) !== canonicalStrategy(expected.strategy)
        || held.strategy.id !== expected.strategy.id || held.blocks.length !== expected.blocks.length))) return false;
    const candidateTelemetryId = held.candidateTelemetryId ?? held.strategy.id;
    return held.blocks.every((block, index) => validateProductBlockEvidence(block, expected
      ? { ...expected.blocks[index]!, candidateTelemetryId } : undefined));
  } catch { return false; }
}

function normalizedStrategyTelemetry(
  telemetry: TelemetryAggregate, candidateId: string, opponentId: string
): unknown {
  const rename = (source: Readonly<Record<string, Record<string, number>>> | undefined) => {
    const result: Record<string, Record<string, number>> = {};
    if (source?.[candidateId]) result.candidate = source[candidateId]!;
    if (opponentId !== candidateId && source?.[opponentId]) result.opponent = source[opponentId]!;
    return result;
  };
  return {
    acquisitions: rename(telemetry.acquisitionsByStrategy),
    planPositions: rename(telemetry.planPositionPurchasesByStrategy),
    damageByCard: telemetry.damageByCard, playsByCard: telemetry.playsByCard,
    deadDraws: telemetry.deadDraws, turnsToWin: telemetry.turnsToWin,
    byOrientation: telemetry.byOrientation
  };
}

export function completeAcquisitionEvidenceKey(evidence: FullCandidateEvidence): string {
  const telemetryId = evidence.candidateTelemetryId ?? evidence.strategy.id;
  if (!evidence.blocks.length || evidence.blocks.some((block) => block.matches !== 4
    || block.score < 0 || block.score > 1 || !block.telemetry.planPositionPurchasesByStrategy
    || !block.telemetry.acquisitionsByStrategy[telemetryId])) {
    throw new Error('Complete acquisition evidence is missing product telemetry.');
  }
  return stableHash(JSON.stringify({
    startingBuild: evidence.strategy.startingBuild,
    blocks: evidence.blocks.map((block) => ({ seed: block.seed, opponentId: block.opponentId,
      score: block.score, telemetry: normalizedStrategyTelemetry(block.telemetry,
        telemetryId, block.opponentId) }))
  }));
}

export interface AcquisitionEquivalentClass {
  evidenceKey: string;
  representativeId: string;
  memberIds: string[];
  shadowIds: string[];
}

export function acquisitionEquivalentClasses(
  evidence: readonly FullCandidateEvidence[]
): AcquisitionEquivalentClass[] {
  const byId = new Map(evidence.map((entry) => [entry.strategy.id, entry]));
  if (byId.size !== evidence.length) throw new Error('Acquisition equivalence needs unique candidates.');
  const groups = new Map<string, string[]>();
  for (const entry of evidence) {
    const key = completeAcquisitionEvidenceKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry.strategy.id]);
  }
  return [...groups].map(([evidenceKey, ids]) => {
    const memberIds = ids.sort(compareUtf16), representativeId = memberIds[0]!;
    return { evidenceKey, representativeId, memberIds, shadowIds: memberIds.slice(1) };
  }).sort((left, right) => compareUtf16(left.representativeId, right.representativeId));
}

export interface StratifiedOpponentBlock { seed: number; opponentId: string }
export interface StratifiedOpponentSchedule {
  weights: Record<string, number>;
  blocks: StratifiedOpponentBlock[];
  counts: Record<string, number>;
}

function seededOrder(seed: number, id: string): string { return stableHash(`${seed}:${id}`); }

export function stratifiedOpponentSchedule(
  inputWeights: Readonly<Record<string, number>>, seeds: readonly number[], minimumPerOpponent = 25
): StratifiedOpponentSchedule {
  const entries = Object.entries(inputWeights).filter(([, weight]) => Number.isFinite(weight) && weight >= 0)
    .sort(([left], [right]) => compareUtf16(left, right));
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!entries.length || !(total > 0) || !seeds.length || new Set(seeds).size !== seeds.length
    || minimumPerOpponent < 1 || entries.length * minimumPerOpponent > seeds.length) {
    throw new Error('Stratified opponent schedule input is invalid.');
  }
  const remaining = seeds.length - entries.length * minimumPerOpponent;
  const raw = entries.map(([id, weight]) => ({ id, weight: weight / total,
    floor: Math.floor(remaining * weight / total), remainder: remaining * weight / total % 1 }));
  let assigned = raw.reduce((sum, entry) => sum + entry.floor, 0);
  const tieSeed = seeds[0]!;
  for (const entry of [...raw].sort((a, b) => b.remainder - a.remainder
    || seededOrder(tieSeed, a.id).localeCompare(seededOrder(tieSeed, b.id)))) {
    if (assigned >= remaining) break;
    entry.floor += 1; assigned += 1;
  }
  const ids = raw.flatMap((entry) => Array.from({ length: minimumPerOpponent + entry.floor },
    (_unused, occurrence) => ({ id: entry.id, order: stableHash(`${tieSeed}:${entry.id}:${occurrence}`) })))
    .sort((left, right) => left.order.localeCompare(right.order) || compareUtf16(left.id, right.id))
    .map((entry) => entry.id);
  const counts = Object.fromEntries(entries.map(([id]) => [id, ids.filter((held) => held === id).length]));
  return { weights: Object.fromEntries(entries.map(([id, weight]) => [id, weight / total])),
    blocks: seeds.map((seed, index) => ({ seed, opponentId: ids[index]! })), counts };
}

function acquisitionsFor(block: ProductBlockEvidence, strategyId: string): { counts: Record<string, number>; games: number } {
  const counts = block.telemetry.acquisitionsByStrategy[strategyId] ?? {};
  const self = strategyId === block.opponentId;
  return { counts, games: block.matches * (self ? 2 : 1) };
}

export interface LotteryAcquisitionSummary {
  strategyAcquisitionRates: Record<string, Record<string, number>>;
  strategyLabels: Record<string, string>;
  selectedArchetypeShares: Record<string, number>;
  feasibleArchetypeRanges: Record<string, { minimum: number; maximum: number }>;
  expectedCopiesPerPlayerGame: Record<string, number>;
  normalizedActionCardShares: Record<string, number>;
  damageFamilyShares: Record<string, number>;
}

export function summarizeLotteryAcquisitions(input: {
  strategies: readonly Strategy[];
  panels: readonly FullCandidateEvidence[];
  equilibrium: EquilibriumResult;
  centeredPayoffs: readonly (readonly number[])[];
  fallbackAcquisitionRates?: Readonly<Record<string, Record<string, number>>>;
}): LotteryAcquisitionSummary {
  const strategyById = new Map(input.strategies.map((strategy) => [strategy.id, strategy]));
  const panelById = new Map(input.panels.map((panel) => [panel.strategy.id, panel]));
  const positive = input.equilibrium.strategyIds.filter((id) => (input.equilibrium.weights[id] ?? 0) > 1e-8);
  if (panelById.size !== input.panels.length || positive.some((id) => !panelById.has(id) || !strategyById.has(id))) {
    throw new Error('Lottery acquisition panels do not cover the selected support.');
  }
  const strategyAcquisitionRates: Record<string, Record<string, number>> = {
    ...structuredClone(input.fallbackAcquisitionRates ?? {})
  };
  const expected: Record<string, number> = {};
  for (const id of panelById.keys()) {
    const panel = panelById.get(id)!;
    const byOpponent = new Map<string, ProductBlockEvidence[]>();
    for (const block of panel.blocks) byOpponent.set(block.opponentId,
      [...(byOpponent.get(block.opponentId) ?? []), block]);
    const rates: Record<string, number> = {};
    for (const opponentId of positive) {
      const blocks = byOpponent.get(opponentId);
      if (!blocks?.length) throw new Error(`Panel ${id} is missing opponent ${opponentId}.`);
      const totals: Record<string, number> = {}; let games = 0;
      for (const block of blocks) {
        const held = acquisitionsFor(block, id); games += held.games;
        for (const [cardId, amount] of Object.entries(held.counts)) totals[cardId] = (totals[cardId] ?? 0) + amount;
      }
      const opponentWeight = input.equilibrium.weights[opponentId] ?? 0;
      for (const [cardId, amount] of Object.entries(totals)) {
        rates[cardId] = (rates[cardId] ?? 0) + opponentWeight * amount / games;
      }
    }
    strategyAcquisitionRates[id] = rates;
    const rowWeight = input.equilibrium.weights[id] ?? 0;
    for (const [cardId, rate] of Object.entries(rates)) expected[cardId] = (expected[cardId] ?? 0) + rowWeight * rate;
  }
  const strategyLabels = Object.fromEntries(input.strategies.map((strategy) => [strategy.id,
    classifyStrategyDamage({ startingBuild: strategy.startingBuild,
      acquisitionRates: strategyAcquisitionRates[strategy.id] ?? {} })]));
  const labels = [...new Set([...Object.values(strategyLabels), 'Melee', 'Ranged', 'Mage',
    'Melee + Ranged', 'Melee + Mage', 'Ranged + Mage', 'Melee + Ranged + Mage', 'No damage package'])];
  const selectedArchetypeShares: Record<string, number> = {};
  const feasibleArchetypeRanges: Record<string, { minimum: number; maximum: number }> = {};
  for (const label of labels) {
    const ids = input.equilibrium.strategyIds.filter((id) => strategyLabels[id] === label);
    selectedArchetypeShares[label] = ids.reduce((sum, id) => sum + (input.equilibrium.weights[id] ?? 0), 0);
    feasibleArchetypeRanges[label] = equilibriumGroupWeightRange(input.equilibrium.strategyIds,
      input.centeredPayoffs, input.equilibrium.value, ids);
  }
  const actionEntries = Object.entries(expected).filter(([cardId]) => cardDefinition(cardId).type === 'action');
  const totalActions = actionEntries.reduce((sum, [, amount]) => sum + amount, 0);
  const normalizedActionCardShares = Object.fromEntries(actionEntries.map(([id, amount]) =>
    [id, totalActions ? amount / totalActions : 0]));
  const damageTotals = Object.fromEntries(DAMAGE_FAMILIES.map((family) => [family, 0])) as Record<string, number>;
  for (const [cardId, amount] of actionEntries) { const family = damageFamily(cardId); if (family) damageTotals[family] = damageTotals[family]! + amount; }
  const damageTotal = Object.values(damageTotals).reduce((sum, amount) => sum + amount, 0);
  const damageFamilyShares = Object.fromEntries(Object.entries(damageTotals).map(([family, amount]) =>
    [family, damageTotal ? amount / damageTotal : 0]));
  return { strategyAcquisitionRates, strategyLabels, selectedArchetypeShares, feasibleArchetypeRanges,
    expectedCopiesPerPlayerGame: expected, normalizedActionCardShares, damageFamilyShares };
}
