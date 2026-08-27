import { createHash } from 'node:crypto';
import { anytimeConfidenceBounds } from './anytimeMeanEvidence';
import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import type { MixtureSchedule } from './mixtureEvaluation';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from './pairing';
import { matrixProtocol, payoffMatrixPairKey } from './payoffMatrix';
import type { MatrixCell, MatrixSnapshot } from './payoffMatrix';
import type { CalibrationCandidateIdentity } from './responseOracleCalibration';
import { stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { StrategySearchMatrixArtifact } from './strategySearchMatrix';
import { createStrategySearchPsroLook } from './strategySearchPsro';
import type { StrategySearchPsroLook } from './strategySearchPsro';
import {
  CONFIRMATION_FAMILY_ALPHA, CONFIRMATION_LOOKS, PSRO_MATRIX_BLOCKS, RESPONSE_THRESHOLD,
  SCREEN_ALPHA, SCREEN_DEPTHS, assembleRawPsroLook, createRawPsroLookArtifact, orderConfirmedQueue,
  scheduleSlice, thresholdRacingSeedLabel, validateThresholdRacingProtocol, weightedFairSchedule
} from './thresholdRacingPsro';
import type {
  ConfirmationDecision, QueueOrder, RawPsroScoreChunk, ThresholdDecision, ThresholdRacingProtocol
} from './thresholdRacingPsro';
import type { TelemetryAggregate } from './types';
import { compareUtf16 } from './utf16';

export const STRATEGY_SEARCH_PARALLEL_PSRO_VERSION = 'strategy-search-parallel-psro-v1' as const;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

export interface ParallelPsroCandidate extends CalibrationCandidateIdentity { strategy: Strategy }
export interface ParallelPsroDecisionRecord {
  raceKind: 'screen' | 'confirmation' | 'queue-retest'; lookId: string; lookDepth: number;
  decisions: Array<ThresholdDecision | ConfirmationDecision>;
}
export interface ParallelPsroAdmission {
  admission: number; strategyId: string; goldfishRank: number; canonicalStrategy: string;
  queueOrder: QueueOrder; matrixSizeBefore: number; matrixSizeAfter: number;
}
export interface ParallelPsroRaceState {
  raceKind: 'screen' | 'confirmation' | 'queue-retest'; ordinal: number; familyCandidateIds: string[];
  activeCandidateIds: string[]; resolvedCandidateIds: string[]; scoresByCandidate: Record<string, number[]>;
  fullSchedule: MixtureSchedule; lookIndex: number; lookIdPrefix: string;
}
export interface ParallelPsroSemanticCheckpoint {
  schemaVersion: 1; experiment: 'strategy-search-parallel-psro';
  version: typeof STRATEGY_SEARCH_PARALLEL_PSRO_VERSION; protocol: ThresholdRacingProtocol; seedSourceHash: string;
  status: 'running' | 'complete' | 'terminal-incomplete'; stopReason: 'running' | 'empirical-two-clean-scans'
    | 'fixed-protocol-look-cap-unresolved'; matrix: MatrixSnapshot; equilibrium: EquilibriumResult;
  candidates: ParallelPsroCandidate[]; cleanSearches: number; scanCount: number; queueRetestCount: number;
  queue: ConfirmationDecision[]; currentRace: ParallelPsroRaceState | null;
  decisions: ParallelPsroDecisionRecord[]; looks: StrategySearchPsroLook[]; admissions: ParallelPsroAdmission[];
  telemetry: TelemetryAggregate; evidenceHash: string;
}
export interface ParallelPsroLookDescriptor {
  descriptorHash: string; raceKind: ParallelPsroRaceState['raceKind']; lookId: string; lookDepth: number;
  familySize: number; alpha: number; threshold: typeof RESPONSE_THRESHOLD; candidateIds: string[];
  candidateCanonicals: string[]; fullSchedule: MixtureSchedule; suffixSchedule: MixtureSchedule;
  scheduleStart: number; scheduleEnd: number;
}
export interface ParallelPsroScoreTaskDescriptor {
  taskIndex: number; candidateStart: number; candidateEnd: number; expectedTaskMs: number;
}
export interface ParallelAdmissionRowDescriptor {
  descriptorHash: string; admission: number; candidateId: string; candidateCanonical: string;
  opponentIds: string[]; seeds: number[]; tasks: Array<{ taskIndex: number; opponentStart: number; opponentEnd: number }>;
}
export interface ParallelAdmissionRowCell {
  opponentId: string; scores: number[]; played: number[]; telemetry: TelemetryAggregate;
}
export interface ParallelAdmissionRowChunk {
  schemaVersion: 1; experiment: 'strategy-search-admission-row-chunk'; descriptorHash: string;
  taskIndex: number; opponentStart: number; opponentEnd: number; cells: ParallelAdmissionRowCell[]; contentHash: string;
}
export type ParallelPsroTransition =
  | { kind: 'score'; checkpoint: ParallelPsroSemanticCheckpoint; look: ParallelPsroLookDescriptor;
      tasks: ParallelPsroScoreTaskDescriptor[] }
  | { kind: 'admission-row'; checkpoint: ParallelPsroSemanticCheckpoint; row: ParallelAdmissionRowDescriptor }
  | { kind: 'complete' | 'terminal-incomplete'; checkpoint: ParallelPsroSemanticCheckpoint };

function seal(checkpoint: ParallelPsroSemanticCheckpoint): ParallelPsroSemanticCheckpoint {
  const copy = structuredClone(checkpoint); copy.evidenceHash = '';
  return { ...copy, evidenceHash: hash(copy) };
}
function candidateMap(checkpoint: ParallelPsroSemanticCheckpoint): Map<string, ParallelPsroCandidate> {
  return new Map(checkpoint.candidates.map((candidate) => [candidate.strategyId, candidate]));
}
function positiveLottery(checkpoint: ParallelPsroSemanticCheckpoint): {
  opponents: Map<string, Strategy>; weights: Record<string, number> } {
  const opponents = new Map<string, Strategy>(), weights: Record<string, number> = {};
  for (const strategy of checkpoint.matrix.strategies) {
    const weight = checkpoint.equilibrium.weights[strategy.id] ?? 0;
    if (weight > 0) { opponents.set(strategy.id, strategy); weights[strategy.id] = weight; }
  }
  if (!opponents.size) throw new Error('PSRO equilibrium has no positive support.');
  return { opponents, weights };
}
function usedSeeds(checkpoint: ParallelPsroSemanticCheckpoint): Set<number> {
  const used = new Set(checkpoint.matrix.protocol.seeds);
  for (const look of checkpoint.looks) for (const block of look.fullSchedule.blocks) used.add(block.seed);
  if (checkpoint.currentRace) for (const block of checkpoint.currentRace.fullSchedule.blocks) used.add(block.seed);
  return used;
}
function scheduleFor(checkpoint: ParallelPsroSemanticCheckpoint, kind: ParallelPsroRaceState['raceKind'],
  label: string, count: number): MixtureSchedule {
  const used = usedSeeds(checkpoint), weights = positiveLottery(checkpoint).weights;
  const seeds = Array.from({ length: count }, (_unused, index) => {
    let nonce = 0;
    for (;;) {
      const scoped = thresholdRacingSeedLabel(checkpoint.protocol, kind, label);
      const seed = Number.parseInt(stableHash(`${checkpoint.protocol.protocolVersion}:${checkpoint.seedSourceHash}:run:`
        + `${checkpoint.protocol.runId}:${scoped}:${index}:nonce:${nonce}`).slice(0, 8), 16) >>> 0;
      if (!used.has(seed)) { used.add(seed); return seed; }
      nonce += 1;
    }
  });
  return weightedFairSchedule(weights, seeds);
}
function beginScreen(checkpoint: ParallelPsroSemanticCheckpoint): void {
  checkpoint.scanCount += 1;
  const matrixIds = new Set(checkpoint.matrix.strategies.map((strategy) => strategy.id));
  const ids = checkpoint.candidates.filter((candidate) => !matrixIds.has(candidate.strategyId))
    .map((candidate) => candidate.strategyId);
  checkpoint.currentRace = { raceKind: 'screen', ordinal: checkpoint.scanCount, familyCandidateIds: ids,
    activeCandidateIds: ids, resolvedCandidateIds: [], scoresByCandidate: Object.fromEntries(ids.map((id) => [id, []])),
    fullSchedule: scheduleFor(checkpoint, 'screen', `scan:${checkpoint.scanCount}:screen`, SCREEN_DEPTHS.at(-1)!),
    lookIndex: 0, lookIdPrefix: `run-${checkpoint.protocol.runId}.scan-${checkpoint.scanCount}.screen` };
}
function beginConfirmation(checkpoint: ParallelPsroSemanticCheckpoint, ids: readonly string[],
  kind: 'confirmation' | 'queue-retest'): void {
  const ordinal = kind === 'queue-retest' ? ++checkpoint.queueRetestCount : checkpoint.scanCount;
  const label = kind === 'queue-retest' ? `queue-retest:${ordinal}:confirmation`
    : `scan:${checkpoint.scanCount}:confirmation`;
  checkpoint.currentRace = { raceKind: kind, ordinal, familyCandidateIds: [...ids], activeCandidateIds: [...ids],
    resolvedCandidateIds: [], scoresByCandidate: Object.fromEntries(ids.map((id) => [id, []])),
    fullSchedule: scheduleFor(checkpoint, kind, label, CONFIRMATION_LOOKS.at(-1)!), lookIndex: 0,
    lookIdPrefix: kind === 'queue-retest' ? `run-${checkpoint.protocol.runId}.queue-retest-${ordinal}.confirmation`
      : `run-${checkpoint.protocol.runId}.scan-${checkpoint.scanCount}.confirmation` };
}
function nextDepth(race: ParallelPsroRaceState): number {
  const depths = race.raceKind === 'screen' ? SCREEN_DEPTHS : CONFIRMATION_LOOKS;
  const depth = depths[race.lookIndex];
  if (!depth) throw new Error('PSRO race has no next fixed look.');
  return depth;
}
function lookDescriptor(checkpoint: ParallelPsroSemanticCheckpoint): ParallelPsroLookDescriptor {
  const race = checkpoint.currentRace;
  if (!race || !race.activeCandidateIds.length) throw new Error('PSRO checkpoint has no active look.');
  const candidates = candidateMap(checkpoint), depth = nextDepth(race), previous = race.lookIndex
    ? (race.raceKind === 'screen' ? SCREEN_DEPTHS : CONFIRMATION_LOOKS)[race.lookIndex - 1]! : 0;
  const familySize = race.familyCandidateIds.length;
  const base = { descriptorHash: '', raceKind: race.raceKind,
    lookId: `${race.lookIdPrefix}.blocks-${depth}`, lookDepth: depth, familySize,
    alpha: race.raceKind === 'screen' ? SCREEN_ALPHA : CONFIRMATION_FAMILY_ALPHA / familySize,
    threshold: RESPONSE_THRESHOLD as typeof RESPONSE_THRESHOLD, candidateIds: [...race.activeCandidateIds],
    candidateCanonicals: race.activeCandidateIds.map((id) => candidates.get(id)!.canonicalStrategy),
    fullSchedule: structuredClone(race.fullSchedule), suffixSchedule: scheduleSlice(race.fullSchedule, previous, depth),
    scheduleStart: previous, scheduleEnd: depth };
  return { ...base, descriptorHash: hash(base) };
}
export function partitionParallelPsroLook(look: ParallelPsroLookDescriptor, input: {
  targetTaskMs?: number; measuredCandidateBlocksPerSecond?: number } = {}): ParallelPsroScoreTaskDescriptor[] {
  const targetMs = input.targetTaskMs ?? 20_000, rate = input.measuredCandidateBlocksPerSecond ?? 1_653;
  if (targetMs < 15_000 || targetMs > 60_000 || !(rate > 0)) throw new Error('PSRO score-task sizing is invalid.');
  const blocks = look.scheduleEnd - look.scheduleStart;
  const totalMs = look.candidateIds.length * blocks / rate * 1000;
  const minimumTasks = Math.max(1, Math.ceil(totalMs / 60_000));
  const maximumTasks = Math.max(1, Math.floor(totalMs / 15_000));
  const taskCount = Math.max(minimumTasks, Math.min(maximumTasks, Math.round(totalMs / targetMs)));
  const tasks: ParallelPsroScoreTaskDescriptor[] = []; let cursor = 0;
  for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
    const count = Math.floor(look.candidateIds.length / taskCount)
      + (taskIndex < look.candidateIds.length % taskCount ? 1 : 0);
    tasks.push({ taskIndex, candidateStart: cursor, candidateEnd: cursor + count,
      expectedTaskMs: count * blocks / rate * 1000 }); cursor += count;
  }
  return tasks;
}
function requestNext(checkpoint: ParallelPsroSemanticCheckpoint): ParallelPsroTransition {
  if (checkpoint.status !== 'running') return { kind: checkpoint.status, checkpoint: seal(checkpoint) };
  if (checkpoint.queue.length && !checkpoint.currentRace) {
    const order = orderConfirmedQueue(checkpoint.queue), selected = order.strongestStrategyId;
    if (!selected) throw new Error('PSRO confirmed queue has no strongest candidate.');
    const base = { descriptorHash: '', admission: checkpoint.admissions.length + 1, candidateId: selected,
      candidateCanonical: candidateMap(checkpoint).get(selected)!.canonicalStrategy,
      opponentIds: checkpoint.matrix.strategies.map((strategy) => strategy.id),
      seeds: [...checkpoint.matrix.protocol.seeds], tasks: [{ taskIndex: 0, opponentStart: 0,
        opponentEnd: checkpoint.matrix.strategies.length }] };
    return { kind: 'admission-row', checkpoint: seal(checkpoint), row: { ...base, descriptorHash: hash(base) } };
  }
  if (!checkpoint.currentRace) beginScreen(checkpoint);
  const look = lookDescriptor(checkpoint);
  return { kind: 'score', checkpoint: seal(checkpoint), look, tasks: partitionParallelPsroLook(look) };
}
export function createParallelPsroCheckpoint(input: { protocol: ThresholdRacingProtocol; seedSourceHash?: string;
  matrix: MatrixSnapshot; candidates: readonly ParallelPsroCandidate[] }): ParallelPsroSemanticCheckpoint {
  const seedSourceHash = input.seedSourceHash ?? input.protocol.sourceIdentityHash;
  if (!validateThresholdRacingProtocol(input.protocol) || !/^[0-9a-f]{64}$/.test(seedSourceHash)
    || !input.matrix.complete || input.candidates.length < 50
    || new Set(input.candidates.map((candidate) => candidate.strategyId)).size !== input.candidates.length) {
    throw new Error('Parallel PSRO source is invalid.');
  }
  return seal({ schemaVersion: 1, experiment: 'strategy-search-parallel-psro',
    version: STRATEGY_SEARCH_PARALLEL_PSRO_VERSION, protocol: structuredClone(input.protocol), seedSourceHash,
    status: 'running',
    stopReason: 'running', matrix: structuredClone(input.matrix),
    equilibrium: solveEquilibrium(input.matrix.strategies.map((strategy) => strategy.id), input.matrix.centeredPayoffs),
    candidates: input.candidates.map((candidate) => structuredClone(candidate)), cleanSearches: 0, scanCount: 0,
    queueRetestCount: 0, queue: [], currentRace: null, decisions: [], looks: [], admissions: [],
    telemetry: emptyAggregate(), evidenceHash: '' });
}
export function startParallelPsro(checkpoint: ParallelPsroSemanticCheckpoint): ParallelPsroTransition {
  if (!validateParallelPsroCheckpoint(checkpoint)) throw new Error('Parallel PSRO checkpoint is invalid.');
  return requestNext(structuredClone(checkpoint));
}
function finishClean(checkpoint: ParallelPsroSemanticCheckpoint): ParallelPsroTransition {
  checkpoint.cleanSearches += 1; checkpoint.currentRace = null;
  if (checkpoint.cleanSearches >= 2) {
    checkpoint.status = 'complete'; checkpoint.stopReason = 'empirical-two-clean-scans';
  }
  return requestNext(checkpoint);
}
export function reduceParallelPsroLook(input: { checkpoint: ParallelPsroSemanticCheckpoint;
  look: ParallelPsroLookDescriptor; chunks: readonly RawPsroScoreChunk[] }): ParallelPsroTransition {
  if (!validateParallelPsroCheckpoint(input.checkpoint)) throw new Error('Parallel PSRO checkpoint is invalid.');
  const checkpoint = structuredClone(input.checkpoint), race = checkpoint.currentRace;
  if (!race || lookDescriptor(checkpoint).descriptorHash !== input.look.descriptorHash) {
    throw new Error('Parallel PSRO look is stale.');
  }
  const chunks = [...input.chunks].sort((left, right) => left.candidateStart - right.candidateStart);
  const candidates = candidateMap(checkpoint), refs = race.activeCandidateIds.map((id) => {
    const candidate = candidates.get(id)!; return { identity: candidate, strategy: candidate.strategy };
  });
  const rawLook = createRawPsroLookArtifact({ protocol: checkpoint.protocol, raceKind: race.raceKind,
    lookId: input.look.lookId, lookDepth: input.look.lookDepth, familySize: input.look.familySize,
    alpha: input.look.alpha, candidates: refs, scheduleStart: input.look.scheduleStart,
    scheduleEnd: input.look.scheduleEnd, chunks });
  const suffixScores = assembleRawPsroLook(rawLook, chunks, checkpoint.protocol);
  checkpoint.looks.push(createStrategySearchPsroLook({ look: rawLook, chunks, protocol: checkpoint.protocol }));
  chunks.forEach((chunk) => chunk.telemetryByCandidate.forEach((telemetry) => mergeAggregate(checkpoint.telemetry, telemetry)));
  for (const id of race.activeCandidateIds) race.scoresByCandidate[id]!.push(...suffixScores[id]!);
  const decisions = race.activeCandidateIds.map((id) => {
    const candidate = candidates.get(id)!, scores = race.scoresByCandidate[id]!, interval = anytimeConfidenceBounds(scores,
      race.raceKind === 'screen' ? SCREEN_ALPHA : CONFIRMATION_FAMILY_ALPHA / race.familyCandidateIds.length);
    if (race.raceKind === 'screen') return { goldfishRank: candidate.goldfishRank, strategyId: id,
      canonicalStrategy: candidate.canonicalStrategy, blocks: scores.length, mean: mean(scores), interval,
      status: interval.upper <= RESPONSE_THRESHOLD ? 'below' as const
        : interval.lower > RESPONSE_THRESHOLD ? 'above' as const : 'unresolved' as const };
    return { goldfishRank: candidate.goldfishRank, strategyId: id, canonicalStrategy: candidate.canonicalStrategy,
      blocks: scores.length, mean: mean(scores), interval, status: interval.lower > RESPONSE_THRESHOLD
        ? 'confirmed' as const : interval.upper <= RESPONSE_THRESHOLD ? 'rejected' as const : 'unresolved' as const };
  });
  checkpoint.decisions.push({ raceKind: race.raceKind, lookId: input.look.lookId,
    lookDepth: input.look.lookDepth, decisions });
  const resolved = decisions.filter((decision) => decision.status !== 'unresolved');
  race.resolvedCandidateIds.push(...resolved.map((decision) => decision.strategyId));
  race.activeCandidateIds = decisions.filter((decision) => decision.status === 'unresolved')
    .map((decision) => decision.strategyId);
  race.lookIndex += 1;
  const depths = race.raceKind === 'screen' ? SCREEN_DEPTHS : CONFIRMATION_LOOKS;
  const finalLook = race.lookIndex === depths.length;
  if (race.activeCandidateIds.length && !finalLook) return requestNext(checkpoint);
  if (race.activeCandidateIds.length) {
    checkpoint.status = 'terminal-incomplete'; checkpoint.stopReason = 'fixed-protocol-look-cap-unresolved';
    checkpoint.currentRace = null; return requestNext(checkpoint);
  }
  const allRaceDecisions = checkpoint.decisions.filter((record) => record.raceKind === race.raceKind
    && record.lookId.startsWith(race.lookIdPrefix)).flatMap((record) => record.decisions);
  if (race.raceKind === 'screen') {
    const provisional = allRaceDecisions.filter((decision): decision is ThresholdDecision => decision.status === 'above');
    checkpoint.currentRace = null;
    if (!provisional.length) return finishClean(checkpoint);
    beginConfirmation(checkpoint, provisional.map((decision) => decision.strategyId), 'confirmation');
    return requestNext(checkpoint);
  }
  const confirmed = allRaceDecisions.filter((decision): decision is ConfirmationDecision => decision.status === 'confirmed');
  checkpoint.currentRace = null;
  if (!confirmed.length) {
    if (race.raceKind === 'confirmation') return finishClean(checkpoint);
    checkpoint.queue = []; return requestNext(checkpoint);
  }
  checkpoint.queue = confirmed; return requestNext(checkpoint);
}
export function createParallelAdmissionRowChunk(input: { row: ParallelAdmissionRowDescriptor; taskIndex: number;
  cells: readonly ParallelAdmissionRowCell[] }): ParallelAdmissionRowChunk {
  const task = input.row.tasks[input.taskIndex];
  if (!task || input.cells.length !== task.opponentEnd - task.opponentStart
    || input.cells.some((cell, index) => cell.opponentId !== input.row.opponentIds[task.opponentStart + index]
      || cell.scores.length !== input.row.seeds.length || cell.played.length !== input.row.seeds.length
      || cell.scores.some((score) => ![0, 0.25, 0.5, 0.75, 1].includes(score))
      || cell.played.some((played) => played !== GAMES_PER_SEED))) throw new Error('Admission-row chunk is invalid.');
  const base = { schemaVersion: 1 as const, experiment: 'strategy-search-admission-row-chunk' as const,
    descriptorHash: input.row.descriptorHash, taskIndex: input.taskIndex, opponentStart: task.opponentStart,
    opponentEnd: task.opponentEnd, cells: input.cells.map((cell) => structuredClone(cell)), contentHash: '' };
  return { ...base, contentHash: hash(base) };
}
export function validateParallelAdmissionRowChunk(value: unknown, row: ParallelAdmissionRowDescriptor):
  value is ParallelAdmissionRowChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try { const held = value as ParallelAdmissionRowChunk;
    return exact(held, createParallelAdmissionRowChunk({ row, taskIndex: held.taskIndex, cells: held.cells }));
  } catch { return false; }
}
export function reduceParallelAdmissionRow(input: { checkpoint: ParallelPsroSemanticCheckpoint;
  row: ParallelAdmissionRowDescriptor; chunks: readonly ParallelAdmissionRowChunk[] }): ParallelPsroTransition {
  if (!validateParallelPsroCheckpoint(input.checkpoint)) throw new Error('Parallel PSRO checkpoint is invalid.');
  const checkpoint = structuredClone(input.checkpoint), order = orderConfirmedQueue(checkpoint.queue);
  if (order.strongestStrategyId !== input.row.candidateId || input.row.admission !== checkpoint.admissions.length + 1
    || input.chunks.length !== input.row.tasks.length) throw new Error('Admission-row descriptor is stale.');
  const byTask = new Map<number, ParallelAdmissionRowChunk>();
  for (const chunk of input.chunks) {
    if (byTask.has(chunk.taskIndex) || !validateParallelAdmissionRowChunk(chunk, input.row)) {
      throw new Error('Admission-row chunks are missing, duplicate, stale, or corrupt.');
    }
    byTask.set(chunk.taskIndex, chunk);
  }
  const cells = input.row.tasks.flatMap((task) => byTask.get(task.taskIndex)!.cells);
  const selected = candidateMap(checkpoint).get(input.row.candidateId)!;
  const before = checkpoint.matrix.strategies.length;
  const oldIndex = new Map(checkpoint.matrix.strategies.map((strategy, index) => [strategy.id, index]));
  const nextStrategies = [...checkpoint.matrix.strategies, selected.strategy]
    .sort((left, right) => compareUtf16(left.id, right.id));
  const matrixCells = [...checkpoint.matrix.cells];
  cells.forEach((cell, index) => {
    const opponent = checkpoint.matrix.strategies[index]!;
    const selectedFirst = compareUtf16(selected.strategyId, opponent.id) < 0;
    const scores = selectedFirst ? cell.scores : cell.scores.map((score) => 1 - score);
    matrixCells.push({ rowId: selectedFirst ? selected.strategyId : opponent.id,
      columnId: selectedFirst ? opponent.id : selected.strategyId,
      key: payoffMatrixPairKey(checkpoint.matrix.protocol, selectedFirst ? selected.strategy : opponent,
        selectedFirst ? opponent : selected.strategy), blocks: scores.map((score, ordinal) => ({
          seed: input.row.seeds[ordinal]!, score, played: GAMES_PER_SEED, aborted: 0 })), complete: true,
      centeredPayoff: 2 * mean(scores) - 1, matches: input.row.seeds.length * GAMES_PER_SEED,
      telemetry: structuredClone(cell.telemetry) });
    mergeAggregate(checkpoint.telemetry, cell.telemetry);
  });
  const newScore = new Map(cells.map((cell) => [cell.opponentId, 2 * mean(cell.scores) - 1]));
  const centeredPayoffs = nextStrategies.map((row) => nextStrategies.map((column) => {
    if (row.id === column.id) return 0;
    if (row.id === selected.strategyId) return newScore.get(column.id)!;
    if (column.id === selected.strategyId) return -newScore.get(row.id)!;
    return checkpoint.matrix.centeredPayoffs[oldIndex.get(row.id)!]![oldIndex.get(column.id)!]!;
  }));
  checkpoint.matrix = { ...checkpoint.matrix, strategies: nextStrategies,
    cells: matrixCells.sort((left, right) => compareUtf16(left.rowId, right.rowId)
      || compareUtf16(left.columnId, right.columnId)), centeredPayoffs };
  checkpoint.equilibrium = solveEquilibrium(nextStrategies.map((strategy) => strategy.id), centeredPayoffs);
  checkpoint.admissions.push({ admission: input.row.admission, strategyId: selected.strategyId,
    goldfishRank: selected.goldfishRank, canonicalStrategy: selected.canonicalStrategy, queueOrder: order,
    matrixSizeBefore: before, matrixSizeAfter: before + 1 });
  checkpoint.queue = checkpoint.queue.filter((decision) => decision.strategyId !== selected.strategyId);
  checkpoint.cleanSearches = 0;
  if (checkpoint.queue.length) beginConfirmation(checkpoint, checkpoint.queue.map((decision) => decision.strategyId), 'queue-retest');
  return requestNext(checkpoint);
}
export function matrixSnapshotFromStrategySearchArtifact(artifact: StrategySearchMatrixArtifact): MatrixSnapshot {
  const seeds = artifact.manifest.seeds.slice(0, PSRO_MATRIX_BLOCKS);
  const protocol = matrixProtocol(artifact.source.kingdomId, seeds, 30, 200, false);
  const cells: MatrixCell[] = artifact.cells.filter((cell) => cell.rowIndex !== cell.columnIndex).map((cell) => {
    const records = cell.seedRecords.slice(0, PSRO_MATRIX_BLOCKS), row = artifact.manifest.strategies[cell.rowIndex]!,
      column = artifact.manifest.strategies[cell.columnIndex]!, original = records.map((record) => record.payoffScore!);
    const rowFirst = compareUtf16(row.id, column.id) < 0, scores = rowFirst ? original : original.map((score) => 1 - score);
    const telemetry = emptyAggregate(); records.forEach((record) => mergeAggregate(telemetry, record.telemetry));
    return { rowId: rowFirst ? row.id : column.id, columnId: rowFirst ? column.id : row.id,
      key: payoffMatrixPairKey(protocol, rowFirst ? row : column, rowFirst ? column : row),
      blocks: scores.map((score, index) => ({ seed: seeds[index]!, score, played: GAMES_PER_SEED, aborted: 0 })),
      complete: true, centeredPayoff: 2 * mean(scores) - 1, matches: PSRO_MATRIX_BLOCKS * GAMES_PER_SEED, telemetry };
  }).sort((left, right) => compareUtf16(left.rowId, right.rowId) || compareUtf16(left.columnId, right.columnId));
  return { protocol, strategies: artifact.manifest.strategies, cells, complete: true,
    centeredPayoffs: artifact.centeredPayoffs };
}
export function validateParallelPsroCheckpoint(value: unknown): value is ParallelPsroSemanticCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as ParallelPsroSemanticCheckpoint, copy = structuredClone(held), digest = copy.evidenceHash;
    copy.evidenceHash = '';
    const solved = solveEquilibrium(copy.matrix.strategies.map((strategy) => strategy.id), copy.matrix.centeredPayoffs);
    return held.schemaVersion === 1 && held.experiment === 'strategy-search-parallel-psro'
      && held.version === STRATEGY_SEARCH_PARALLEL_PSRO_VERSION && validateThresholdRacingProtocol(held.protocol)
      && digest === hash(copy) && exact(held.equilibrium, solved)
      && new Set(held.candidates.map((candidate) => candidate.strategyId)).size === held.candidates.length
      && held.matrix.complete && held.cleanSearches >= 0 && held.cleanSearches <= 2
      && (held.status === 'running') === (held.stopReason === 'running');
  } catch { return false; }
}
