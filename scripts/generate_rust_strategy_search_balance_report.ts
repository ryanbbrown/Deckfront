import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import rawSmokeManifest from '../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import {
  buildRustBalanceAnalysis, stringifyRustBalanceAnalysis
} from '../src/sim/rustStrategySearchBalance';
import type {
  RustBalanceAnalysisV2, RustStrategySearchExecutionProvenance, RustStrategySearchSourceProvenanceV2
} from '../src/sim/rustStrategySearchBalance';
import { loadRustStrategySearchKingdomEvidence } from '../src/sim/rustStrategySearchEvidence';

const DEFAULT_ROOT = path.join('.data', 'strategy-search-30');
const DEFAULT_BINARY = path.join('rust', 'target', 'release', 'hexdeck-goldfish');
const DEFAULT_PROVENANCE = path.join(DEFAULT_ROOT, 'source-provenance-v2.json');
const DEFAULT_JSON = path.join(DEFAULT_ROOT, 'rust-balance-analysis-v2.json');
const DEFAULT_HTML = path.join('.html', 'strategy-search-30-rust-balance-v2.html');
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;

export interface CliOptions {
  root: string;
  binary: string;
  provenance: string;
  json: string;
  html: string;
}

function sha256(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function fileSha256(file: string): string { return sha256(fs.readFileSync(file)); }
function regularFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${label} must be a string array.`);
  return value as string[];
}
function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256.`);
  return value;
}
function commit(value: unknown, label: string): string {
  if (typeof value !== 'string' || !GIT_SHA.test(value)) throw new Error(`${label} must be a full lowercase Git SHA.`);
  return value;
}
function optionalDigest(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return digest(value, label);
}
function optionalCommit(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return commit(value, label);
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string.`);
  return value;
}

function parseExecution(value: unknown, index: number): RustStrategySearchExecutionProvenance {
  const row = object(value, `executions[${index}]`), stage = row.stage;
  if (!Number.isInteger(row.ordinal) || row.ordinal !== index + 1) throw new Error(`executions[${index}].ordinal differs from its order.`);
  if (stage !== 'goldfish' && stage !== 'matrix' && stage !== 'psro' && stage !== 'self-play-telemetry') {
    throw new Error(`executions[${index}].stage is invalid.`);
  }
  const gitCommit = optionalCommit(row.gitCommit, `executions[${index}].gitCommit`);
  const sourceDigest = optionalDigest(row.sourceDigest, `executions[${index}].sourceDigest`);
  const deploymentDigest = optionalDigest(row.deploymentDigest, `executions[${index}].deploymentDigest`);
  if (!gitCommit && !sourceDigest && !deploymentDigest) throw new Error(`executions[${index}] lacks a build or deployment identity.`);
  const report = object(row.report, `executions[${index}].report`);
  const reportPath = nonempty(report.path, `executions[${index}].report.path`).split(path.sep).join('/');
  if (path.isAbsolute(reportPath) || reportPath === '..' || reportPath.startsWith('../')) {
    throw new Error(`executions[${index}].report.path must be repository-relative.`);
  }
  const reportHash = digest(report.sha256, `executions[${index}].report.sha256`);
  const binarySha256 = optionalDigest(row.binarySha256, `executions[${index}].binarySha256`);
  const binarySha256UnavailableReason = row.binarySha256UnavailableReason === undefined ? undefined
    : nonempty(row.binarySha256UnavailableReason, `executions[${index}].binarySha256UnavailableReason`);
  if (Boolean(binarySha256) === Boolean(binarySha256UnavailableReason)) {
    throw new Error(`executions[${index}] needs exactly one binary hash or unavailable reason.`);
  }
  regularFile(path.resolve(reportPath));
  if (fileSha256(path.resolve(reportPath)) !== reportHash) throw new Error(`Execution report hash differs: ${reportPath}`);
  return { ordinal: index + 1, stage, coveredKingdomIds: stringArray(row.coveredKingdomIds,
    `executions[${index}].coveredKingdomIds`), ...(gitCommit ? { gitCommit } : {}),
    ...(sourceDigest ? { sourceDigest } : {}), ...(deploymentDigest ? { deploymentDigest } : {}),
    report: { path: reportPath, sha256: reportHash },
    ...(binarySha256 ? { binarySha256 } : {}),
    ...(binarySha256UnavailableReason ? { binarySha256UnavailableReason } : {}) };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateCoverage(executions: readonly RustStrategySearchExecutionProvenance[], kingdomIds: readonly string[]): void {
  const expected = new Set(kingdomIds);
  for (const stage of ['goldfish', 'matrix', 'psro', 'self-play-telemetry'] as const) {
    const covered = executions.filter((execution) => execution.stage === stage).flatMap((execution) => execution.coveredKingdomIds);
    if (covered.length !== kingdomIds.length || new Set(covered).size !== covered.length
      || covered.some((kingdomId) => !expected.has(kingdomId))) throw new Error(`${stage} execution coverage must assign every smoke kingdom exactly once.`);
  }
}

export function validateConsolidatedManifest(root: string, kingdomIds: readonly string[]): void {
  for (const name of ['goldfish-manifest.json', 'matrix-batch-report.json', 'psro-batch-report.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    regularFile(file);
    const held = object(JSON.parse(fs.readFileSync(file, 'utf8')), name);
    const rows = Array.isArray(held.kingdoms) ? held.kingdoms : [];
    const ids = rows.flatMap((row) => {
      const record = object(row, `${name}.kingdoms`);
      return typeof record.kingdomId === 'string' ? [record.kingdomId] : [];
    });
    if (ids.length && (!sameStrings(ids, kingdomIds) || new Set(ids).size !== ids.length)) {
      throw new Error(`${name} kingdom coverage contradicts the smoke manifest.`);
    }
    if (held.allValid === false || Array.isArray(held.missingKingdomIds) && held.missingKingdomIds.length) {
      throw new Error(`${name} is incomplete or invalid.`);
    }
  }
}

export function loadSourceProvenance(file: string, binary: string, root: string): RustStrategySearchSourceProvenanceV2 {
  regularFile(file); regularFile(binary);
  const raw = object(JSON.parse(fs.readFileSync(file, 'utf8')), 'source provenance');
  if (raw.schemaVersion !== 2 || raw.protocol !== 'rust-strategy-search-source-provenance-v2') {
    throw new Error('Source provenance version or protocol is invalid.');
  }
  const smokeIds = (rawSmokeManifest as { selectedKingdomIds: string[] }).selectedKingdomIds;
  const kingdomIds = stringArray(raw.kingdomIds, 'kingdomIds');
  if (!sameStrings(kingdomIds, smokeIds)) throw new Error('Source provenance kingdom IDs differ from balance-smoke-v1.');
  const commits = object(raw.scientificImplementationCommits, 'scientificImplementationCommits');
  const scientificImplementationCommits = { goldfish: commit(commits.goldfish, 'goldfish implementation commit'),
    matrix: commit(commits.matrix, 'matrix implementation commit'), psro: commit(commits.psro, 'psro implementation commit'),
    selfPlayTelemetry: commit(commits.selfPlayTelemetry, 'self-play telemetry implementation commit') };
  const currentVerifierAndBackfillBinarySha256 = digest(raw.currentVerifierAndBackfillBinarySha256,
    'current verifier and backfill binary');
  const verifierBinarySha256 = fileSha256(binary);
  if (currentVerifierAndBackfillBinarySha256 !== verifierBinarySha256) {
    throw new Error('Current verifier and backfill hash differs from the supplied binary.');
  }
  if (!Array.isArray(raw.executions) || !raw.executions.length) throw new Error('Source provenance needs ordered executions.');
  const executions = raw.executions.map(parseExecution);
  validateCoverage(executions, kingdomIds);
  for (const execution of executions) {
    if (execution.stage === 'self-play-telemetry'
      && execution.binarySha256 !== currentVerifierAndBackfillBinarySha256) {
      throw new Error('Self-play telemetry execution binary hash is missing or contradictory.');
    }
  }
  validateConsolidatedManifest(root, kingdomIds);
  return { schemaVersion: 2, protocol: 'rust-strategy-search-source-provenance-v2', kingdomIds,
    scientificImplementationCommits, currentVerifierAndBackfillBinarySha256, executions,
    provenanceFileSha256: fileSha256(file), verifierBinarySha256 };
}

export function loadRustBalanceReportInputs(options: CliOptions): RustBalanceAnalysisV2 {
  const provenance = loadSourceProvenance(options.provenance, options.binary, options.root);
  const evidence = provenance.kingdomIds.map((kingdomId, index) => {
    const base = path.join(options.root, kingdomId);
    const result = loadRustStrategySearchKingdomEvidence({ kingdomId,
      topFile: path.join(base, 'goldfish', 'top-500000.hgf'),
      reservoirFile: path.join(base, 'goldfish', 'reservoir.hgf'),
      initialMatrixDir: path.join(base, 'matrix'), psroDir: path.join(base, 'psro') }, { binary: options.binary });
    if ((index + 1) % 5 === 0) {
      const stat = fs.statfsSync(options.root);
      process.stderr.write(`Checked ${index + 1}/${provenance.kingdomIds.length}; ${(Number(stat.bavail) * Number(stat.bsize) / 2 ** 30).toFixed(1)} GiB available.\n`);
    }
    return result;
  });
  if (evidence.some((row) => row.adapterVerification.binarySha256 !== provenance.verifierBinarySha256)) {
    throw new Error('Per-kingdom adapter binary hash differs from provenance.');
  }
  return buildRustBalanceAnalysis(evidence, provenance);
}

function escape(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function number(value: number): string { return value.toFixed(4); }
function rows(values: readonly string[][]): string {
  return `<tbody>${values.map((row) => `<tr>${row.map((cell, index) => index === 0
    ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function table(headings: readonly string[], values: readonly string[][], caption?: string): string {
  return `<div class="table-wrap"><table>${caption ? `<caption class="sr-only">${escape(caption)}</caption>` : ''}<thead><tr>${headings.map((heading) => `<th scope="col">${escape(heading)}</th>`).join('')}</tr></thead>${rows(values)}</table></div>`;
}

export interface ArchetypeDominanceInput {
  kingdomId: string;
  archetypes: ReadonlyArray<{ archetype: string; selectedShare: number }>;
  strategies: ReadonlyArray<{ archetype: string; strategyId: string; selectedLotteryScorePercent: number }>;
}

export interface ArchetypeDominanceRow {
  kingdomId: string;
  winningArchetypes: string[];
  selectedShare: number;
  alternative: null | {
    archetype: string;
    strategyId: string;
    selectedLotteryScorePercent: number;
    gapBelowFiftyPercent: number;
  };
}

export function strongestNonWinningArchetype(input: ArchetypeDominanceInput): ArchetypeDominanceRow {
  if (!input.archetypes.length) throw new Error(`${input.kingdomId}: no classified archetypes.`);
  const selectedShare = Math.max(...input.archetypes.map((row) => row.selectedShare));
  const winningArchetypes = input.archetypes.filter((row) => row.selectedShare === selectedShare)
    .map((row) => row.archetype);
  const winners = new Set(winningArchetypes);
  const alternative = input.strategies.reduce<ArchetypeDominanceInput['strategies'][number] | null>((best, strategy) => {
    if (winners.has(strategy.archetype)) return best;
    return !best || strategy.selectedLotteryScorePercent > best.selectedLotteryScorePercent ? strategy : best;
  }, null);
  return { kingdomId: input.kingdomId, winningArchetypes, selectedShare,
    alternative: alternative ? { archetype: alternative.archetype, strategyId: alternative.strategyId,
      selectedLotteryScorePercent: alternative.selectedLotteryScorePercent,
      gapBelowFiftyPercent: Math.max(0, 50 - alternative.selectedLotteryScorePercent) } : null };
}

function familyName(family: string): string {
  return ({ mana: 'Mage', melee: 'Melee', ranged: 'Ranged', engine: 'Engine', treasure: 'Treasure' } as Record<string, string>)[family] ?? family;
}

function barList(values: ReadonlyArray<{ label: string; value: number }>, label: string): string {
  const tones = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
  return `<div class="bar-list" role="img" aria-label="${escape(label)}">${values.map((row, index) =>
    `<div class="bar-row"><span class="bar-label">${escape(row.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, row.value * 100)).toFixed(2)}%;background:${tones[index % tones.length]}"></span></span><strong>${percent(row.value)}</strong></div>`).join('')}</div>`;
}

export function renderRustBalanceReport(analysis: RustBalanceAnalysisV2): string {
  const cardNames = new Map(analysis.kingdoms.flatMap((kingdom) => kingdom.kingdom.offeredCards.map((card) => [card.id, card.name] as const)));
  const archetypeRows = analysis.crossKingdom.archetypes.filter((row) => row.selectedKingdomCount > 0)
    .sort((left, right) => right.selectedShare - left.selectedShare || left.archetype.localeCompare(right.archetype));
  const damageRows = [...analysis.crossKingdom.familyDamage].sort((left, right) => right.meanKingdomShare - left.meanKingdomShare);
  const cardRows = [...analysis.crossKingdom.cards].sort((left, right) => right.meanEquilibriumSelectionRate - left.meanEquilibriumSelectionRate
    || left.cardId.localeCompare(right.cardId));
  const archetypes = table(['Archetype', 'Metagame share', 'Mean feasible minimum', 'Mean feasible maximum', 'Kingdoms selected'],
    archetypeRows.map((row) => [escape(row.archetype), percent(row.selectedShare), percent(row.meanMinimumFeasibleShare),
      percent(row.meanMaximumFeasibleShare), `${row.selectedKingdomCount} / ${analysis.scope.kingdomCount}`]));
  const cards = table(['Card', 'Offered in', 'Selected when offered', 'Acquired by selected strategy', 'Expected buys / player side', 'Mean owned copies'],
    cardRows.map((row) => [escape(cardNames.get(row.cardId) ?? row.cardId), `${row.offeredKingdomCount} kingdoms`,
      percent(row.meanEquilibriumSelectionRate), percent(row.meanEquilibriumAcquisitionRate),
      number(row.meanExpectedAcquiredCopiesPerPlayerSide), number(row.meanEquilibriumOwnedCopies)]));
  const families = table(['Damage family', 'Metagame damage share', 'Expected damage / player side'], damageRows.map((row) => [
    escape(familyName(row.family)), percent(row.meanKingdomShare), number(row.meanExpectedDamagePerPlayerSide)]));
  const selectedStrategyCount = analysis.kingdoms.reduce((total, kingdom) => total + kingdom.equilibrium.supportSize, 0);
  const singleStrategyKingdoms = analysis.kingdoms.filter((kingdom) => kingdom.equilibrium.supportSize === 1).length;
  const kingdomLinks = analysis.kingdoms.map((kingdom) => `<a href="#${escape(kingdom.kingdom.id)}">${escape(kingdom.kingdom.id.replace('balance-tuning-', ''))}</a>`).join('');
  const kingdomSections = analysis.kingdoms.map((kingdom) => {
    const selectedStrategies = kingdom.strategies.filter((strategy) => strategy.supportMember)
      .sort((left, right) => right.selectedWeight - left.selectedWeight || left.strategyNumber - right.strategyNumber);
    const selectedLabels = new Set(selectedStrategies.map((strategy) => strategy.archetype));
    const selectedArchetypes = kingdom.archetypes.filter((row) => selectedLabels.has(row.archetype))
      .sort((left, right) => right.selectedShare - left.selectedShare || left.archetype.localeCompare(right.archetype));
    const selectedCards = [...kingdom.cards].sort((left, right) => right.equilibriumSelectionRate - left.equilibriumSelectionRate
      || left.cardId.localeCompare(right.cardId));
    const selectedDamage = [...kingdom.familyDamage].sort((left, right) => right.share - left.share);
    const mix = table(['Strategy', 'Weight', 'Archetype', 'Score against metagame', 'Goldfish rank', 'Purchase priority'],
      selectedStrategies.map((strategy) => [escape(strategy.strategyId), percent(strategy.selectedWeight), escape(strategy.archetype),
        `${strategy.selectedLotteryScorePercent.toFixed(2)}%`, String(strategy.goldfishRank),
        `<span class="wrap">${escape(strategy.buySteps.map((step) => `${cardNames.get(step.cardId) ?? step.cardId} × ${step.desiredCount}`).join(' → '))}</span>`]),
    `Selected strategies for ${kingdom.kingdom.name}`);
    const ranges = table(['Archetype', 'Selected share', 'Feasible minimum', 'Feasible maximum'], selectedArchetypes.map((row) => [
      escape(row.archetype), percent(row.selectedShare), percent(row.minimumFeasibleShare), percent(row.maximumFeasibleShare)]));
    const cardUse = table(['Card', 'Selected', 'Acquired', 'Expected buys / player side', 'Mean owned copies'], selectedCards.map((card) => [
      escape(cardNames.get(card.cardId) ?? card.cardId), percent(card.equilibriumSelectionRate), percent(card.equilibriumAcquisitionRate),
      number(card.expectedAcquiredCopiesPerPlayerSide), number(card.equilibriumMeanOwnedCopies)]));
    const damage = table(['Damage family', 'Share', 'Expected damage / player side'], selectedDamage.map((row) => [
      escape(familyName(row.family)), percent(row.share), number(row.expectedDamagePerPlayerSide)]));
    const source = table(['Path', 'Bytes', 'SHA-256'], kingdom.sourceFiles.map((file) => [escape(file.path), String(file.bytes),
      `<code>${escape(file.sha256)}</code>`]));
    return `<section class="kingdom" id="${escape(kingdom.kingdom.id)}"><div class="section-heading"><div><p class="eyebrow">${escape(kingdom.kingdom.id)}</p><h2>${escape(kingdom.kingdom.name)}</h2></div><a href="#top">Back to top</a></div>
      <p class="summary">${kingdom.equilibrium.supportSize} selected ${kingdom.equilibrium.supportSize === 1 ? 'strategy' : 'strategies'} from ${kingdom.completion.finalStrategyCount} evaluated; ${kingdom.completion.admissions} PSRO admissions; effective strategy count ${number(kingdom.equilibrium.effectiveSize)}.</p>
      <div class="two-up"><div><h3>Archetype metagame</h3>${barList(selectedArchetypes.map((row) => ({ label: row.archetype, value: row.selectedShare })), `${kingdom.kingdom.name} archetype shares`)}${ranges}</div>
      <div><h3>Damage by card family</h3>${barList(selectedDamage.map((row) => ({ label: familyName(row.family), value: row.share })), `${kingdom.kingdom.name} damage shares`)}${damage}</div></div>
      <h3>Card selection priority</h3><p class="note">Selected is the equilibrium chance that a strategy starts with or acquires the card. Acquired excludes starting cards.</p>${cardUse}
      <details><summary>Show ${selectedStrategies.length} selected ${selectedStrategies.length === 1 ? 'strategy' : 'strategies'}</summary>${mix}</details>
      <details><summary>Show source hashes</summary>${source}</details></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>30-kingdom metagame balance report</title><style>
:root{color-scheme:light;--surface:#f7f7f4;--panel:#fff;--panel-alt:#f0f1ed;--text:#171815;--muted:#60645d;--border:#d7d9d2;--accent:#285f96;--series-1:#2774ae;--series-2:#d7662f;--series-3:#278c6d;--series-4:#a66bb6;--series-5:#b58a16;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#121512;--panel:#1a1e1a;--panel-alt:#222722;--text:#f4f5f1;--muted:#b7bdb4;--border:#3a413a;--accent:#78b7f1;--series-1:#4f9bd3;--series-2:#e47b4b;--series-3:#49b38f;--series-4:#bd89ca;--series-5:#d2aa3e}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--surface);color:var(--text)}main{max-width:1220px;margin:auto;padding:36px 22px 80px}h1,h2,h3{line-height:1.15;text-wrap:balance}h1{font-size:clamp(2rem,5vw,3.6rem);margin:.15em 0}h2{font-size:clamp(1.5rem,3vw,2.15rem);margin:0}h3{font-size:1.05rem;margin:26px 0 10px}p{max-width:78ch;text-wrap:pretty}.lede{font-size:1.12rem;color:var(--muted)}.eyebrow{margin:0;color:var(--accent);font-size:.78rem;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:28px 0}.metric{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}.metric strong{display:block;font-size:1.8rem;font-variant-numeric:tabular-nums}.metric span{color:var(--muted);font-size:.83rem}.overview,.kingdom,.method{margin:28px 0;padding:22px;background:var(--panel);border:1px solid var(--border);border-radius:14px}.two-up{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.two-up>div{min-width:0}.bar-list{display:grid;gap:9px;margin:14px 0 20px}.bar-row{display:grid;grid-template-columns:minmax(105px,1fr) minmax(130px,2.5fr) 68px;gap:10px;align-items:center;font-size:.9rem}.bar-track{height:11px;background:var(--panel-alt);border-radius:999px;overflow:hidden}.bar-fill{display:block;height:100%;border-radius:inherit}.bar-row strong{text-align:end;font-variant-numeric:tabular-nums}.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:10px}table{width:100%;border-collapse:collapse;font-size:.87rem}th,td{text-align:start;padding:9px 11px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap}thead th{background:var(--panel-alt);color:var(--muted);font-size:.78rem}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}.wrap{display:inline-block;max-width:46ch;white-space:normal;overflow-wrap:break-word}.section-heading{display:flex;align-items:start;justify-content:space-between;gap:20px}.section-heading a,.kingdom-nav a{color:var(--accent);text-underline-position:from-font;text-decoration-thickness:from-font}.summary,.note{color:var(--muted)}.kingdom-nav{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.kingdom-nav a{display:inline-grid;place-items:center;min-width:40px;min-height:40px;border:1px solid var(--border);border-radius:8px;text-decoration:none;background:var(--panel)}details{margin-top:18px}summary{cursor:pointer;font-weight:700;min-height:40px;padding-block:8px}code{font-size:.78rem;overflow-wrap:break-word}.method{border-inline-start:5px solid var(--series-5)}.method li{margin:.45em 0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:820px){.metrics,.two-up{grid-template-columns:1fr 1fr}.bar-row{grid-template-columns:100px 1fr 62px}}@media(max-width:580px){main{padding:24px 14px 60px}.metrics,.two-up{grid-template-columns:1fr}.bar-row{grid-template-columns:90px 1fr 58px}.overview,.kingdom,.method{padding:16px}.section-heading{display:block}.section-heading>a{display:inline-block;margin-top:10px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{:root{color-scheme:light}body{background:#fff}.overview,.kingdom,.method,.metric{break-inside:avoid;background:#fff}}
</style></head><body><main id="top"><p class="eyebrow">Final 30-kingdom search · source ${escape(analysis.provenance.scientificImplementationCommits.goldfish.slice(0, 7))}</p><h1>Metagame balance report</h1>
<p class="lede">Each kingdom has equal weight. Within a kingdom, both players use the stored equilibrium lottery. Archetype classification uses the selected strategy’s observed acquisitions against that lottery.</p>
<div class="metrics"><div class="metric"><span>Kingdoms</span><strong>${analysis.scope.kingdomCount}</strong></div><div class="metric"><span>Selected strategies</span><strong>${selectedStrategyCount}</strong></div><div class="metric"><span>Single-strategy kingdoms</span><strong>${singleStrategyKingdoms}</strong></div><div class="metric"><span>Mean effective strategy count</span><strong>${analysis.crossKingdom.effectiveSize.mean.toFixed(2)}</strong></div></div>
<section class="overview"><h2>Archetype metagame</h2><p class="note">Pure and mixed classifier labels are shown separately. Shares use equilibrium weights, then give each kingdom equal weight.</p>${barList(archetypeRows.map((row) => ({ label: row.archetype, value: row.selectedShare })), 'Cross-kingdom archetype shares')}${archetypes}</section>
<section class="overview"><h2>Damage by card family</h2><p class="note">Damage is weighted by both players’ equilibrium strategy weights. Family share is calculated inside each kingdom before the 30 kingdoms are averaged.</p>${barList(damageRows.map((row) => ({ label: familyName(row.family), value: row.meanKingdomShare })), 'Cross-kingdom damage family shares')}${families}</section>
<section class="overview"><h2>Card selection priority</h2><p class="note">“Selected when offered” is the equilibrium chance that a strategy starts with or acquires the card, averaged equally across kingdoms where that card is offered. It is not a per-shop click rate. “Acquired” excludes starting cards.</p>${cards}</section>
<section class="overview"><h2>Strategy diversity</h2>${table(['Measure','Minimum','Median','Mean','Maximum'], [
    ['Selected strategy count', number(analysis.crossKingdom.supportSize.minimum), number(analysis.crossKingdom.supportSize.median), number(analysis.crossKingdom.supportSize.mean), number(analysis.crossKingdom.supportSize.maximum)],
    ['Effective strategy count', number(analysis.crossKingdom.effectiveSize.minimum), number(analysis.crossKingdom.effectiveSize.median), number(analysis.crossKingdom.effectiveSize.mean), number(analysis.crossKingdom.effectiveSize.maximum)]])}</section>
<nav class="kingdom-nav" aria-label="Kingdom details">${kingdomLinks}</nav>${kingdomSections}
<section class="method"><h2>Method and evidence limits</h2><ul><li>Only strategies with positive selected equilibrium weight appear in this HTML. The companion JSON keeps the complete Matrix evidence.</li><li>Same-strategy purchases and family damage use 500 player sides per strategy. The payoff diagonal stays fixed at 50%.</li><li>Card selection means starting with or acquiring a card. The evidence does not contain card-play counts or per-card damage.</li><li>Report generation checked file structure, CRCs, source links, checkpoint completion, selected Matrix order, and same-strategy telemetry. It did not run a separate deep replay.</li></ul><p class="note">Provenance SHA-256: <code>${escape(analysis.provenance.provenanceFileSha256)}</code><br>Verifier binary SHA-256: <code>${escape(analysis.provenance.verifierBinarySha256)}</code></p></section>
</main></body></html>\n`;
}

function availableBytes(directory: string): number {
  const stat = fs.statfsSync(directory);
  return Number(stat.bavail) * Number(stat.bsize);
}
function sourceTreeBytes(root: string): number {
  let total = 0;
  const visit = (directory: string): void => { for (const name of fs.readdirSync(directory)) {
    const held = path.join(directory, name), stat = fs.lstatSync(held);
    if (stat.isDirectory()) visit(held); else if (stat.isFile()) total += stat.size;
  } };
  visit(root); return total;
}
function writePairAtomically(jsonFile: string, json: string, htmlFile: string, html: string): void {
  for (const file of [jsonFile, htmlFile]) fs.mkdirSync(path.dirname(file), { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const temporary = [jsonFile, htmlFile].map((file) => `${file}.${nonce}.tmp`);
  const backups = [jsonFile, htmlFile].map((file) => `${file}.${nonce}.bak`);
  fs.writeFileSync(temporary[0]!, json); fs.writeFileSync(temporary[1]!, html);
  const existed = [jsonFile, htmlFile].map((file) => fs.existsSync(file));
  try {
    for (let index = 0; index < 2; index += 1) if (existed[index]) fs.renameSync([jsonFile, htmlFile][index]!, backups[index]!);
    fs.renameSync(temporary[0]!, jsonFile); fs.renameSync(temporary[1]!, htmlFile);
    for (let index = 0; index < 2; index += 1) if (existed[index]) fs.rmSync(backups[index]!);
  } catch (error) {
    for (let index = 0; index < 2; index += 1) {
      const final = [jsonFile, htmlFile][index]!;
      if (fs.existsSync(final) && (!existed[index] || fs.existsSync(backups[index]!))) fs.rmSync(final);
      if (fs.existsSync(backups[index]!)) fs.renameSync(backups[index]!, final);
      if (fs.existsSync(temporary[index]!)) fs.rmSync(temporary[index]!);
    }
    throw error;
  }
}

export function generateRustBalanceReport(options: CliOptions): RustBalanceAnalysisV2 {
  const sourceBytes = sourceTreeBytes(options.root), before = availableBytes(options.root);
  process.stderr.write(`Strategy-search evidence uses ${(sourceBytes / 2 ** 30).toFixed(2)} GiB; ${(before / 2 ** 30).toFixed(1)} GiB available.\n`);
  const analysis = loadRustBalanceReportInputs(options), json = stringifyRustBalanceAnalysis(analysis), html = renderRustBalanceReport(analysis);
  const required = Buffer.byteLength(json) + Buffer.byteLength(html) + 64 * 1024 * 1024;
  if (availableBytes(options.root) < required) throw new Error(`Report needs ${required} available bytes for atomic output.`);
  writePairAtomically(options.json, json, options.html, html);
  return analysis;
}

export function parseCli(args: readonly string[]): CliOptions {
  const options: CliOptions = { root: DEFAULT_ROOT, binary: DEFAULT_BINARY, provenance: DEFAULT_PROVENANCE,
    json: DEFAULT_JSON, html: DEFAULT_HTML };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--root') options.root = value;
    else if (flag === '--binary') options.binary = value;
    else if (flag === '--provenance') options.provenance = value;
    else if (flag === '--json') options.json = value;
    else if (flag === '--html') options.html = value;
    else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCli(process.argv.slice(2)), analysis = generateRustBalanceReport(options);
    process.stdout.write(`Wrote ${options.json} and ${options.html} from ${analysis.scope.kingdomCount} kingdoms.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
