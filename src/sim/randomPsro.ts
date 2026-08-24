import { SeededRandom, cardDefinition, kingdomOf } from '../game';
import type { Kingdom } from '../game';
import { BudgetedResponseObjective } from './budgetedResponseObjective';
import { equilibriumGroupWeightRange, solveEquilibrium } from './equilibrium';
import type { EquilibriumGroupWeightRange, EquilibriumResult } from './equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from './mixtureEvaluation';
import type { BootstrapInterval, CandidateEvaluation } from './mixtureEvaluation';
import { createMatrixCellCache, matrixProtocol, PayoffMatrix } from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import type { PairingRunner } from './pairingRunner';
import { ResponsePolicyDomain } from './responsePolicyGrammar';
import { runUniformRandomRacing } from './responseOptimizers';
import { rulesFingerprint } from './rulesFingerprint';
import type { RulesFingerprint } from './rulesFingerprint';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const RANDOM_PSRO_VERSION = 'random-psro-v1';
export const RANDOM_PSRO_SUITE_SEEDS = Object.freeze([35_001, 35_002] as const);
export const RANDOM_PSRO_DEFAULT_CONFIG = Object.freeze({
  initialStrategies: 8,
  proposalCount: 20_000,
  raceBlocks: Object.freeze([1, 2, 4, 8] as const),
  finalists: 8,
  confirmationBlocks: 400,
  matrixBlocks: 32,
  safetyCap: 12,
  cleanBatchesRequired: 2,
  admissionLowerBound: 0.50,
  independentAttackProposalCount: 20_000,
  independentAttackLowerBound: 0.55
});

export interface RandomPsroConfig {
  initialStrategies: number;
  proposalCount: number;
  raceBlocks: readonly number[];
  finalists: number;
  confirmationBlocks: number;
  matrixBlocks: number;
  safetyCap: number;
  cleanBatchesRequired: number;
  admissionLowerBound: number;
  independentAttackProposalCount: number;
  independentAttackLowerBound: number;
}

export interface ConfirmedCandidate {
  strategy: Strategy;
  mean: number;
  interval95: BootstrapInterval;
  blocks: number;
  matches: number;
}

export interface RandomOracleRound {
  round: number;
  targetWeights: Record<string, number>;
  proposalSeed: number;
  uniqueProposals: number;
  raceScheduleSeeds: number[];
  confirmationScheduleSeeds: number[];
  finalists: ConfirmedCandidate[];
  admittedStrategyId: string | null;
  cleanBatch: boolean;
  cleanStreak: number;
  equilibriumAfter: EquilibriumResult;
}

export interface RandomAttackResult {
  proposalSeed: number;
  uniqueProposals: number;
  scheduleSeeds: number[];
  best: ConfirmedCandidate | null;
  confirmedAboveThreshold: boolean;
}

export interface RandomPsroArtifact {
  schemaVersion: 1;
  experiment: 'random-first-psro-consistency';
  suiteVersion: typeof RANDOM_PSRO_VERSION;
  createdAt: string;
  kingdom: Kingdom;
  rulesFingerprint: RulesFingerprint;
  runSeed: number;
  config: RandomPsroConfig;
  status: 'converged' | 'incomplete';
  stopReason: 'two-clean-random-batches' | 'safety-cap';
  rounds: RandomOracleRound[];
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  independentAttack: RandomAttackResult;
  seedNamespaces: Record<string, number[]>;
  elapsedMs: number;
}

export interface RunRandomPsroOptions {
  kingdomId: string;
  seed: number;
  config?: Partial<RandomPsroConfig>;
}

const DAMAGE_MECHANICS = Object.freeze({
  Melee: new Set(['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush']),
  Ranged: new Set(['ranged', 'repellingShot', 'volley', 'longshot', 'salvageShot', 'precisionShot']),
  Mage: new Set(['spell', 'discharge', 'cascade', 'overload'])
});

export function stoplessRandomDomain(kingdomId: string, maxActiveSlots = 8): ResponsePolicyDomain {
  return new ResponsePolicyDomain(kingdomId, {
    maxActiveSlots,
    allowStopTokens: false,
    allowNoBuyFloor: false
  });
}

export function randomRacingBudget(proposals: number, rounds: readonly number[]): number {
  let field = proposals;
  let total = 0;
  for (const blocks of rounds) {
    total += field * blocks;
    field = field <= 3 ? 1 : Math.max(3, Math.ceil(field / 3));
  }
  return total;
}

function completeConfig(input: Partial<RandomPsroConfig> = {}): RandomPsroConfig {
  const config = { ...RANDOM_PSRO_DEFAULT_CONFIG, ...input,
    raceBlocks: [...(input.raceBlocks ?? RANDOM_PSRO_DEFAULT_CONFIG.raceBlocks)] };
  const positive = ['initialStrategies', 'proposalCount', 'finalists', 'confirmationBlocks', 'matrixBlocks',
    'safetyCap', 'cleanBatchesRequired', 'independentAttackProposalCount'] as const;
  for (const key of positive) if (!Number.isInteger(config[key]) || config[key] < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  if (!config.raceBlocks.length || config.raceBlocks.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('raceBlocks must be positive integers.');
  }
  if (!(config.admissionLowerBound >= 0.5 && config.admissionLowerBound < 1)
    || !(config.independentAttackLowerBound >= 0.5 && config.independentAttackLowerBound < 1)) {
    throw new Error('CI gates must be from 0.5 up to, but not including, 1.');
  }
  return config;
}

/** Generates collision-free simulation seeds inside one run. Labels are retained in the artifact. */
export class RandomPsroSeedLedger {
  readonly namespaces: Record<string, number[]> = {};
  private cursor = 0;
  private readonly base: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Run seed must be a 32-bit integer.');
    this.base = Number.parseInt(stableHash(`random-psro:${seed >>> 0}`).slice(0, 8), 16) >>> 0;
  }

  reserve(label: string, count: number): number[] {
    if (this.namespaces[label]) throw new Error(`Seed namespace ${label} is already reserved.`);
    if (!Number.isInteger(count) || count < 1) throw new Error('Seed namespace count must be positive.');
    const seeds = Array.from({ length: count }, (_unused, index) => (this.base + this.cursor + index) >>> 0);
    this.cursor += count;
    this.namespaces[label] = seeds;
    return seeds;
  }

  validate(): void {
    const all = Object.values(this.namespaces).flat();
    if (new Set(all).size !== all.length) throw new Error('Random PSRO simulation seed namespaces overlap.');
  }
}

function uniqueRandomPolicies(domain: ResponsePolicyDomain, seed: number, count: number): Strategy[] {
  const random = new SeededRandom(seed);
  const forms = new Set<string>();
  const policies: Strategy[] = [];
  for (let attempts = 0; policies.length < count && attempts < count * 256; attempts += 1) {
    const policy = domain.randomComplete(random);
    const form = canonicalStrategy(policy);
    if (!forms.has(form)) { forms.add(form); policies.push(policy); }
  }
  if (policies.length !== count) throw new Error(`Random policy space produced only ${policies.length} of ${count} unique policies.`);
  return policies;
}

function weightedStrategies(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult): { strategy: Strategy; weight: number }[] {
  return snapshot.strategies.flatMap((strategy) => {
    const weight = equilibrium.weights[strategy.id] ?? 0;
    return weight > 0 ? [{ strategy, weight }] : [];
  });
}

function solve(snapshot: MatrixSnapshot): EquilibriumResult {
  if (!snapshot.complete) throw new Error('Random PSRO cannot solve an incomplete payoff matrix.');
  return solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
}

function confirmed(evaluation: CandidateEvaluation, bootstrapSeed: number): ConfirmedCandidate {
  return { strategy: evaluation.strategy, mean: evaluation.mean,
    interval95: percentileBootstrapMean(evaluation.blockScores, bootstrapSeed),
    blocks: evaluation.blockScores.length, matches: evaluation.matches };
}

interface OracleBatchInput {
  kind: 'oracle' | 'attack';
  round: number;
  config: RandomPsroConfig;
  domain: ResponsePolicyDomain;
  snapshot: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  runner: PairingRunner;
  ledger: RandomPsroSeedLedger;
}

async function randomBatch(input: OracleBatchInput): Promise<{
  proposalSeed: number; uniqueProposals: number; raceSeeds: number[];
  confirmationSeeds: number[]; finalists: ConfirmedCandidate[];
}> {
  const count = input.kind === 'attack' ? input.config.independentAttackProposalCount : input.config.proposalCount;
  const label = `${input.kind}:${input.round}`;
  const raceSeeds = input.ledger.reserve(`${label}:race`, input.config.raceBlocks.reduce((sum, value) => sum + value, 0));
  const confirmationSeeds = input.ledger.reserve(`${label}:confirmation`, input.config.confirmationBlocks);
  const samplingSeeds = input.ledger.reserve(`${label}:sampling`, 2);
  const bootstrapSeeds = input.ledger.reserve(`${label}:bootstrap`, input.config.finalists);
  const seed = input.ledger.reserve(`${label}:proposal`, 1)[0]!;
  const opponents = weightedStrategies(input.snapshot, input.equilibrium);
  const budget = randomRacingBudget(count, input.config.raceBlocks);
  const objective = new BudgetedResponseObjective({ kingdomId: input.domain.kingdomId, opponents,
    budget, scheduleSeed: samplingSeeds[0]!, samplingSeed: samplingSeeds[0]!, scheduleSeeds: raceSeeds,
    runner: input.runner, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN });
  const raced = await runUniformRandomRacing(objective, input.domain, seed, {
    batchSize: count, roundBlocks: input.config.raceBlocks, searchBudget: budget
  });
  const uniqueProposals = Number(raced.diagnostics.uniquePolicies);
  if (uniqueProposals !== count) throw new Error(`Random batch generated ${uniqueProposals}; required ${count} unique proposals.`);
  const known = new Set(input.snapshot.strategies.map(canonicalStrategy));
  const finalists = raced.finalists.filter((strategy) => !known.has(canonicalStrategy(strategy)))
    .slice(0, input.config.finalists);
  if (!finalists.length) return { proposalSeed: seed, uniqueProposals, raceSeeds, confirmationSeeds, finalists: [] };
  const weights = input.equilibrium.weights;
  const opponentMap = new Map(input.snapshot.strategies.map((strategy) => [strategy.id, strategy]));
  const schedule = mixtureSchedule(weights, confirmationSeeds, samplingSeeds[1]!);
  const evaluations = await evaluateCandidates(finalists, opponentMap, schedule, input.runner, {
    kingdomId: input.domain.kingdomId,
    turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
    actionCapPerTurn: ACTION_CAP_PER_TURN
  });
  const evidence = evaluations.map((entry, index) => confirmed(entry, bootstrapSeeds[index]!))
    .sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return { proposalSeed: seed, uniqueProposals, raceSeeds, confirmationSeeds, finalists: evidence };
}

export function convergenceState(cleanStreak: number, admitted: boolean, required = 2): {
  cleanStreak: number; converged: boolean;
} {
  const next = admitted ? 0 : cleanStreak + 1;
  return { cleanStreak: next, converged: next >= required };
}

export async function runRandomPsro(
  options: RunRandomPsroOptions, runner: PairingRunner, now = Date.now
): Promise<RandomPsroArtifact> {
  const started = now();
  const config = completeConfig(options.config);
  const kingdom = kingdomOf(options.kingdomId);
  if (kingdom.startingHealth !== 50) throw new Error(`${options.kingdomId} must use 50 starting health.`);
  const fingerprint = rulesFingerprint(options.kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
  const ledger = new RandomPsroSeedLedger(options.seed);
  const domain = stoplessRandomDomain(options.kingdomId, 8);
  const matrixSeeds = ledger.reserve('matrix', config.matrixBlocks);
  const matrix = new PayoffMatrix(matrixProtocol(options.kingdomId, matrixSeeds,
    TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false), runner, createMatrixCellCache());
  const initialSeed = ledger.reserve('initial:proposal', 1)[0]!;
  const initial = uniqueRandomPolicies(domain, initialSeed, config.initialStrategies);
  for (const strategy of initial) matrix.addStrategy(strategy);
  await matrix.fillAll(false);
  let snapshot = matrix.snapshot();
  let equilibrium = solve(snapshot);
  let cleanStreak = 0;
  let converged = false;
  const rounds: RandomOracleRound[] = [];
  for (let round = 0; round < config.safetyCap; round += 1) {
    const targetWeights = { ...equilibrium.weights };
    const batch = await randomBatch({ kind: 'oracle', round, config,
      domain, snapshot, equilibrium, runner, ledger });
    const response = batch.finalists.find((entry) => entry.interval95.lower > config.admissionLowerBound) ?? null;
    if (response) {
      await matrix.addRow(response.strategy, false);
      snapshot = matrix.snapshot();
      equilibrium = solve(snapshot);
    }
    const state = convergenceState(cleanStreak, response !== null, config.cleanBatchesRequired);
    cleanStreak = state.cleanStreak;
    converged = state.converged;
    rounds.push({ round, targetWeights, proposalSeed: batch.proposalSeed,
      uniqueProposals: batch.uniqueProposals, raceScheduleSeeds: batch.raceSeeds,
      confirmationScheduleSeeds: batch.confirmationSeeds, finalists: batch.finalists,
      admittedStrategyId: response?.strategy.id ?? null, cleanBatch: response === null,
      cleanStreak, equilibriumAfter: equilibrium });
    if (converged) break;
  }
  snapshot = matrix.snapshot();
  equilibrium = solve(snapshot);
  const attackBatch = await randomBatch({ kind: 'attack', round: rounds.length,
    config, domain, snapshot, equilibrium, runner, ledger });
  const attackBest = attackBatch.finalists[0] ?? null;
  const independentAttack: RandomAttackResult = {
    proposalSeed: attackBatch.proposalSeed,
    uniqueProposals: attackBatch.uniqueProposals,
    scheduleSeeds: attackBatch.confirmationSeeds,
    best: attackBest,
    confirmedAboveThreshold: (attackBest?.interval95.lower ?? 0) > config.independentAttackLowerBound
  };
  ledger.validate();
  return {
    schemaVersion: 1, experiment: 'random-first-psro-consistency', suiteVersion: RANDOM_PSRO_VERSION,
    createdAt: new Date().toISOString(), kingdom, rulesFingerprint: fingerprint, runSeed: options.seed,
    config, status: converged ? 'converged' : 'incomplete',
    stopReason: converged ? 'two-clean-random-batches' : 'safety-cap', rounds,
    matrix: snapshot, equilibrium, independentAttack, seedNamespaces: ledger.namespaces,
    elapsedMs: now() - started
  };
}

export interface ArtifactEvidence { valid: boolean; converged: boolean; reason: string; artifact: RandomPsroArtifact | null }

export function validateRandomPsroArtifact(
  input: unknown, expected: { kingdomId: string; seed: number; config?: Partial<RandomPsroConfig> }
): ArtifactEvidence {
  try {
    const artifact = input as RandomPsroArtifact;
    const config = completeConfig(expected.config);
    const fingerprint = rulesFingerprint(expected.kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
    if (artifact?.schemaVersion !== 1 || artifact.experiment !== 'random-first-psro-consistency'
      || artifact.suiteVersion !== RANDOM_PSRO_VERSION) throw new Error('wrong random PSRO schema or version');
    if (artifact.kingdom?.id !== expected.kingdomId || artifact.runSeed !== expected.seed) throw new Error('wrong kingdom or seed');
    if (JSON.stringify(artifact.config) !== JSON.stringify(config)) throw new Error('configuration is stale');
    if (JSON.stringify(artifact.rulesFingerprint) !== JSON.stringify(fingerprint)) throw new Error('rules fingerprint is stale');
    if (!artifact.matrix?.complete || artifact.matrix.protocol?.startingDraftEnabled !== false
      || artifact.matrix.protocol?.rulesFingerprint !== fingerprint.hash) throw new Error('matrix is incomplete or stale');
    if (!artifact.equilibrium || artifact.equilibrium.strategyIds.length !== artifact.matrix.strategies.length) {
      throw new Error('equilibrium is missing or stale');
    }
    if (!Array.isArray(artifact.rounds) || !artifact.rounds.length || artifact.rounds.length > config.safetyCap) {
      throw new Error('oracle rounds are missing or exceed the safety cap');
    }
    const raceSeedCount = config.raceBlocks.reduce((sum, value) => sum + value, 0);
    for (const round of artifact.rounds) {
      if (round.uniqueProposals !== config.proposalCount
        || round.raceScheduleSeeds.length !== raceSeedCount
        || round.confirmationScheduleSeeds.length !== config.confirmationBlocks
        || round.cleanBatch !== (round.admittedStrategyId === null)) {
        throw new Error('oracle round evidence is incomplete or inconsistent');
      }
    }
    const domain = stoplessRandomDomain(expected.kingdomId, 8);
    for (const strategy of artifact.matrix.strategies) domain.decode(strategy);
    const allSeeds = Object.values(artifact.seedNamespaces ?? {}).flat();
    if (!allSeeds.length || new Set(allSeeds).size !== allSeeds.length) throw new Error('simulation evidence seeds overlap');
    const converged = artifact.status === 'converged'
      && artifact.stopReason === 'two-clean-random-batches'
      && artifact.rounds.slice(-config.cleanBatchesRequired).every((round) => round.cleanBatch);
    if (artifact.status !== 'incomplete' && !converged) throw new Error('terminal convergence state is inconsistent');
    if (artifact.status === 'incomplete'
      && (artifact.stopReason !== 'safety-cap' || artifact.rounds.length !== config.safetyCap)) {
      throw new Error('incomplete run has wrong safety-cap state');
    }
    if (!artifact.independentAttack || artifact.independentAttack.uniqueProposals !== config.independentAttackProposalCount) {
      throw new Error('independent attack is missing or stale');
    }
    return { valid: true, converged, reason: converged ? 'converged' : 'safety cap reached', artifact };
  } catch (error) {
    return { valid: false, converged: false,
      reason: error instanceof Error ? error.message : String(error), artifact: null };
  }
}

export function strategyArchetype(strategy: Strategy): string {
  const families = Object.entries(DAMAGE_MECHANICS).flatMap(([label, mechanics]) =>
    strategy.buyPlan.some((slot) => slot.kind === 'buy' && mechanics.has(cardDefinition(slot.cardId).mechanic))
      ? [label] : []);
  return families.length ? families.join(' + ') : 'Engine';
}

export interface ArchetypeSummary { archetype: string; selectedShare: number; range: EquilibriumGroupWeightRange }
export function artifactArchetypes(artifact: RandomPsroArtifact): ArchetypeSummary[] {
  const labels = new Map(artifact.matrix.strategies.map((strategy) => [strategy.id, strategyArchetype(strategy)]));
  return [...new Set(labels.values())].sort().map((archetype) => {
    const ids = artifact.matrix.strategies.filter((strategy) => labels.get(strategy.id) === archetype)
      .map((strategy) => strategy.id);
    return { archetype,
      selectedShare: ids.reduce((sum, id) => sum + (artifact.equilibrium.weights[id] ?? 0), 0),
      range: equilibriumGroupWeightRange(artifact.equilibrium.strategyIds,
        artifact.matrix.centeredPayoffs, artifact.equilibrium.value, ids) };
  });
}

export function supportStrategies(artifact: RandomPsroArtifact): { strategy: Strategy; weight: number }[] {
  return artifact.matrix.strategies.flatMap((strategy) => {
    const weight = artifact.equilibrium.weights[strategy.id] ?? 0;
    return weight > 1e-6 ? [{ strategy, weight }] : [];
  });
}
