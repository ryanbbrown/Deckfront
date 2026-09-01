import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildRustBalanceAnalysis } from '../src/sim/rustStrategySearchBalance';
import type {
  RustBalanceAnalysisV2, RustKingdomBalanceAnalysis, RustStrategySearchSourceProvenanceV2
} from '../src/sim/rustStrategySearchBalance';
import { loadRustStrategySearchKingdomEvidence } from '../src/sim/rustStrategySearchEvidence';

export const CARD_BALANCE_SMOKE_KINGDOM_IDS = [
  'balance-tuning-005',
  'balance-tuning-010',
  'balance-tuning-013',
  'balance-tuning-021',
  'balance-tuning-033',
  'balance-tuning-053',
  'balance-tuning-082',
  'balance-tuning-090'
] as const;
export const CARD_BALANCE_SMOKE_CHANGED_CARD_IDS = [
  'focus', 'overload', 'bullRush', 'openingStrike', 'volley'
] as const;
const DAMAGE_FAMILIES = ['treasure', 'mana', 'melee', 'ranged', 'engine'] as const;
const DEFAULT_BASELINE = path.join('.data', 'strategy-search-30', 'rust-balance-analysis-v2.json');
const DEFAULT_ROOT = path.join('.data', 'card-balance-smoke-84');
const DEFAULT_BINARY = path.join('rust', 'target', 'release', 'hexdeck-goldfish');
const DEFAULT_JSON = path.join('.html', 'card-balance-smoke-84.json');
const DEFAULT_HTML = path.join('.html', 'card-balance-smoke-84.html');

type ChangedCardId = typeof CARD_BALANCE_SMOKE_CHANGED_CARD_IDS[number];
type DamageFamily = typeof DAMAGE_FAMILIES[number];
export interface Difference { before: number; after: number; difference: number }
export interface CardAcquisitionComparison {
  cardId: ChangedCardId;
  expectedCopiesPerPlayerSide: Difference;
  acquisitionPresence: Difference;
  selectionPresence: Difference;
  meanOwnedCopies: Difference;
}
export interface KingdomCardBalanceComparison {
  kingdomId: string;
  beforeEvidenceSetSha256: string;
  afterEvidenceSetSha256: string;
  supportSize: Difference;
  effectiveSize: Difference;
  availableCards: Array<{ id: string; name: string; cost: number; family: string }>;
  equilibriumStrategies: Array<{
    strategyId: string;
    selectedShare: number;
    archetype: string;
    buySteps: Array<{ cardId: string; cardName: string; desiredCount: number }>;
    expectedAcquisitions: Array<{ cardId: string; cardName: string; copiesPerPlayerSide: number }>;
  }>;
  archetypes: Array<{ archetype: string; selectedShare: Difference }>;
  changedCardAcquisition: CardAcquisitionComparison[];
  familyDamage: Array<{ family: DamageFamily; expectedDamagePerPlayerSide: Difference; share: Difference }>;
}
export interface CardBalanceSmokeComparison {
  schemaVersion: 1;
  protocol: 'card-balance-directional-smoke-v1';
  label: 'directional smoke, not final balance evidence';
  scope: {
    kingdomIds: string[];
    kingdomCount: 8;
    kingdomWeighting: 'equal';
    changedCardIds: ChangedCardId[];
    evidenceBasis: 'stored equilibrium lottery versus itself; diagonal included; rates are per player side';
  };
  scientificSettings: {
    goldfishRanking: 'unchanged';
    matrixSeeds: '4200001..4200125';
    matrixPayoffSeeds: 75;
    matrixTelemetrySeeds: 125;
    psroRules: 'confirmed queue capped at 100; thresholds, depths, admission, solver, and stopping rules unchanged';
    scoreWorkerCores: 16;
    maximumActiveScoreCpus: 512;
  };
  source: { baselineReportSha256: string };
  kingdoms: KingdomCardBalanceComparison[];
  crossKingdom: {
    supportSize: Difference;
    effectiveSize: Difference;
    archetypes: Array<{ archetype: string; selectedShare: Difference }>;
    changedCardAcquisition: Array<CardAcquisitionComparison & { offeredKingdomCount: number }>;
    familyDamage: Array<{ family: DamageFamily; expectedDamagePerPlayerSide: Difference; share: Difference }>;
  };
}

export interface CardBalanceSmokeReportOptions {
  baseline: string;
  root: string;
  binary: string;
  json: string;
  html: string;
}

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function difference(before: number, after: number): Difference {
  return { before, after, difference: after - before };
}
function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function kingdomById(analysis: RustBalanceAnalysisV2): Map<string, RustKingdomBalanceAnalysis> {
  return new Map(analysis.kingdoms.map((kingdom) => [kingdom.kingdom.id, kingdom]));
}
function archetypeShare(kingdom: RustKingdomBalanceAnalysis, archetype: string): number {
  return kingdom.archetypes.find((row) => row.archetype === archetype)?.selectedShare ?? 0;
}
function cardRow(kingdom: RustKingdomBalanceAnalysis, cardId: string) {
  return kingdom.cards.find((row) => row.cardId === cardId);
}
function familyRow(kingdom: RustKingdomBalanceAnalysis, family: DamageFamily) {
  const row = kingdom.familyDamage.find((entry) => entry.family === family);
  if (!row) throw new Error(`${kingdom.kingdom.id}: missing ${family} family damage.`);
  return row;
}
function compareCard(cardId: ChangedCardId, before: NonNullable<ReturnType<typeof cardRow>>,
  after: NonNullable<ReturnType<typeof cardRow>>): CardAcquisitionComparison {
  return { cardId,
    expectedCopiesPerPlayerSide: difference(before.expectedAcquiredCopiesPerPlayerSide,
      after.expectedAcquiredCopiesPerPlayerSide),
    acquisitionPresence: difference(before.equilibriumAcquisitionRate, after.equilibriumAcquisitionRate),
    selectionPresence: difference(before.equilibriumSelectionRate, after.equilibriumSelectionRate),
    meanOwnedCopies: difference(before.equilibriumMeanOwnedCopies, after.equilibriumMeanOwnedCopies) };
}
function meanDifference(rows: readonly Difference[]): Difference {
  return difference(average(rows.map((row) => row.before)), average(rows.map((row) => row.after)));
}

export function compareCardBalanceSmoke(input: {
  before: RustBalanceAnalysisV2;
  after: RustBalanceAnalysisV2;
  baselineReportSha256: string;
}): CardBalanceSmokeComparison {
  const kingdomIds = [...CARD_BALANCE_SMOKE_KINGDOM_IDS];
  const beforeById = kingdomById(input.before), afterById = kingdomById(input.after);
  if (!sameOrder(input.after.scope.kingdomIds, kingdomIds)
    || kingdomIds.some((kingdomId) => !beforeById.has(kingdomId) || !afterById.has(kingdomId))) {
    throw new Error('Before/after evidence must contain the exact eight smoke kingdoms in order.');
  }
  const kingdoms = kingdomIds.map((kingdomId): KingdomCardBalanceComparison => {
    const before = beforeById.get(kingdomId)!, after = afterById.get(kingdomId)!;
    const archetypes = [...new Set([...before.archetypes, ...after.archetypes].map((row) => row.archetype))].sort();
    const cardNames = new Map(after.kingdom.offeredCards.map((card) => [card.id, card.name]));
    const equilibriumStrategies = after.strategies.filter((strategy) => strategy.selectedWeight > 1e-12)
      .sort((left, right) => right.selectedWeight - left.selectedWeight || left.strategyNumber - right.strategyNumber)
      .map((strategy) => ({ strategyId: strategy.strategyId, selectedShare: strategy.selectedWeight,
        archetype: strategy.archetype,
        buySteps: strategy.buySteps.map((step) => ({ ...step, cardName: cardNames.get(step.cardId) ?? step.cardId })),
        expectedAcquisitions: strategy.equilibriumOpponentAcquisitions
          .filter((entry) => entry.copiesPerPlayerSide > 1e-6)
          .map((entry) => ({ ...entry, cardName: cardNames.get(entry.cardId) ?? entry.cardId })) }));
    const changedCardAcquisition = CARD_BALANCE_SMOKE_CHANGED_CARD_IDS.flatMap((cardId) => {
      const beforeCard = cardRow(before, cardId), afterCard = cardRow(after, cardId);
      if (Boolean(beforeCard) !== Boolean(afterCard)) throw new Error(`${kingdomId}: ${cardId} offering changed.`);
      return beforeCard && afterCard ? [compareCard(cardId, beforeCard, afterCard)] : [];
    });
    return { kingdomId, beforeEvidenceSetSha256: before.evidenceSetSha256,
      afterEvidenceSetSha256: after.evidenceSetSha256,
      supportSize: difference(before.equilibrium.supportSize, after.equilibrium.supportSize),
      effectiveSize: difference(before.equilibrium.effectiveSize, after.equilibrium.effectiveSize),
      availableCards: after.kingdom.offeredCards.map(({ id, name, cost, family }) => ({ id, name, cost, family })),
      equilibriumStrategies,
      archetypes: archetypes.map((archetype) => ({ archetype,
        selectedShare: difference(archetypeShare(before, archetype), archetypeShare(after, archetype)) })),
      changedCardAcquisition,
      familyDamage: DAMAGE_FAMILIES.map((family) => { const beforeFamily = familyRow(before, family);
        const afterFamily = familyRow(after, family);
        return { family,
          expectedDamagePerPlayerSide: difference(beforeFamily.expectedDamagePerPlayerSide,
            afterFamily.expectedDamagePerPlayerSide),
          share: difference(beforeFamily.share, afterFamily.share) };
      }) };
  });
  const archetypes = [...new Set(kingdoms.flatMap((kingdom) => kingdom.archetypes.map((row) => row.archetype)))].sort();
  return { schemaVersion: 1, protocol: 'card-balance-directional-smoke-v1',
    label: 'directional smoke, not final balance evidence',
    scope: { kingdomIds, kingdomCount: 8, kingdomWeighting: 'equal',
      changedCardIds: [...CARD_BALANCE_SMOKE_CHANGED_CARD_IDS],
      evidenceBasis: 'stored equilibrium lottery versus itself; diagonal included; rates are per player side' },
    scientificSettings: { goldfishRanking: 'unchanged', matrixSeeds: '4200001..4200125',
      matrixPayoffSeeds: 75, matrixTelemetrySeeds: 125, psroRules: 'confirmed queue capped at 100; thresholds, depths, admission, solver, and stopping rules unchanged',
      scoreWorkerCores: 16, maximumActiveScoreCpus: 512 },
    source: { baselineReportSha256: input.baselineReportSha256 }, kingdoms,
    crossKingdom: {
      supportSize: meanDifference(kingdoms.map((kingdom) => kingdom.supportSize)),
      effectiveSize: meanDifference(kingdoms.map((kingdom) => kingdom.effectiveSize)),
      archetypes: archetypes.map((archetype) => ({ archetype, selectedShare: meanDifference(kingdoms.map((kingdom) =>
        kingdom.archetypes.find((row) => row.archetype === archetype)?.selectedShare ?? difference(0, 0))) })),
      changedCardAcquisition: CARD_BALANCE_SMOKE_CHANGED_CARD_IDS.map((cardId) => {
        const rows = kingdoms.flatMap((kingdom) => kingdom.changedCardAcquisition.filter((row) => row.cardId === cardId));
        return { cardId, offeredKingdomCount: rows.length,
          expectedCopiesPerPlayerSide: meanDifference(rows.map((row) => row.expectedCopiesPerPlayerSide)),
          acquisitionPresence: meanDifference(rows.map((row) => row.acquisitionPresence)),
          selectionPresence: meanDifference(rows.map((row) => row.selectionPresence)),
          meanOwnedCopies: meanDifference(rows.map((row) => row.meanOwnedCopies)) };
      }),
      familyDamage: DAMAGE_FAMILIES.map((family) => { const rows = kingdoms.map((kingdom) =>
        kingdom.familyDamage.find((row) => row.family === family)!);
        return { family,
          expectedDamagePerPlayerSide: meanDifference(rows.map((row) => row.expectedDamagePerPlayerSide)),
          share: meanDifference(rows.map((row) => row.share)) };
      }) }
  };
}

function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function fixed(value: number): string { return value.toFixed(4); }
function signed(value: number, format: (held: number) => string): string {
  return `${value >= 0 ? '+' : ''}${format(value)}`;
}
function escape(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function table(headings: readonly string[], rows: readonly string[][], className = ''): string {
  return `<div class="table-wrap${className ? ` ${className}` : ''}"><table><thead><tr>${headings.map((heading) => `<th>${escape(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function diffCells(row: Difference, format: (value: number) => string): string[] {
  return [format(row.before), format(row.after), signed(row.difference, format)];
}

const FAMILY_ORDER = ['treasure', 'mana', 'melee', 'ranged', 'engine'] as const;
function familyName(family: string): string { return family === 'mana' ? 'Mage' : family[0]!.toUpperCase() + family.slice(1); }
function availabilityLabel(cardId: string): string {
  if (cardId === 'focus' || cardId === 'step') return 'always available';
  if (cardId === 'scrap') return 'starter';
  if (cardId === 'copper' || cardId === 'silver' || cardId === 'gold') return 'treasure';
  return '';
}
function renderAvailableCards(kingdom: KingdomCardBalanceComparison): string {
  return `<div class="card-groups">${FAMILY_ORDER.map((family) => {
    const cards = kingdom.availableCards.filter((card) => card.family === family)
      .sort((left, right) => left.cost - right.cost || compareText(left.name, right.name));
    if (!cards.length) return '';
    return `<div class="card-group"><h4>${escape(familyName(family))}</h4><div class="card-chips">${cards.map((card) => {
      const availability = availabilityLabel(card.id);
      return `<span class="card-chip"><strong>${escape(card.name)}</strong><span>${card.cost}</span>${availability ? `<small>${escape(availability)}</small>` : ''}</span>`;
    }).join('')}</div></div>`;
  }).join('')}</div>`;
}
function renderEquilibriumStrategies(kingdom: KingdomCardBalanceComparison): string {
  const maximumShare = Math.max(...kingdom.equilibriumStrategies.map((strategy) => strategy.selectedShare));
  return table(['Role', 'Share', 'Archetype', 'Buy plan', 'Expected acquisitions'],
    kingdom.equilibriumStrategies.map((strategy) => [
      Math.abs(strategy.selectedShare - maximumShare) < 1e-9 ? 'Primary' : 'Alternative',
      percent(strategy.selectedShare), escape(strategy.archetype),
      strategy.buySteps.map((step) => `${escape(step.cardName)} ×${step.desiredCount}`).join(' → '),
      strategy.expectedAcquisitions.map((entry) => `${escape(entry.cardName)} ${fixed(entry.copiesPerPlayerSide)}`).join(', ')
    ]), 'strategy-table');
}

export function renderCardBalanceSmokeReport(report: CardBalanceSmokeComparison): string {
  const archetypes = table(['Archetype', 'Before', 'After', 'Difference'], report.crossKingdom.archetypes.map((row) =>
    [escape(row.archetype), ...diffCells(row.selectedShare, percent)]));
  const cards = table(['Card', 'Offered', 'Before copies', 'After copies', 'Difference', 'Before selection', 'After selection', 'Difference'],
    report.crossKingdom.changedCardAcquisition.map((row) => [escape(row.cardId), String(row.offeredKingdomCount),
      ...diffCells(row.expectedCopiesPerPlayerSide, fixed), ...diffCells(row.selectionPresence, percent)]));
  const families = table(['Family', 'Before damage', 'After damage', 'Difference', 'Before share', 'After share', 'Difference'],
    report.crossKingdom.familyDamage.map((row) => [escape(row.family),
      ...diffCells(row.expectedDamagePerPlayerSide, fixed), ...diffCells(row.share, percent)]));
  const kingdomSections = report.kingdoms.map((kingdom) => `<section id="${escape(kingdom.kingdomId)}"><h2>${escape(kingdom.kingdomId)}</h2>
    <h3>Available cards by type</h3>${renderAvailableCards(kingdom)}
    <h3>Equilibrium strategies</h3><p class="section-note">Buy plans are priority ladders, not fixed purchase sequences. On each buy, the player scans from left to right and buys the first still-needed card it can afford. Expected acquisitions are MW copies per player side against the equilibrium opponent.</p>${renderEquilibriumStrategies(kingdom)}
    <h3>Archetype shares</h3>${table(['Archetype', 'Share'], kingdom.archetypes
      .filter((row) => row.selectedShare.after > 1e-10)
      .sort((left, right) => right.selectedShare.after - left.selectedShare.after)
      .map((row) => [escape(row.archetype), percent(row.selectedShare.after)]))}
    <h3>Played-card family damage</h3>${table(['Family', 'Damage', 'Share'], kingdom.familyDamage
      .filter((row) => row.share.after > 1e-10)
      .sort((left, right) => right.share.after - left.share.after)
      .map((row) => [escape(familyName(row.family)), fixed(row.expectedDamagePerPlayerSide.after), percent(row.share.after)]))}
    <h3>Before and after run shape</h3>${table(['Measure', 'Before', 'After', 'Difference'], [
      ['Support size', ...diffCells(kingdom.supportSize, fixed)],
      ['Effective size', ...diffCells(kingdom.effectiveSize, fixed)]
    ])}
    <h3>Changed-card acquisition</h3>${table(['Card', 'Before copies', 'After copies', 'Difference', 'Before selection', 'After selection', 'Difference'],
      kingdom.changedCardAcquisition.map((row) => [escape(row.cardId), ...diffCells(row.expectedCopiesPerPlayerSide, fixed),
        ...diffCells(row.selectionPresence, percent)]))}
    <details><summary>Evidence hashes</summary><p>Before <code>${escape(kingdom.beforeEvidenceSetSha256)}</code><br>After <code>${escape(kingdom.afterEvidenceSetSha256)}</code></p></details></section>`).join('\n');
  const embedded = JSON.stringify(report).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Card balance directional smoke</title><style>
:root{font:16px/1.45 system-ui,sans-serif;color:#17231d;background:#f7f5ef}body{margin:0}main{max-width:1400px;margin:auto;padding:32px 24px 70px}h1{font-size:clamp(32px,5vw,58px);line-height:1.05;margin-bottom:8px}h2{margin-top:0}h3{margin:28px 0 8px}.lede{max-width:82ch;color:#536159}.section-note{margin-top:0;color:#536159}.warning{border:2px solid #9a3f13;background:#fff1e8}section{background:#fff;border:1px solid #ccd6d0;border-radius:12px;padding:22px;margin:22px 0;scroll-margin-top:16px}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.metrics div{background:#e8f2ed;border-radius:9px;padding:14px}.metrics strong{display:block;font-size:28px}.card-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card-group{border:1px solid #dce4df;border-radius:9px;padding:12px}.card-group h4{margin:0 0 8px}.card-chips{display:flex;flex-wrap:wrap;gap:7px}.card-chip{display:grid;grid-template-columns:1fr auto;gap:0 8px;align-items:center;background:#edf3ef;border-radius:7px;padding:6px 8px;min-width:120px}.card-chip small{grid-column:1/-1;color:#607168}.kingdom-links{display:flex;flex-wrap:wrap;gap:8px}.kingdom-links a{color:#174c38;background:#e8f2ed;border-radius:7px;padding:8px 10px;text-decoration:none}.kingdom-links a:hover{text-decoration:underline}.table-wrap{overflow:auto;border:1px solid #dce4df;border-radius:8px;margin:10px 0 22px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e4e9e6}th{background:#edf3ef;font-size:12px;text-transform:uppercase}.strategy-table table{min-width:1000px;white-space:normal}.strategy-table td:nth-child(4),.strategy-table td:nth-child(5){min-width:320px}tr:last-child td{border-bottom:0}code{font-size:12px}@media(max-width:700px){main{padding:20px 10px}.metrics{grid-template-columns:1fr}section{padding:14px}.card-groups{grid-template-columns:1fr}}
</style></head><body><main><h1>Card balance directional smoke</h1><p class="lede">Before and after comparison for the exact eight smoke kingdoms. Each kingdom has equal weight. Within a kingdom, both players use the stored equilibrium lottery.</p>
<section class="warning"><h2>Directional smoke, not final balance evidence</h2><p>This small run checks the direction of the agreed card changes. It does not replace the completed 30-kingdom evidence.</p></section>
<section><h2>Run shape</h2><p>Goldfish used Modal Functions with 16 cores per score container and at most 512 active score CPUs. Matrix ran locally with unchanged rules. Local PSRO capped each confirmed queue at 100; thresholds, depths, admission, solver, and stopping rules stayed unchanged.</p><div class="metrics"><div><strong>${fixed(report.crossKingdom.supportSize.before)} → ${fixed(report.crossKingdom.supportSize.after)}</strong>Mean support size</div><div><strong>${fixed(report.crossKingdom.effectiveSize.before)} → ${fixed(report.crossKingdom.effectiveSize.after)}</strong>Mean effective size</div></div></section>
<section><h2>Equilibrium-weighted archetype shares</h2>${archetypes}</section><section><h2>Changed-card acquisition</h2><p>Copies are expected acquired copies per player side. Selection is the equilibrium share of strategies that start with or acquire the card.</p>${cards}</section><section><h2>Played-card family damage</h2>${families}</section>
<section><h2>Kingdom explorer</h2><p>Open a kingdom to compare its available cards, equilibrium strategies, archetype shares, and damage shares.</p><nav class="kingdom-links">${report.kingdoms.map((kingdom) => `<a href="#${escape(kingdom.kingdomId)}">${escape(kingdom.kingdomId)}</a>`).join('')}</nav></section>
${kingdomSections}<script id="card-balance-smoke-data" type="application/json">${embedded}</script></main></body></html>\n`;
}

function deterministicProvenance(): RustStrategySearchSourceProvenanceV2 {
  return { schemaVersion: 2, protocol: 'rust-strategy-search-source-provenance-v2',
    kingdomIds: [...CARD_BALANCE_SMOKE_KINGDOM_IDS],
    scientificImplementationCommits: { goldfish: '0'.repeat(40), matrix: '0'.repeat(40),
      psro: '0'.repeat(40), selfPlayTelemetry: '0'.repeat(40) },
    currentVerifierAndBackfillBinarySha256: '0'.repeat(64), executions: [] };
}
function loadAfter(options: CardBalanceSmokeReportOptions): RustBalanceAnalysisV2 {
  const evidence = CARD_BALANCE_SMOKE_KINGDOM_IDS.map((kingdomId) => {
    const base = path.join(options.root, kingdomId);
    return loadRustStrategySearchKingdomEvidence({ kingdomId,
      topFile: path.join(base, 'goldfish', 'top-500000.hgf'),
      reservoirFile: path.join(base, 'goldfish', 'reservoir.hgf'),
      initialMatrixDir: path.join(base, 'matrix'), psroDir: path.join(base, 'psro') },
    { binary: options.binary });
  });
  return buildRustBalanceAnalysis(evidence, deterministicProvenance());
}
function parseOptions(args: readonly string[]): CardBalanceSmokeReportOptions {
  const options = { baseline: DEFAULT_BASELINE, root: DEFAULT_ROOT, binary: DEFAULT_BINARY,
    json: DEFAULT_JSON, html: DEFAULT_HTML };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!value) throw new Error(`${name} needs a value.`);
    if (name === '--baseline') options.baseline = value;
    else if (name === '--root') options.root = value;
    else if (name === '--binary') options.binary = value;
    else if (name === '--json') options.json = value;
    else if (name === '--html') options.html = value;
    else throw new Error(`Unknown option ${name}.`);
  }
  return options;
}
function writeAtomically(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents); fs.renameSync(temporary, file);
}
export function generateCardBalanceSmokeReport(options: CardBalanceSmokeReportOptions): CardBalanceSmokeComparison {
  const baselineBytes = fs.readFileSync(options.baseline);
  const before = JSON.parse(baselineBytes.toString('utf8')) as RustBalanceAnalysisV2;
  if (before.schemaVersion !== 2 || before.protocol !== 'rust-strategy-search-balance-v2') {
    throw new Error('Baseline report is not rust-strategy-search-balance-v2.');
  }
  const report = compareCardBalanceSmoke({ before, after: loadAfter(options),
    baselineReportSha256: sha256(baselineBytes) });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeAtomically(options.json, json);
  writeAtomically(options.html, renderCardBalanceSmokeReport(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseOptions(process.argv.slice(2));
  const report = generateCardBalanceSmokeReport(options);
  process.stdout.write(`${JSON.stringify({ json: options.json, html: options.html,
    kingdomCount: report.scope.kingdomCount })}\n`);
}
