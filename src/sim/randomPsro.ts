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
import { proposeResponsePortfolio } from './responsePortfolio';
import type { ResponseProposalDiagnostics } from './responsePortfolio';
import { ResponsePolicyDomain } from './responsePolicyGrammar';
import { rulesFingerprint } from './rulesFingerprint';
import type { RulesFingerprint } from './rulesFingerprint';
import { canonicalStrategy, identify, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const RANDOM_PSRO_VERSION = 'random-psro-v5';
export const RANDOM_PSRO_SUITE_SEEDS = Object.freeze([35_001, 35_002] as const);
export const RANDOM_PSRO_DEFAULT_CONFIG = Object.freeze({
  initialStrategies: 8,
  proposalCount: 20_000,
  raceBlocks: Object.freeze([1, 2, 4, 8] as const),
  finalists: 8,
  confirmationBlocks: 400,
  matrixBlocks: 25,
  safetyCap: 48,
  cleanBatchesRequired: 5,
  admissionLowerBound: 0.50,
  independentAttackProposalCount: 20_000
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
  proposalDiagnostics: ResponseProposalDiagnostics;
  raceScheduleSeeds: number[];
  confirmationScheduleSeeds: number[];
  archiveCandidateIds: string[];
  freshFinalistIds: string[];
  archiveFinalistIds: string[];
  finalists: ConfirmedCandidate[];
  admittedStrategyIds: string[];
  archiveSizeAfter: number;
  cleanBatch: boolean;
  cleanStreak: number;
  equilibriumAfter: EquilibriumResult;
}

export interface RandomAttackResult {
  proposalSeed: number;
  uniqueProposals: number;
  proposalDiagnostics: ResponseProposalDiagnostics;
  scheduleSeeds: number[];
  finalists: ConfirmedCandidate[];
  best: ConfirmedCandidate | null;
  confirmedAboveThreshold: boolean;
}

export interface RandomPsroArtifact {
  schemaVersion: 4;
  experiment: 'random-first-psro-consistency';
  suiteVersion: typeof RANDOM_PSRO_VERSION;
  createdAt: string;
  kingdom: Kingdom;
  rulesFingerprint: RulesFingerprint;
  runSeed: number;
  config: RandomPsroConfig;
  status: 'converged' | 'incomplete';
  stopReason: 'five-clean-batches-and-attack-clear' | 'independent-attack-found' | 'safety-cap';
  rounds: RandomOracleRound[];
  archive: ConfirmedCandidate[];
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  independentAttack: RandomAttackResult | null;
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
  if (config.matrixBlocks > 25) throw new Error('matrixBlocks cannot exceed the 25-seed pairing limit.');
  if (!config.raceBlocks.length || config.raceBlocks.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('raceBlocks must be positive integers.');
  }
  if (config.admissionLowerBound !== 0.5) throw new Error('The random PSRO CI gate must be 0.50.');
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

function uniqueRandomPolicies(
  domain: ResponsePolicyDomain, seed: number, count: number, excluded: ReadonlySet<string> = new Set()
): Strategy[] {
  const random = new SeededRandom(seed);
  const forms = new Set<string>();
  const policies: Strategy[] = [];
  for (let attempts = 0; policies.length < count && attempts < count * 256; attempts += 1) {
    const policy = domain.randomComplete(random);
    const form = canonicalStrategy(policy);
    if (!excluded.has(form) && !forms.has(form)) { forms.add(form); policies.push(policy); }
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
  archive?: readonly ConfirmedCandidate[];
  parents?: readonly Strategy[];
}

function ordered(evaluations: readonly CandidateEvaluation[]): CandidateEvaluation[] {
  return [...evaluations].sort((left, right) => right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id));
}

async function raceField(
  objective: BudgetedResponseObjective, field: readonly Strategy[], rounds: readonly number[]
): Promise<CandidateEvaluation[]> {
  let survivors = [...field];
  let last: CandidateEvaluation[] = [];
  for (const blocks of rounds) {
    last = ordered(await objective.evaluate(survivors, blocks));
    const keep = last.length <= 3 ? 1 : Math.max(3, Math.ceil(last.length / 3));
    survivors = last.slice(0, keep).map((entry) => entry.strategy);
  }
  return last;
}

async function randomBatch(input: OracleBatchInput): Promise<{
  proposalSeed: number; uniqueProposals: number; proposalDiagnostics: ResponseProposalDiagnostics;
  raceSeeds: number[]; confirmationSeeds: number[]; finalists: ConfirmedCandidate[];
}> {
  const count = input.kind === 'attack' ? input.config.independentAttackProposalCount : input.config.proposalCount;
  const label = `${input.kind}:${input.round}`;
  const raceSeeds = input.ledger.reserve(`${label}:race`, input.config.raceBlocks.reduce((sum, value) => sum + value, 0));
  const confirmationSeeds = input.ledger.reserve(`${label}:confirmation`, input.config.confirmationBlocks);
  const samplingSeeds = input.ledger.reserve(`${label}:sampling`, 2);
  const bootstrapSeeds = input.ledger.reserve(`${label}:bootstrap`, input.config.finalists);
  const seed = input.ledger.reserve(`${label}:proposal`, 1)[0]!;
  const opponents = weightedStrategies(input.snapshot, input.equilibrium);
  const archive = input.kind === 'oracle' ? [...(input.archive ?? [])] : [];
  const parents = [...weightedStrategies(input.snapshot, input.equilibrium).map((entry) => entry.strategy),
    ...(input.parents ?? [])];
  const known = new Set([...input.snapshot.strategies.map(canonicalStrategy),
    ...archive.map((entry) => canonicalStrategy(entry.strategy)), ...parents.map(canonicalStrategy)]);
  const proposal = proposeResponsePortfolio({ kingdom: kingdomOf(input.domain.kingdomId), seed, count,
    excludedCanonical: known, parents });
  const fresh = proposal.policies;
  const budget = randomRacingBudget(fresh.length, input.config.raceBlocks)
    + (archive.length ? randomRacingBudget(archive.length, input.config.raceBlocks) : 0);
  const objective = new BudgetedResponseObjective({ kingdomId: input.domain.kingdomId, opponents,
    budget, scheduleSeed: samplingSeeds[0]!, samplingSeed: samplingSeeds[0]!, scheduleSeeds: raceSeeds,
    runner: input.runner, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
    actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false });
  const archiveRaced = archive.length
    ? await raceField(objective, archive.map((entry) => entry.strategy), input.config.raceBlocks) : [];
  const freshRaced = await raceField(objective, fresh, input.config.raceBlocks);
  const finalists = ordered([...archiveRaced, ...freshRaced]).slice(0, input.config.finalists)
    .map((entry) => entry.strategy);
  const uniqueProposals = fresh.length;
  if (!finalists.length) return { proposalSeed: seed, uniqueProposals,
    proposalDiagnostics: proposal.diagnostics, raceSeeds, confirmationSeeds, finalists: [] };
  const weights = input.equilibrium.weights;
  const opponentMap = new Map(input.snapshot.strategies.map((strategy) => [strategy.id, strategy]));
  const schedule = mixtureSchedule(weights, confirmationSeeds, samplingSeeds[1]!);
  const evaluations = await evaluateCandidates(finalists, opponentMap, schedule, input.runner, {
    kingdomId: input.domain.kingdomId,
    turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
    actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false
  });
  const evidence = evaluations.map((entry, index) => confirmed(entry, bootstrapSeeds[index]!))
    .sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return { proposalSeed: seed, uniqueProposals, proposalDiagnostics: proposal.diagnostics,
    raceSeeds, confirmationSeeds, finalists: evidence };
}

export function convergenceState(cleanStreak: number, admitted: boolean, required = 5): {
  cleanStreak: number; converged: boolean;
} {
  const next = admitted ? 0 : cleanStreak + 1;
  return { cleanStreak: next, converged: next >= required };
}

export function summarizeIndependentAttack(
  proposalSeed: number, uniqueProposals: number, proposalDiagnostics: ResponseProposalDiagnostics,
  scheduleSeeds: readonly number[], finalists: readonly ConfirmedCandidate[], threshold: number
): RandomAttackResult {
  const retained = [...finalists];
  const best = [...retained].sort((left, right) => right.interval95.lower - left.interval95.lower
    || right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id))[0] ?? null;
  return { proposalSeed, uniqueProposals, proposalDiagnostics, scheduleSeeds: [...scheduleSeeds], finalists: retained, best,
    confirmedAboveThreshold: retained.some((entry) => entry.interval95.lower > threshold) };
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
  let cleanConvergence = false;
  const rounds: RandomOracleRound[] = [];
  const archive: ConfirmedCandidate[] = [];
  const archivedForms = new Set<string>();
  for (let round = 0; round < config.safetyCap; round += 1) {
    const targetWeights = { ...equilibrium.weights };
    const activeForms = new Set(snapshot.strategies.map(canonicalStrategy));
    const reconsidered = archive.filter((entry) => !activeForms.has(canonicalStrategy(entry.strategy)));
    const archiveCandidateIds = reconsidered.map((entry) => entry.strategy.id);
    const archiveForms = new Set(reconsidered.map((entry) => canonicalStrategy(entry.strategy)));
    const batch = await randomBatch({ kind: 'oracle', round, config,
      domain, snapshot, equilibrium, runner, ledger, archive: reconsidered,
      parents: archive.map((entry) => entry.strategy) });
    const freshFinalistIds = batch.finalists.filter((entry) => !archiveForms.has(canonicalStrategy(entry.strategy)))
      .map((entry) => entry.strategy.id);
    const archiveFinalistIds = batch.finalists.filter((entry) => archiveForms.has(canonicalStrategy(entry.strategy)))
      .map((entry) => entry.strategy.id);
    for (const finalist of batch.finalists) {
      const form = canonicalStrategy(finalist.strategy);
      if (!archivedForms.has(form)) { archivedForms.add(form); archive.push(finalist); }
    }
    const admitted = batch.finalists.filter((entry) => entry.interval95.lower > config.admissionLowerBound);
    for (const entry of admitted) matrix.addStrategy(entry.strategy);
    if (admitted.length) {
      await matrix.fillAll(false);
      snapshot = matrix.snapshot();
      equilibrium = solve(snapshot);
    }
    const state = convergenceState(cleanStreak, admitted.length > 0, config.cleanBatchesRequired);
    cleanStreak = state.cleanStreak;
    cleanConvergence = state.converged;
    rounds.push({ round, targetWeights, proposalSeed: batch.proposalSeed,
      uniqueProposals: batch.uniqueProposals, proposalDiagnostics: batch.proposalDiagnostics,
      raceScheduleSeeds: batch.raceSeeds,
      confirmationScheduleSeeds: batch.confirmationSeeds, archiveCandidateIds,
      freshFinalistIds, archiveFinalistIds, finalists: batch.finalists,
      admittedStrategyIds: admitted.map((entry) => entry.strategy.id), archiveSizeAfter: archive.length,
      cleanBatch: admitted.length === 0, cleanStreak, equilibriumAfter: equilibrium });
    if (cleanConvergence) break;
  }
  snapshot = matrix.snapshot();
  equilibrium = solve(snapshot);
  let independentAttack: RandomAttackResult | null = null;
  if (cleanConvergence) {
    const attackBatch = await randomBatch({ kind: 'attack', round: rounds.length,
      config, domain, snapshot, equilibrium, runner, ledger,
      parents: archive.map((entry) => entry.strategy) });
    independentAttack = summarizeIndependentAttack(attackBatch.proposalSeed,
      attackBatch.uniqueProposals, attackBatch.proposalDiagnostics,
      attackBatch.confirmationSeeds, attackBatch.finalists,
      config.admissionLowerBound);
  }
  const converged = cleanConvergence && independentAttack?.confirmedAboveThreshold === false;
  const stopReason = converged ? 'five-clean-batches-and-attack-clear'
    : cleanConvergence ? 'independent-attack-found' : 'safety-cap';
  ledger.validate();
  return {
    schemaVersion: 4, experiment: 'random-first-psro-consistency', suiteVersion: RANDOM_PSRO_VERSION,
    createdAt: new Date().toISOString(), kingdom, rulesFingerprint: fingerprint, runSeed: options.seed,
    config, status: converged ? 'converged' : 'incomplete', stopReason, rounds, archive,
    matrix: snapshot, equilibrium, independentAttack, seedNamespaces: ledger.namespaces,
    elapsedMs: now() - started
  };
}

export interface ArtifactEvidence { valid: boolean; converged: boolean; reason: string; artifact: RandomPsroArtifact | null }

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function near(left: number, right: number, tolerance = 1e-8): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function validateEquilibrium(saved: EquilibriumResult, computed: EquilibriumResult, label: string): void {
  if (!exact(saved.strategyIds, computed.strategyIds)) throw new Error(`${label} equilibrium strategy ids are stale`);
  const keys = Object.keys(computed.weights).sort();
  if (!exact(Object.keys(saved.weights ?? {}).sort(), keys)
    || !exact(Object.keys(saved.maximumEquilibriumWeight ?? {}).sort(), keys)) {
    throw new Error(`${label} equilibrium weight ids are stale`);
  }
  for (const id of keys) {
    if (!near(saved.weights[id]!, computed.weights[id]!)
      || !near(saved.maximumEquilibriumWeight[id]!, computed.maximumEquilibriumWeight[id]!)) {
      throw new Error(`${label} equilibrium weights are stale`);
    }
  }
  if (!near(saved.value, computed.value) || !near(saved.maximumKnownAdvantage, computed.maximumKnownAdvantage)) {
    throw new Error(`${label} equilibrium value is stale`);
  }
  for (const key of Object.keys(computed.residuals) as (keyof EquilibriumResult['residuals'])[]) {
    if (!(saved.residuals?.[key] >= 0) || !near(saved.residuals[key], computed.residuals[key])) {
      throw new Error(`${label} equilibrium residuals are invalid`);
    }
  }
}

function validateConfirmedCandidate(
  entry: ConfirmedCandidate, domain: ResponsePolicyDomain, blocks: number, label: string
): void {
  domain.decode(entry.strategy);
  if (identify(entry.strategy).id !== entry.strategy.id) throw new Error(`${label} strategy id is not canonical`);
  if (!Number.isFinite(entry.mean) || entry.mean < 0 || entry.mean > 1
    || !Number.isFinite(entry.interval95?.lower) || !Number.isFinite(entry.interval95?.upper)
    || entry.interval95.lower < 0 || entry.interval95.upper > 1
    || entry.interval95.lower > entry.interval95.upper
    || entry.blocks !== blocks || entry.matches !== blocks * 4) {
    throw new Error(`${label} confirmation evidence is invalid`);
  }
}

export function validateRandomPsroArtifact(
  input: unknown, expected: { kingdomId: string; seed: number; config?: Partial<RandomPsroConfig> }
): ArtifactEvidence {
  try {
    const artifact = input as RandomPsroArtifact;
    const config = completeConfig(expected.config);
    const kingdom = kingdomOf(expected.kingdomId);
    const fingerprint = rulesFingerprint(expected.kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
    if (artifact?.schemaVersion !== 4 || artifact.experiment !== 'random-first-psro-consistency'
      || artifact.suiteVersion !== RANDOM_PSRO_VERSION) throw new Error('wrong random PSRO schema or version');
    if (artifact.runSeed !== expected.seed || !exact(artifact.kingdom, kingdom)) throw new Error('wrong kingdom or seed');
    if (!exact(artifact.config, config)) throw new Error('configuration is stale');
    if (!exact(artifact.rulesFingerprint, fingerprint)) throw new Error('rules fingerprint is stale');

    const namespaces = artifact.seedNamespaces ?? {};
    const allSeeds = Object.values(namespaces).flat();
    if (!allSeeds.length || new Set(allSeeds).size !== allSeeds.length) throw new Error('simulation evidence seeds overlap');
    const matrixSeeds = namespaces.matrix;
    if (!Array.isArray(matrixSeeds) || matrixSeeds.length !== config.matrixBlocks
      || namespaces['initial:proposal']?.length !== 1) throw new Error('matrix or initial seed evidence is stale');
    const expectedProtocol = matrixProtocol(expected.kingdomId, matrixSeeds,
      TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
    if (!artifact.matrix?.complete || !exact(artifact.matrix.protocol, expectedProtocol)) {
      throw new Error('matrix protocol is incomplete or stale');
    }
    const domain = stoplessRandomDomain(expected.kingdomId, 8);
    const strategies = artifact.matrix.strategies;
    if (!Array.isArray(strategies) || strategies.length < config.initialStrategies
      || !exact(strategies.map((strategy) => strategy.id), strategies.map((strategy) => strategy.id).sort())
      || new Set(strategies.map((strategy) => strategy.id)).size !== strategies.length) {
      throw new Error('matrix strategy ids are invalid');
    }
    for (const strategy of strategies) {
      domain.decode(strategy);
      if (identify(strategy).id !== strategy.id) throw new Error('matrix strategy id is not canonical');
    }
    const size = strategies.length;
    const payoffs = artifact.matrix.centeredPayoffs;
    if (!Array.isArray(payoffs) || payoffs.length !== size
      || payoffs.some((row) => !Array.isArray(row) || row.length !== size)) throw new Error('matrix payoff shape is invalid');
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
      const value = payoffs[row]![column]!;
      if (!Number.isFinite(value) || (row === column && value !== 0)
        || !near(value, -payoffs[column]![row]!)) throw new Error('matrix payoffs are not finite antisymmetric values');
    }
    const cells = artifact.matrix.cells;
    if (!Array.isArray(cells) || cells.length !== size * (size - 1) / 2) throw new Error('matrix cells are incomplete');
    const cellPairs = new Set<string>();
    const cellKeys = new Set<string>();
    const indexById = new Map(strategies.map((strategy, index) => [strategy.id, index]));
    for (const cell of cells) {
      const row = indexById.get(cell.rowId), column = indexById.get(cell.columnId);
      const pair = `${cell.rowId}|${cell.columnId}`;
      if (row === undefined || column === undefined || row >= column || cellPairs.has(pair)
        || typeof cell.key !== 'string' || !cell.key || cellKeys.has(cell.key) || !cell.complete
        || !Array.isArray(cell.blocks) || cell.blocks.length !== config.matrixBlocks
        || !exact(cell.blocks.map((block) => block.seed), matrixSeeds)
        || cell.blocks.some((block) => block.played !== 4
          || block.aborted !== 0 || !Number.isFinite(block.score) || block.score < 0 || block.score > 1)) {
        throw new Error('matrix cell evidence is invalid');
      }
      cellPairs.add(pair); cellKeys.add(cell.key);
      const played = cell.blocks.reduce((sum, block) => sum + block.played, 0);
      const centered = 2 * cell.blocks.reduce((sum, block) => sum + block.score * block.played, 0) / played - 1;
      if (!near(cell.centeredPayoff, centered) || !near(payoffs[row]![column]!, centered)
        || cell.matches !== cell.blocks.length * 4) throw new Error('matrix cell payoff is stale');
    }
    const computedFinal = solveEquilibrium(strategies.map((strategy) => strategy.id), payoffs);
    validateEquilibrium(artifact.equilibrium, computedFinal, 'final');

    if (!Array.isArray(artifact.rounds) || artifact.rounds.length < 1 || artifact.rounds.length > config.safetyCap) {
      throw new Error('oracle rounds are missing or exceed the safety cap');
    }
    const admittedIds = artifact.rounds.flatMap((round) => round.admittedStrategyIds ?? []);
    if (new Set(admittedIds).size !== admittedIds.length) throw new Error('admitted strategy chain contains duplicates');
    const admittedSet = new Set(admittedIds);
    let activeIds = strategies.map((strategy) => strategy.id).filter((id) => !admittedSet.has(id));
    if (activeIds.length !== config.initialStrategies) throw new Error('initial strategy population is stale');
    let cleanStreak = 0;
    let cleanConvergence = false;
    const reconstructedArchive: ConfirmedCandidate[] = [];
    const archivedForms = new Set<string>();
    const raceSeedCount = config.raceBlocks.reduce((sum, value) => sum + value, 0);
    const expectedNamespaceLabels = new Set(['matrix', 'initial:proposal']);
    for (let index = 0; index < artifact.rounds.length; index += 1) {
      const round = artifact.rounds[index]!;
      const label = `oracle:${index}`;
      for (const suffix of ['race', 'confirmation', 'sampling', 'bootstrap', 'proposal']) {
        expectedNamespaceLabels.add(`${label}:${suffix}`);
      }
      const activeIndexes = activeIds.map((id) => strategies.findIndex((strategy) => strategy.id === id));
      const activePayoffs = activeIndexes.map((row) => activeIndexes.map((column) => payoffs[row]![column]!));
      const before = solveEquilibrium(activeIds, activePayoffs);
      const activeForms = new Set(activeIds.map((id) => canonicalStrategy(strategies.find((strategy) => strategy.id === id)!)));
      const expectedArchiveCandidates = reconstructedArchive
        .filter((entry) => !activeForms.has(canonicalStrategy(entry.strategy))).map((entry) => entry.strategy.id);
      if (round.round !== index || !exact(round.targetWeights, before.weights)
        || round.uniqueProposals !== config.proposalCount
        || !exact(round.archiveCandidateIds, expectedArchiveCandidates)
        || !exact(round.raceScheduleSeeds, namespaces[`${label}:race`])
        || !exact(round.confirmationScheduleSeeds, namespaces[`${label}:confirmation`])
        || round.raceScheduleSeeds.length !== raceSeedCount
        || round.confirmationScheduleSeeds.length !== config.confirmationBlocks
        || namespaces[`${label}:sampling`]?.length !== 2
        || namespaces[`${label}:bootstrap`]?.length !== config.finalists
        || namespaces[`${label}:proposal`]?.length !== 1
        || round.proposalSeed !== namespaces[`${label}:proposal`]![0]) {
        throw new Error('oracle round schedule, archive, or target chain is stale');
      }
      const activeStrategies = activeIds.map((id) => strategies.find((strategy) => strategy.id === id)!);
      const proposalParents = [...activeStrategies.filter((strategy) => (before.weights[strategy.id] ?? 0) > 0),
        ...reconstructedArchive.map((entry) => entry.strategy)];
      const regenerated = proposeResponsePortfolio({ kingdom, seed: round.proposalSeed,
        count: config.proposalCount,
        excludedCanonical: new Set([...activeStrategies, ...reconstructedArchive.map((entry) => entry.strategy)]
          .map(canonicalStrategy)), parents: proposalParents });
      if (!exact(round.proposalDiagnostics, regenerated.diagnostics)) {
        throw new Error('oracle proposal source or recipe evidence is stale');
      }
      const generatedForms = new Set(regenerated.policies.map(canonicalStrategy));
      if (round.finalists.length > config.finalists) throw new Error('oracle finalist count exceeds its cap');
      const archiveCandidateSet = new Set(round.archiveCandidateIds);
      const expectedFresh: string[] = [], expectedArchived: string[] = [];
      const finalistForms = new Set<string>();
      for (const finalist of round.finalists) {
        validateConfirmedCandidate(finalist, domain, config.confirmationBlocks, 'oracle finalist');
        const form = canonicalStrategy(finalist.strategy);
        if (activeForms.has(form) || finalistForms.has(form)) throw new Error('oracle finalist is not novel');
        finalistForms.add(form);
        if (archiveCandidateSet.has(finalist.strategy.id)) expectedArchived.push(finalist.strategy.id);
        else {
          if (!generatedForms.has(form)) throw new Error('oracle fresh finalist lacks proposal evidence');
          expectedFresh.push(finalist.strategy.id);
        }
        if (!archivedForms.has(form)) { archivedForms.add(form); reconstructedArchive.push(finalist); }
      }
      if (!exact(round.freshFinalistIds, expectedFresh) || !exact(round.archiveFinalistIds, expectedArchived)
        || round.archiveSizeAfter !== reconstructedArchive.length) {
        throw new Error('oracle finalist provenance or archive size is stale');
      }
      const expectedAdmitted = round.finalists.filter((entry) => entry.interval95.lower > config.admissionLowerBound)
        .map((entry) => entry.strategy.id);
      if (!exact(round.admittedStrategyIds, expectedAdmitted)
        || round.cleanBatch !== (expectedAdmitted.length === 0)) {
        throw new Error('oracle admission evidence is inconsistent');
      }
      for (const admitted of expectedAdmitted) {
        const finalist = round.finalists.find((entry) => entry.strategy.id === admitted)!;
        const matrixStrategy = strategies.find((strategy) => strategy.id === admitted);
        if (!matrixStrategy || canonicalStrategy(matrixStrategy) !== canonicalStrategy(finalist.strategy)) {
          throw new Error('admitted strategy content is missing from matrix');
        }
      }
      activeIds = [...activeIds, ...expectedAdmitted].sort();
      const afterIndexes = activeIds.map((id) => strategies.findIndex((strategy) => strategy.id === id));
      if (afterIndexes.some((value) => value < 0)) throw new Error('admitted strategy is missing from matrix');
      const after = solveEquilibrium(activeIds,
        afterIndexes.map((row) => afterIndexes.map((column) => payoffs[row]![column]!)));
      validateEquilibrium(round.equilibriumAfter, after, `round ${index}`);
      const state = convergenceState(cleanStreak, expectedAdmitted.length > 0, config.cleanBatchesRequired);
      cleanStreak = state.cleanStreak;
      if (round.cleanStreak !== cleanStreak || (state.converged && index !== artifact.rounds.length - 1)) {
        throw new Error('oracle clean-streak chain is inconsistent');
      }
      cleanConvergence = state.converged;
    }
    if (!exact(activeIds, strategies.map((strategy) => strategy.id))) throw new Error('terminal matrix strategy chain is stale');
    if (!Array.isArray(artifact.archive) || !exact(artifact.archive, reconstructedArchive)
      || new Set(artifact.archive.map((entry) => canonicalStrategy(entry.strategy))).size !== artifact.archive.length) {
      throw new Error('terminal finalist archive is stale');
    }

    const converged = artifact.status === 'converged';
    if (cleanConvergence) {
      if (artifact.rounds.length < config.cleanBatchesRequired || cleanStreak !== config.cleanBatchesRequired
        || !artifact.independentAttack) throw new Error('terminal clean state is inconsistent');
      const attack = artifact.independentAttack;
      const label = `attack:${artifact.rounds.length}`;
      for (const suffix of ['race', 'confirmation', 'sampling', 'bootstrap', 'proposal']) {
        expectedNamespaceLabels.add(`${label}:${suffix}`);
      }
      if (attack.uniqueProposals !== config.independentAttackProposalCount
        || !exact(attack.scheduleSeeds, namespaces[`${label}:confirmation`])
        || attack.scheduleSeeds.length !== config.confirmationBlocks
        || namespaces[`${label}:race`]?.length !== raceSeedCount
        || namespaces[`${label}:sampling`]?.length !== 2
        || namespaces[`${label}:bootstrap`]?.length !== config.finalists
        || namespaces[`${label}:proposal`]?.length !== 1
        || attack.proposalSeed !== namespaces[`${label}:proposal`]![0]) {
        throw new Error('independent attack schedule is stale');
      }
      const attackParents = [...strategies.filter((strategy) => (computedFinal.weights[strategy.id] ?? 0) > 0),
        ...reconstructedArchive.map((entry) => entry.strategy)];
      const regenerated = proposeResponsePortfolio({ kingdom, seed: attack.proposalSeed,
        count: config.independentAttackProposalCount,
        excludedCanonical: new Set([...strategies, ...reconstructedArchive.map((entry) => entry.strategy)]
          .map(canonicalStrategy)), parents: attackParents });
      if (!exact(attack.proposalDiagnostics, regenerated.diagnostics)) {
        throw new Error('independent attack proposal source or recipe evidence is stale');
      }
      const generatedForms = new Set(regenerated.policies.map(canonicalStrategy));
      if (attack.finalists.length > config.finalists) throw new Error('attack finalist count exceeds its cap');
      const finalForms = new Set(strategies.map(canonicalStrategy));
      const attackForms = new Set<string>();
      for (const finalist of attack.finalists) {
        validateConfirmedCandidate(finalist, domain, config.confirmationBlocks, 'attack finalist');
        const form = canonicalStrategy(finalist.strategy);
        if (finalForms.has(form) || attackForms.has(form) || !generatedForms.has(form)) {
          throw new Error('attack finalist is not novel or lacks proposal evidence');
        }
        attackForms.add(form);
      }
      const summary = summarizeIndependentAttack(attack.proposalSeed, attack.uniqueProposals,
        attack.proposalDiagnostics, attack.scheduleSeeds, attack.finalists, config.admissionLowerBound);
      if (!exact(attack.best, summary.best) || attack.confirmedAboveThreshold !== summary.confirmedAboveThreshold) {
        throw new Error('independent attack result flag is stale');
      }
      if (converged !== !attack.confirmedAboveThreshold
        || artifact.stopReason !== (converged ? 'five-clean-batches-and-attack-clear' : 'independent-attack-found')) {
        throw new Error('independent attack convergence gate is inconsistent');
      }
    } else if (artifact.status !== 'incomplete' || artifact.stopReason !== 'safety-cap'
      || artifact.rounds.length !== config.safetyCap || artifact.independentAttack !== null) {
      throw new Error('incomplete run has wrong safety-cap state');
    }
    if (!exact(Object.keys(namespaces).sort(), [...expectedNamespaceLabels].sort())) {
      throw new Error('seed namespace evidence is incomplete or unexpected');
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
