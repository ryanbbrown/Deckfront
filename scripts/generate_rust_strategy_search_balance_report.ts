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

function validateConsolidatedManifest(root: string, kingdomIds: readonly string[]): void {
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
function rows(values: readonly string[][]): string { return `<tbody>${values.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`; }
function table(headings: readonly string[], values: readonly string[][]): string {
  return `<div class="table-wrap"><table><thead><tr>${headings.map((heading) => `<th>${escape(heading)}</th>`).join('')}</tr></thead>${rows(values)}</table></div>`;
}
function outlierTable(title: string, entries: RustBalanceAnalysisV2['outliers']['pairScoreSkew75']): string {
  return `<section><h3>${escape(title)}</h3>${table(['Kingdom', 'Metric', 'Strategy', 'Opponent', 'Card', 'Family'], entries.map((row) => [
    escape(row.kingdomId), number(row.metric), escape(row.strategyNumber ?? '—'), escape(row.opponentNumber ?? '—'),
    escape(row.cardId ?? '—'), escape(row.family ?? '—')]))}</section>`;
}

export function renderRustBalanceReport(analysis: RustBalanceAnalysisV2): string {
  const archetypes = table(['Archetype', 'Selected', 'Mean minimum', 'Mean maximum', 'Selected kingdoms', 'Feasible kingdoms'],
    analysis.crossKingdom.archetypes.map((row) => [escape(row.archetype), percent(row.selectedShare),
      percent(row.meanMinimumFeasibleShare), percent(row.meanMaximumFeasibleShare), String(row.selectedKingdomCount), String(row.feasibleKingdomCount)]));
  const cards = table(['Card', 'Offered kingdoms', 'Kingdoms with use', 'Acquisition presence', 'Selection presence', 'Mean owned copies'],
    analysis.crossKingdom.cards.map((row) => [escape(row.cardId), String(row.offeredKingdomCount), String(row.positiveUsageKingdomCount),
      percent(row.meanEquilibriumAcquisitionRate), percent(row.meanEquilibriumSelectionRate), number(row.meanEquilibriumOwnedCopies)]));
  const families = table(['Family', 'Expected damage / player side', 'Mean kingdom share'],
    analysis.crossKingdom.familyDamage.map((row) => [escape(row.family), number(row.meanExpectedDamagePerPlayerSide),
      percent(row.meanKingdomShare)]));
  const kingdomSections = analysis.kingdoms.map((kingdom) => {
    const mix = table(['Strategy', 'Weight', 'Archetype', 'Feasible minimum', 'Feasible maximum', 'Score against selected mix'],
      kingdom.strategies.map((strategy) => [escape(strategy.strategyId), percent(strategy.selectedWeight), escape(strategy.archetype),
        percent(strategy.feasibleWeightRange.minimum), percent(strategy.feasibleWeightRange.maximum),
        `${strategy.selectedLotteryScorePercent.toFixed(2)}%`]));
    const ranges = table(['Archetype', 'Selected', 'Minimum', 'Maximum'], kingdom.archetypes.map((row) => [escape(row.archetype),
      percent(row.selectedShare), percent(row.minimumFeasibleShare), percent(row.maximumFeasibleShare)]));
    const definitions = table(['Strategy', 'Goldfish rank', 'Buy definition'], kingdom.strategies.map((strategy) => [
      escape(strategy.strategyId), String(strategy.goldfishRank),
      escape(strategy.buySteps.map((step) => `${step.cardId} × ${step.desiredCount}`).join(' → '))]));
    const cardUse = table(['Card', 'Acquisition presence', 'Selection presence', 'Mean owned copies', 'Expected acquired copies / player side'],
      kingdom.cards.map((card) => [escape(card.cardId), percent(card.equilibriumAcquisitionRate),
        percent(card.equilibriumSelectionRate), number(card.equilibriumMeanOwnedCopies),
        number(card.expectedAcquiredCopiesPerPlayerSide)]));
    const damage = table(['Family', 'Expected damage / player side', 'Share'], kingdom.familyDamage.map((row) => [
      escape(row.family), number(row.expectedDamagePerPlayerSide), percent(row.share)]));
    const pairEvidence = table(['First strategy', 'Second strategy', 'First-75 score', 'All-125 score', 'Point bytes 0–4'],
      kingdom.pairedScoreEvidence.pairs.map((pair) => [escape(pair.firstStrategyNumber), escape(pair.secondStrategyNumber),
        `${pair.percent75.toFixed(2)}%`, `${pair.percent125.toFixed(2)}%`, pair.byteCounts.join(', ')]));
    const source = table(['Path', 'Bytes', 'SHA-256'], kingdom.sourceFiles.map((file) => [escape(file.path), String(file.bytes), `<code>${escape(file.sha256)}</code>`]));
    const matrix = table(['Strategy', ...kingdom.strategies.map((row) => row.strategyId)], kingdom.pairedScoreEvidence.percentages75.map((row, index) =>
      [escape(kingdom.strategies[index]!.strategyId), ...row.map((value) => `${value.toFixed(2)}%`)]));
    const audit = table(['Strategy', 'Off-diagonal player sides', 'Diagonal player sides'],
      kingdom.auditTelemetry.strategies.map((row) => [escape(row.strategyNumber), String(row.offDiagonal.playerSides), String(row.diagonal.playerSides)]));
    return `<section class="kingdom"><h2>${escape(kingdom.kingdom.name)}</h2><p>${kingdom.completion.finalStrategyCount} final strategies; ${kingdom.completion.admissions} admissions; support ${kingdom.equilibrium.supportSize}; effective size ${number(kingdom.equilibrium.effectiveSize)}.</p>
      <p>${escape(kingdom.telemetryBasis)}.</p><h3>Selected mix and strategy ranges</h3>${mix}<h3>Archetype ranges</h3>${ranges}
      <h3>Equilibrium self-play card acquisition usage</h3>${cardUse}<h3>Equilibrium self-play family damage</h3>${damage}
      <details><summary>Strategy definitions</summary>${definitions}</details><details><summary>Unweighted full-Matrix observed counts (audit only)</summary>${audit}</details>
      <details><summary>Paired-game score evidence</summary>${pairEvidence}</details><details><summary>Complete 75-seed score matrix</summary>${matrix}</details>
      <details><summary>Source hashes</summary>${source}</details></section>`;
  }).join('\n');
  const embedded = stringifyRustBalanceAnalysis(analysis).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rust strategy-search balance analysis</title><style>
:root{color-scheme:light dark;font:16px/1.45 system-ui,sans-serif}body{margin:0;background:#10141b;color:#edf2f7}main{max-width:1440px;margin:auto;padding:28px}h1,h2,h3{line-height:1.15}section{margin:30px 0;padding:20px;background:#18202b;border:1px solid #334155;border-radius:12px}.limits{border-color:#eab308;background:#30290f}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #334155;white-space:nowrap}th{position:sticky;top:0;background:#202b39}code{font-size:.78rem}details{margin:16px 0}summary{cursor:pointer;font-weight:700}.lede{max-width:80ch;color:#cbd5e1}@media print{body{background:#fff;color:#111}section{break-inside:avoid;background:#fff;border-color:#aaa}th{background:#eee}}
</style></head><body><main><h1>Rust strategy-search balance analysis</h1>
<p class="lede">Equal-weight analysis of ${analysis.scope.kingdomCount} kingdoms in the ${escape(analysis.scope.suiteId)} tuning set. Within each kingdom, both the acting strategy and opponent use the stored equilibrium weights.</p>
<section class="limits"><h2>Evidence limits</h2><p>Same-strategy purchases and family damage are available from 500 player sides per strategy. The payoff diagonal remains fixed at 50% and does not use those games.</p><p>A paired point byte of 2 can mean one success and one failure, or two ties. Exact W/D/L and first-player outcome rates are not available. Card-play counts, per-card damage, and turns-to-finish are also absent.</p></section>
<section><h2>Source and verification</h2><p>The completed scientific evidence is trusted from its recorded deep verification. Report generation checks file structure, CRCs, source links, checkpoint completion, selected Matrix order, and HST evidence without replaying Goldfish, Matrix, or PSRO. Provenance SHA-256: <code>${escape(analysis.provenance.provenanceFileSha256)}</code>. Backfill and audit binary SHA-256: <code>${escape(analysis.provenance.verifierBinarySha256)}</code>.</p></section>
<section><h2>Archetype shares and full feasible ranges</h2>${archetypes}</section>
<section><h2>Support and effective sizes</h2>${table(['Measure','Minimum','Median','Mean','Maximum'], [
    ['Support size', number(analysis.crossKingdom.supportSize.minimum), number(analysis.crossKingdom.supportSize.median), number(analysis.crossKingdom.supportSize.mean), number(analysis.crossKingdom.supportSize.maximum)],
    ['Effective size', number(analysis.crossKingdom.effectiveSize.minimum), number(analysis.crossKingdom.effectiveSize.median), number(analysis.crossKingdom.effectiveSize.mean), number(analysis.crossKingdom.effectiveSize.maximum)]])}</section>
<section><h2>Card offering and equilibrium acquisition usage</h2><p>Usage means acquired copies, not card plays. Each kingdom has equal weight.</p>${cards}</section>
<section><h2>Equilibrium family damage</h2>${families}</section>
<section><h2>Paired-game score evidence</h2><p>Point bytes 0–4: ${analysis.crossKingdom.pairedScoreEvidence.byteCounts.join(', ')}. Ambiguous byte-2 share: ${percent(analysis.crossKingdom.pairedScoreEvidence.byteTwoShare)}.</p></section>
<section><h2>Outliers to inspect</h2>${outlierTable('All-125 score skew', analysis.outliers.pairScoreSkew125)}${outlierTable('First-75 score skew', analysis.outliers.pairScoreSkew75)}${outlierTable('Low effective size', analysis.outliers.lowestEffectiveSize)}${outlierTable('High equilibrium acquisition intensity', analysis.outliers.equilibriumCardCopiesPerPlayerSide)}${outlierTable('High equilibrium family damage', analysis.outliers.equilibriumFamilyDamagePerPlayerSide)}</section>
${kingdomSections}<script id="rust-balance-analysis" type="application/json">${embedded}</script></main></body></html>\n`;
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
