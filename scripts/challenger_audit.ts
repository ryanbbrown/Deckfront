import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SeededRandom } from '../src/game';
import { balanceSuite } from '../src/sim/balanceSuite';
import type { BalanceSuiteSplit } from '../src/sim/balanceSuite';
import {
  mixtureSchedule, evaluateCandidates, percentileBootstrapMean
} from '../src/sim/mixtureEvaluation';
import type { BootstrapInterval, CandidateEvaluation, MixtureSchedule } from '../src/sim/mixtureEvaluation';
import type { PairingRunner } from '../src/sim/pairingRunner';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { randomUniqueStrategies } from '../src/sim/randomStrategy';
import { globalAdmission } from '../src/sim/responseOracle';
import { assertDisjointSeedNamespaces, configuredSeedNamespaces } from '../src/sim/seedNamespaces';
import { canonicalStrategy, formatStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { MATERIAL_WEIGHT, loadArtifactDirectory } from './generate_balance_report';
import type { ArtifactSet } from './generate_balance_report';

export const CHALLENGER_AUDIT_CONFIG = Object.freeze({
  version: 'challenger-audit-v1',
  auditSeed: 0xa11d17,
  sampleSeed: 0x51c0ffee,
  sampleSize: 10,
  requiredKingdomId: 'balance-tuning-005',
  candidateCount: 3_000,
  screenBlocks: 5,
  finalistCount: 20,
  confirmationBlocks: 25,
  meanThreshold: 0.52,
  lowerBoundThreshold: 0.5,
  materialWeight: MATERIAL_WEIGHT
});

interface AuditSeedNamespaces {
  candidate: number[];
  screen: number[];
  screenSampling: number[];
  confirmation: number[];
  confirmationSampling: number[];
  bootstrap: number[];
}

export interface AuditProtocol {
  version: string;
  protocolHash: string;
  auditSeed: number;
  candidateCount: number;
  screenBlocks: number;
  finalistCount: number;
  confirmationBlocks: number;
  meanThreshold: number;
  lowerBoundThreshold: number;
  materialWeight: number;
  seeds: AuditSeedNamespaces;
}

export interface AuditChallenger {
  strategy: Strategy;
  screeningMean: number;
  confirmedMean: number;
  interval: BootstrapInterval;
  drawRate: number;
  matches: number;
  admitted: boolean;
}

export interface AuditKingdomResult {
  complete: true;
  kingdomId: string;
  split: BalanceSuiteSplit;
  lotteryPassed: boolean;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  source: {
    schemaVersion: 4;
    rulesFingerprint: string;
    finishedAt: string;
    matrixHash: string;
    discoveredStrategies: number;
    materialStrategies: number;
    materialWeights: Record<string, number>;
  };
  protocol: AuditProtocol;
  generation: { requested: number; actual: number; duplicateRejections: number; shortfall: number };
  screening: { schedule: MixtureSchedule; candidates: number; matches: number;
    finalists: { strategyId: string; mean: number }[] };
  confirmation: { schedule: MixtureSchedule; candidates: number; matches: number;
    challengers: AuditChallenger[] };
  bestChallenger: AuditChallenger;
  admittedChallenger: AuditChallenger | null;
}

export interface AuditKingdomFailure {
  complete: false;
  kingdomId: string;
  lotteryPassed: false;
  error: string;
}

export interface AuditBatchResult {
  version: string;
  selectedKingdomIds: string[];
  completed: string[];
  skipped: string[];
  passed: string[];
  lotteriesFailed: string[];
  failed: { kingdomId: string; error: string }[];
}

interface RunOptions {
  root: string;
  kingdomId?: string | undefined;
  force?: boolean | undefined;
  workers?: number | undefined;
}

interface AuditAdapters {
  now?: (() => number) | undefined;
  loadSource?: ((root: string, kingdomId: string) => ArtifactSet) | undefined;
  createRunner?: ((workers: number, root: string) => PairingRunner) | undefined;
  evaluateLottery?: ((artifact: ArtifactSet, runner: PairingRunner,
    now?: (() => number) | undefined) => Promise<AuditKingdomResult>) | undefined;
}

function hashSeed(text: string): number {
  return Number.parseInt(stableHash(`${CHALLENGER_AUDIT_CONFIG.version}:${CHALLENGER_AUDIT_CONFIG.auditSeed}:${text}`).slice(0, 8), 16) >>> 0;
}

function auditSeeds(kingdomId: string): AuditSeedNamespaces {
  return {
    candidate: [hashSeed(`${kingdomId}:candidate`)],
    screen: Array.from({ length: CHALLENGER_AUDIT_CONFIG.screenBlocks }, (_entry, index) =>
      hashSeed(`${kingdomId}:screen:${index}`)),
    screenSampling: [hashSeed(`${kingdomId}:screen-sampling`)],
    confirmation: Array.from({ length: CHALLENGER_AUDIT_CONFIG.confirmationBlocks }, (_entry, index) =>
      hashSeed(`${kingdomId}:confirmation:${index}`)),
    confirmationSampling: [hashSeed(`${kingdomId}:confirmation-sampling`)],
    bootstrap: [hashSeed(`${kingdomId}:bootstrap`)]
  };
}

function requiredLimit(artifact: ArtifactSet, name: string): number {
  const value = artifact.run.limits[name];
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    throw new Error(`Source run has no valid ${name} limit.`);
  }
  return value;
}

function originalSeedNamespaces(artifact: ArtifactSet): Record<string, number[]> {
  return configuredSeedNamespaces({
    seed: artifact.run.seed,
    kingdomId: artifact.run.kingdomId,
    restarts: requiredLimit(artifact, 'restarts'),
    iterations: requiredLimit(artifact, 'iterations'),
    unionIterations: requiredLimit(artifact, 'unionIterations'),
    seeds: requiredLimit(artifact, 'seeds')
  });
}

function assertSafeSeeds(original: Readonly<Record<string, readonly number[]>>,
  audit: AuditSeedNamespaces): void {
  assertDisjointSeedNamespaces({
    ...Object.fromEntries(Object.entries(original).map(([name, seeds]) => [`source:${name}`, seeds])),
    ...Object.fromEntries(Object.entries(audit).map(([name, seeds]) => [`audit:${name}`, seeds]))
  });
}

function protocolFor(artifact: ArtifactSet): AuditProtocol {
  const seeds = auditSeeds(artifact.run.kingdomId);
  assertSafeSeeds(originalSeedNamespaces(artifact), seeds);
  const withoutHash = {
    version: CHALLENGER_AUDIT_CONFIG.version,
    auditSeed: CHALLENGER_AUDIT_CONFIG.auditSeed,
    candidateCount: CHALLENGER_AUDIT_CONFIG.candidateCount,
    screenBlocks: CHALLENGER_AUDIT_CONFIG.screenBlocks,
    finalistCount: CHALLENGER_AUDIT_CONFIG.finalistCount,
    confirmationBlocks: CHALLENGER_AUDIT_CONFIG.confirmationBlocks,
    meanThreshold: CHALLENGER_AUDIT_CONFIG.meanThreshold,
    lowerBoundThreshold: CHALLENGER_AUDIT_CONFIG.lowerBoundThreshold,
    materialWeight: CHALLENGER_AUDIT_CONFIG.materialWeight,
    seeds
  };
  return { ...withoutHash, protocolHash: stableHash(JSON.stringify(withoutHash)) };
}

function sourceSignature(artifact: ArtifactSet): AuditKingdomResult['source'] {
  if (artifact.run.aborted !== 0) throw new Error(`Source run has ${artifact.run.aborted} aborted games.`);
  const entries = artifact.strategies.map((strategy) => [strategy.id,
    artifact.matrix.equilibrium.weights[strategy.id] ?? 0] as const)
    .filter(([, weight]) => weight >= MATERIAL_WEIGHT);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0)) throw new Error('Source run has no material final-lottery strategy.');
  const materialWeights = Object.fromEntries(entries.map(([id, weight]) => [id, weight / total]));
  return {
    schemaVersion: 4,
    rulesFingerprint: artifact.run.rulesFingerprint.hash,
    finishedAt: artifact.run.finishedAt,
    matrixHash: stableHash(JSON.stringify({
      strategyIds: artifact.matrix.equilibrium.strategyIds,
      weights: artifact.matrix.equilibrium.weights,
      rulesFingerprint: artifact.matrix.protocol.rulesFingerprint
    })),
    discoveredStrategies: artifact.strategies.length,
    materialStrategies: entries.length,
    materialWeights
  };
}

function drawRate(evaluation: CandidateEvaluation): number {
  const records = Object.values(evaluation.telemetry.byOrientation).flatMap((entry) => Object.values(entry));
  const games = records.reduce((sum, record) => sum + record.played, 0);
  const draws = records.reduce((sum, record) => sum + record.draws, 0);
  return games ? draws / games : 0;
}

function compareConfirmed(left: AuditChallenger, right: AuditChallenger): number {
  return right.confirmedMean - left.confirmedMean
    || right.interval.lower - left.interval.lower
    || left.strategy.id.localeCompare(right.strategy.id);
}

function assess(confirmed: readonly AuditChallenger[]): {
  lotteryPassed: boolean; bestChallenger: AuditChallenger; admittedChallenger: AuditChallenger | null;
} {
  if (!confirmed.length) throw new Error('A challenger audit needs confirmed candidates.');
  const ranked = [...confirmed].sort(compareConfirmed);
  const admitted = ranked.filter((entry) => globalAdmission(entry.confirmedMean, entry.interval));
  return { lotteryPassed: admitted.length === 0, bestChallenger: ranked[0]!, admittedChallenger: admitted[0] ?? null };
}

async function evaluateLottery(
  artifact: ArtifactSet, runner: PairingRunner, now: (() => number) = Date.now
): Promise<AuditKingdomResult> {
  const started = now();
  const source = sourceSignature(artifact);
  const protocol = protocolFor(artifact);
  const opponents = new Map(artifact.strategies.map((strategy) => [strategy.id, strategy]));
  const generated = randomUniqueStrategies(artifact.run.kingdomId, protocol.seeds.candidate[0]!,
    protocol.candidateCount, new Set(artifact.strategies.map(canonicalStrategy)));
  if (generated.shortfall) throw new Error(`Audit candidate generation fell short by ${generated.shortfall}.`);
  const screenSchedule = mixtureSchedule(source.materialWeights, protocol.seeds.screen,
    protocol.seeds.screenSampling[0]!);
  const screened = await evaluateCandidates(generated.strategies, opponents, screenSchedule, runner, {
    kingdomId: artifact.run.kingdomId,
    turnLimitPerPlayer: artifact.matrix.protocol.turnLimitPerPlayer,
    actionCapPerTurn: artifact.matrix.protocol.actionCapPerTurn
  });
  const finalists = [...screened].sort((left, right) => right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id)).slice(0, protocol.finalistCount);
  const confirmationSchedule = mixtureSchedule(source.materialWeights, protocol.seeds.confirmation,
    protocol.seeds.confirmationSampling[0]!);
  const confirmed = await evaluateCandidates(finalists.map((entry) => entry.strategy), opponents,
    confirmationSchedule, runner, {
      kingdomId: artifact.run.kingdomId,
      turnLimitPerPlayer: artifact.matrix.protocol.turnLimitPerPlayer,
      actionCapPerTurn: artifact.matrix.protocol.actionCapPerTurn
    });
  const screenMean = new Map(finalists.map((entry) => [entry.strategy.id, entry.mean]));
  const challengers = confirmed.map((entry): AuditChallenger => {
    const interval = percentileBootstrapMean(entry.blockScores, protocol.seeds.bootstrap[0]!);
    return { strategy: entry.strategy, screeningMean: screenMean.get(entry.strategy.id)!,
      confirmedMean: entry.mean, interval, drawRate: drawRate(entry), matches: entry.matches,
      admitted: globalAdmission(entry.mean, interval) };
  }).sort(compareConfirmed);
  const decision = assess(challengers);
  const finished = now();
  return {
    complete: true,
    kingdomId: artifact.run.kingdomId,
    split: balanceSuite.manifest.kingdoms.find((entry) => entry.id === artifact.run.kingdomId)!.split,
    lotteryPassed: decision.lotteryPassed,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    elapsedMs: finished - started,
    source,
    protocol,
    generation: { requested: protocol.candidateCount, actual: generated.strategies.length,
      duplicateRejections: generated.duplicateRejections, shortfall: generated.shortfall },
    screening: { schedule: screenSchedule, candidates: screened.length,
      matches: screened.reduce((sum, entry) => sum + entry.matches, 0),
      finalists: finalists.map((entry) => ({ strategyId: entry.strategy.id, mean: entry.mean })) },
    confirmation: { schedule: confirmationSchedule, candidates: challengers.length,
      matches: challengers.reduce((sum, entry) => sum + entry.matches, 0), challengers },
    bestChallenger: decision.bestChallenger,
    admittedChallenger: decision.admittedChallenger
  };
}

function selectSample(): string[] {
  const tuning = balanceSuite.manifest.kingdoms.filter((entry) => entry.split === 'tuning')
    .map((entry) => entry.id).filter((id) => id !== CHALLENGER_AUDIT_CONFIG.requiredKingdomId).sort();
  const random = new SeededRandom(CHALLENGER_AUDIT_CONFIG.sampleSeed);
  for (let index = tuning.length - 1; index > 0; index -= 1) {
    const other = random.nextInt(index + 1);
    [tuning[index], tuning[other]] = [tuning[other]!, tuning[index]!];
  }
  return [CHALLENGER_AUDIT_CONFIG.requiredKingdomId,
    ...tuning.slice(0, CHALLENGER_AUDIT_CONFIG.sampleSize - 1)].sort();
}

function resultDirectory(root: string, kingdomId: string): string {
  return path.join(root, '.experiments', 'balance-audit', CHALLENGER_AUDIT_CONFIG.version, kingdomId);
}

function serialize(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function fixed(value: number): string { return value.toFixed(4); }
function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }

function renderResult(result: AuditKingdomResult | AuditKingdomFailure): string {
  if (!result.complete) return `# Final-lottery challenger audit: ${result.kingdomId}\n\n**Audit failed:** ${result.error}\n`;
  const best = result.bestChallenger;
  const lines = [
    `# Final-lottery challenger audit: ${result.kingdomId}`,
    '',
    `**Lottery result:** ${result.lotteryPassed ? 'PASS' : 'FAIL'}`,
    '',
    `The audit screened ${result.screening.candidates} fresh strategies on ${result.protocol.screenBlocks} shared blocks. It confirmed ${result.confirmation.candidates} finalists on ${result.protocol.confirmationBlocks} separate shared blocks.`,
    '',
    '| Measure | Value |', '| --- | --- |',
    `| Best confirmed mean | ${percent(best.confirmedMean)} |`,
    `| Bootstrap 95% interval | ${percent(best.interval.lower)}–${percent(best.interval.upper)} |`,
    `| Best challenger draw rate | ${percent(best.drawRate)} |`,
    `| Screening games | ${result.screening.matches} |`,
    `| Confirmation games | ${result.confirmation.matches} |`,
    `| Elapsed | ${fixed(result.elapsedMs / 1000)} seconds |`,
    '',
    '## Best challenger plan', '', '```', formatStrategy(best.strategy), '```', '',
    '## Confirmed finalists', '',
    '| Rank | Strategy | Screen mean | Confirmed mean | 95% interval | Draws | Admitted |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...result.confirmation.challengers.map((entry, index) =>
      `| ${index + 1} | ${entry.strategy.id} | ${percent(entry.screeningMean)} | ${percent(entry.confirmedMean)} | ${percent(entry.interval.lower)}–${percent(entry.interval.upper)} | ${percent(entry.drawRate)} | ${entry.admitted ? 'yes' : 'no'} |`)
  ];
  return `${lines.join('\n')}\n`;
}

function loadSource(root: string, kingdomId: string): ArtifactSet {
  balanceSuite.register();
  return loadArtifactDirectory(balanceSuite.runDirectory(root, kingdomId), kingdomId);
}

function writeResult(root: string, result: AuditKingdomResult | AuditKingdomFailure): void {
  const directory = resultDirectory(root, result.kingdomId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'result.json'), serialize(result));
  fs.writeFileSync(path.join(directory, 'report.md'), renderResult(result));
}

function currentResult(root: string, kingdomId: string, artifact: ArtifactSet): AuditKingdomResult | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(resultDirectory(root, kingdomId), 'result.json'), 'utf8')) as AuditKingdomResult;
    const expectedProtocol = protocolFor(artifact);
    const expectedSource = sourceSignature(artifact);
    return parsed.complete === true && parsed.kingdomId === kingdomId
      && parsed.protocol?.protocolHash === expectedProtocol.protocolHash
      && parsed.source?.rulesFingerprint === expectedSource.rulesFingerprint
      && parsed.source?.finishedAt === expectedSource.finishedAt
      && parsed.source?.matrixHash === expectedSource.matrixHash ? parsed : null;
  } catch { return null; }
}

function renderBatch(result: AuditBatchResult): string {
  const lines = ['# Final-lottery challenger audit batch', '',
    `Protocol: ${result.version}`, '',
    `Selected kingdoms: ${result.selectedKingdomIds.join(', ')}`, '',
    `Completed: ${result.completed.length}. Skipped: ${result.skipped.length}. Source or runtime failures: ${result.failed.length}.`,
    '', `Lottery passes: ${result.passed.length}. Lottery failures: ${result.lotteriesFailed.length}.`];
  if (result.failed.length) lines.push('', '## Failures', '', ...result.failed.map((entry) =>
    `- ${entry.kingdomId}: ${entry.error}`));
  return `${lines.join('\n')}\n`;
}

async function run(options: RunOptions, adapters: AuditAdapters = {}): Promise<AuditBatchResult> {
  balanceSuite.register();
  const sample = selectSample();
  let selected = sample;
  if (options.kingdomId) {
    const definition = balanceSuite.manifest.kingdoms.find((entry) => entry.id === options.kingdomId);
    if (!definition || definition.split !== 'tuning') throw new Error(`Unknown tuning audit kingdom ${options.kingdomId}.`);
    selected = [options.kingdomId];
  }
  const result: AuditBatchResult = { version: CHALLENGER_AUDIT_CONFIG.version,
    selectedKingdomIds: selected, completed: [], skipped: [], passed: [], lotteriesFailed: [], failed: [] };
  const sourceLoader = adapters.loadSource ?? loadSource;
  const evaluator = adapters.evaluateLottery ?? evaluateLottery;
  let runner: PairingRunner | null = null;
  try {
    for (const kingdomId of selected) {
      let artifact: ArtifactSet;
      try {
        artifact = sourceLoader(options.root, kingdomId);
        sourceSignature(artifact);
        protocolFor(artifact);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ kingdomId, error: message });
        writeResult(options.root, { complete: false, kingdomId, lotteryPassed: false, error: message });
        continue;
      }
      const existing = !options.force ? currentResult(options.root, kingdomId, artifact) : null;
      if (existing) {
        result.skipped.push(kingdomId);
        (existing.lotteryPassed ? result.passed : result.lotteriesFailed).push(kingdomId);
        continue;
      }
      try {
        runner ??= (adapters.createRunner ?? ((workers, root) => new WorkerPairingRunner(workers,
          pathToFileURL(path.join(root, 'dist-sim', 'experiment.mjs')))))(options.workers ?? 8, options.root);
        const audited = await evaluator(artifact, runner, adapters.now);
        writeResult(options.root, audited);
        result.completed.push(kingdomId);
        (audited.lotteryPassed ? result.passed : result.lotteriesFailed).push(kingdomId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ kingdomId, error: message });
        writeResult(options.root, { complete: false, kingdomId, lotteryPassed: false, error: message });
      }
    }
  } finally { await runner?.close(); }
  const directory = path.join(options.root, '.experiments', 'balance-audit', CHALLENGER_AUDIT_CONFIG.version);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'summary.json'), serialize(result));
  fs.writeFileSync(path.join(directory, 'report.md'), renderBatch(result));
  return result;
}

export const challengerAudit = Object.freeze({
  config: CHALLENGER_AUDIT_CONFIG,
  selectSample,
  assertSafeSeeds,
  assess,
  evaluateLottery,
  run,
  serialize,
  renderResult,
  resultDirectory
});
