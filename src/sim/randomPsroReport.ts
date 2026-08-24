import fs from 'node:fs';
import path from 'node:path';
import { registerKingdom } from '../game';
import type { Kingdom } from '../game';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from './mixtureEvaluation';
import type { BootstrapInterval, CandidateEvaluation } from './mixtureEvaluation';
import type { PairingRunner } from './pairingRunner';
import { WorkerPairingRunner } from './pairingRunner';
import {
  RANDOM_PSRO_DEFAULT_CONFIG, RANDOM_PSRO_SUITE_SEEDS, RandomPsroSeedLedger,
  artifactArchetypes, strategyArchetype, supportStrategies
} from './randomPsro';
import type { ArchetypeSummary, ConfirmedCandidate, RandomPsroArtifact } from './randomPsro';
import {
  RANDOM_PSRO_KINGDOMS, inspectRandomPsroUnit, randomPsroArtifactPath
} from './randomPsroSuite';
import { rulesFingerprint } from './rulesFingerprint';
import { STRATIFIED_ADMISSIONS_PER_LANE, STRATIFIED_BEAM_LANES } from './stratifiedBeam';
import { INFINITE_COUNT, canonicalStrategy, fixedBuyPlan, formatSlot, identify } from './strategy';
import type { Strategy } from './strategy';

export const K001_ORDINARY_SOURCE_VERSION = 'k001-ordinary-recovered-v1';
const ORDINARY_SUPPORT = Object.freeze([
  { weight: 0.3404255296666667, strategy: identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'channel', desiredCount: 5 },
    { kind: 'buy', cardId: 'gold', desiredCount: 3 },
    { kind: 'buy', cardId: 'arcBolt', desiredCount: INFINITE_COUNT }
  ]) }) },
  { weight: 0.3404255341333333, strategy: identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'footwork', desiredCount: 5 },
    { kind: 'buy', cardId: 'channel', desiredCount: 5 },
    { kind: 'buy', cardId: 'starfire', desiredCount: 5 },
    { kind: 'buy', cardId: 'arcBolt', desiredCount: INFINITE_COUNT }
  ]) }) },
  { weight: 0.3191489362, strategy: identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'step', desiredCount: 1 },
    { kind: 'buy', cardId: 'cascade', desiredCount: 4 },
    { kind: 'buy', cardId: 'strike', desiredCount: INFINITE_COUNT }
  ]) }) }
]);
const STRATIFIED_SUPPORT = Object.freeze([
  { weight: 0.79629626665, strategy: identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'footwork', desiredCount: 3 },
    { kind: 'buy', cardId: 'strike', desiredCount: 5 },
    { kind: 'buy', cardId: 'adapt', desiredCount: 2 },
    { kind: 'buy', cardId: 'footwork', desiredCount: 3 },
    { kind: 'buy', cardId: 'strike', desiredCount: INFINITE_COUNT }
  ]) }) },
  { weight: 0.20370373335, strategy: identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([
    { kind: 'buy', cardId: 'strike', desiredCount: INFINITE_COUNT }
  ]) }) }
]);

for (const [actual, expected] of [
  [ORDINARY_SUPPORT[0]!.strategy.id, 'sg-00060b43b5'],
  [ORDINARY_SUPPORT[1]!.strategy.id, 'sg-0033a454c1'],
  [ORDINARY_SUPPORT[2]!.strategy.id, 'sg-00dac22eb4'],
  [STRATIFIED_SUPPORT[0]!.strategy.id, 'sg-1e75552ec4'],
  [STRATIFIED_SUPPORT[1]!.strategy.id, 'sg-7b4e9543a9']
]) if (actual !== expected) throw new Error(`Historical K001 strategy identity mismatch: ${actual} != ${expected}.`);

export interface Lottery { label: string; strategies: { strategy: Strategy; weight: number }[] }
export interface LotteryEvaluation {
  score: number;
  interval95: BootstrapInterval;
  support: ConfirmedCandidate[];
  worstSupport: ConfirmedCandidate;
}
export interface KingdomConsistencyReport {
  kingdomId: string;
  runs: { seed: number; converged: boolean; archetypes: ArchetypeSummary[];
    support: { id: string; archetype: string; weight: number; plan: string }[];
    proposalDiagnostics: RandomPsroArtifact['rounds'][number]['proposalDiagnostics'][];
    independentAttack: NonNullable<RandomPsroArtifact['independentAttack']> }[];
  crossPlay: LotteryEvaluation;
  reverseCrossPlay: LotteryEvaluation;
  canonicalSupportOverlap: { count: number; union: number; jaccard: number; forms: string[] };
  gates: { crossPlayWithin47To53: boolean; crossRunSupportHasNoConfirmedExploit: boolean;
    independentAttackHasNoConfirmedChallenger: boolean };
  kingdom001Comparison?: Kingdom001Comparison;
}
export interface OldLotteryEvaluations {
  ordinary: LotteryEvaluation;
  stratified: LotteryEvaluation;
}
export interface Kingdom001Comparison {
  sources: { ordinary: string; stratified: string };
  pooledOldSupportCount: number;
  oldSupportAgainstNew: Record<string, LotteryEvaluation>;
  newSupportAgainstOld: Record<string, OldLotteryEvaluations>;
  wholeLotteryCrossPlay: Record<string, LotteryEvaluation>;
  oldSupportGate: boolean;
}
export interface Kingdom001SenseCheck {
  schemaVersion: 1;
  experiment: 'random-psro-k001-old-lottery-check';
  createdAt: string;
  runSeed: number;
  reportSeed: number;
  confirmationBlocks: number;
  newArtifact: string;
  seedNamespaces: Record<string, number[]>;
  comparison: Kingdom001Comparison;
}
export interface RandomPsroConsistencyReport {
  schemaVersion: 1;
  experiment: 'random-psro-consistency-report';
  createdAt: string;
  reportSeed: number;
  confirmationBlocks: number;
  empiricalGates: {
    oldSupportVsNewNoCiLowerAbove50: boolean;
    crossRunLotteryWithin47To53: boolean;
    crossRunSupportNoCiLowerAbove50: boolean;
    independentAttackNoCiLowerAbove55: boolean;
  };
  kingdoms: KingdomConsistencyReport[];
}

interface SavedLotteryArtifact {
  schemaVersion?: unknown;
  experiment?: unknown;
  suiteVersion?: unknown;
  provenance?: unknown;
  kingdom: Kingdom;
  rulesFingerprint?: unknown;
  config?: unknown;
  targetMixture?: { strategy: Strategy; weight: number }[];
}

function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function kingdom001OrdinarySourcePath(root: string): string {
  return path.join(root, '.experiments', 'random-psro-consistency', 'baselines', 'k001-ordinary-mage.json');
}

export function buildKingdom001OrdinarySource(_root: string): SavedLotteryArtifact {
  const kingdom = RANDOM_PSRO_KINGDOMS[0]!;
  registerKingdom(kingdom);
  return { schemaVersion: 1, experiment: 'historical-k001-ordinary-lottery',
    suiteVersion: K001_ORDINARY_SOURCE_VERSION,
    provenance: 'Recovered from the prior ordinary deep-beam Kingdom 001 result recorded in the project session transcript.',
    kingdom, rulesFingerprint: rulesFingerprint(kingdom.id,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false),
    config: { startingDraftEnabled: false, maxSlots: 8 },
    targetMixture: ORDINARY_SUPPORT.map((entry) => structuredClone(entry)) };
}

export function writeKingdom001OrdinarySource(root: string, output = kingdom001OrdinarySourcePath(root)): string {
  const artifact = buildKingdom001OrdinarySource(root);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  loadKingdom001PriorLottery(output, 'ordinary-mage');
  return output;
}

function exactSourceConfig(kind: 'ordinary-mage' | 'stratified-melee'): unknown {
  if (kind === 'ordinary-mage') return { startingDraftEnabled: false, maxSlots: 8 };
  return { startingDraftEnabled: false, workers: 10, iterations: 3, maxSlots: 8,
    lanes: STRATIFIED_BEAM_LANES, admissionsPerLane: STRATIFIED_ADMISSIONS_PER_LANE,
    stageSeeds: [1, 2, 4], confirmationSeeds: 12, matrixSeeds: 8,
    earlyStopDelta: 0.002, earlyStopPatience: 2, sweep: false };
}

export function loadKingdom001PriorLottery(file: string, kind: 'ordinary-mage' | 'stratified-melee'): Lottery {
  let parsed: SavedLotteryArtifact;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedLotteryArtifact; }
  catch (error) {
    const requirement = kind === 'ordinary-mage' ? 'exact Mage-heavy ordinary Kingdom 001 source' : 'exact Melee-heavy stratified Kingdom 001 source';
    throw new Error(`${requirement} is required at ${file}: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const kingdom = RANDOM_PSRO_KINGDOMS[0]!;
  registerKingdom(kingdom);
  const fingerprint = rulesFingerprint(kingdom.id, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
  const schemaValid = kind === 'ordinary-mage'
    ? parsed.schemaVersion === 1 && parsed.experiment === 'historical-k001-ordinary-lottery'
      && parsed.suiteVersion === K001_ORDINARY_SOURCE_VERSION
      && parsed.provenance === 'Recovered from the prior ordinary deep-beam Kingdom 001 result recorded in the project session transcript.'
    : parsed.schemaVersion === 1 && parsed.experiment === 'draft-off-diverse-beam-double-oracle'
      && parsed.suiteVersion === 'deep-beam-v1';
  if (!schemaValid || !exact(parsed.kingdom, kingdom) || !exact(parsed.rulesFingerprint, fingerprint)
    || !exact(parsed.config, exactSourceConfig(kind))) {
    throw new Error(`${file} is not the exact validated ${kind} Kingdom 001 artifact.`);
  }
  const expected = kind === 'ordinary-mage' ? ORDINARY_SUPPORT : STRATIFIED_SUPPORT;
  const support = (parsed.targetMixture ?? []).filter((entry) => entry.weight > 0)
    .sort((left, right) => left.strategy.id.localeCompare(right.strategy.id));
  const expectedSorted = [...expected].sort((left, right) => left.strategy.id.localeCompare(right.strategy.id));
  if (support.length !== expectedSorted.length) throw new Error(`${file} has wrong exact ${kind} support membership.`);
  for (let index = 0; index < support.length; index += 1) {
    const held = support[index]!, wanted = expectedSorted[index]!;
    if (held.strategy.id !== identify(held.strategy).id || held.strategy.id !== wanted.strategy.id
      || canonicalStrategy(held.strategy) !== canonicalStrategy(wanted.strategy)
      || held.weight !== wanted.weight) {
      throw new Error(`${file} has wrong exact ${kind} strategy content or weight.`);
    }
  }
  return { label: kind, strategies: support.map((entry) => structuredClone(entry)) };
}

export function weightedLotteryEvaluation(
  evaluations: readonly CandidateEvaluation[], candidateWeights: Readonly<Record<string, number>>,
  bootstrapSeed: number
): LotteryEvaluation {
  if (!evaluations.length) throw new Error('Lottery cross-play needs candidate evaluations.');
  const total = evaluations.reduce((sum, entry) => sum + (candidateWeights[entry.strategy.id] ?? 0), 0);
  if (!(total > 0)) throw new Error('Lottery cross-play needs positive candidate weights.');
  const length = evaluations[0]!.blockScores.length;
  if (evaluations.some((entry) => entry.blockScores.length !== length)) throw new Error('Cross-play block schedules differ.');
  const blockScores = Array.from({ length }, (_unused, block) => evaluations.reduce((sum, entry) =>
    sum + (candidateWeights[entry.strategy.id] ?? 0) / total * entry.blockScores[block]!, 0));
  const support = evaluations.map((entry, index): ConfirmedCandidate => ({ strategy: entry.strategy,
    mean: entry.mean, interval95: percentileBootstrapMean(entry.blockScores, bootstrapSeed + index + 1),
    blocks: entry.blockScores.length, matches: entry.matches }))
    .sort((left, right) => right.interval95.lower - left.interval95.lower
      || right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return { score: blockScores.reduce((sum, value) => sum + value, 0) / blockScores.length,
    interval95: percentileBootstrapMean(blockScores, bootstrapSeed), support, worstSupport: support[0]! };
}

async function evaluateLottery(
  candidate: Lottery, opponent: Lottery, runner: PairingRunner, kingdomId: string,
  seeds: readonly number[], samplingSeed: number, bootstrapSeed: number
): Promise<LotteryEvaluation> {
  const opponents = new Map(opponent.strategies.map((entry) => [entry.strategy.id, entry.strategy]));
  const weights = Object.fromEntries(opponent.strategies.map((entry) => [entry.strategy.id, entry.weight]));
  const schedule = mixtureSchedule(weights, seeds, samplingSeed);
  const evaluations = await evaluateCandidates(candidate.strategies.map((entry) => entry.strategy),
    opponents, schedule, runner, { kingdomId, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false });
  return weightedLotteryEvaluation(evaluations,
    Object.fromEntries(candidate.strategies.map((entry) => [entry.strategy.id, entry.weight])), bootstrapSeed);
}

function lottery(label: string, artifact: RandomPsroArtifact): Lottery {
  return { label, strategies: supportStrategies(artifact) };
}

export type LotteryEvaluator = (
  candidate: Lottery, opponent: Lottery, label: string
) => Promise<LotteryEvaluation>;

export async function evaluateKingdom001Comparison(
  newLotteries: readonly Lottery[], ordinary: Lottery, stratified: Lottery,
  evaluate: LotteryEvaluator, sources: Kingdom001Comparison['sources']
): Promise<Kingdom001Comparison> {
  const byForm = new Map<string, { strategy: Strategy; weight: number }>();
  for (const source of [ordinary, stratified]) for (const entry of source.strategies) {
    if (!byForm.has(canonicalStrategy(entry.strategy))) byForm.set(canonicalStrategy(entry.strategy), entry);
  }
  const pooled: Lottery = { label: 'pooled-old-support',
    strategies: [...byForm.values()].map((entry) => ({ ...entry, weight: 1 })) };
  const oldSupportAgainstNew: Record<string, LotteryEvaluation> = {};
  const newSupportAgainstOld: Record<string, OldLotteryEvaluations> = {};
  const wholeLotteryCrossPlay: Record<string, LotteryEvaluation> = {};
  for (const current of newLotteries) {
    oldSupportAgainstNew[current.label] = await evaluate(pooled, current, `old-support-vs-${current.label}`);
    newSupportAgainstOld[current.label] = {
      ordinary: await evaluate(current, ordinary, `${current.label}-vs-ordinary`),
      stratified: await evaluate(current, stratified, `${current.label}-vs-stratified`)
    };
    wholeLotteryCrossPlay[`${current.label}-vs-ordinary`] = newSupportAgainstOld[current.label]!.ordinary;
    wholeLotteryCrossPlay[`${current.label}-vs-stratified`] = newSupportAgainstOld[current.label]!.stratified;
    wholeLotteryCrossPlay[`ordinary-vs-${current.label}`] = await evaluate(ordinary, current, `ordinary-vs-${current.label}`);
    wholeLotteryCrossPlay[`stratified-vs-${current.label}`] = await evaluate(stratified, current, `stratified-vs-${current.label}`);
  }
  wholeLotteryCrossPlay['ordinary-vs-stratified'] = await evaluate(ordinary, stratified, 'ordinary-vs-stratified');
  return { sources, pooledOldSupportCount: pooled.strategies.length,
    oldSupportAgainstNew, newSupportAgainstOld, wholeLotteryCrossPlay,
    oldSupportGate: Object.values(oldSupportAgainstNew)
      .every((result) => result.support.every((entry) => entry.interval95.lower <= 0.50)) };
}

export function directionalCrossPlayWithinRange(
  forward: number, reverse: number, minimum = 0.47, maximum = 0.53
): boolean {
  return forward >= minimum && forward <= maximum && reverse >= minimum && reverse <= maximum;
}

function supportOverlap(left: RandomPsroArtifact, right: RandomPsroArtifact): KingdomConsistencyReport['canonicalSupportOverlap'] {
  const a = new Set(supportStrategies(left).map((entry) => canonicalStrategy(entry.strategy)));
  const b = new Set(supportStrategies(right).map((entry) => canonicalStrategy(entry.strategy)));
  const forms = [...a].filter((form) => b.has(form)).sort();
  const union = new Set([...a, ...b]).size;
  return { count: forms.length, union, jaccard: union ? forms.length / union : 1, forms };
}

function runSummary(seed: number, artifact: RandomPsroArtifact): KingdomConsistencyReport['runs'][number] {
  if (!artifact.independentAttack) throw new Error('A converged report artifact needs an independent attack.');
  return { seed, converged: artifact.status === 'converged', archetypes: artifactArchetypes(artifact),
    support: supportStrategies(artifact).map((entry) => ({ id: entry.strategy.id,
      archetype: strategyArchetype(entry.strategy), weight: entry.weight,
      plan: entry.strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot).join(' → ') })),
    proposalDiagnostics: artifact.rounds.map((round) => round.proposalDiagnostics),
    independentAttack: artifact.independentAttack };
}

export interface GenerateRandomPsroReportOptions {
  root: string;
  ordinarySource?: string;
  stratifiedSource?: string;
  reportSeed?: number;
  confirmationBlocks?: number;
  workers?: number;
}

export async function generateRandomPsroConsistencyReport(
  options: GenerateRandomPsroReportOptions
): Promise<RandomPsroConsistencyReport> {
  const reportSeed = options.reportSeed ?? 91_001;
  const confirmationBlocks = options.confirmationBlocks ?? 400;
  const ordinaryPath = path.resolve(options.root,
    options.ordinarySource ?? kingdom001OrdinarySourcePath(options.root));
  const stratifiedPath = path.resolve(options.root, options.stratifiedSource
    ?? path.join('.experiments', 'deep-beam-suite', 'deep-beam-v1', 'results', 'deep-beam-tuning-001.json'));
  const ordinary = loadKingdom001PriorLottery(ordinaryPath, 'ordinary-mage');
  const stratified = loadKingdom001PriorLottery(stratifiedPath, 'stratified-melee');
  const kingdoms: KingdomConsistencyReport[] = [];
  for (let kingdomIndex = 0; kingdomIndex < RANDOM_PSRO_KINGDOMS.length; kingdomIndex += 1) {
    const kingdom = RANDOM_PSRO_KINGDOMS[kingdomIndex]!;
    registerKingdom(kingdom);
    const artifacts = RANDOM_PSRO_SUITE_SEEDS.map((seed) => {
      const evidence = inspectRandomPsroUnit(options.root, { kingdomId: kingdom.id, seed }, RANDOM_PSRO_DEFAULT_CONFIG);
      if (!evidence.valid || !evidence.converged || !evidence.artifact) {
        throw new Error(`${kingdom.id} seed ${seed} is not a valid converged random PSRO artifact: ${evidence.reason}.`);
      }
      return evidence.artifact;
    });
    const runs = artifacts.map((artifact, index) => lottery(`seed-${RANDOM_PSRO_SUITE_SEEDS[index]}`, artifact));
    const runner = new WorkerPairingRunner(options.workers ?? 10,
      new URL('../server/aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']);
    const ledger = new RandomPsroSeedLedger(reportSeed + kingdomIndex);
    const evaluate = async (candidate: Lottery, opponent: Lottery, label: string): Promise<LotteryEvaluation> => {
      const seeds = ledger.reserve(`${label}:schedule`, confirmationBlocks);
      const extras = ledger.reserve(`${label}:other`, 2);
      return evaluateLottery(candidate, opponent, runner, kingdom.id, seeds, extras[0]!, extras[1]!);
    };
    try {
      const crossPlay = await evaluate(runs[0]!, runs[1]!, 'run-a-vs-b');
      const reverseCrossPlay = await evaluate(runs[1]!, runs[0]!, 'run-b-vs-a');
      let kingdom001Comparison: Kingdom001Comparison | undefined;
      if (kingdomIndex === 0) {
        kingdom001Comparison = await evaluateKingdom001Comparison(runs, ordinary, stratified, evaluate,
          { ordinary: path.relative(options.root, ordinaryPath),
            stratified: path.relative(options.root, stratifiedPath) });
      }
      ledger.validate();
      const crossSupportGate = crossPlay.worstSupport.interval95.lower <= 0.50
        && reverseCrossPlay.worstSupport.interval95.lower <= 0.50;
      kingdoms.push({ kingdomId: kingdom.id,
        runs: artifacts.map((artifact, index) => runSummary(RANDOM_PSRO_SUITE_SEEDS[index]!, artifact)),
        crossPlay, reverseCrossPlay, canonicalSupportOverlap: supportOverlap(artifacts[0]!, artifacts[1]!),
        gates: { crossPlayWithin47To53: directionalCrossPlayWithinRange(crossPlay.score, reverseCrossPlay.score),
          crossRunSupportHasNoConfirmedExploit: crossSupportGate,
          independentAttackHasNoConfirmedChallenger: artifacts.every((artifact) =>
            artifact.independentAttack !== null && !artifact.independentAttack.confirmedAboveThreshold) },
        ...(kingdom001Comparison ? { kingdom001Comparison } : {}) });
    } finally { await runner.close(); }
  }
  return { schemaVersion: 1, experiment: 'random-psro-consistency-report', createdAt: new Date().toISOString(),
    reportSeed, confirmationBlocks,
    empiricalGates: {
      oldSupportVsNewNoCiLowerAbove50: kingdoms[0]?.kingdom001Comparison?.oldSupportGate ?? false,
      crossRunLotteryWithin47To53: kingdoms.every((entry) => entry.gates.crossPlayWithin47To53),
      crossRunSupportNoCiLowerAbove50: kingdoms.every((entry) => entry.gates.crossRunSupportHasNoConfirmedExploit),
      independentAttackNoCiLowerAbove55: kingdoms.every((entry) => entry.gates.independentAttackHasNoConfirmedChallenger)
    }, kingdoms };
}

export interface GenerateKingdom001SenseCheckOptions {
  root: string;
  seed: number;
  ordinarySource?: string;
  stratifiedSource?: string;
  reportSeed?: number;
  confirmationBlocks?: number;
  workers?: number;
}

export async function generateKingdom001SenseCheck(
  options: GenerateKingdom001SenseCheckOptions
): Promise<Kingdom001SenseCheck> {
  const kingdom = RANDOM_PSRO_KINGDOMS[0]!;
  registerKingdom(kingdom);
  const unit = { kingdomId: kingdom.id, seed: options.seed };
  const evidence = inspectRandomPsroUnit(options.root, unit, RANDOM_PSRO_DEFAULT_CONFIG);
  if (!evidence.valid || !evidence.converged || !evidence.artifact) {
    throw new Error(`${kingdom.id} seed ${options.seed} is not one valid converged full artifact: ${evidence.reason}.`);
  }
  const ordinaryPath = path.resolve(options.root,
    options.ordinarySource ?? kingdom001OrdinarySourcePath(options.root));
  if (!options.ordinarySource && !fs.existsSync(ordinaryPath)) {
    writeKingdom001OrdinarySource(options.root, ordinaryPath);
  }
  const stratifiedPath = path.resolve(options.root, options.stratifiedSource
    ?? path.join('.experiments', 'deep-beam-suite', 'deep-beam-v1', 'results', 'deep-beam-tuning-001.json'));
  const ordinary = loadKingdom001PriorLottery(ordinaryPath, 'ordinary-mage');
  const stratified = loadKingdom001PriorLottery(stratifiedPath, 'stratified-melee');
  const reportSeed = options.reportSeed ?? 92_001;
  const confirmationBlocks = options.confirmationBlocks ?? 400;
  const runner = new WorkerPairingRunner(options.workers ?? 10,
    new URL('../server/aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']);
  const ledger = new RandomPsroSeedLedger(reportSeed);
  const evaluate: LotteryEvaluator = async (candidate, opponent, label) => {
    const seeds = ledger.reserve(`${label}:schedule`, confirmationBlocks);
    const extras = ledger.reserve(`${label}:other`, 2);
    return evaluateLottery(candidate, opponent, runner, kingdom.id, seeds, extras[0]!, extras[1]!);
  };
  try {
    const comparison = await evaluateKingdom001Comparison(
      [lottery(`seed-${options.seed}`, evidence.artifact)], ordinary, stratified, evaluate,
      { ordinary: path.relative(options.root, ordinaryPath), stratified: path.relative(options.root, stratifiedPath) });
    ledger.validate();
    const priorSeeds = new Set(Object.values(evidence.artifact.seedNamespaces).flat());
    if (Object.values(ledger.namespaces).flat().some((seed) => priorSeeds.has(seed))) {
      throw new Error('K001 held-out evidence overlaps the strategy-discovery run.');
    }
    return { schemaVersion: 1, experiment: 'random-psro-k001-old-lottery-check',
      createdAt: new Date().toISOString(), runSeed: options.seed, reportSeed, confirmationBlocks,
      newArtifact: path.relative(options.root, randomPsroArtifactPath(options.root, unit)),
      seedNamespaces: ledger.namespaces, comparison };
  } finally { await runner.close(); }
}

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function gate(value: boolean): string { return value ? 'PASS' : 'FAIL'; }
function candidateLine(entry: ConfirmedCandidate): string {
  const plan = entry.strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot).join(' → ');
  return `- ${entry.strategy.id}: ${percent(entry.mean)}; CI ${percent(entry.interval95.lower)}–${percent(entry.interval95.upper)}; ${plan}`;
}

export function renderKingdom001SenseCheck(report: Kingdom001SenseCheck): string {
  const label = `seed-${report.runSeed}`;
  const comparison = report.comparison;
  const old = comparison.oldSupportAgainstNew[label]!;
  const newAgainst = comparison.newSupportAgainstOld[label]!;
  const lines = ['# Kingdom 001 old-lottery sense check', '',
    'This is fresh held-out empirical evidence. It is not a proof.', '',
    `Old-support no-CI-lower-above-50% gate: **${gate(comparison.oldSupportGate)}**`, '',
    '## Every old support strategy vs the new lottery', '', ...old.support.map(candidateLine), '',
    '## Every new support strategy vs each old lottery', '', '### Ordinary Mage-heavy lottery', '',
    ...newAgainst.ordinary.support.map(candidateLine), '', '### Stratified Melee-heavy lottery', '',
    ...newAgainst.stratified.support.map(candidateLine), '', '## Whole-lottery cross-play', '' ];
  for (const [name, result] of Object.entries(comparison.wholeLotteryCrossPlay)) {
    lines.push(`- ${name}: ${percent(result.score)}; CI ${percent(result.interval95.lower)}–${percent(result.interval95.upper)}`);
  }
  lines.push('', `Detailed JSON: \`k001-seed-${report.runSeed}-check.json\``, '');
  return lines.join('\n');
}

export function renderRandomPsroConsistencyReport(report: RandomPsroConsistencyReport): string {
  const lines = [
    '# Random PSRO consistency report', '',
    'These are empirical gates on sampled games. They are not proofs.', '',
    `- Old support vs new lottery: ${gate(report.empiricalGates.oldSupportVsNewNoCiLowerAbove50)}`,
    `- Cross-run lottery in 47–53%: ${gate(report.empiricalGates.crossRunLotteryWithin47To53)}`,
    `- Cross-run support has no confirmed exploit: ${gate(report.empiricalGates.crossRunSupportNoCiLowerAbove50)}`,
    `- Independent attack has no confirmed challenger above 55%: ${gate(report.empiricalGates.independentAttackNoCiLowerAbove55)}`, ''
  ];
  for (const kingdom of report.kingdoms) {
    lines.push(`## ${kingdom.kingdomId}`, '',
      `Cross-play A→B ${percent(kingdom.crossPlay.score)} (${percent(kingdom.crossPlay.interval95.lower)}–${percent(kingdom.crossPlay.interval95.upper)}); B→A ${percent(kingdom.reverseCrossPlay.score)}. `
      + `Worst support lower bounds: ${percent(kingdom.crossPlay.worstSupport.interval95.lower)} / ${percent(kingdom.reverseCrossPlay.worstSupport.interval95.lower)}. `
      + `Exact support overlap: ${kingdom.canonicalSupportOverlap.count}/${kingdom.canonicalSupportOverlap.union}.`, '');
    for (const run of kingdom.runs) {
      const shares = run.archetypes.map((entry) => `${entry.archetype} ${percent(entry.selectedShare)} [${percent(entry.range.minimum)}–${percent(entry.range.maximum)}]`).join('; ');
      const attack = run.independentAttack.best;
      const batches = [...run.proposalDiagnostics, run.independentAttack.proposalDiagnostics];
      const minimumCovered = Math.min(...batches.map((entry) => entry.recipeCoverage.coveredCoreIds.length));
      const availableCores = batches[0]?.recipeCoverage.availableCoreIds.length ?? 0;
      const allocation = batches[0]?.sourceCounts;
      lines.push(`- Seed ${run.seed}: ${run.converged ? 'converged' : 'incomplete'}; ${shares}; attack ${attack ? `${percent(attack.mean)} (${percent(attack.interval95.lower)} lower)` : 'none'}.`,
        `  Proposal portfolio: ${allocation?.semantic ?? 0} semantic / ${allocation?.local ?? 0} local / ${allocation?.unrestricted ?? 0} unrestricted per batch; minimum core coverage ${minimumCovered}/${availableCores}.`,
        `  Strategies: ${run.support.map((entry) => `${entry.id} ${percent(entry.weight)} ${entry.archetype}: ${entry.plan}`).join(' | ')}`);
    }
    if (kingdom.kingdom001Comparison) lines.push(`- K001 old-support gate: ${gate(kingdom.kingdom001Comparison.oldSupportGate)} from ${kingdom.kingdom001Comparison.pooledOldSupportCount} pooled support strategies.`);
    lines.push('');
  }
  lines.push(`Detailed JSON: random-psro-consistency.json`, '');
  return lines.join('\n');
}
