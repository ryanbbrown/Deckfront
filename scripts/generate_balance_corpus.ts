import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ALWAYS_AVAILABLE_ACTION_IDS, cardDefinition } from '../src/game';
import { balanceSuite } from '../src/sim/balanceSuite';
import type { BalanceSuiteManifest, BalanceSuiteSplit } from '../src/sim/balanceSuite';
import {
  buildBalanceReportModel, family, loadArtifactDirectory, selfPlayFor
} from './generate_balance_report';
import type { CardFamily, KingdomReport, StrategyReport } from './generate_balance_report';

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
  buildPlans: number;
  finitePlans: number;
  repeatPlans: number;
  acquiredStrategies: number;
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

const DAMAGE_FAMILIES = ['Melee', 'Ranged', 'Mage'] as const;
const MIXED_DAMAGE_MINIMUM = 0.2;

function damageFamily(cardId: string): (typeof DAMAGE_FAMILIES)[number] | null {
  const mechanic = cardDefinition(cardId).mechanic;
  if (['melee', 'drive', 'flurry'].includes(mechanic)) return 'Melee';
  if (['ranged', 'volley'].includes(mechanic)) return 'Ranged';
  if (mechanic === 'spell') return 'Mage';
  return null;
}

export function classifyStrategyDamage(
  strategy: Pick<StrategyReport, 'startingBuild' | 'acquisitionRates'>
): string {
  const amounts = Object.fromEntries(DAMAGE_FAMILIES.map((name) => [name, 0])) as Record<(typeof DAMAGE_FAMILIES)[number], number>;
  for (const cardId of strategy.startingBuild) {
    const cardFamily = damageFamily(cardId);
    if (cardFamily) amounts[cardFamily] += 1;
  }
  for (const [cardId, amount] of Object.entries(strategy.acquisitionRates)) {
    const cardFamily = damageFamily(cardId);
    if (cardFamily) amounts[cardFamily] += amount;
  }
  const total = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  if (!total) return 'No damage package';
  const material = DAMAGE_FAMILIES.filter((name) => amounts[name] / total >= MIXED_DAMAGE_MINIMUM);
  return material.length ? material.join(' + ') : DAMAGE_FAMILIES
    .reduce((best, name) => amounts[name] > amounts[best] ? name : best);
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
  let buildPlans = 0, finitePlans = 0, repeatPlans = 0, acquiredStrategies = 0;
  let materialWeight = 0, cardAcquisitions = 0, familyAcquisitions = 0;
  for (const kingdom of kingdoms) for (const strategy of kingdom.strategies) {
    const inBuild = strategy.startingBuild.includes(cardId);
    const inFinite = strategy.purchaseSteps.some((step) => step.cardId === cardId);
    const inRepeat = strategy.repeatPurchase === cardId;
    if (inBuild) buildPlans += 1;
    if (inFinite) finitePlans += 1;
    if (inRepeat) repeatPlans += 1;
    const acquired = strategy.acquisitionRates[cardId] ?? 0;
    if (acquired > 0) acquiredStrategies += 1;
    cardAcquisitions += acquired;
    for (const [acquiredId, rate] of Object.entries(strategy.acquisitionRates)) {
      if (family(acquiredId) === cardFamily) familyAcquisitions += rate;
    }
    if (strategy.status === 'Lottery' && (inBuild || inFinite || inRepeat)) materialWeight += strategy.weight;
  }
  return { availability: availableIds.size, buildPlans, finitePlans, repeatPlans, acquiredStrategies,
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
  if (tuning.length !== 80 || (scope === 'full' && validation.length !== 20)) {
    throw new Error('Corpus reports do not preserve the requested split.');
  }
  const availableCards = [...ALWAYS_AVAILABLE_ACTION_IDS, ...manifest.eligibleCardIds];
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
  return table(['Split', 'Kingdoms', 'Lottery count distribution', 'Near-50% distribution',
    'Effective size min / median / mean / max', '2+ viable', 'Viable strategies by damage package',
    'Draws', 'Turns/player', 'First-player score'], summaries.map((summary) => [summary.label,
    String(summary.kingdoms), formatDistribution(summary.lotteryDistribution), formatDistribution(summary.nearDistribution),
    `${fixed(summary.effectiveMinimum)} / ${fixed(summary.effectiveMedian)} / ${fixed(summary.effectiveMean)} / ${fixed(summary.effectiveMaximum)}`,
    percent(summary.multipleViableRate), formatDamageStrategies(summary.damageStrategyCounts), percent(summary.drawRate),
    fixed(summary.winnerTurnsPerPlayer), percent(summary.firstPlayerScore)]));
}
function strategyKey(index: number): string { return `S${index + 1}`; }
function selectedDetail(selected: SelectedKingdom): string {
  const kingdom = selected.kingdom;
  const maxSteps = Math.max(0, ...kingdom.strategies.map((strategy) => strategy.purchaseSteps.length));
  const planRows = kingdom.strategies.map((strategy, index) => [`<span class="key">${strategyKey(index)}</span><br><code>${strategy.id}</code>`,
    strategy.status, strategy.status === 'Lottery' ? percent(strategy.weight, 2) : '—', percent(strategy.score),
    strategy.startingBuild.map((id) => escape(cardDefinition(id).name)).join(', ') || 'None',
    ...Array.from({ length: maxSteps }, (_, step) => strategy.purchaseSteps[step]
      ? `${escape(cardDefinition(strategy.purchaseSteps[step]!.cardId).name)} ×${strategy.purchaseSteps[step]!.remaining}` : '—'),
    escape(cardDefinition(strategy.repeatPurchase).name), classifyStrategyDamage(strategy)]);
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
    + card.combined.repeatPlans === 0).map((card) => card.name);
  const notAcquired = model.cards.filter((card) => card.combined.acquiredStrategies === 0).map((card) => card.name);
  const measures = model.scope === 'full' ? ['tuning', 'validation', 'combined'] as const
    : ['tuning'] as const;
  const cardRows = model.cards.map((card) => [escape(card.name), card.family,
    ...(measures.flatMap((name) => {
      const measure = card[name]!;
      return [String(measure.availability),
      String(measure.buildPlans), String(measure.finitePlans), String(measure.repeatPlans),
      String(measure.acquiredStrategies), percent(measure.averageMaterialWeight), percent(measure.familyAcquisitionShare)];
    }))]);
  const kingdomRows = model.kingdoms.map((kingdom) => [escape(kingdom.id), kingdom.split,
    String(kingdom.materialCount), String(kingdom.nearCount), String(kingdom.strategies.length),
    fixed(kingdom.effectiveLotterySize), formatDamageStrategies(kingdom.strategies.reduce<Record<string, number>>((counts, strategy) => {
      const identity = classifyStrategyDamage(strategy); counts[identity] = (counts[identity] ?? 0) + 1; return counts;
    }, {})), percent(kingdom.lotteryTelemetry.drawRate),
    fixed(kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0), percent(kingdom.lotteryTelemetry.firstPlayerScore),
    integer(kingdom.matches), fixed(kingdom.elapsedMs / 1000, 1)]);
  const measureHeaders = ['Available', 'Build', 'Finite', 'Repeat', 'Acquired', 'Lottery weight', 'Family share'];
  const warning = model.playQualityWarnings.length ? `<section class="warning"><h2>Play quality needs investigation</h2><p>${model.playQualityWarnings.length} ${model.playQualityWarnings.length === 1 ? 'kingdom has' : 'kingdoms have'} a final-lottery draw rate of at least 50%. A high draw rate can mean a stalled market. It can also mean that the search or shared pilot did not discover a working strategy. ${model.playQualityWarnings.length === 1 ? 'This kingdom needs' : 'These kingdoms need'} investigation before card tuning.</p>${table(['Kingdom', 'Split', 'Draw rate', 'Lottery', 'Near 50%', 'Viable', 'Turns/player'], model.playQualityWarnings.map((entry) => [escape(entry.id), entry.split, percent(entry.drawRate), String(entry.lotteryStrategies), String(entry.nearStrategies), String(entry.viableStrategies), fixed(entry.winnerTurnsPerPlayer ?? 0)]))}</section>` : '';
  const summaryRows = model.scope === 'full'
    ? [model.summaries.tuning, model.summaries.validation!, model.summaries.combined]
    : [model.summaries.tuning];
  const designRows = model.scope === 'full' ? [
    ['Tuning', '80', `${tuningDesign.cardCountMinimum}–${tuningDesign.cardCountMaximum}`, `${tuningDesign.pairCountMinimum}–${tuningDesign.pairCountMaximum}`, fixed(tuningDesign.pairCountStandardDeviation, 4), String(tuningDesign.largestOverlap)],
    ['Validation', '20', `${validationDesign.cardCountMinimum}–${validationDesign.cardCountMaximum}`, `${validationDesign.pairCountMinimum}–${validationDesign.pairCountMaximum}`, fixed(validationDesign.pairCountStandardDeviation, 4), String(validationDesign.largestOverlap)]
  ] : [[
    'Tuning', '80', `${tuningDesign.cardCountMinimum}–${tuningDesign.cardCountMaximum}`,
    `${tuningDesign.pairCountMinimum}–${tuningDesign.pairCountMaximum}`,
    fixed(tuningDesign.pairCountStandardDeviation, 4), String(tuningDesign.largestOverlap)
  ]];
  const title = model.scope === 'full' ? 'One-hundred-kingdom balance corpus' : 'Eighty-kingdom tuning report';
  const introduction = model.scope === 'full'
    ? 'This report measures 80 tuning kingdoms and 20 held-back validation kingdoms. Use tuning results for repeated card changes. Use validation only to confirm a proposed change.'
    : 'This report measures the 80 tuning kingdoms under the current card rules. The held-back validation kingdoms were not run for this tuning round.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{--ink:#17231d;--muted:#56625c;--line:#ccd6d0;--paper:#f7f5ef;--panel:#fff;--accent:#096b4b;--soft:#e8f2ed;--warn:#9a3f13;--warn-soft:#fff1e8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.48 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:36px 28px 72px}h1{font-size:clamp(30px,4vw,52px);line-height:1.05;margin:0 0 12px}h2{font-size:28px;margin:0 0 8px}h3{font-size:18px;margin:24px 0 8px}p{max-width:90ch;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;margin:24px 0}.warning{border:2px solid var(--warn);background:var(--warn-soft)}.warning h2{color:var(--warn)}.table-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #e4e9e6;vertical-align:top}th{background:#edf3ef;font-size:12px;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}.matrix td:not(:first-child),.matrix th:not(:first-child){text-align:right}.key{display:inline-block;background:var(--accent);color:#fff;border-radius:4px;padding:1px 6px;font-weight:700}.selection{color:var(--accent);font-weight:650}.callouts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.callouts div{background:var(--soft);padding:14px;border-radius:9px}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:720px){main{padding:22px 12px 48px}section{padding:16px;margin:14px 0}.callouts{grid-template-columns:1fr}h2{font-size:23px}}
</style></head><body><main><header><h1>${title}</h1><p>${introduction}</p></header>
${warning}
<section><h2>Corpus design</h2>${table(['Split', 'Kingdoms', 'Card count range', 'Pair count range', 'Pair-count SD', 'Largest overlap'], designRows)}<p>Every kingdom has ten distinct piles, 40 health, no overrides, and at least one direct-damage card. Card counts differ by at most one within each split. No pair of kingdoms shares more than eight piles.</p></section>
<section><h2>Strategy diversity and play diagnostics</h2>${summaryTable(summaryRows)}<p>Effective lottery size is 1 divided by the sum of squared lottery weights. A strategy's damage package uses its starting damage cards plus the damage cards it acquired against the final lottery. A second damage family makes the strategy mixed when it supplies at least 20% of those cards. Draw rate, turns, and first-player score are diagnostics, not balance targets.</p></section>
<section><h2>Card health</h2><div class="callouts"><div><strong>No viable plan use</strong><br>${unused.length ? escape(unused.join(', ')) : 'None'}</div><div><strong>No acquired use</strong><br>${notAcquired.length ? escape(notAcquired.join(', ')) : 'None'}</div></div><p>The report shows kingdom availability; viable-strategy build, finite-plan, repeat-plan, and acquired presence; average material-lottery weight of plans using the card; and the card’s share of acquisitions within its family.</p>${table(['Card', 'Family', ...measures.flatMap((split) => measureHeaders.map((measure) => `${split[0]!.toUpperCase()}${split.slice(1)} ${measure}`))], cardRows)}</section>
<section><h2>All ${model.kingdoms.length} kingdoms</h2>${table(['Kingdom', 'Split', 'Lottery', 'Near 50%', 'Viable', 'Effective size', 'Damage packages', 'Draws', 'Turns/player', 'First-player score', 'Search games', 'Seconds'], kingdomRows)}</section>
<div><h2>Five selected kingdom details</h2><p>Selection uses five fixed rules and an id tie-break. A kingdom can fill only one slot.</p>${model.selected.map(selectedDetail).join('\n')}</div>
</main></body></html>\n`;
}

export function generateBalanceCorpus(
  root: string, output = path.join(root, '.html', 'balance-corpus.html'), scope: 'tuning' | 'full' = 'full'
): BalanceCorpusModel {
  balanceSuite.register();
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
    const report = buildBalanceReportModel([artifact], new Map([[definition.id, selfPlay]])).kingdoms[0]!;
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
