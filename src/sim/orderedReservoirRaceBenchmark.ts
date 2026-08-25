import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import { validateConsistencyMatrix } from './fixedReservoirConsistency';
import { mixtureSchedule } from './mixtureEvaluation';
import type { MixtureSchedule } from './mixtureEvaluation';
import { matrixProtocol } from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import type { OrderedChallengePoolArtifact } from './orderedReservoirChallenge';
import { canonicalStrategy, stableHash } from './strategy';
import { compareUtf16 } from './utf16';

export const ORDERED_RACE_BENCHMARK_V1_VERSION = 'ordered-reservoir-race-benchmark-v1' as const;
export const ORDERED_RACE_BENCHMARK_VERSION = 'ordered-reservoir-race-benchmark-v2' as const;
export const ORDERED_RACE_BENCHMARK_WORKERS = 4;
export const ORDERED_RACE_BENCHMARK_KINGDOM = 'deep-beam-tuning-009';

export interface OrderedRaceBenchmarkProtocol {
  rankLimit: number;
  initialStrategies: number;
  matrixBlocks: number;
  evaluationTrials: number;
  candidateBlocks: number;
  chunkSize: number;
  gamesPerBlock: 4;
  startingDraftEnabled: false;
  startingHealth: 50;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  scoreOnlyCandidates: true;
  admissions: false;
  workers: 4;
}

export const ORDERED_RACE_BENCHMARK_PROTOCOL: Readonly<OrderedRaceBenchmarkProtocol> = Object.freeze({
  rankLimit: 1_000,
  initialStrategies: 50,
  matrixBlocks: 25,
  evaluationTrials: 3,
  candidateBlocks: 25,
  chunkSize: 250,
  gamesPerBlock: 4,
  startingDraftEnabled: false,
  startingHealth: 50,
  turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
  actionCapPerTurn: ACTION_CAP_PER_TURN,
  scoreOnlyCandidates: true,
  admissions: false,
  workers: ORDERED_RACE_BENCHMARK_WORKERS
});

export interface OrderedRaceBenchmarkTrialSeeds {
  trial: number;
  blockSeeds: number[];
  opponentSamplingSeed: number;
}
export interface OrderedRaceBenchmarkSeedPlan {
  version: typeof ORDERED_RACE_BENCHMARK_VERSION;
  reservoirHash: string;
  matrixSeedNamespace: typeof ORDERED_RACE_BENCHMARK_V1_VERSION;
  candidateSeedNamespace: typeof ORDERED_RACE_BENCHMARK_VERSION;
  matrixSeeds: number[];
  trials: OrderedRaceBenchmarkTrialSeeds[];
}

function uint32Hash(value: string): number {
  return Number.parseInt(stableHash(value).slice(0, 8), 16) >>> 0;
}
function deriveSeeds(namespace: string, reservoirHash: string, label: string, count: number): number[] {
  return Array.from({ length: count }, (_unused, index) =>
    uint32Hash(`${namespace}:${reservoirHash}:${label}:${index}`));
}

export function orderedRaceBenchmarkSeedPlan(
  reservoirHash: string,
  protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
): OrderedRaceBenchmarkSeedPlan {
  if (!/^[0-9a-f]{9,}$/.test(reservoirHash)) throw new Error('Benchmark reservoir hash is invalid.');
  const plan: OrderedRaceBenchmarkSeedPlan = {
    version: ORDERED_RACE_BENCHMARK_VERSION,
    reservoirHash,
    matrixSeedNamespace: ORDERED_RACE_BENCHMARK_V1_VERSION,
    candidateSeedNamespace: ORDERED_RACE_BENCHMARK_VERSION,
    matrixSeeds: deriveSeeds(ORDERED_RACE_BENCHMARK_V1_VERSION, reservoirHash, 'matrix', protocol.matrixBlocks),
    trials: Array.from({ length: protocol.evaluationTrials }, (_unused, trial) => ({
      trial,
      blockSeeds: deriveSeeds(ORDERED_RACE_BENCHMARK_VERSION, reservoirHash,
        `trial:${trial}:blocks`, protocol.candidateBlocks),
      opponentSamplingSeed: deriveSeeds(ORDERED_RACE_BENCHMARK_VERSION, reservoirHash,
        `trial:${trial}:opponent-sampling`, 1)[0]!
    }))
  };
  const all = [...plan.matrixSeeds, ...plan.trials.flatMap((trial) =>
    [...trial.blockSeeds, trial.opponentSamplingSeed])];
  if (new Set(all).size !== all.length) throw new Error('Benchmark seed namespaces collided.');
  return plan;
}

export function benchmarkPoolSlices(
  pool: OrderedChallengePoolArtifact,
  protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
) {
  if (pool.kingdomId !== ORDERED_RACE_BENCHMARK_KINGDOM || pool.reservoir.length < protocol.rankLimit
    || protocol.initialStrategies >= protocol.rankLimit) throw new Error('Benchmark pool or rank limits are invalid.');
  const prefix = pool.reservoir.slice(0, protocol.rankLimit);
  if (prefix.some((entry, index) => entry.goldfishRank !== index + 1)) {
    throw new Error('Benchmark source is not a ranked reservoir prefix.');
  }
  return {
    initial: prefix.slice(0, protocol.initialStrategies).map((entry) => entry.strategy),
    candidates: prefix.slice(protocol.initialStrategies).map((entry) => entry.strategy)
  };
}

function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function sameEquilibrium(left: EquilibriumResult, right: EquilibriumResult): boolean {
  return exact(left.strategyIds, right.strategyIds)
    && left.strategyIds.every((id) => Math.abs((left.weights[id] ?? 0) - (right.weights[id] ?? 0)) <= 1e-6
      && Math.abs((left.maximumEquilibriumWeight[id] ?? 0) - (right.maximumEquilibriumWeight[id] ?? 0)) <= 1e-6)
    && Math.abs(left.value - right.value) <= 1e-7
    && Math.abs(left.maximumKnownAdvantage - right.maximumKnownAdvantage) <= 1e-6;
}
function positiveWeights(equilibrium: EquilibriumResult): Record<string, number> {
  const weights = Object.fromEntries(equilibrium.strategyIds.flatMap((id) => {
    const weight = equilibrium.weights[id] ?? 0;
    return weight > 0 ? [[id, weight]] : [];
  }));
  if (!Object.keys(weights).length) throw new Error('Benchmark lottery has empty support.');
  return weights;
}

export interface OrderedRaceBenchmarkMatrixArtifact {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-race-benchmark-matrix';
  version: typeof ORDERED_RACE_BENCHMARK_VERSION;
  poolHash: string;
  reservoirHash: string;
  sourceRankedSha256: string;
  protocol: OrderedRaceBenchmarkProtocol;
  seedPlan: OrderedRaceBenchmarkSeedPlan;
  matrix: MatrixSnapshot;
  equilibrium: EquilibriumResult;
  elapsedMs: number;
  evidenceHash: string;
}
function matrixArtifactHash(value: Omit<OrderedRaceBenchmarkMatrixArtifact, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
export function createOrderedRaceBenchmarkMatrixArtifact(
  input: Omit<OrderedRaceBenchmarkMatrixArtifact, 'schemaVersion' | 'experiment' | 'version' | 'evidenceHash'>
): OrderedRaceBenchmarkMatrixArtifact {
  const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-race-benchmark-matrix' as const,
    version: ORDERED_RACE_BENCHMARK_VERSION, ...input };
  const held = structuredClone(base) as Partial<typeof base>; delete held.elapsedMs;
  return { ...base, evidenceHash: matrixArtifactHash(
    held as Omit<OrderedRaceBenchmarkMatrixArtifact, 'evidenceHash' | 'elapsedMs'>) };
}
export function validateOrderedRaceBenchmarkMatrixArtifact(
  value: unknown, pool: OrderedChallengePoolArtifact,
  protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
): value is OrderedRaceBenchmarkMatrixArtifact {
  try {
    if (!value || typeof value !== 'object') return false;
    const artifact = value as OrderedRaceBenchmarkMatrixArtifact;
    const plan = orderedRaceBenchmarkSeedPlan(pool.reservoirHash, protocol);
    const { initial } = benchmarkPoolSlices(pool, protocol);
    if (artifact.schemaVersion !== 1 || artifact.experiment !== 'ordered-reservoir-race-benchmark-matrix'
      || artifact.version !== ORDERED_RACE_BENCHMARK_VERSION || artifact.poolHash !== pool.generatedHash
      || artifact.reservoirHash !== pool.reservoirHash
      || artifact.sourceRankedSha256 !== pool.source.rankedSha256 || !exact(artifact.protocol, protocol)
      || !exact(artifact.seedPlan, plan) || !Number.isFinite(artifact.elapsedMs) || artifact.elapsedMs < 0
      || !validateConsistencyMatrix(artifact.matrix)
      || !exact(artifact.matrix.protocol, matrixProtocol(pool.kingdomId, plan.matrixSeeds,
        protocol.turnLimitPerPlayer, protocol.actionCapPerTurn, false))
      || !exact(artifact.matrix.strategies.map(canonicalStrategy),
        [...initial].sort((left, right) => compareUtf16(left.id, right.id)).map(canonicalStrategy))) return false;
    const solved = solveEquilibrium(artifact.matrix.strategies.map((entry) => entry.id),
      artifact.matrix.centeredPayoffs);
    if (!sameEquilibrium(artifact.equilibrium, solved)) return false;
    const held = structuredClone(artifact) as Partial<OrderedRaceBenchmarkMatrixArtifact>;
    delete held.evidenceHash; delete held.elapsedMs;
    return artifact.evidenceHash === matrixArtifactHash(
      held as Omit<OrderedRaceBenchmarkMatrixArtifact, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

export function benchmarkTrialSchedule(
  artifact: OrderedRaceBenchmarkMatrixArtifact, trial: number
): MixtureSchedule {
  const seeds = artifact.seedPlan.trials[trial];
  if (!seeds || seeds.trial !== trial) throw new Error(`Benchmark trial ${trial} is invalid.`);
  return mixtureSchedule(positiveWeights(artifact.equilibrium), seeds.blockSeeds, seeds.opponentSamplingSeed);
}

export interface OrderedRaceBenchmarkCandidateEvidence {
  goldfishRank: number;
  strategyId: string;
  canonicalStrategy: string;
  blockScores: number[];
  matches: number;
}
export interface OrderedRaceBenchmarkChunkArtifact {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-race-benchmark-chunk';
  version: typeof ORDERED_RACE_BENCHMARK_VERSION;
  matrixEvidenceHash: string;
  trial: number;
  chunk: number;
  startRank: number;
  endRank: number;
  schedule: MixtureSchedule;
  candidates: OrderedRaceBenchmarkCandidateEvidence[];
  elapsedMs: number;
  evidenceHash: string;
}
function chunkArtifactHash(value: Omit<OrderedRaceBenchmarkChunkArtifact, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
export function createOrderedRaceBenchmarkChunkArtifact(
  input: Omit<OrderedRaceBenchmarkChunkArtifact, 'schemaVersion' | 'experiment' | 'version' | 'evidenceHash'>
): OrderedRaceBenchmarkChunkArtifact {
  const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-race-benchmark-chunk' as const,
    version: ORDERED_RACE_BENCHMARK_VERSION, ...input };
  const held = structuredClone(base) as Partial<typeof base>; delete held.elapsedMs;
  return { ...base, evidenceHash: chunkArtifactHash(
    held as Omit<OrderedRaceBenchmarkChunkArtifact, 'evidenceHash' | 'elapsedMs'>) };
}
export function benchmarkChunkBounds(
  chunk: number, protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
): { startRank: number; endRank: number } {
  const startRank = protocol.initialStrategies + 1 + chunk * protocol.chunkSize;
  const endRank = Math.min(protocol.rankLimit, startRank + protocol.chunkSize - 1);
  if (!Number.isSafeInteger(chunk) || chunk < 0 || startRank > protocol.rankLimit) {
    throw new Error(`Benchmark chunk ${chunk} is out of range.`);
  }
  return { startRank, endRank };
}
export function benchmarkChunkCount(
  protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
): number {
  return Math.ceil((protocol.rankLimit - protocol.initialStrategies) / protocol.chunkSize);
}
export function validateOrderedRaceBenchmarkChunkArtifact(
  value: unknown, pool: OrderedChallengePoolArtifact, matrix: OrderedRaceBenchmarkMatrixArtifact,
  protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
): value is OrderedRaceBenchmarkChunkArtifact {
  try {
    if (!value || typeof value !== 'object') return false;
    const artifact = value as OrderedRaceBenchmarkChunkArtifact;
    const bounds = benchmarkChunkBounds(artifact.chunk, protocol);
    const expected = pool.reservoir.slice(bounds.startRank - 1, bounds.endRank);
    if (artifact.schemaVersion !== 1 || artifact.experiment !== 'ordered-reservoir-race-benchmark-chunk'
      || artifact.version !== ORDERED_RACE_BENCHMARK_VERSION
      || artifact.matrixEvidenceHash !== matrix.evidenceHash
      || artifact.trial < 0 || artifact.trial >= protocol.evaluationTrials
      || artifact.startRank !== bounds.startRank || artifact.endRank !== bounds.endRank
      || !exact(artifact.schedule, benchmarkTrialSchedule(matrix, artifact.trial))
      || artifact.candidates.length !== expected.length || !Number.isFinite(artifact.elapsedMs)
      || artifact.elapsedMs < 0) return false;
    for (let index = 0; index < expected.length; index += 1) {
      const row = artifact.candidates[index]!, entry = expected[index]!;
      if (row.goldfishRank !== entry.goldfishRank || row.strategyId !== entry.strategy.id
        || row.canonicalStrategy !== canonicalStrategy(entry.strategy)
        || row.blockScores.length !== protocol.candidateBlocks
        || row.blockScores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)
        || row.matches !== protocol.candidateBlocks * protocol.gamesPerBlock) return false;
    }
    const held = structuredClone(artifact) as Partial<OrderedRaceBenchmarkChunkArtifact>;
    delete held.evidenceHash; delete held.elapsedMs;
    return artifact.evidenceHash === chunkArtifactHash(
      held as Omit<OrderedRaceBenchmarkChunkArtifact, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

export type OrderedRaceBenchmarkDepth = 1 | 8 | 25;

export interface RankedBenchmarkCandidate extends OrderedRaceBenchmarkCandidateEvidence {
  mean: number;
  rank: number;
}
export function rankBenchmarkCandidates(
  rows: readonly OrderedRaceBenchmarkCandidateEvidence[], blocks: OrderedRaceBenchmarkDepth
): RankedBenchmarkCandidate[] {
  return rows.map((row) => ({ ...row,
    mean: row.blockScores.slice(0, blocks).reduce((sum, score) => sum + score, 0) / blocks,
    rank: 0
  })).sort((left, right) => right.mean - left.mean
    || compareUtf16(left.strategyId, right.strategyId)
    || compareUtf16(left.canonicalStrategy, right.canonicalStrategy))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export interface SetComparison {
  intersection: number;
  union: number;
  jaccard: number;
}
export function compareSets(left: ReadonlySet<string>, right: ReadonlySet<string>): SetComparison {
  const union = new Set([...left, ...right]);
  const intersection = [...left].filter((id) => right.has(id)).length;
  return { intersection, union: union.size, jaccard: union.size ? intersection / union.size : 1 };
}
function averageRanks(values: readonly number[]): number[] {
  const indexes = values.map((value, index) => ({ value, index })).sort((left, right) => right.value - left.value);
  const ranks = Array<number>(values.length);
  for (let start = 0; start < indexes.length;) {
    let end = start + 1;
    while (end < indexes.length && indexes[end]!.value === indexes[start]!.value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[indexes[index]!.index] = rank;
    start = end;
  }
  return ranks;
}
function pearson(left: readonly number[], right: readonly number[]): number | null {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0, leftSquare = 0, rightSquare = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]! - leftMean, b = right[index]! - rightMean;
    numerator += a * b; leftSquare += a * a; rightSquare += b * b;
  }
  return leftSquare > 0 && rightSquare > 0 ? numerator / Math.sqrt(leftSquare * rightSquare) : null;
}
export function tieAdjustedSpearman(
  left: readonly RankedBenchmarkCandidate[], right: readonly RankedBenchmarkCandidate[]
): number | null {
  if (left.length !== right.length || !left.length) throw new Error('Rank correlation needs aligned candidate sets.');
  const rightMeans = new Map(right.map((entry) => [entry.strategyId, entry.mean]));
  const leftMeans = left.map((entry) => entry.mean);
  const alignedRight = left.map((entry) => {
    const mean = rightMeans.get(entry.strategyId);
    if (mean === undefined) throw new Error(`Rank correlation is missing ${entry.strategyId}.`);
    return mean;
  });
  return pearson(averageRanks(leftMeans), averageRanks(alignedRight));
}

export interface CutoffConsistency {
  cutoff: number;
  pairwise: Array<{ leftTrial: number; rightTrial: number } & SetComparison>;
  triple: SetComparison;
  boundaryTies: Array<{ trial: number; score: number; tiedAtScore: number; selectedAtScore: number }>;
}
export interface DepthConsistency {
  blocks: OrderedRaceBenchmarkDepth;
  cutoffs: CutoffConsistency[];
  rankCorrelations: Array<{ leftTrial: number; rightTrial: number; tieAdjustedSpearman: number | null }>;
}
export interface DepthComparison {
  trial: number;
  fromBlocks: OrderedRaceBenchmarkDepth;
  toBlocks: OrderedRaceBenchmarkDepth;
  cutoff: number;
  intersection: number;
  union: number;
  jaccard: number;
}
export interface OrderedRaceBenchmarkReport {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-race-benchmark-report';
  version: typeof ORDERED_RACE_BENCHMARK_VERSION;
  matrixEvidenceHash: string;
  protocol: OrderedRaceBenchmarkProtocol;
  candidateCount: number;
  matches: number;
  elapsedMs: { matrix: number; candidateEvaluation: number; total: number };
  depths: DepthConsistency[];
  depthComparisons: DepthComparison[];
  chunkEvidenceHashes: string[];
  evidenceHash: string;
}
function reportHash(value: Omit<OrderedRaceBenchmarkReport, 'evidenceHash'>): string {
  return stableHash(JSON.stringify(value));
}
function topSet(rows: readonly RankedBenchmarkCandidate[], cutoff: number): Set<string> {
  return new Set(rows.slice(0, cutoff).map((entry) => entry.strategyId));
}
function cutoffConsistency(rankings: readonly RankedBenchmarkCandidate[][], cutoff: number): CutoffConsistency {
  if (rankings.some((rows) => rows.length < cutoff)) throw new Error(`Cutoff ${cutoff} exceeds the candidate count.`);
  const sets = rankings.map((rows) => topSet(rows, cutoff));
  const pairwise: CutoffConsistency['pairwise'] = [];
  for (let left = 0; left < sets.length; left += 1) for (let right = left + 1; right < sets.length; right += 1) {
    pairwise.push({ leftTrial: left, rightTrial: right, ...compareSets(sets[left]!, sets[right]!) });
  }
  const union = new Set(sets.flatMap((set) => [...set]));
  const intersection = [...sets[0]!].filter((id) => sets.every((set) => set.has(id))).length;
  return { cutoff, pairwise,
    triple: { intersection, union: union.size, jaccard: union.size ? intersection / union.size : 1 },
    boundaryTies: rankings.map((rows, trial) => {
      const score = rows[cutoff - 1]!.mean;
      return { trial, score, tiedAtScore: rows.filter((entry) => entry.mean === score).length,
        selectedAtScore: rows.slice(0, cutoff).filter((entry) => entry.mean === score).length };
    }) };
}

export function createOrderedRaceBenchmarkReport(input: {
  matrix: OrderedRaceBenchmarkMatrixArtifact;
  chunks: readonly OrderedRaceBenchmarkChunkArtifact[];
  protocol?: OrderedRaceBenchmarkProtocol;
}): OrderedRaceBenchmarkReport {
  const protocol = input.protocol ?? ORDERED_RACE_BENCHMARK_PROTOCOL;
  const expectedChunks = benchmarkChunkCount(protocol) * protocol.evaluationTrials;
  if (input.chunks.length !== expectedChunks) throw new Error(`Benchmark needs ${expectedChunks} chunks.`);
  const byTrial = Array.from({ length: protocol.evaluationTrials }, (_unused, trial) => input.chunks
    .filter((chunk) => chunk.trial === trial).sort((left, right) => left.chunk - right.chunk)
    .flatMap((chunk) => chunk.candidates));
  const candidateCount = protocol.rankLimit - protocol.initialStrategies;
  if (byTrial.some((rows) => rows.length !== candidateCount)) throw new Error('Benchmark trial coverage is incomplete.');
  const ranked = ([1, 8, 25] as const).map((blocks) => ({ blocks,
    rankings: byTrial.map((rows) => rankBenchmarkCandidates(rows, blocks)) }));
  const depths = ranked.map(({ blocks, rankings }): DepthConsistency => ({ blocks,
    cutoffs: [16, 50, 100].map((cutoff) => cutoffConsistency(rankings, cutoff)),
    rankCorrelations: rankings.flatMap((left, leftTrial) => rankings.slice(leftTrial + 1)
      .map((right, offset) => ({ leftTrial, rightTrial: leftTrial + offset + 1,
        tieAdjustedSpearman: tieAdjustedSpearman(left, right) }))) }));
  const depthComparisons = ranked.flatMap((from, fromIndex) => ranked.slice(fromIndex + 1).flatMap((to) =>
    byTrial.flatMap((_rows, trial) => [16, 50, 100].map((cutoff): DepthComparison => ({
      trial, fromBlocks: from.blocks, toBlocks: to.blocks, cutoff,
      ...compareSets(topSet(from.rankings[trial]!, cutoff), topSet(to.rankings[trial]!, cutoff))
    })))));
  const candidateEvaluation = input.chunks.reduce((sum, chunk) => sum + chunk.elapsedMs, 0);
  const base: Omit<OrderedRaceBenchmarkReport, 'evidenceHash'> = {
    schemaVersion: 1, experiment: 'ordered-reservoir-race-benchmark-report',
    version: ORDERED_RACE_BENCHMARK_VERSION, matrixEvidenceHash: input.matrix.evidenceHash,
    protocol, candidateCount,
    matches: protocol.evaluationTrials * candidateCount * protocol.candidateBlocks * protocol.gamesPerBlock,
    elapsedMs: { matrix: input.matrix.elapsedMs, candidateEvaluation,
      total: input.matrix.elapsedMs + candidateEvaluation },
    depths, depthComparisons, chunkEvidenceHashes: input.chunks.map((chunk) => chunk.evidenceHash)
  };
  return { ...base, evidenceHash: reportHash(base) };
}

export function validateOrderedRaceBenchmarkReport(
  value: unknown, matrix: OrderedRaceBenchmarkMatrixArtifact,
  chunks: readonly OrderedRaceBenchmarkChunkArtifact[],
  protocol: OrderedRaceBenchmarkProtocol = ORDERED_RACE_BENCHMARK_PROTOCOL
): value is OrderedRaceBenchmarkReport {
  try {
    return exact(value, createOrderedRaceBenchmarkReport({ matrix, chunks, protocol }));
  } catch { return false; }
}
