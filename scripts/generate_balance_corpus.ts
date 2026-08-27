import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ALWAYS_AVAILABLE_ACTION_IDS, VARIABLE_ACTION_IDS, cardDefinition } from '../src/game';
import { balanceSuite } from '../src/sim/balanceSuite';
import type { BalanceSuiteManifest, BalanceSuiteSplit } from '../src/sim/balanceSuite';
import { classifyStrategyDamage, damageFamily } from '../src/sim/strategyDamage';
export { classifyStrategyDamage } from '../src/sim/strategyDamage';
import {
  buildBalanceReportModel, family, loadArtifactDirectory, selfPlayFor
} from './generate_balance_report';
import type { CardFamily, KingdomReport } from './generate_balance_report';

type ActionFamily = Exclude<CardFamily, 'Treasure'>;

export interface CorpusSummary {
  label: string;
  kingdoms: number;
  lotteryDistribution: Record<string, number>;
  nearDistribution: Record<string, number>;
  effectiveMinimum: number;
  effectiveMedian: number;
  effectiveMean: number;
  effectiveMaximum: number;
  multipleViableRate: number;
  damageStrategyCounts: Record<string, number>;
  drawRate: number;
  winnerTurnsPerPlayer: number;
  firstPlayerScore: number;
}

export interface CorpusCardMeasure {
  availability: number;
  availableStrategies: number;
  buildPlans: number;
  finitePlans: number;
  infinitePlans: number;
  planStrategies: number;
  acquiredStrategies: number;
  averageCopiesWhenAcquired: number;
  averageMaterialWeight: number;
  familyAcquisitionShare: number;
}

export interface CorpusCardReport {
  cardId: string;
  name: string;
  family: ActionFamily;
  tuning: CorpusCardMeasure;
  validation: CorpusCardMeasure | null;
  combined: CorpusCardMeasure;
}

export interface StrategyGroupCardUse {
  cardId: string;
  name: string;
  family: ActionFamily;
  cost: number;
  effect: string;
  availableStrategies: number;
  acquiredStrategies: number;
  averageCopiesWhenAcquired: number;
  buildPlans: number;
  finitePlans: number;
  infinitePlans: number;
}

export interface StrategyGroupCardPair {
  firstCardId: string;
  secondCardId: string;
  offeredTogether: number;
  acquiredTogether: number;
  firstOnly: number;
  secondOnly: number;
  neither: number;
}

export interface StrategyGroupAvailability {
  cardId: string;
  offeredKingdoms: number;
  offeredWithStrategy: number;
  absentKingdoms: number;
  absentWithStrategy: number;
}

export interface StrategyGroupReport {
  label: string;
  strategies: number;
  share: number;
  cards: StrategyGroupCardUse[];
  pairs: StrategyGroupCardPair[];
  availability: StrategyGroupAvailability[];
}

export interface CorpusKingdomReport extends KingdomReport { split: BalanceSuiteSplit }
export interface SelectedKingdom { reason: string; kingdom: CorpusKingdomReport }
export interface PlayQualityWarning {
  id: string;
  split: BalanceSuiteSplit;
  drawRate: number;
  lotteryStrategies: number;
  nearStrategies: number;
  viableStrategies: number;
  winnerTurnsPerPlayer: number | null;
}
export interface BalanceCorpusModel {
  scope: 'tuning' | 'full';
  manifest: BalanceSuiteManifest;
  summaries: { tuning: CorpusSummary; validation: CorpusSummary | null; combined: CorpusSummary };
  cards: CorpusCardReport[];
  kingdoms: CorpusKingdomReport[];
  selected: SelectedKingdom[];
  playQualityWarnings: PlayQualityWarning[];
}

function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function distribution(values: readonly number[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[String(value)] = (result[String(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => Number(left) - Number(right)));
}

function summarize(label: string, kingdoms: readonly CorpusKingdomReport[]): CorpusSummary {
  if (!kingdoms.length) throw new Error(`Cannot summarize an empty ${label} corpus.`);
  const effective = kingdoms.map((kingdom) => kingdom.effectiveLotterySize);
  const damageStrategyCounts: Record<string, number> = {};
  for (const strategy of kingdoms.flatMap((kingdom) => kingdom.strategies)) {
    const identity = classifyStrategyDamage(strategy);
    damageStrategyCounts[identity] = (damageStrategyCounts[identity] ?? 0) + 1;
  }
  return { label, kingdoms: kingdoms.length,
    lotteryDistribution: distribution(kingdoms.map((kingdom) => kingdom.materialCount)),
    nearDistribution: distribution(kingdoms.map((kingdom) => kingdom.nearCount)),
    effectiveMinimum: Math.min(...effective), effectiveMedian: median(effective),
    effectiveMean: mean(effective), effectiveMaximum: Math.max(...effective),
    multipleViableRate: kingdoms.filter((kingdom) => kingdom.strategies.length >= 2).length / kingdoms.length,
    damageStrategyCounts, drawRate: mean(kingdoms.map((kingdom) => kingdom.lotteryTelemetry.drawRate)),
    winnerTurnsPerPlayer: mean(kingdoms.map((kingdom) => kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0)),
    firstPlayerScore: mean(kingdoms.map((kingdom) => kingdom.lotteryTelemetry.firstPlayerScore)) };
}

function cardMeasure(
  cardId: string, cardFamily: ActionFamily, kingdoms: readonly CorpusKingdomReport[],
  manifest: BalanceSuiteManifest
): CorpusCardMeasure {
  const ids = new Set(kingdoms.map((kingdom) => kingdom.id));
  const definitions = manifest.kingdoms.filter((kingdom) => ids.has(kingdom.id));
  const availableIds = new Set(definitions.filter((kingdom) => ALWAYS_AVAILABLE_ACTION_IDS.includes(cardId)
    || kingdom.actionPiles.some((pile) => pile.cardId === cardId)).map((kingdom) => kingdom.id));
  let availableStrategies = 0, buildPlans = 0, finitePlans = 0, infinitePlans = 0;
  let planStrategies = 0, acquiredStrategies = 0;
  let materialWeight = 0, cardAcquisitions = 0, familyAcquisitions = 0;
  for (const kingdom of kingdoms) for (const strategy of kingdom.strategies) {
    if (availableIds.has(kingdom.id)) availableStrategies += 1;
    const inBuild = strategy.startingBuild.includes(cardId);
    const inFinite = strategy.purchaseSteps.some((step) => step.cardId === cardId);
    const inInfinite = strategy.purchaseSteps.some((step) => step.infinite && step.cardId === cardId);
    if (inBuild) buildPlans += 1;
    if (inFinite) finitePlans += 1;
    if (inInfinite) infinitePlans += 1;
    if (inBuild || inFinite || inInfinite) planStrategies += 1;
    const acquired = strategy.acquisitionRates[cardId] ?? 0;
    if (acquired > 0) acquiredStrategies += 1;
    cardAcquisitions += acquired;
    for (const [acquiredId, rate] of Object.entries(strategy.acquisitionRates)) {
      if (family(acquiredId) === cardFamily) familyAcquisitions += rate;
    }
    if (strategy.status === 'Lottery' && (inBuild || inFinite || inInfinite)) materialWeight += strategy.weight;
  }
  return { availability: availableIds.size, availableStrategies, buildPlans, finitePlans, infinitePlans,
    planStrategies, acquiredStrategies,
    averageCopiesWhenAcquired: acquiredStrategies ? cardAcquisitions / acquiredStrategies : 0,
    averageMaterialWeight: availableIds.size ? materialWeight / availableIds.size : 0,
    familyAcquisitionShare: familyAcquisitions ? cardAcquisitions / familyAcquisitions : 0 };
}

export function selectCorpusKingdoms(kingdoms: readonly CorpusKingdomReport[]): SelectedKingdom[] {
  const ordered = [...kingdoms].sort((left, right) => left.id.localeCompare(right.id));
  const criteria: { reason: string; compare: (left: CorpusKingdomReport, right: CorpusKingdomReport) => number }[] = [
    { reason: 'Lowest effective lottery size', compare: (left, right) => left.effectiveLotterySize - right.effectiveLotterySize },
    { reason: 'Highest effective lottery size', compare: (left, right) => right.effectiveLotterySize - left.effectiveLotterySize },
    { reason: 'Highest ranged-strategy share', compare: (left, right) =>
      right.strategies.filter((strategy) => classifyStrategyDamage(strategy).includes('Ranged')).length / right.strategies.length
      - left.strategies.filter((strategy) => classifyStrategyDamage(strategy).includes('Ranged')).length / left.strategies.length },
    { reason: 'Lowest ranged-strategy share', compare: (left, right) =>
      left.strategies.filter((strategy) => classifyStrategyDamage(strategy).includes('Ranged')).length / left.strategies.length
      - right.strategies.filter((strategy) => classifyStrategyDamage(strategy).includes('Ranged')).length / right.strategies.length },
    { reason: 'Highest draw rate', compare: (left, right) =>
      right.lotteryTelemetry.drawRate - left.lotteryTelemetry.drawRate }
  ];
  const used = new Set<string>();
  return criteria.map((criterion) => {
    const kingdom = [...ordered].sort((left, right) => criterion.compare(left, right) || left.id.localeCompare(right.id))
      .find((entry) => !used.has(entry.id));
    if (!kingdom) throw new Error('The corpus needs at least five kingdoms for detail selection.');
    used.add(kingdom.id); return { reason: criterion.reason, kingdom };
  });
}

export function buildBalanceCorpusModel(
  manifest: BalanceSuiteManifest, kingdoms: readonly CorpusKingdomReport[]
): BalanceCorpusModel {
  const fullExpected = manifest.kingdoms.map((kingdom) => kingdom.id).sort();
  const tuningExpected = manifest.kingdoms.filter((kingdom) => kingdom.split === 'tuning')
    .map((kingdom) => kingdom.id).sort();
  const actual = kingdoms.map((kingdom) => kingdom.id).sort();
  const scope = JSON.stringify(actual) === JSON.stringify(fullExpected) ? 'full'
    : JSON.stringify(actual) === JSON.stringify(tuningExpected) ? 'tuning' : null;
  if (!scope) throw new Error('Corpus reports do not match the full manifest or its tuning split.');
  const tuning = kingdoms.filter((kingdom) => kingdom.split === 'tuning');
  const validation = kingdoms.filter((kingdom) => kingdom.split === 'validation');
  const tuningSize = manifest.splits.find((split) => split.name === 'tuning')!.size;
  const validationSize = manifest.splits.find((split) => split.name === 'validation')!.size;
  if (tuning.length !== tuningSize || (scope === 'full' && validation.length !== validationSize)) {
    throw new Error('Corpus reports do not preserve the manifest split.');
  }
  const availableCards = [...ALWAYS_AVAILABLE_ACTION_IDS, ...manifest.cardPool.orderedVariableCardIds];
  const cards = availableCards.map((cardId): CorpusCardReport => {
    const cardFamily = family(cardId);
    if (cardFamily === 'Treasure') throw new Error(`Corpus action-card table cannot include ${cardId}.`);
    return { cardId, name: cardDefinition(cardId).name, family: cardFamily,
      tuning: cardMeasure(cardId, cardFamily, tuning, manifest),
      validation: validation.length ? cardMeasure(cardId, cardFamily, validation, manifest) : null,
      combined: cardMeasure(cardId, cardFamily, kingdoms, manifest) };
  }).sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name));
  const playQualityWarnings = kingdoms.filter((kingdom) => kingdom.lotteryTelemetry.drawRate >= 0.5)
    .sort((left, right) => left.id.localeCompare(right.id)).map((kingdom): PlayQualityWarning => ({
      id: kingdom.id, split: kingdom.split, drawRate: kingdom.lotteryTelemetry.drawRate,
      lotteryStrategies: kingdom.materialCount, nearStrategies: kingdom.nearCount,
      viableStrategies: kingdom.strategies.length,
      winnerTurnsPerPlayer: kingdom.lotteryTelemetry.winnerTurnsPerPlayer
    }));
  return { scope, manifest,
    summaries: { tuning: summarize('Tuning', tuning),
      validation: validation.length ? summarize('Validation', validation) : null,
      combined: summarize('Combined', kingdoms) },
    cards, kingdoms: [...kingdoms], selected: selectCorpusKingdoms(kingdoms), playQualityWarnings };
}

export function buildStrategyGroups(model: BalanceCorpusModel): StrategyGroupReport[] {
  const entries = model.kingdoms.flatMap((kingdom) => kingdom.strategies.map((strategy) => ({ kingdom, strategy })));
  const labels = new Map<string, typeof entries>();
  for (const entry of entries) {
    const label = classifyStrategyDamage(entry.strategy);
    const group = labels.get(label) ?? [];
    group.push(entry);
    labels.set(label, group);
  }
  const marketByKingdom = new Map(model.manifest.kingdoms.map((kingdom) => [kingdom.id,
    new Set([...ALWAYS_AVAILABLE_ACTION_IDS, ...kingdom.actionPiles.map((pile) => pile.cardId)])]));
  const cardIds = [...ALWAYS_AVAILABLE_ACTION_IDS, ...model.manifest.cardPool.orderedVariableCardIds];
  return [...labels.entries()].map(([label, group]): StrategyGroupReport => {
    const cards = cardIds.map((cardId): StrategyGroupCardUse => {
      let availableStrategies = 0, acquiredStrategies = 0, acquisitions = 0;
      let buildPlans = 0, finitePlans = 0, infinitePlans = 0;
      for (const { kingdom, strategy } of group) {
        if (marketByKingdom.get(kingdom.id)?.has(cardId)) availableStrategies += 1;
        const acquired = strategy.acquisitionRates[cardId] ?? 0;
        if (acquired > 0) acquiredStrategies += 1;
        acquisitions += acquired;
        if (strategy.startingBuild.includes(cardId)) buildPlans += 1;
        if (strategy.purchaseSteps.some((step) => step.cardId === cardId)) finitePlans += 1;
        if (strategy.purchaseSteps.some((step) => step.infinite && step.cardId === cardId)) infinitePlans += 1;
      }
      const definition = cardDefinition(cardId);
      const cardFamily = family(cardId);
      if (cardFamily === 'Treasure') throw new Error(`Strategy group cannot include treasure ${cardId}.`);
      return { cardId, name: definition.name, family: cardFamily, cost: definition.cost, effect: definition.text,
        availableStrategies, acquiredStrategies,
        averageCopiesWhenAcquired: acquiredStrategies ? acquisitions / acquiredStrategies : 0,
        buildPlans, finitePlans, infinitePlans };
    }).filter((card) => card.acquiredStrategies + card.buildPlans + card.finitePlans + card.infinitePlans > 0)
      .sort((left, right) => {
        const leftRate = left.availableStrategies ? left.acquiredStrategies / left.availableStrategies : 0;
        const rightRate = right.availableStrategies ? right.acquiredStrategies / right.availableStrategies : 0;
        return rightRate - leftRate || right.acquiredStrategies - left.acquiredStrategies
          || left.name.localeCompare(right.name);
      });
    const definingFamilies = new Set(label.split(' + '));
    const definingCards = cards.filter((card) => definingFamilies.has(card.family));
    const pairs: StrategyGroupCardPair[] = [];
    for (let first = 0; first < definingCards.length; first += 1) {
      for (let second = first + 1; second < definingCards.length; second += 1) {
        const firstCardId = definingCards[first]!.cardId, secondCardId = definingCards[second]!.cardId;
        let offeredTogether = 0, acquiredTogether = 0, firstOnly = 0, secondOnly = 0, neither = 0;
        for (const { kingdom, strategy } of group) {
          const market = marketByKingdom.get(kingdom.id)!;
          if (!market.has(firstCardId) || !market.has(secondCardId)) continue;
          offeredTogether += 1;
          const acquiredFirst = (strategy.acquisitionRates[firstCardId] ?? 0) > 0;
          const acquiredSecond = (strategy.acquisitionRates[secondCardId] ?? 0) > 0;
          if (acquiredFirst && acquiredSecond) acquiredTogether += 1;
          else if (acquiredFirst) firstOnly += 1;
          else if (acquiredSecond) secondOnly += 1;
          else neither += 1;
        }
        if (offeredTogether) pairs.push({ firstCardId, secondCardId, offeredTogether, acquiredTogether,
          firstOnly, secondOnly, neither });
      }
    }
    pairs.sort((left, right) => right.offeredTogether - left.offeredTogether
      || left.firstCardId.localeCompare(right.firstCardId) || left.secondCardId.localeCompare(right.secondCardId));
    const groupKingdoms = new Set(group.map((entry) => entry.kingdom.id));
    const availability = definingCards.map((card): StrategyGroupAvailability => {
      let offeredKingdoms = 0, offeredWithStrategy = 0, absentKingdoms = 0, absentWithStrategy = 0;
      for (const kingdom of model.kingdoms) {
        const offered = marketByKingdom.get(kingdom.id)!.has(card.cardId);
        const hasStrategy = groupKingdoms.has(kingdom.id);
        if (offered) { offeredKingdoms += 1; if (hasStrategy) offeredWithStrategy += 1; }
        else { absentKingdoms += 1; if (hasStrategy) absentWithStrategy += 1; }
      }
      return { cardId: card.cardId, offeredKingdoms, offeredWithStrategy, absentKingdoms, absentWithStrategy };
    });
    return { label, strategies: group.length, share: group.length / entries.length, cards, pairs, availability };
  }).sort((left, right) => right.strategies - left.strategies || left.label.localeCompare(right.label));
}

function escape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function percent(value: number, places = 1): string { return `${(value * 100).toFixed(places)}%`; }
function fixed(value: number, places = 2): string { return value.toFixed(places); }
function integer(value: number): string { return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function table(headers: readonly string[], rows: readonly (readonly string[])[], className = ''): string {
  return `<div class="table-scroll"><table class="${className}"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function formatDistribution(values: Record<string, number>): string {
  return Object.entries(values).map(([count, kingdoms]) => `${count}: ${kingdoms}`).join(' · ');
}
function formatDamageStrategies(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `${label}: ${count} (${percent(count / total)})`).join(' · ');
}
function summaryTable(summaries: readonly CorpusSummary[]): string {
  return table(['Split', 'Kingdoms', 'Lottery count distribution', 'Additional ≥40% distribution',
    'Effective size min / median / mean / max', '2+ at 40%', 'Viable strategies by damage type',
    'Draws', 'Turns/player', 'First-player score'], summaries.map((summary) => [summary.label,
    String(summary.kingdoms), formatDistribution(summary.lotteryDistribution), formatDistribution(summary.nearDistribution),
    `${fixed(summary.effectiveMinimum)} / ${fixed(summary.effectiveMedian)} / ${fixed(summary.effectiveMean)} / ${fixed(summary.effectiveMaximum)}`,
    percent(summary.multipleViableRate), formatDamageStrategies(summary.damageStrategyCounts), percent(summary.drawRate),
    fixed(summary.winnerTurnsPerPlayer), percent(summary.firstPlayerScore)]));
}
function strategySplit(summary: CorpusSummary): string {
  const total = Object.values(summary.damageStrategyCounts).reduce((sum, count) => sum + count, 0);
  const rows = Object.entries(summary.damageStrategyCounts).sort(([, left], [, right]) => right - left)
    .map(([label, count]) => [escape(label), integer(count), percent(count / total)]);
  return table(['Strategy type', 'Viable strategies', 'Share'], rows);
}
function strategyGroupCardTable(cards: readonly StrategyGroupCardUse[]): string {
  return table(['Card', 'Cost and effect', 'Used when offered', 'Copies when used'], cards.map((card) => [escape(card.name),
    `${card.cost} coins · ${escape(card.effect)}`,
    `<strong>${percent(card.availableStrategies ? card.acquiredStrategies / card.availableStrategies : 0)}</strong><br>${integer(card.acquiredStrategies)} of ${integer(card.availableStrategies)} eligible strategies`,
    fixed(card.averageCopiesWhenAcquired)]), 'card-use');
}
function strategyGroupPairTable(group: StrategyGroupReport): string {
  return table(['Cards offered together', 'Eligible strategies', 'Used both', 'Used only first',
    'Used only second', 'Used neither'], group.pairs.map((pair) => {
    const first = cardDefinition(pair.firstCardId).name, second = cardDefinition(pair.secondCardId).name;
    const result = (count: number) => `${percent(count / pair.offeredTogether)} (${integer(count)})`;
    return [`${escape(first)} + ${escape(second)}`, integer(pair.offeredTogether), result(pair.acquiredTogether),
      result(pair.firstOnly), result(pair.secondOnly), result(pair.neither)];
  }), 'pair-use');
}
function strategyGroupAvailabilityTable(group: StrategyGroupReport): string {
  return table(['Card', 'Kingdoms that offered it', 'Kingdoms without it'], group.availability.map((entry) => {
    const rate = (count: number, total: number) => total
      ? `<strong>${percent(count / total)}</strong><br>${integer(count)} of ${integer(total)} had ${escape(group.label)} strategies`
      : 'Always offered';
    return [escape(cardDefinition(entry.cardId).name), rate(entry.offeredWithStrategy, entry.offeredKingdoms),
      rate(entry.absentWithStrategy, entry.absentKingdoms)];
  }), 'availability-use');
}
function strategyGroupSections(model: BalanceCorpusModel): string {
  return buildStrategyGroups(model).map((group) => {
    const damageFamilies = new Set(group.label.split(' + '));
    const damageCards = group.cards.filter((card) => damageFamilies.has(card.family));
    const otherDamageCards = group.cards.filter((card) => !damageFamilies.has(card.family)
      && damageFamily(card.cardId));
    const supportCards = group.cards.filter((card) => !damageFamily(card.cardId));
    const common = group.cards.slice(0, 3).map((card) => `<div><strong>${escape(card.name)}</strong><br>${integer(card.acquiredStrategies)} of ${integer(card.availableStrategies)} strategies acquired it when it was available</div>`).join('');
    const definition = group.label === 'No damage package'
      ? 'These strategies did not acquire enough Melee, Ranged, or Mage cards to form a damage package.'
      : `These strategies get their damage from ${escape(group.label)} cards. A damage type appears in the name when it supplies at least 20% of the strategy’s damage-card weight.`;
    return `<section class="strategy-group"><h2>${escape(group.label)} strategies</h2><p class="group-share"><strong>${integer(group.strategies)} strategies · ${percent(group.share)} of all viable strategies</strong></p><p>${definition}</p><div class="callouts">${common}</div>${damageCards.length ? `<h3>Cards that define this strategy type</h3><p>“Used when offered” counts only viable ${escape(group.label)} strategies from kingdoms that included the card. “Copies when used” is the average acquired per game among strategies that acquired at least one copy.</p>${strategyGroupCardTable(damageCards)}` : ''}${group.pairs.length ? `<h3>When defining cards were offered together</h3><p>Every percentage in a row uses the same eligible strategies: ${escape(group.label)} strategies from kingdoms that offered both named cards.</p>${strategyGroupPairTable(group)}` : ''}${group.availability.length ? `<h3>Does this strategy type depend on a card?</h3><p>Each cell counts kingdoms with at least one viable ${escape(group.label)} strategy. Compare the offered and absent columns to see whether the card changes how often this strategy type appears.</p>${strategyGroupAvailabilityTable(group)}` : ''}${otherDamageCards.length ? `<h3>Other damage cards used in smaller amounts</h3>${strategyGroupCardTable(otherDamageCards)}` : ''}${supportCards.length ? `<h3>Movement, drawing, money, and other support</h3>${strategyGroupCardTable(supportCards)}` : ''}</section>`;
  }).join('\n');
}
function strategyKey(index: number): string { return `S${index + 1}`; }
function selectedDetail(selected: SelectedKingdom): string {
  const kingdom = selected.kingdom;
  const maxSteps = Math.max(0, ...kingdom.strategies.map((strategy) => strategy.purchaseSteps.length));
  const planRows = kingdom.strategies.map((strategy, index) => [`<span class="key">${strategyKey(index)}</span><br><code>${strategy.id}</code>`,
    strategy.status, strategy.status === 'Lottery' ? percent(strategy.weight, 2) : '—', percent(strategy.score),
    strategy.startingBuild.map((id) => escape(cardDefinition(id).name)).join(', ') || 'None',
    ...Array.from({ length: maxSteps }, (_, step) => strategy.purchaseSteps[step]
      ? `${escape(cardDefinition(strategy.purchaseSteps[step]!.cardId).name)} ×${strategy.purchaseSteps[step]!.infinite ? '∞' : strategy.purchaseSteps[step]!.remaining}` : '—'),
    classifyStrategyDamage(strategy)]);
  const matchupRows = kingdom.strategies.map((_strategy, row) => [`<span class="key">${strategyKey(row)}</span>`,
    ...kingdom.matchupScores[row]!.map((score, column) => row === column ? '50.0% mirror' : percent(score))]);
  return `<section><h2>${escape(kingdom.name)}</h2><p class="selection">${escape(selected.reason)} · ${kingdom.split} · effective lottery size ${fixed(kingdom.effectiveLotterySize)}</p>
  <h3>Viable strategy plans</h3>${table(['Key', 'Status', 'Lottery weight', 'Score vs lottery', 'Starting build',
    ...Array.from({ length: maxSteps }, (_, index) => `Purchase ${index + 1}`), 'Repeat', 'Damage package'], planRows)}
  <h3>Viable-strategy matchups</h3>${table(['Row', ...kingdom.strategies.map((_entry, index) => strategyKey(index))], matchupRows, 'matrix')}</section>`;
}

export function renderBalanceCorpus(model: BalanceCorpusModel): string {
  const tuningDesign = model.manifest.splits.find((split) => split.name === 'tuning')!.design;
  const validationDesign = model.manifest.splits.find((split) => split.name === 'validation')!.design;
  const unused = model.cards.filter((card) => card.combined.buildPlans + card.combined.finitePlans
    + card.combined.infinitePlans === 0).map((card) => card.name);
  const notAcquired = model.cards.filter((card) => card.combined.acquiredStrategies === 0).map((card) => card.name);
  const kingdomRows = model.kingdoms.map((kingdom) => [escape(kingdom.id), kingdom.split,
    String(kingdom.materialCount), String(kingdom.nearCount), String(kingdom.strategies.length),
    fixed(kingdom.effectiveLotterySize), formatDamageStrategies(kingdom.strategies.reduce<Record<string, number>>((counts, strategy) => {
      const identity = classifyStrategyDamage(strategy); counts[identity] = (counts[identity] ?? 0) + 1; return counts;
    }, {})), percent(kingdom.lotteryTelemetry.drawRate),
    fixed(kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0), percent(kingdom.lotteryTelemetry.firstPlayerScore),
    integer(kingdom.matches), fixed(kingdom.elapsedMs / 1000, 1)]);
  const warning = model.playQualityWarnings.length ? `<section class="warning"><h2>Play quality needs investigation</h2><p>${model.playQualityWarnings.length} ${model.playQualityWarnings.length === 1 ? 'kingdom has' : 'kingdoms have'} a final-lottery draw rate of at least 50%. A high draw rate can mean a stalled market. It can also mean that the search or shared pilot did not discover a working strategy. ${model.playQualityWarnings.length === 1 ? 'This kingdom needs' : 'These kingdoms need'} investigation before card tuning.</p>${table(['Kingdom', 'Split', 'Draw rate', 'Lottery', 'Near 50%', 'Viable', 'Turns/player'], model.playQualityWarnings.map((entry) => [escape(entry.id), entry.split, percent(entry.drawRate), String(entry.lotteryStrategies), String(entry.nearStrategies), String(entry.viableStrategies), fixed(entry.winnerTurnsPerPlayer ?? 0)]))}</section>` : '';
  const summaryRows = model.scope === 'full'
    ? [model.summaries.tuning, model.summaries.validation!, model.summaries.combined]
    : [model.summaries.tuning];
  const tuningSize = model.manifest.splits.find((split) => split.name === 'tuning')!.size;
  const validationSize = model.manifest.splits.find((split) => split.name === 'validation')!.size;
  const designRows = model.scope === 'full' ? [
    ['Tuning', String(tuningSize), `${tuningDesign.cardCountMinimum}–${tuningDesign.cardCountMaximum}`, `${tuningDesign.pairCountMinimum}–${tuningDesign.pairCountMaximum}`, fixed(tuningDesign.pairCountStandardDeviation, 4), String(tuningDesign.largestOverlap)],
    ['Validation', String(validationSize), `${validationDesign.cardCountMinimum}–${validationDesign.cardCountMaximum}`, `${validationDesign.pairCountMinimum}–${validationDesign.pairCountMaximum}`, fixed(validationDesign.pairCountStandardDeviation, 4), String(validationDesign.largestOverlap)]
  ] : [[
    'Tuning', String(tuningSize), `${tuningDesign.cardCountMinimum}–${tuningDesign.cardCountMaximum}`,
    `${tuningDesign.pairCountMinimum}–${tuningDesign.pairCountMaximum}`,
    fixed(tuningDesign.pairCountStandardDeviation, 4), String(tuningDesign.largestOverlap)
  ]];
  const title = model.scope === 'full' ? `${model.manifest.chosenCount}-kingdom balance corpus` : `${tuningSize}-kingdom tuning report`;
  const introduction = model.scope === 'full'
    ? `This report measures ${tuningSize} tuning kingdoms and ${validationSize} held-back validation kingdoms. Use tuning results for repeated card changes. Use validation only to confirm a proposed change.`
    : `This report measures the ${tuningSize} tuning kingdoms under the current card rules. The held-back validation kingdoms were not run for this tuning round.`;
  const missingVariableCards = VARIABLE_ACTION_IDS.filter((cardId) => !model.manifest.cardPool.orderedVariableCardIds.includes(cardId));
  const incompletePoolWarning = missingVariableCards.length
    ? `<section class="warning"><h2>This is an incomplete historical card pool</h2><p>These runs excluded ${escape(missingVariableCards.map((cardId) => cardDefinition(cardId).name).join(' and '))}, even though the playable random market can include them. Use this report to understand the latest completed runs, but do not treat it as the final whole-game balance result.</p></section>` : '';
  const primarySummary = model.scope === 'full' ? model.summaries.combined : model.summaries.tuning;
  const strategyTotal = Object.values(primarySummary.damageStrategyCounts).reduce((sum, count) => sum + count, 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{--ink:#17231d;--muted:#56625c;--line:#ccd6d0;--paper:#f7f5ef;--panel:#fff;--accent:#096b4b;--soft:#e8f2ed;--warn:#9a3f13;--warn-soft:#fff1e8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.48 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:36px 28px 72px}h1{font-size:clamp(30px,4vw,52px);line-height:1.05;margin:0 0 12px}h2{font-size:28px;margin:0 0 8px}h3{font-size:18px;margin:24px 0 8px}p{max-width:90ch;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;margin:24px 0}.warning{border:2px solid var(--warn);background:var(--warn-soft)}.warning h2{color:var(--warn)}.table-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #e4e9e6;vertical-align:top}th{background:#edf3ef;font-size:12px;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}.card-use{white-space:normal;table-layout:fixed;min-width:760px}.card-use th:nth-child(1){width:15%}.card-use th:nth-child(2){width:49%}.card-use th:nth-child(3){width:24%}.card-use th:nth-child(4){width:12%}.pair-use td:not(:first-child),.pair-use th:not(:first-child),.availability-use td:not(:first-child),.availability-use th:not(:first-child){text-align:right}.matrix td:not(:first-child),.matrix th:not(:first-child){text-align:right}.key{display:inline-block;background:var(--accent);color:#fff;border-radius:4px;padding:1px 6px;font-weight:700}.selection{color:var(--accent);font-weight:650}.callouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.callouts div{background:var(--soft);padding:14px;border-radius:9px}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:720px){main{padding:22px 12px 48px}section{padding:16px;margin:14px 0}.callouts{grid-template-columns:1fr}h2{font-size:23px}}
</style></head><body><main><header><h1>${title}</h1><p>${introduction}</p></header>
${incompletePoolWarning}
${warning}
<section><h2>Balance at a glance</h2><div class="callouts"><div><strong>${integer(strategyTotal)}</strong><br>strategies score at least 40% against the best discovered strategy mix</div><div><strong>${percent(primarySummary.multipleViableRate)}</strong><br>of kingdoms have at least two such strategies</div><div><strong>${fixed(primarySummary.winnerTurnsPerPlayer)}</strong><br>turns per player in games with a winner</div><div><strong>${percent(primarySummary.firstPlayerScore)}</strong><br>first-player score</div></div><p>A strategy counts as viable here if it is in the final lottery or scores at least 40% against that lottery. The 40% line represents a strategy that a human could reasonably play, not equal computer strength.</p></section>
<section><h2>Strategy types</h2>${strategySplit(primarySummary)}<p>A strategy is mixed when at least 20% of its damage-card weight comes from a second damage type. The sections that follow show which cards each strategy type actually uses.</p></section>
${strategyGroupSections(model)}
<section><h2>Cards with no use in any strategy type</h2><div class="callouts"><div><strong>No planned use</strong><br>${unused.length ? escape(unused.join(', ')) : 'None'}</div><div><strong>No actual acquisitions</strong><br>${notAcquired.length ? escape(notAcquired.join(', ')) : 'None'}</div></div></section>
<section><h2>Kingdom diversity</h2>${summaryTable(summaryRows)}<p>The lottery count shows strategies used by the best discovered mix. “Additional ≥40%” counts other discovered strategies that score at least 40% against that mix. Effective size measures how evenly the lottery is split; 1 means one strategy receives all weight.</p></section>
<section><h2>All ${model.kingdoms.length} kingdoms</h2>${table(['Kingdom', 'Split', 'Lottery', 'Additional ≥40%', 'Viable at 40%', 'Effective size', 'Damage types', 'Draws', 'Turns/player', 'First-player score', 'Search games', 'Seconds'], kingdomRows)}</section>
<section><h2>How the kingdoms were selected</h2>${table(['Split', 'Kingdoms', 'Card count range', 'Pair count range', 'Pair-count SD', 'Largest overlap'], designRows)}<p>Every kingdom has ten distinct piles, 40 health, no overrides, and at least two direct-damage cards. Card counts differ by at most one within each split. No pair of kingdoms shares more than ${model.manifest.thresholds.distinctness.maximumOverlap} piles.</p></section>
<div><h2>Five selected kingdom details</h2><p>Selection uses five fixed rules and an id tie-break. A kingdom can fill only one slot.</p>${model.selected.map(selectedDetail).join('\n')}</div>
</main></body></html>\n`;
}

export function generateBalanceCorpus(
  root: string, output = path.join(root, '.html', 'balance-corpus.html'), scope: 'tuning' | 'full' = 'full'
): BalanceCorpusModel {
  balanceSuite.assertCampaignReady();
  if (scope === 'full') {
    const validation = balanceSuite.validateRuns(root);
    if (!validation.valid) throw new Error(`Balance suite is incomplete: ${validation.failures.map((failure) => `${failure.kingdomId}: ${failure.reason}`).join('; ')}`);
  }
  const splitById = new Map(balanceSuite.manifest.kingdoms.map((kingdom) => [kingdom.id, kingdom.split]));
  const kingdoms: CorpusKingdomReport[] = [];
  const definitions = scope === 'full' ? balanceSuite.manifest.kingdoms
    : balanceSuite.manifest.kingdoms.filter((definition) => definition.split === 'tuning');
  for (const definition of definitions) {
    const artifact = loadArtifactDirectory(balanceSuite.runDirectory(root, definition.id), definition.id);
    const selfPlay = selfPlayFor(artifact);
    const report = buildBalanceReportModel([artifact], new Map([[definition.id, selfPlay]]), {
      competitiveScore: 0.4, competitiveStatus: '40% viable'
    }).kingdoms[0]!;
    kingdoms.push({ ...report, split: splitById.get(definition.id)! });
  }
  const model = buildBalanceCorpusModel(balanceSuite.manifest, kingdoms);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderBalanceCorpus(model));
  return model;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const scope = process.argv.includes('--tuning-only') ? 'tuning' : 'full';
    const outputArgument = process.argv.slice(2).find((argument) => argument !== '--tuning-only');
    const output = outputArgument ? path.resolve(outputArgument) : undefined;
    const model = generateBalanceCorpus(process.cwd(), output, scope);
    process.stdout.write(`Wrote ${output ?? path.join(process.cwd(), '.html', 'balance-corpus.html')} from ${model.kingdoms.length} full runs.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
  }
}
