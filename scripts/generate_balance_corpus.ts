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
  familyShares: Record<ActionFamily, number>;
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
  validation: CorpusCardMeasure;
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
  manifest: BalanceSuiteManifest;
  summaries: { tuning: CorpusSummary; validation: CorpusSummary; combined: CorpusSummary };
  cards: CorpusCardReport[];
  kingdoms: CorpusKingdomReport[];
  selected: SelectedKingdom[];
  playQualityWarnings: PlayQualityWarning[];
}

const ACTION_FAMILIES: readonly ActionFamily[] = ['Engine', 'Melee', 'Ranged', 'Mage'];

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
  const familyShares = Object.fromEntries(ACTION_FAMILIES.map((cardFamily) => [cardFamily,
    mean(kingdoms.map((kingdom) => kingdom.acquiredFamilyShares[cardFamily]))])) as Record<ActionFamily, number>;
  return { label, kingdoms: kingdoms.length,
    lotteryDistribution: distribution(kingdoms.map((kingdom) => kingdom.materialCount)),
    nearDistribution: distribution(kingdoms.map((kingdom) => kingdom.nearCount)),
    effectiveMinimum: Math.min(...effective), effectiveMedian: median(effective),
    effectiveMean: mean(effective), effectiveMaximum: Math.max(...effective),
    multipleViableRate: kingdoms.filter((kingdom) => kingdom.strategies.length >= 2).length / kingdoms.length,
    familyShares, drawRate: mean(kingdoms.map((kingdom) => kingdom.lotteryTelemetry.drawRate)),
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
    { reason: 'Highest ranged acquisition share', compare: (left, right) => right.acquiredFamilyShares.Ranged - left.acquiredFamilyShares.Ranged },
    { reason: 'Lowest ranged acquisition share', compare: (left, right) => left.acquiredFamilyShares.Ranged - right.acquiredFamilyShares.Ranged },
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
  const expected = manifest.kingdoms.map((kingdom) => kingdom.id).sort();
  const actual = kingdoms.map((kingdom) => kingdom.id).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Corpus reports do not match the manifest kingdom ids.');
  const tuning = kingdoms.filter((kingdom) => kingdom.split === 'tuning');
  const validation = kingdoms.filter((kingdom) => kingdom.split === 'validation');
  if (tuning.length !== 80 || validation.length !== 20) throw new Error('Corpus reports do not preserve the 80/20 split.');
  const availableCards = [...ALWAYS_AVAILABLE_ACTION_IDS, ...manifest.eligibleCardIds];
  const cards = availableCards.map((cardId): CorpusCardReport => {
    const cardFamily = family(cardId);
    if (cardFamily === 'Treasure') throw new Error(`Corpus action-card table cannot include ${cardId}.`);
    return { cardId, name: cardDefinition(cardId).name, family: cardFamily,
      tuning: cardMeasure(cardId, cardFamily, tuning, manifest),
      validation: cardMeasure(cardId, cardFamily, validation, manifest),
      combined: cardMeasure(cardId, cardFamily, kingdoms, manifest) };
  }).sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name));
  const playQualityWarnings = kingdoms.filter((kingdom) => kingdom.lotteryTelemetry.drawRate >= 0.5)
    .sort((left, right) => left.id.localeCompare(right.id)).map((kingdom): PlayQualityWarning => ({
      id: kingdom.id, split: kingdom.split, drawRate: kingdom.lotteryTelemetry.drawRate,
      lotteryStrategies: kingdom.materialCount, nearStrategies: kingdom.nearCount,
      viableStrategies: kingdom.strategies.length,
      winnerTurnsPerPlayer: kingdom.lotteryTelemetry.winnerTurnsPerPlayer
    }));
  return { manifest,
    summaries: { tuning: summarize('Tuning', tuning), validation: summarize('Validation', validation),
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
function summaryTable(summaries: readonly CorpusSummary[]): string {
  return table(['Split', 'Kingdoms', 'Lottery count distribution', 'Near-50% distribution',
    'Effective size min / median / mean / max', '2+ viable', 'Engine', 'Melee', 'Ranged', 'Mage',
    'Draws', 'Turns/player', 'First-player score'], summaries.map((summary) => [summary.label,
    String(summary.kingdoms), formatDistribution(summary.lotteryDistribution), formatDistribution(summary.nearDistribution),
    `${fixed(summary.effectiveMinimum)} / ${fixed(summary.effectiveMedian)} / ${fixed(summary.effectiveMean)} / ${fixed(summary.effectiveMaximum)}`,
    percent(summary.multipleViableRate), percent(summary.familyShares.Engine), percent(summary.familyShares.Melee),
    percent(summary.familyShares.Ranged), percent(summary.familyShares.Mage), percent(summary.drawRate),
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
    escape(cardDefinition(strategy.repeatPurchase).name),
    ACTION_FAMILIES.map((cardFamily) => `${cardFamily} ${percent(Object.entries(strategy.acquisitionRates)
      .filter(([id]) => family(id) === cardFamily).reduce((sum, [, rate]) => sum + rate, 0)
      / Math.max(0.000001, Object.entries(strategy.acquisitionRates).filter(([id]) => family(id) !== 'Treasure')
        .reduce((sum, [, rate]) => sum + rate, 0)))}`).join(' · ')]);
  const matchupRows = kingdom.strategies.map((_strategy, row) => [`<span class="key">${strategyKey(row)}</span>`,
    ...kingdom.matchupScores[row]!.map((score, column) => row === column ? '50.0% mirror' : percent(score))]);
  return `<section><h2>${escape(kingdom.name)}</h2><p class="selection">${escape(selected.reason)} · ${kingdom.split} · effective lottery size ${fixed(kingdom.effectiveLotterySize)}</p>
  <h3>Viable strategy plans</h3>${table(['Key', 'Status', 'Lottery weight', 'Score vs lottery', 'Starting build',
    ...Array.from({ length: maxSteps }, (_, index) => `Purchase ${index + 1}`), 'Repeat', 'Acquired family profile'], planRows)}
  <h3>Viable-strategy matchups</h3>${table(['Row', ...kingdom.strategies.map((_entry, index) => strategyKey(index))], matchupRows, 'matrix')}</section>`;
}

export function renderBalanceCorpus(model: BalanceCorpusModel): string {
  const tuningDesign = model.manifest.splits.find((split) => split.name === 'tuning')!.design;
  const validationDesign = model.manifest.splits.find((split) => split.name === 'validation')!.design;
  const unused = model.cards.filter((card) => card.combined.buildPlans + card.combined.finitePlans
    + card.combined.repeatPlans === 0).map((card) => card.name);
  const notAcquired = model.cards.filter((card) => card.combined.acquiredStrategies === 0).map((card) => card.name);
  const cardRows = model.cards.map((card) => [escape(card.name), card.family,
    ...([card.tuning, card.validation, card.combined].flatMap((measure) => [String(measure.availability),
      String(measure.buildPlans), String(measure.finitePlans), String(measure.repeatPlans),
      String(measure.acquiredStrategies), percent(measure.averageMaterialWeight), percent(measure.familyAcquisitionShare)]))]);
  const kingdomRows = model.kingdoms.map((kingdom) => [escape(kingdom.id), kingdom.split,
    String(kingdom.materialCount), String(kingdom.nearCount), String(kingdom.strategies.length),
    fixed(kingdom.effectiveLotterySize), percent(kingdom.acquiredFamilyShares.Engine),
    percent(kingdom.acquiredFamilyShares.Melee), percent(kingdom.acquiredFamilyShares.Ranged),
    percent(kingdom.acquiredFamilyShares.Mage), percent(kingdom.lotteryTelemetry.drawRate),
    fixed(kingdom.lotteryTelemetry.winnerTurnsPerPlayer ?? 0), percent(kingdom.lotteryTelemetry.firstPlayerScore),
    integer(kingdom.matches), fixed(kingdom.elapsedMs / 1000, 1)]);
  const measureHeaders = ['Available', 'Build', 'Finite', 'Repeat', 'Acquired', 'Lottery weight', 'Family share'];
  const warning = model.playQualityWarnings.length ? `<section class="warning"><h2>Play quality needs investigation</h2><p>${model.playQualityWarnings.length} ${model.playQualityWarnings.length === 1 ? 'kingdom has' : 'kingdoms have'} a final-lottery draw rate of at least 50%. A high draw rate can mean a stalled market. It can also mean that the search or shared pilot did not discover a working strategy. ${model.playQualityWarnings.length === 1 ? 'This kingdom needs' : 'These kingdoms need'} investigation before card tuning.</p>${table(['Kingdom', 'Split', 'Draw rate', 'Lottery', 'Near 50%', 'Viable', 'Turns/player'], model.playQualityWarnings.map((entry) => [escape(entry.id), entry.split, percent(entry.drawRate), String(entry.lotteryStrategies), String(entry.nearStrategies), String(entry.viableStrategies), fixed(entry.winnerTurnsPerPlayer ?? 0)]))}</section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One-hundred-kingdom balance corpus</title><style>
:root{--ink:#17231d;--muted:#56625c;--line:#ccd6d0;--paper:#f7f5ef;--panel:#fff;--accent:#096b4b;--soft:#e8f2ed;--warn:#9a3f13;--warn-soft:#fff1e8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.48 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:36px 28px 72px}h1{font-size:clamp(30px,4vw,52px);line-height:1.05;margin:0 0 12px}h2{font-size:28px;margin:0 0 8px}h3{font-size:18px;margin:24px 0 8px}p{max-width:90ch;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;margin:24px 0}.warning{border:2px solid var(--warn);background:var(--warn-soft)}.warning h2{color:var(--warn)}.table-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #e4e9e6;vertical-align:top}th{background:#edf3ef;font-size:12px;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}.matrix td:not(:first-child),.matrix th:not(:first-child){text-align:right}.key{display:inline-block;background:var(--accent);color:#fff;border-radius:4px;padding:1px 6px;font-weight:700}.selection{color:var(--accent);font-weight:650}.callouts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.callouts div{background:var(--soft);padding:14px;border-radius:9px}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:720px){main{padding:22px 12px 48px}section{padding:16px;margin:14px 0}.callouts{grid-template-columns:1fr}h2{font-size:23px}}
</style></head><body><main><header><h1>One-hundred-kingdom balance corpus</h1><p>This report measures 80 tuning kingdoms and 20 held-back validation kingdoms. Use tuning results for repeated card changes. Use validation only to confirm a proposed change.</p></header>
${warning}
<section><h2>Corpus design</h2>${table(['Split', 'Kingdoms', 'Card count range', 'Pair count range', 'Pair-count SD', 'Largest overlap'], [
    ['Tuning', '80', `${tuningDesign.cardCountMinimum}–${tuningDesign.cardCountMaximum}`, `${tuningDesign.pairCountMinimum}–${tuningDesign.pairCountMaximum}`, fixed(tuningDesign.pairCountStandardDeviation, 4), String(tuningDesign.largestOverlap)],
    ['Validation', '20', `${validationDesign.cardCountMinimum}–${validationDesign.cardCountMaximum}`, `${validationDesign.pairCountMinimum}–${validationDesign.pairCountMaximum}`, fixed(validationDesign.pairCountStandardDeviation, 4), String(validationDesign.largestOverlap)]
  ])}<p>Every kingdom has ten distinct piles, 40 health, no overrides, and at least one direct-damage card. Card counts differ by at most one within each split. No pair of kingdoms shares more than eight piles.</p></section>
<section><h2>Strategy diversity and play diagnostics</h2>${summaryTable([model.summaries.tuning, model.summaries.validation, model.summaries.combined])}<p>Effective lottery size is 1 divided by the sum of squared lottery weights. Acquired family shares use actual acquisition rates from each viable strategy against the final material lottery. Draw rate, turns, and first-player score are diagnostics, not balance targets.</p></section>
<section><h2>Card health</h2><div class="callouts"><div><strong>No viable plan use</strong><br>${unused.length ? escape(unused.join(', ')) : 'None'}</div><div><strong>No acquired use</strong><br>${notAcquired.length ? escape(notAcquired.join(', ')) : 'None'}</div></div><p>Each split shows kingdom availability; viable-strategy build, finite-plan, repeat-plan, and acquired presence; average material-lottery weight of plans using the card; and the card’s share of acquisitions within its family.</p>${table(['Card', 'Family', ...['Tuning', 'Validation', 'Combined'].flatMap((split) => measureHeaders.map((measure) => `${split} ${measure}`))], cardRows)}</section>
<section><h2>All 100 kingdoms</h2>${table(['Kingdom', 'Split', 'Lottery', 'Near 50%', 'Viable', 'Effective size', 'Engine', 'Melee', 'Ranged', 'Mage', 'Draws', 'Turns/player', 'First-player score', 'Search games', 'Seconds'], kingdomRows)}</section>
<div><h2>Five selected kingdom details</h2><p>Selection uses five fixed rules and an id tie-break. A kingdom can fill only one slot.</p>${model.selected.map(selectedDetail).join('\n')}</div>
</main></body></html>\n`;
}

export function generateBalanceCorpus(root: string, output = path.join(root, '.html', 'balance-corpus.html')): BalanceCorpusModel {
  balanceSuite.register();
  const validation = balanceSuite.validateRuns(root);
  if (!validation.valid) throw new Error(`Balance suite is incomplete: ${validation.failures.map((failure) => `${failure.kingdomId}: ${failure.reason}`).join('; ')}`);
  const splitById = new Map(balanceSuite.manifest.kingdoms.map((kingdom) => [kingdom.id, kingdom.split]));
  const kingdoms: CorpusKingdomReport[] = [];
  for (const definition of balanceSuite.manifest.kingdoms) {
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
    const output = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
    const model = generateBalanceCorpus(process.cwd(), output);
    process.stdout.write(`Wrote ${output ?? path.join(process.cwd(), '.html', 'balance-corpus.html')} from ${model.kingdoms.length} full runs.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
  }
}
