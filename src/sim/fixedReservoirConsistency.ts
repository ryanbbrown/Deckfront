import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from './mixtureEvaluation';
import type { BootstrapInterval, MixtureSchedule } from './mixtureEvaluation';
import type { MatrixCellCache, MatrixSnapshot } from './payoffMatrix';
import { GAMES_PER_SEED } from './pairing';
import type { PairingRunner } from './pairingRunner';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const FIXED_RESERVOIR_CONSISTENCY_VERSION = 'fixed-reservoir-consistency-v2' as const;
export const CONSISTENCY_EVALUATION_SEEDS = Object.freeze([7_100_009, 7_200_009, 7_300_009] as const);
export const CONSISTENCY_PHASES = Object.freeze(['search', 'baseline-audit', 'selected-closure', 'selected-direct'] as const);
export type ConsistencyPhase = typeof CONSISTENCY_PHASES[number];
export type RaceProtocolId = 'legacy-stage-v1' | 'cumulative-v1' | 'early-4x-v1' |
  'union-2x-v1' | 'adaptive-boundary-v1' | 'closure-union-cumulative-v1';
export type RankingSemantics = 'stage-local' | 'cumulative';

export interface RaceProtocolDefinition {
  id: RaceProtocolId;
  stageBlocks: readonly number[];
  ranking: RankingSemantics;
  racePasses: 1 | 2;
  finalistLimit: number;
  confirmationBlocks: 400;
  union: boolean;
  adaptive: boolean;
  wilsonZ: number | null;
  boundaryMultiplier: number | null;
  extraAllocation: 'none' | 'base-stage-blocks';
}

const definition = (value: RaceProtocolDefinition): Readonly<RaceProtocolDefinition> => Object.freeze({
  ...value, stageBlocks: Object.freeze([...value.stageBlocks])
});
export const RACE_PROTOCOLS: Readonly<Record<RaceProtocolId, Readonly<RaceProtocolDefinition>>> = Object.freeze({
  'legacy-stage-v1': definition({ id: 'legacy-stage-v1', stageBlocks: [1, 2, 4, 8], ranking: 'stage-local',
    racePasses: 1, finalistLimit: 8, confirmationBlocks: 400, union: false, adaptive: false,
    wilsonZ: null, boundaryMultiplier: null, extraAllocation: 'none' }),
  'cumulative-v1': definition({ id: 'cumulative-v1', stageBlocks: [1, 2, 4, 8], ranking: 'cumulative',
    racePasses: 1, finalistLimit: 8, confirmationBlocks: 400, union: false, adaptive: false,
    wilsonZ: null, boundaryMultiplier: null, extraAllocation: 'none' }),
  'early-4x-v1': definition({ id: 'early-4x-v1', stageBlocks: [4, 8, 16, 32], ranking: 'stage-local',
    racePasses: 1, finalistLimit: 8, confirmationBlocks: 400, union: false, adaptive: false,
    wilsonZ: null, boundaryMultiplier: null, extraAllocation: 'none' }),
  'union-2x-v1': definition({ id: 'union-2x-v1', stageBlocks: [1, 2, 4, 8], ranking: 'stage-local',
    racePasses: 2, finalistLimit: 8, confirmationBlocks: 400, union: true, adaptive: false,
    wilsonZ: null, boundaryMultiplier: null, extraAllocation: 'none' }),
  'adaptive-boundary-v1': definition({ id: 'adaptive-boundary-v1', stageBlocks: [1, 2, 4, 8], ranking: 'cumulative',
    racePasses: 1, finalistLimit: 8, confirmationBlocks: 400, union: false, adaptive: true,
    wilsonZ: 1.959963984540054, boundaryMultiplier: 2, extraAllocation: 'base-stage-blocks' }),
  'closure-union-cumulative-v1': definition({ id: 'closure-union-cumulative-v1', stageBlocks: [1, 2, 4, 8],
    ranking: 'cumulative', racePasses: 2, finalistLimit: 8, confirmationBlocks: 400, union: true,
    adaptive: false, wilsonZ: null, boundaryMultiplier: null, extraAllocation: 'none' })
});

export function raceProtocol(id: RaceProtocolId): Readonly<RaceProtocolDefinition> {
  const held = RACE_PROTOCOLS[id];
  if (!held) throw new Error(`Unknown fixed-reservoir race protocol ${id}.`);
  return held;
}

export function nominalSurvivorCount(fieldSize: number): number {
  if (!Number.isSafeInteger(fieldSize) || fieldSize < 1) throw new Error('Race field size must be positive.');
  return fieldSize <= 3 ? 1 : Math.max(3, Math.ceil(fieldSize / 3));
}

export function raceFunnel(fieldSize: number, stages = 4): number[] {
  if (!Number.isSafeInteger(stages) || stages < 1) throw new Error('Race stage count must be positive.');
  const sizes = [fieldSize];
  for (let index = 0; index < stages; index += 1) sizes.push(nominalSurvivorCount(sizes.at(-1)!));
  return sizes;
}

function uint32Hash(value: string): number {
  return Number.parseInt(stableHash(value).slice(0, 8), 16) >>> 0;
}

export interface ConsistencySeedNamespace { label: string; seeds: number[] }
export interface ConsistencySeedPlan {
  version: typeof FIXED_RESERVOIR_CONSISTENCY_VERSION;
  reservoirHash: string;
  evaluationSeed: number;
  roots: Record<ConsistencyPhase, number>;
  namespaces: ConsistencySeedNamespace[];
}

export function consistencySeedRoots(reservoirHash: string, evaluationSeed: number): Record<ConsistencyPhase, number> {
  if (!/^[0-9a-f]{9,}$/.test(reservoirHash) || !Number.isSafeInteger(evaluationSeed)
    || evaluationSeed < 0 || evaluationSeed > 0xffffffff) throw new Error('Seed root input is invalid.');
  return Object.fromEntries(CONSISTENCY_PHASES.map((phase) => [phase, uint32Hash([
    FIXED_RESERVOIR_CONSISTENCY_VERSION, reservoirHash, evaluationSeed, phase
  ].join(':'))])) as Record<ConsistencyPhase, number>;
}

export class ConsistencySeedPlanner {
  readonly plan: ConsistencySeedPlan;
  private readonly held = new Map<string, number[]>();
  constructor(reservoirHash: string, evaluationSeed: number) {
    this.plan = { version: FIXED_RESERVOIR_CONSISTENCY_VERSION, reservoirHash, evaluationSeed,
      roots: consistencySeedRoots(reservoirHash, evaluationSeed), namespaces: [] };
  }
  derive(phase: ConsistencyPhase, label: string, count: number): number[] {
    if (!CONSISTENCY_PHASES.includes(phase) || !label.length || !Number.isSafeInteger(count) || count < 1) {
      throw new Error('Seed namespace is invalid.');
    }
    const full = `${phase}:${label}`;
    const previous = this.held.get(full);
    const seeds = Array.from({ length: count }, (_unused, index) => uint32Hash(`${this.plan.roots[phase]}:${full}:${index}`));
    if (previous && previous.join('|') !== seeds.join('|')) throw new Error(`Seed namespace ${full} changed length.`);
    if (!previous) { this.held.set(full, seeds); this.plan.namespaces.push({ label: full, seeds }); }
    return [...seeds];
  }
  validate(): void { validateConsistencySeedPlan(this.plan); }
}

export function validateConsistencySeedPlan(plan: ConsistencySeedPlan): boolean {
  try {
    if (plan.version !== FIXED_RESERVOIR_CONSISTENCY_VERSION
      || JSON.stringify(plan.roots) !== JSON.stringify(consistencySeedRoots(plan.reservoirHash, plan.evaluationSeed))
      || !Array.isArray(plan.namespaces)) return false;
    const labels = new Set<string>(); const seeds = new Set<number>();
    for (const namespace of plan.namespaces) {
      if (labels.has(namespace.label) || !namespace.label.includes(':') || !namespace.seeds.length) return false;
      labels.add(namespace.label);
      const phase = namespace.label.slice(0, namespace.label.indexOf(':')) as ConsistencyPhase;
      if (!CONSISTENCY_PHASES.includes(phase)) return false;
      const expected = namespace.seeds.map((_seed, index) =>
        uint32Hash(`${plan.roots[phase]}:${namespace.label}:${index}`));
      if (expected.join('|') !== namespace.seeds.join('|')) return false;
      for (const seed of namespace.seeds) { if (seeds.has(seed)) return false; seeds.add(seed); }
    }
    return true;
  } catch { return false; }
}

export interface WilsonInterval { lower: number; upper: number }
export function wilsonScoreInterval(mean: number, blocks: number, z = 1.959963984540054): WilsonInterval {
  if (!Number.isFinite(mean) || mean < 0 || mean > 1 || !Number.isSafeInteger(blocks) || blocks < 1
    || !Number.isFinite(z) || z <= 0) throw new Error('Wilson interval input is invalid.');
  const observations = GAMES_PER_SEED * blocks;
  const denominator = 1 + z * z / observations;
  const center = (mean + z * z / (2 * observations)) / denominator;
  const radius = z * Math.sqrt(mean * (1 - mean) / observations + z * z / (4 * observations * observations))
    / denominator;
  return { lower: Math.max(0, center - radius), upper: Math.min(1, center + radius) };
}

export interface RankedScore { strategyId: string; canonicalStrategy: string; mean: number }
export function compareRankedScore(left: RankedScore, right: RankedScore): number {
  return right.mean - left.mean || compareUtf16(left.strategyId, right.strategyId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy);
}

export interface AdaptiveCandidate extends RankedScore { blocks: number; interval: WilsonInterval }
export interface AdaptiveBoundary {
  nominalCount: number;
  boundary: AdaptiveCandidate[];
  threshold: WilsonInterval;
}
export function adaptiveBoundary(input: readonly RankedScore[], blocksById: ReadonlyMap<string, number>): AdaptiveBoundary {
  if (!input.length) throw new Error('Adaptive boundary needs candidates.');
  const ranked = [...input].sort(compareRankedScore);
  const candidates = ranked.map((entry): AdaptiveCandidate => {
    const blocks = blocksById.get(entry.strategyId);
    if (!blocks) throw new Error(`Missing adaptive blocks for ${entry.strategyId}.`);
    return { ...entry, blocks, interval: wilsonScoreInterval(entry.mean, blocks) };
  });
  const nominalCount = nominalSurvivorCount(candidates.length);
  const threshold = candidates[nominalCount - 1]!.interval;
  const eligible = candidates.filter((entry, index) => index < nominalCount || entry.interval.upper >= threshold.lower);
  return { nominalCount, threshold, boundary: eligible.slice(0, Math.min(candidates.length, 2 * nominalCount)) };
}

export interface ScanCandidateEvidence {
  strategyId: string;
  canonicalStrategy: string;
  blockScores: number[];
  cumulativeBlockScores: number[];
  mean: number;
  rank: number;
  survived: boolean;
  wilson95: WilsonInterval | null;
}
export interface ScanAllocationEvidence {
  pass: number;
  stage: number;
  kind: 'base' | 'adaptive-extra';
  seedLabel: string;
  seeds: number[];
  samplingLabel: string;
  samplingSeed: number;
  schedule: MixtureSchedule;
  entered: number;
  survivors: number;
  matches: number;
  candidates: ScanCandidateEvidence[];
  boundaryStrategyIds: string[] | null;
  rerankStrategyIds: string[] | null;
}
export interface ScanFinalistEvidence {
  strategy: Strategy;
  passMeans: number[];
  unionMean: number;
  blockScores: number[];
  mean: number;
  interval95: BootstrapInterval;
  rank: number;
  admitted: boolean;
  matches: number;
}
export interface ProtocolScanEvidence {
  schemaVersion: 1;
  experiment: 'fixed-reservoir-consistency-scan';
  version: typeof FIXED_RESERVOIR_CONSISTENCY_VERSION;
  protocol: RaceProtocolDefinition;
  phase: ConsistencyPhase;
  namespace: string;
  snapshotHash: string;
  enteredStrategyIds: string[];
  targetWeights: Record<string, number>;
  allocations: ScanAllocationEvidence[];
  passFinalists: Array<{ pass: number; strategyIds: string[]; means: number[] }>;
  unionStrategyIds: string[];
  confirmationSeedLabel: string;
  confirmationSeeds: number[];
  confirmationSamplingLabel: string;
  confirmationSamplingSeed: number;
  confirmationSchedule: MixtureSchedule | null;
  bootstrapLabels: string[];
  bootstrapSeeds: number[];
  finalists: ScanFinalistEvidence[];
  admittedStrategyIds: string[];
  completeCandidateCoverage: number;
  matches: number;
  elapsedMs: number;
  evidenceHash: string;
}

export interface ScoreAllocationInput {
  candidates: readonly Strategy[];
  opponents: ReadonlyMap<string, Strategy>;
  schedule: MixtureSchedule;
  scoreOnly: true;
}
export type ScoreAllocation = (input: ScoreAllocationInput) => Promise<Array<{ strategy: Strategy; blockScores: number[]; matches: number }>>;

export function protocolScanEvidenceHash(
  scan: Omit<ProtocolScanEvidence, 'evidenceHash' | 'elapsedMs'>
): string {
  return stableHash(JSON.stringify(scan));
}
export function lotterySnapshotHash(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult): string {
  return stableHash(JSON.stringify({ strategies: snapshot.strategies.map(canonicalStrategy),
    centeredPayoffs: snapshot.centeredPayoffs, equilibrium }));
}
function positiveMixture(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult) {
  const opponents = new Map<string, Strategy>(); const weights: Record<string, number> = {};
  for (const strategy of snapshot.strategies) {
    const weight = equilibrium.weights[strategy.id] ?? 0;
    if (weight > 0) { opponents.set(strategy.id, strategy); weights[strategy.id] = weight; }
  }
  if (!opponents.size) throw new Error('Race target has empty support.');
  return { opponents, weights };
}
function rowMean(scores: readonly number[]): number {
  if (!scores.length || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new Error('Candidate seed-evaluation scores are invalid.');
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}
function rankedRows(strategies: readonly Strategy[], current: ReadonlyMap<string, number[]>,
  cumulative: ReadonlyMap<string, number[]>, semantics: RankingSemantics): Array<{ strategy: Strategy; current: number[];
    cumulative: number[]; mean: number }> {
  return strategies.map((strategy) => {
    const now = current.get(strategy.id) ?? []; const all = cumulative.get(strategy.id) ?? [];
    return { strategy, current: now, cumulative: all, mean: rowMean(semantics === 'cumulative' ? all : now) };
  }).sort((left, right) => compareRankedScore({ strategyId: left.strategy.id,
    canonicalStrategy: canonicalStrategy(left.strategy), mean: left.mean }, { strategyId: right.strategy.id,
    canonicalStrategy: canonicalStrategy(right.strategy), mean: right.mean }));
}

export function pairingScoreAllocation(runner: PairingRunner, kingdomId: string, deadline?: number): ScoreAllocation {
  return async ({ candidates, opponents, schedule }) => (await evaluateCandidates(candidates, opponents, schedule, runner, {
    kingdomId, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
    startingDraftEnabled: false, scoreOnly: true, deadline
  })).map((entry) => ({ strategy: entry.strategy, blockScores: entry.blockScores, matches: entry.matches }));
}

export async function runProtocolScan(input: {
  protocolId: RaceProtocolId;
  phase: ConsistencyPhase;
  namespace: string;
  candidates: readonly Strategy[];
  snapshot: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  planner: ConsistencySeedPlanner;
  score: ScoreAllocation;
  admissionLowerBound?: number;
  now?: () => number;
}): Promise<ProtocolScanEvidence> {
  const protocol = raceProtocol(input.protocolId); const now = input.now ?? Date.now; const started = now();
  const { opponents, weights } = positiveMixture(input.snapshot, input.equilibrium);
  const allocations: ScanAllocationEvidence[] = []; const passFinalists: ProtocolScanEvidence['passFinalists'] = [];
  const finalistScores = new Map<string, number[]>(); const strategyById = new Map(input.candidates.map((entry) => [entry.id, entry]));
  let matches = 0;
  for (let pass = 0; pass < protocol.racePasses; pass += 1) {
    let field = [...input.candidates]; const cumulative = new Map<string, number[]>(); let lastRanked: ReturnType<typeof rankedRows> = [];
    for (let stage = 0; stage < protocol.stageBlocks.length && field.length; stage += 1) {
      const blockCount = protocol.stageBlocks[stage]!;
      const seedLabel = `${input.namespace}:pass:${pass}:stage:${stage}:base`;
      const samplingLabel = `${input.namespace}:pass:${pass}:stage:${stage}:base:sampling`;
      const seeds = input.planner.derive(input.phase, seedLabel, blockCount);
      const samplingSeed = input.planner.derive(input.phase, samplingLabel, 1)[0]!;
      const schedule = mixtureSchedule(weights, seeds, samplingSeed);
      const evaluated = await input.score({ candidates: field, opponents, schedule, scoreOnly: true });
      if (evaluated.length !== field.length) throw new Error('Score allocation returned an incomplete candidate field.');
      const current = new Map<string, number[]>();
      for (const row of evaluated) {
        if (row.blockScores.length !== blockCount || row.matches !== blockCount * GAMES_PER_SEED || current.has(row.strategy.id)) {
          throw new Error('Score allocation returned an invalid seed evaluation.');
        }
        current.set(row.strategy.id, [...row.blockScores]);
        cumulative.set(row.strategy.id, [...(cumulative.get(row.strategy.id) ?? []), ...row.blockScores]);
        matches += row.matches;
      }
      let ranked = rankedRows(field, current, cumulative, protocol.ranking);
      const nominal = nominalSurvivorCount(ranked.length);
      let survivors = ranked.slice(0, nominal).map((entry) => entry.strategy);
      let boundaryStrategyIds: string[] | null = null; let rerankStrategyIds: string[] | null = null;
      const baseRows: ScanCandidateEvidence[] = ranked.map((entry, index) => ({ strategyId: entry.strategy.id,
        canonicalStrategy: canonicalStrategy(entry.strategy), blockScores: entry.current,
        cumulativeBlockScores: entry.cumulative, mean: entry.mean, rank: index + 1,
        survived: !protocol.adaptive && index < nominal,
        wilson95: protocol.adaptive ? wilsonScoreInterval(rowMean(entry.cumulative), entry.cumulative.length) : null }));
      allocations.push({ pass, stage, kind: 'base', seedLabel: `${input.phase}:${seedLabel}`, seeds,
        samplingLabel: `${input.phase}:${samplingLabel}`, samplingSeed, schedule, entered: field.length,
        survivors: nominal, matches: evaluated.reduce((sum, row) => sum + row.matches, 0), candidates: baseRows,
        boundaryStrategyIds, rerankStrategyIds });
      if (protocol.adaptive) {
        const boundary = adaptiveBoundary(ranked.map((entry) => ({ strategyId: entry.strategy.id,
          canonicalStrategy: canonicalStrategy(entry.strategy), mean: rowMean(entry.cumulative) })),
        new Map(ranked.map((entry) => [entry.strategy.id, entry.cumulative.length])));
        boundaryStrategyIds = boundary.boundary.map((entry) => entry.strategyId);
        const boundaryStrategies = boundaryStrategyIds.map((id) => strategyById.get(id)!);
        const extraSeedLabel = `${input.namespace}:pass:${pass}:stage:${stage}:adaptive-extra`;
        const extraSamplingLabel = `${input.namespace}:pass:${pass}:stage:${stage}:adaptive-extra:sampling`;
        const extraSeeds = input.planner.derive(input.phase, extraSeedLabel, blockCount);
        const extraSamplingSeed = input.planner.derive(input.phase, extraSamplingLabel, 1)[0]!;
        const extraSchedule = mixtureSchedule(weights, extraSeeds, extraSamplingSeed);
        const extra = await input.score({ candidates: boundaryStrategies, opponents, schedule: extraSchedule, scoreOnly: true });
        const extraCurrent = new Map<string, number[]>();
        for (const row of extra) {
          if (row.blockScores.length !== blockCount || row.matches !== blockCount * GAMES_PER_SEED) throw new Error('Adaptive extra allocation is invalid.');
          extraCurrent.set(row.strategy.id, [...row.blockScores]);
          cumulative.set(row.strategy.id, [...(cumulative.get(row.strategy.id) ?? []), ...row.blockScores]);
          matches += row.matches;
        }
        ranked = rankedRows(boundaryStrategies, extraCurrent, cumulative, 'cumulative');
        survivors = ranked.slice(0, nominal).map((entry) => entry.strategy);
        rerankStrategyIds = ranked.map((entry) => entry.strategy.id);
        allocations.at(-1)!.boundaryStrategyIds = boundaryStrategyIds;
        allocations.at(-1)!.rerankStrategyIds = rerankStrategyIds;
        allocations.at(-1)!.candidates.forEach((entry) => { entry.survived = survivors.some((held) => held.id === entry.strategyId); });
        allocations.push({ pass, stage, kind: 'adaptive-extra', seedLabel: `${input.phase}:${extraSeedLabel}`,
          seeds: extraSeeds, samplingLabel: `${input.phase}:${extraSamplingLabel}`, samplingSeed: extraSamplingSeed,
          schedule: extraSchedule, entered: boundaryStrategies.length, survivors: nominal,
          matches: extra.reduce((sum, row) => sum + row.matches, 0),
          candidates: ranked.map((entry, index) => ({ strategyId: entry.strategy.id,
            canonicalStrategy: canonicalStrategy(entry.strategy), blockScores: entry.current,
            cumulativeBlockScores: entry.cumulative, mean: entry.mean, rank: index + 1,
            survived: index < nominal, wilson95: wilsonScoreInterval(rowMean(entry.cumulative), entry.cumulative.length) })),
          boundaryStrategyIds, rerankStrategyIds });
      }
      field = survivors; lastRanked = ranked;
    }
    const finalists = lastRanked.slice(0, protocol.finalistLimit);
    passFinalists.push({ pass, strategyIds: finalists.map((entry) => entry.strategy.id),
      means: finalists.map((entry) => entry.mean) });
    finalists.forEach((entry) => finalistScores.set(entry.strategy.id,
      [...(finalistScores.get(entry.strategy.id) ?? []), entry.mean]));
  }
  const union = [...finalistScores].map(([id, means]) => ({ strategy: strategyById.get(id)!, means,
    mean: means.reduce((sum, value) => sum + value, 0) / means.length }))
    .sort((left, right) => compareRankedScore({ strategyId: left.strategy.id,
      canonicalStrategy: canonicalStrategy(left.strategy), mean: left.mean }, { strategyId: right.strategy.id,
      canonicalStrategy: canonicalStrategy(right.strategy), mean: right.mean }));
  const confirmationSeedLabel = `${input.namespace}:confirmation`;
  const confirmationSamplingLabel = `${input.namespace}:confirmation:sampling`;
  const confirmationSeeds = input.planner.derive(input.phase, confirmationSeedLabel, protocol.confirmationBlocks);
  const confirmationSamplingSeed = input.planner.derive(input.phase, confirmationSamplingLabel, 1)[0]!;
  const bootstrapLabels = union.map((_entry, index) => `${input.phase}:${input.namespace}:confirmation:bootstrap:${index}`);
  const bootstrapSeeds = union.map((_entry, index) => input.planner.derive(input.phase,
    `${input.namespace}:confirmation:bootstrap:${index}`, 1)[0]!);
  let confirmationSchedule: MixtureSchedule | null = null; const finalists: ScanFinalistEvidence[] = [];
  if (union.length) {
    confirmationSchedule = mixtureSchedule(weights, confirmationSeeds, confirmationSamplingSeed);
    const confirmed = await input.score({ candidates: union.map((entry) => entry.strategy), opponents,
      schedule: confirmationSchedule, scoreOnly: true });
    const confirmedById = new Map(confirmed.map((entry) => [entry.strategy.id, entry]));
    if (confirmedById.size !== union.length) throw new Error('Confirmation allocation is incomplete.');
    for (let index = 0; index < union.length; index += 1) {
      const source = union[index]!, row = confirmedById.get(source.strategy.id);
      if (!row || row.blockScores.length !== protocol.confirmationBlocks
        || row.matches !== protocol.confirmationBlocks * GAMES_PER_SEED) {
        throw new Error('Confirmation allocation is invalid.');
      }
      const mean = rowMean(row.blockScores), interval95 = percentileBootstrapMean(row.blockScores, bootstrapSeeds[index]!);
      finalists.push({ strategy: row.strategy, passMeans: source.means, unionMean: source.mean,
        blockScores: row.blockScores, mean, interval95, rank: 0,
        admitted: interval95.lower > (input.admissionLowerBound ?? 0.5), matches: row.matches });
      matches += row.matches;
    }
    finalists.sort((left, right) => compareRankedScore({ strategyId: left.strategy.id,
      canonicalStrategy: canonicalStrategy(left.strategy), mean: left.mean }, { strategyId: right.strategy.id,
      canonicalStrategy: canonicalStrategy(right.strategy), mean: right.mean }));
    finalists.forEach((entry, index) => { entry.rank = index + 1; });
  }
  const base: Omit<ProtocolScanEvidence, 'evidenceHash' | 'elapsedMs'> = { schemaVersion: 1,
    experiment: 'fixed-reservoir-consistency-scan', version: FIXED_RESERVOIR_CONSISTENCY_VERSION,
    protocol: { ...protocol, stageBlocks: [...protocol.stageBlocks] }, phase: input.phase, namespace: input.namespace,
    snapshotHash: lotterySnapshotHash(input.snapshot, input.equilibrium),
    enteredStrategyIds: input.candidates.map((entry) => entry.id), targetWeights: { ...weights }, allocations,
    passFinalists, unionStrategyIds: union.map((entry) => entry.strategy.id),
    confirmationSeedLabel: `${input.phase}:${confirmationSeedLabel}`, confirmationSeeds,
    confirmationSamplingLabel: `${input.phase}:${confirmationSamplingLabel}`, confirmationSamplingSeed,
    confirmationSchedule, bootstrapLabels, bootstrapSeeds, finalists,
    admittedStrategyIds: finalists.filter((entry) => entry.admitted).map((entry) => entry.strategy.id),
    completeCandidateCoverage: input.candidates.length, matches };
  return { ...base, elapsedMs: now() - started, evidenceHash: protocolScanEvidenceHash(base) };
}

function exactArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => JSON.stringify(value) === JSON.stringify(right[index]));
}
export function validateProtocolScan(scan: ProtocolScanEvidence, snapshot: MatrixSnapshot,
  equilibrium: EquilibriumResult, planner?: ConsistencySeedPlanner): boolean {
  try {
    const protocol = raceProtocol(scan.protocol.id);
    const target = positiveMixture(snapshot, equilibrium);
    if (scan.schemaVersion !== 1 || scan.experiment !== 'fixed-reservoir-consistency-scan'
      || scan.version !== FIXED_RESERVOIR_CONSISTENCY_VERSION
      || JSON.stringify(scan.protocol) !== JSON.stringify(protocol)
      || scan.snapshotHash !== lotterySnapshotHash(snapshot, equilibrium)
      || JSON.stringify(scan.targetWeights) !== JSON.stringify(target.weights)
      || scan.completeCandidateCoverage !== scan.enteredStrategyIds.length
      || new Set(scan.enteredStrategyIds).size !== scan.enteredStrategyIds.length
      || !Number.isFinite(scan.elapsedMs) || scan.elapsedMs < 0) return false;
    let matches = 0;
    for (const allocation of scan.allocations) {
      if (allocation.entered !== allocation.candidates.length || allocation.seeds.length === 0
        || allocation.schedule.blocks.length !== allocation.seeds.length
        || allocation.schedule.blocks.some((block, index) => block.seed !== allocation.seeds[index])
        || allocation.matches !== allocation.entered * allocation.seeds.length * GAMES_PER_SEED) return false;
      matches += allocation.matches;
      const ordered = [...allocation.candidates].sort((left, right) => compareRankedScore(left, right));
      if (ordered.some((entry, index) => entry.strategyId !== allocation.candidates[index]!.strategyId)) return false;
      for (const [index, entry] of allocation.candidates.entries()) {
        const expectedMean = allocation.kind === 'base' && protocol.ranking === 'stage-local' && !protocol.adaptive
          ? rowMean(entry.blockScores) : rowMean(entry.cumulativeBlockScores);
        if (entry.rank !== index + 1 || Math.abs(entry.mean - expectedMean) > 1e-12
          || (!protocol.adaptive && entry.survived !== (index < allocation.survivors))
          || (allocation.kind === 'adaptive-extra' && entry.survived !== (index < allocation.survivors))
          || entry.blockScores.length !== allocation.seeds.length
          || entry.cumulativeBlockScores.length < entry.blockScores.length
          || (entry.wilson95 && JSON.stringify(entry.wilson95)
            !== JSON.stringify(wilsonScoreInterval(rowMean(entry.cumulativeBlockScores), entry.cumulativeBlockScores.length)))) return false;
        if (index > 0 && compareRankedScore(allocation.candidates[index - 1]!, entry) > 0) return false;
      }
      if (planner) {
        const colon = allocation.seedLabel.indexOf(':');
        const phase = allocation.seedLabel.slice(0, colon) as ConsistencyPhase;
        const label = allocation.seedLabel.slice(colon + 1);
        if (!exactArray(planner.derive(phase, label, allocation.seeds.length), allocation.seeds)) return false;
        const samplingLabel = allocation.samplingLabel.slice(allocation.samplingLabel.indexOf(':') + 1);
        if (planner.derive(phase, samplingLabel, 1)[0] !== allocation.samplingSeed) return false;
      }
    }
    for (let pass = 0; pass < protocol.racePasses; pass += 1) {
      let field = [...scan.enteredStrategyIds];
      const cumulative = new Map<string, number[]>();
      for (let stage = 0; stage < protocol.stageBlocks.length; stage += 1) {
        const base = scan.allocations.find((entry) => entry.pass === pass && entry.stage === stage
          && entry.kind === 'base');
        if (!base || base.survivors !== nominalSurvivorCount(base.candidates.length)
          || !exactArray(base.candidates.map((entry) => entry.strategyId).sort(compareUtf16),
            [...field].sort(compareUtf16))) return false;
        for (const candidate of base.candidates) {
          const expected = [...(cumulative.get(candidate.strategyId) ?? []), ...candidate.blockScores];
          if (!exactArray(candidate.cumulativeBlockScores, expected)) return false;
          cumulative.set(candidate.strategyId, expected);
        }
        if (protocol.adaptive) {
          const extra = scan.allocations.find((entry) => entry.pass === pass && entry.stage === stage
            && entry.kind === 'adaptive-extra');
          if (!extra || !base.boundaryStrategyIds
            || !exactArray(extra.candidates.map((entry) => entry.strategyId).sort(compareUtf16),
              [...base.boundaryStrategyIds].sort(compareUtf16))) return false;
          for (const candidate of extra.candidates) {
            const before = cumulative.get(candidate.strategyId);
            if (!before || !exactArray(candidate.cumulativeBlockScores, [...before, ...candidate.blockScores])) {
              return false;
            }
            cumulative.set(candidate.strategyId, candidate.cumulativeBlockScores);
          }
          field = extra.candidates.filter((entry) => entry.survived).map((entry) => entry.strategyId);
        } else field = base.candidates.filter((entry) => entry.survived).map((entry) => entry.strategyId);
      }
    }
    if (scan.passFinalists.length !== protocol.racePasses) return false;
    for (const pass of scan.passFinalists) {
      const last = scan.allocations.filter((entry) => entry.pass === pass.pass).at(-1);
      if (!last) return false;
      const expected = last.candidates.slice(0, protocol.finalistLimit);
      if (!exactArray(pass.strategyIds, expected.map((entry) => entry.strategyId))
        || !exactArray(pass.means, expected.map((entry) => entry.mean))) return false;
    }
    const unionScores = new Map<string, number[]>();
    for (const pass of scan.passFinalists) pass.strategyIds.forEach((id, index) =>
      unionScores.set(id, [...(unionScores.get(id) ?? []), pass.means[index]!]));
    const expectedUnion = [...unionScores].map(([strategyId, means]) => {
      const finalist = scan.finalists.find((entry) => entry.strategy.id === strategyId);
      return { strategyId, canonicalStrategy: finalist ? canonicalStrategy(finalist.strategy) : '',
        mean: means.reduce((sum, entry) => sum + entry, 0) / means.length };
    }).sort(compareRankedScore).map((entry) => entry.strategyId);
    const expectedConfirmation = scan.unionStrategyIds.length
      ? mixtureSchedule(target.weights, scan.confirmationSeeds, scan.confirmationSamplingSeed) : null;
    if (!exactArray(scan.unionStrategyIds, expectedUnion)
      || scan.finalists.some((entry) => !scan.unionStrategyIds.includes(entry.strategy.id))
      || scan.confirmationSeeds.length !== protocol.confirmationBlocks
      || scan.bootstrapSeeds.length !== scan.unionStrategyIds.length
      || JSON.stringify(scan.confirmationSchedule) !== JSON.stringify(expectedConfirmation)) return false;
    if (planner) {
      const split = (label: string): [ConsistencyPhase, string] => {
        const colon = label.indexOf(':'); return [label.slice(0, colon) as ConsistencyPhase, label.slice(colon + 1)];
      };
      const [phase, label] = split(scan.confirmationSeedLabel);
      const [, samplingLabel] = split(scan.confirmationSamplingLabel);
      if (!exactArray(planner.derive(phase, label, protocol.confirmationBlocks), scan.confirmationSeeds)
        || planner.derive(phase, samplingLabel, 1)[0] !== scan.confirmationSamplingSeed
        || scan.bootstrapLabels.some((held, index) => {
          const [bootstrapPhase, bootstrapLabel] = split(held);
          return planner.derive(bootstrapPhase, bootstrapLabel, 1)[0] !== scan.bootstrapSeeds[index];
        })) return false;
    }
    for (const [index, finalist] of scan.finalists.entries()) {
      const bootstrapIndex = scan.unionStrategyIds.indexOf(finalist.strategy.id);
      if (bootstrapIndex < 0) return false;
      const interval = percentileBootstrapMean(finalist.blockScores, scan.bootstrapSeeds[bootstrapIndex]!);
      if (finalist.blockScores.length !== protocol.confirmationBlocks
        || finalist.matches !== protocol.confirmationBlocks * GAMES_PER_SEED
        || finalist.rank !== index + 1 || Math.abs(finalist.mean - rowMean(finalist.blockScores)) > 1e-12
        || JSON.stringify(finalist.interval95) !== JSON.stringify(interval)
        || finalist.admitted !== (interval.lower > 0.5)
        || (index > 0 && compareRankedScore({ strategyId: scan.finalists[index - 1]!.strategy.id,
          canonicalStrategy: canonicalStrategy(scan.finalists[index - 1]!.strategy), mean: scan.finalists[index - 1]!.mean },
        { strategyId: finalist.strategy.id, canonicalStrategy: canonicalStrategy(finalist.strategy), mean: finalist.mean }) > 0)) return false;
      matches += finalist.matches;
    }
    const admitted = scan.finalists.filter((entry) => entry.admitted).map((entry) => entry.strategy.id);
    if (!exactArray(admitted, scan.admittedStrategyIds) || matches !== scan.matches) return false;
    const base = structuredClone(scan) as Partial<ProtocolScanEvidence>;
    delete base.evidenceHash; delete base.elapsedMs;
    return scan.evidenceHash === protocolScanEvidenceHash(
      base as Omit<ProtocolScanEvidence, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

function near(left: number, right: number, tolerance = 1e-6): boolean {
  return Math.abs(left - right) <= tolerance;
}
export function validateConsistencyMatrix(matrix: MatrixSnapshot): boolean {
  try {
    if (!matrix.complete || matrix.strategies.length < 1
      || matrix.cells.length !== matrix.strategies.length * (matrix.strategies.length - 1) / 2
      || matrix.centeredPayoffs.length !== matrix.strategies.length
      || matrix.centeredPayoffs.some((row) => row.length !== matrix.strategies.length)) return false;
    const indexes = new Map(matrix.strategies.map((entry, index) => [entry.id, index]));
    if (indexes.size !== matrix.strategies.length) return false;
    for (let row = 0; row < matrix.strategies.length; row += 1) {
      if (!near(matrix.centeredPayoffs[row]![row]!, 0)) return false;
      for (let column = row + 1; column < matrix.strategies.length; column += 1) {
        if (!near(matrix.centeredPayoffs[row]![column]!, -matrix.centeredPayoffs[column]![row]!)) return false;
      }
    }
    for (const cell of matrix.cells) {
      const row = indexes.get(cell.rowId), column = indexes.get(cell.columnId);
      if (row === undefined || column === undefined || !cell.complete
        || cell.blocks.length !== matrix.protocol.seeds.length
        || cell.blocks.some((block, index) => block.seed !== matrix.protocol.seeds[index]
          || block.played !== GAMES_PER_SEED || block.aborted !== 0)) return false;
      const played = cell.blocks.reduce((sum, block) => sum + block.played, 0);
      const centered = 2 * cell.blocks.reduce((sum, block) => sum + block.score * block.played, 0) / played - 1;
      if (!near(centered, cell.centeredPayoff) || !near(matrix.centeredPayoffs[row]![column]!, centered)) return false;
    }
    return true;
  } catch { return false; }
}
function matrixSubgame(matrix: MatrixSnapshot, ids: readonly string[]): MatrixSnapshot {
  const selected = [...ids].sort(compareUtf16).map((id) => matrix.strategies.findIndex((entry) => entry.id === id));
  if (selected.some((index) => index < 0)) throw new Error('Matrix subgame strategy is missing.');
  const idSet = new Set(ids);
  return { protocol: matrix.protocol, strategies: selected.map((index) => matrix.strategies[index]!),
    cells: matrix.cells.filter((cell) => idSet.has(cell.rowId) && idSet.has(cell.columnId)), complete: true,
    centeredPayoffs: selected.map((row) => selected.map((column) => matrix.centeredPayoffs[row]![column]!)) };
}
export interface ConsistencyAdmission { kind: 'ordinary' | 'closure' | 'direct'; scanIndex: number; strategyIds: string[]; }
export interface ConsistencyRunArtifact {
  schemaVersion: 1; experiment: 'fixed-reservoir-consistency-run';
  version: typeof FIXED_RESERVOIR_CONSISTENCY_VERSION; runKind: 'baseline' | 'selected';
  kingdomId: string; reservoirHash: string; poolHash: string; evaluationSeed: number;
  protocol: RaceProtocolDefinition; seedPlan: ConsistencySeedPlan; initialStrategyIds: string[];
  scans: ProtocolScanEvidence[]; admissions: ConsistencyAdmission[]; matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult; cleanStreak: number; closureCycle: number;
  nextPhase: SelectedNextPhase; status: 'baseline-complete' | 'selected-complete' | 'incomplete' | 'unresolved';
  elapsedMs: number; evidenceHash: string;
}
function runArtifactHash(value: Omit<ConsistencyRunArtifact, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
export function createConsistencyRunArtifact(input: Omit<ConsistencyRunArtifact, 'schemaVersion' | 'experiment' |
  'version' | 'evidenceHash'>): ConsistencyRunArtifact {
  const base = { schemaVersion: 1 as const, experiment: 'fixed-reservoir-consistency-run' as const,
    version: FIXED_RESERVOIR_CONSISTENCY_VERSION, ...input };
  const hashed = structuredClone(base) as Partial<typeof base>; delete hashed.elapsedMs;
  return { ...base, evidenceHash: runArtifactHash(hashed as Omit<ConsistencyRunArtifact, 'evidenceHash' | 'elapsedMs'>) };
}
export function validateConsistencyRunArtifact(value: ConsistencyRunArtifact): boolean {
  try {
    if (value.schemaVersion !== 1 || value.experiment !== 'fixed-reservoir-consistency-run'
      || value.version !== FIXED_RESERVOIR_CONSISTENCY_VERSION || !validateConsistencySeedPlan(value.seedPlan)
      || JSON.stringify(value.protocol) !== JSON.stringify(raceProtocol(value.protocol.id))
      || !validateConsistencyMatrix(value.matrix) || new Set(value.initialStrategyIds).size !== value.initialStrategyIds.length
      || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) return false;
    const planner = new ConsistencySeedPlanner(value.reservoirHash, value.evaluationSeed);
    planner.derive('search', 'matrix', value.matrix.protocol.seeds.length);
    const active = [...value.initialStrategyIds]; let streak = 0; let closureCycle = 0;
    const admissions = new Map(value.admissions.map((entry) => [entry.scanIndex, entry]));
    if (admissions.size !== value.admissions.length) return false;
    for (const [index, scan] of value.scans.entries()) {
      const snapshot = matrixSubgame(value.matrix, active);
      const equilibrium = solveEquilibrium(snapshot.strategies.map((entry) => entry.id), snapshot.centeredPayoffs);
      if (!validateProtocolScan(scan, snapshot, equilibrium, planner)) return false;
      const admission = admissions.get(index);
      const admitted = scan.admittedStrategyIds;
      if ((admission?.strategyIds ?? []).join('|') !== admitted.join('|')
        || admitted.some((id) => active.includes(id) || !value.matrix.strategies.some((entry) => entry.id === id))) return false;
      if (admission) {
        if ((scan.phase === 'search' && admission.kind !== 'ordinary')
          || (scan.phase === 'selected-closure' && admission.kind !== 'closure')
          || (scan.phase === 'selected-direct' && admission.kind !== 'direct')) return false;
        active.push(...admitted); streak = 0;
        if (admission.kind !== 'ordinary') closureCycle += 1;
      } else if (scan.phase === 'search') streak += 1;
    }
    if (active.slice().sort(compareUtf16).join('|') !== value.matrix.strategies.map((entry) => entry.id).sort(compareUtf16).join('|')
      || value.cleanStreak !== streak || value.closureCycle !== closureCycle
      || JSON.stringify(planner.plan) !== JSON.stringify(value.seedPlan)) return false;
    const solved = solveEquilibrium(value.matrix.strategies.map((entry) => entry.id), value.matrix.centeredPayoffs);
    if (!sameEquilibrium(value.equilibrium, solved)) return false;
    if (value.runKind === 'baseline' && (value.status !== 'baseline-complete' || streak < 2
      || value.nextPhase !== 'closure-scan' || value.scans.some((scan) => scan.phase !== 'search'))) return false;
    const base = structuredClone(value) as Partial<ConsistencyRunArtifact>;
    delete base.evidenceHash; delete base.elapsedMs;
    return value.evidenceHash === runArtifactHash(base as Omit<ConsistencyRunArtifact, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

export interface KnownAttackerEvidence {
  targetEvaluationSeed: number; targetSnapshotHash: string; strategy: Strategy;
  mean: number; interval95: BootstrapInterval; discoveryProtocol: RaceProtocolId | 'direct-sentinel';
  confirmationSeedLabel: string;
}
export interface KnownAttackerRegistry {
  schemaVersion: 1; experiment: 'fixed-reservoir-consistency-attacker-registry';
  version: typeof FIXED_RESERVOIR_CONSISTENCY_VERSION; reservoirHash: string;
  frozen: true; entries: KnownAttackerEvidence[]; sentinelByTarget: Record<string, string[]>; evidenceHash: string;
}
export function registryHash(value: Omit<KnownAttackerRegistry, 'evidenceHash'>): string {
  return stableHash(JSON.stringify(value));
}
export function validateKnownAttackerRegistry(value: KnownAttackerRegistry): boolean {
  try {
    if (value.schemaVersion !== 1 || value.experiment !== 'fixed-reservoir-consistency-attacker-registry'
      || value.version !== FIXED_RESERVOIR_CONSISTENCY_VERSION || value.frozen !== true
      || new Set(value.entries.map((entry) => `${entry.targetSnapshotHash}:${canonicalStrategy(entry.strategy)}`)).size
        !== value.entries.length
      || value.entries.some((entry) => entry.interval95.lower <= 0.5 || entry.mean < 0 || entry.mean > 1)) return false;
    const base = structuredClone(value) as Partial<KnownAttackerRegistry>; delete base.evidenceHash;
    return value.evidenceHash === registryHash(base as Omit<KnownAttackerRegistry, 'evidenceHash'>);
  } catch { return false; }
}
export function immutableRegistryWrite(existing: KnownAttackerRegistry | null, next: KnownAttackerRegistry): KnownAttackerRegistry {
  if (!validateKnownAttackerRegistry(next)) throw new Error('Known-attacker registry is invalid.');
  if (existing && JSON.stringify(existing) !== JSON.stringify(next)) throw new Error('Known-attacker registry is immutable.');
  return existing ?? next;
}

export type SelectedNextPhase = 'ordinary-scan' | 'closure-scan' | 'direct-check' | 'complete' | 'unresolved';
export interface ClosureState { cleanStreak: number; closureCycle: number; nextPhase: SelectedNextPhase;
  snapshotHash: string; status: 'incomplete' | 'complete' | 'unresolved'; }
export type ClosureEvent = { kind: 'ordinary'; admitted: number } | { kind: 'closure'; admitted: number } |
  { kind: 'direct'; admitted: number } | { kind: 'failure'; reason: 'timeout' | 'abort' | 'invalid-block' |
    'ordinary-safety-cap' | 'closure-cycle-cap' };
export function transitionClosureState(state: ClosureState, event: ClosureEvent): ClosureState {
  if (state.status !== 'incomplete') throw new Error('A terminal closure state cannot transition.');
  if (event.kind === 'failure') return { ...state, status: 'unresolved', nextPhase: 'unresolved' };
  if (event.kind === 'ordinary') {
    const cleanStreak = event.admitted ? 0 : state.cleanStreak + 1;
    return { ...state, cleanStreak, nextPhase: cleanStreak >= 2 ? 'closure-scan' : 'ordinary-scan' };
  }
  if (event.kind === 'closure') {
    if (state.nextPhase !== 'closure-scan') throw new Error('Closure scan is out of order.');
    if (!event.admitted) return { ...state, nextPhase: 'direct-check' };
    const closureCycle = state.closureCycle + 1;
    return closureCycle >= 4 ? { ...state, closureCycle, cleanStreak: 0, status: 'unresolved', nextPhase: 'unresolved' }
      : { ...state, closureCycle, cleanStreak: 0, nextPhase: 'ordinary-scan' };
  }
  if (state.nextPhase !== 'direct-check') throw new Error('Direct check is out of order.');
  if (!event.admitted) return { ...state, status: 'complete', nextPhase: 'complete' };
  const closureCycle = state.closureCycle + 1;
  return closureCycle >= 4 ? { ...state, closureCycle, cleanStreak: 0, status: 'unresolved', nextPhase: 'unresolved' }
    : { ...state, closureCycle, cleanStreak: 0, nextPhase: 'ordinary-scan' };
}

export interface SelectedRunCheckpoint {
  schemaVersion: 1; experiment: 'fixed-reservoir-consistency-checkpoint';
  version: typeof FIXED_RESERVOIR_CONSISTENCY_VERSION; reservoirHash: string; evaluationSeed: number;
  protocol: RaceProtocolDefinition; seedPlan: ConsistencySeedPlan; activeStrategyIds: string[];
  matrix: MatrixSnapshot; equilibrium: EquilibriumResult; scans: ProtocolScanEvidence[];
  admissions: Array<{ kind: 'ordinary' | 'closure' | 'direct'; strategyIds: string[]; snapshotHash: string }>;
  state: ClosureState; elapsedMs: number; checkpointHash: string;
}
function checkpointHash(value: Omit<SelectedRunCheckpoint, 'checkpointHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
function sameEquilibrium(left: EquilibriumResult, right: EquilibriumResult): boolean {
  return JSON.stringify(left.strategyIds) === JSON.stringify(right.strategyIds)
    && left.strategyIds.every((id) => Math.abs((left.weights[id] ?? 0) - (right.weights[id] ?? 0)) <= 1e-5)
    && Math.abs(left.value - right.value) <= 1e-6;
}
export function createSelectedRunCheckpoint(input: Omit<SelectedRunCheckpoint, 'schemaVersion' | 'experiment' |
  'version' | 'checkpointHash'>): SelectedRunCheckpoint {
  const base = { schemaVersion: 1 as const, experiment: 'fixed-reservoir-consistency-checkpoint' as const,
    version: FIXED_RESERVOIR_CONSISTENCY_VERSION, ...input };
  const hashed = structuredClone(base) as Partial<typeof base>; delete hashed.elapsedMs;
  return { ...base, checkpointHash: checkpointHash(hashed as Omit<SelectedRunCheckpoint, 'checkpointHash' | 'elapsedMs'>) };
}
export function validateSelectedRunCheckpoint(value: SelectedRunCheckpoint): boolean {
  try {
    if (value.schemaVersion !== 1 || value.experiment !== 'fixed-reservoir-consistency-checkpoint'
      || value.version !== FIXED_RESERVOIR_CONSISTENCY_VERSION || !validateConsistencySeedPlan(value.seedPlan)
      || JSON.stringify(value.protocol) !== JSON.stringify(raceProtocol(value.protocol.id))
      || !value.matrix.complete || value.matrix.strategies.length !== value.activeStrategyIds.length
      || new Set(value.activeStrategyIds).size !== value.activeStrategyIds.length
      || value.matrix.strategies.some((entry) => !value.activeStrategyIds.includes(entry.id))
      || value.state.snapshotHash !== lotterySnapshotHash(value.matrix, value.equilibrium)) return false;
    const solved = solveEquilibrium(value.matrix.strategies.map((entry) => entry.id), value.matrix.centeredPayoffs);
    if (!sameEquilibrium(value.equilibrium, solved)) return false;
    for (const scan of value.scans) if (!validateProtocolScan(scan, value.matrix, value.equilibrium)
      && scan.snapshotHash === value.state.snapshotHash) return false;
    const base = structuredClone(value) as Partial<SelectedRunCheckpoint>;
    delete base.checkpointHash; delete base.elapsedMs;
    return value.checkpointHash === checkpointHash(base as Omit<SelectedRunCheckpoint, 'checkpointHash' | 'elapsedMs'>);
  } catch { return false; }
}
export function reconstructMatrixCache(snapshot: MatrixSnapshot): MatrixCellCache {
  if (!snapshot.complete) throw new Error('Cannot reconstruct an incomplete matrix cache.');
  const cache: MatrixCellCache = new Map();
  for (const cell of snapshot.cells) {
    if (!cell.complete || cell.blocks.length !== snapshot.protocol.seeds.length) throw new Error('Matrix cell is invalid.');
    const [rowId, columnId] = compareUtf16(cell.rowId, cell.columnId) < 0
      ? [cell.rowId, cell.columnId] : [cell.columnId, cell.rowId];
    cache.set(`${cell.key}:${rowId}|${columnId}`, structuredClone(cell));
  }
  return cache;
}

export function supportIdentity(equilibrium: EquilibriumResult, threshold = 1e-6): string[] {
  return equilibrium.strategyIds.filter((id) => (equilibrium.weights[id] ?? 0) > threshold).sort(compareUtf16);
}
export function supportJaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left), b = new Set(right); const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...union].filter((id) => a.has(id) && b.has(id)).length / union.size;
}
export function lotteryTotalVariation(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): number {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  return 0.5 * [...ids].reduce((sum, id) => sum + Math.abs((left[id] ?? 0) - (right[id] ?? 0)), 0);
}

export interface PilotOutcome { protocolId: Exclude<RaceProtocolId, 'closure-union-cumulative-v1'>;
  targetEvaluationSeed: number; elapsedMs: number; matches: number; detectedStrategyIds: string[];
  scriptedAttackerPassed: boolean; }
export interface ProtocolDecision { selected: PilotOutcome['protocolId'] | null; qualified: PilotOutcome['protocolId'][];
  rejected: Record<string, string>; fallback: PilotOutcome['protocolId'] | null; reason: string; }
const SIMPLICITY: PilotOutcome['protocolId'][] = ['cumulative-v1', 'adaptive-boundary-v1', 'union-2x-v1', 'early-4x-v1', 'legacy-stage-v1'];
function median(values: readonly number[]): number { const ordered = [...values].sort((a, b) => a - b);
  return ordered.length % 2 ? ordered[Math.floor(ordered.length / 2)]!
    : (ordered[ordered.length / 2 - 1]! + ordered[ordered.length / 2]!) / 2; }
export function selectPilotProtocol(outcomes: readonly PilotOutcome[], registryStrategyIds: readonly string[],
  targetSeeds: readonly number[] = CONSISTENCY_EVALUATION_SEEDS): ProtocolDecision {
  const protocols = [...new Set(outcomes.map((entry) => entry.protocolId))]; const rejected: Record<string, string> = {};
  const qualified = protocols.filter((id) => {
    const rows = outcomes.filter((entry) => entry.protocolId === id);
    if (rows.length !== targetSeeds.length || targetSeeds.some((seed) => !rows.some((entry) => entry.targetEvaluationSeed === seed))) {
      rejected[id] = 'missing target pilot'; return false;
    }
    if (!registryStrategyIds.length && !rows.every((entry) => entry.scriptedAttackerPassed)) {
      rejected[id] = 'scripted attacker failed'; return false;
    }
    if (registryStrategyIds.length && rows.some((entry) => registryStrategyIds.some((attacker) =>
      !entry.detectedStrategyIds.includes(attacker)))) { rejected[id] = 'known attacker missed'; return false; }
    return true;
  });
  if (!qualified.length) return { selected: null, qualified: [], rejected, fallback: null, reason: 'no qualified protocol' };
  const stats = qualified.map((id) => { const rows = outcomes.filter((entry) => entry.protocolId === id);
    return { id, time: median(rows.map((entry) => entry.elapsedMs)), matches: rows.reduce((sum, entry) => sum + entry.matches, 0) }; });
  stats.sort((left, right) => {
    const faster = Math.abs(left.time - right.time) > 250 && Math.abs(left.time - right.time) / Math.min(left.time, right.time) > 0.05;
    if (faster) return left.time - right.time;
    return left.matches - right.matches || SIMPLICITY.indexOf(left.id) - SIMPLICITY.indexOf(right.id);
  });
  return { selected: stats[0]!.id, qualified, rejected, fallback: stats[1]?.id ?? null,
    reason: 'material time, then matches, then simplicity' };
}
