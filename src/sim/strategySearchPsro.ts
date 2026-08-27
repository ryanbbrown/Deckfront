import { createHash } from 'node:crypto';
import {
  assembleRawPsroLook, validateRawPsroLookArtifact, validateRawPsroScoreChunk
} from './thresholdRacingPsro';
import type { RawPsroLookArtifact, RawPsroScoreChunk, ThresholdRacingProtocol } from './thresholdRacingPsro';
import type { MixtureSchedule } from './mixtureEvaluation';
import type { TelemetryAggregate } from './types';
import { compareUtf16 } from './utf16';

export const STRATEGY_SEARCH_PSRO_SCHEMA_VERSION = 3 as const;
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
const RUNTIME_KEYS = new Set(['elapsedMs', 'workerCount', 'candidateStart', 'candidateEnd', 'chunkHash',
  'chunkHashes', 'checkpointPath', 'rankedPath', 'reservoirPath', 'p75ManifestPath', 'p75ReportPath',
  'p75Root', 'runId', 'source', 'rawLook', 'artifactHash', 'lookHash', 'eventHash', 'evidenceHash']);
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !RUNTIME_KEYS.has(key))
    .sort(([left], [right]) => compareUtf16(left, right))
    .map(([key, held]) => [key, semantic(held)]));
  return value;
}
function containsRuntimeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRuntimeKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, held]) => RUNTIME_KEYS.has(key) || containsRuntimeKey(held));
}
export interface StrategySearchPsroLookRow {
  candidateId: string; candidateCanonical: string; scoreBytes: number[]; played: number[];
  telemetry: TelemetryAggregate;
}
export interface StrategySearchPsroLook {
  raceKind: RawPsroLookArtifact['raceKind']; lookId: string; lookDepth: number; familySize: number;
  alpha: number; threshold: number; candidateIds: string[]; candidateCanonicals: string[];
  fullSchedule: MixtureSchedule; suffixSchedule: MixtureSchedule; scheduleStart: number; scheduleEnd: number;
  rows: StrategySearchPsroLookRow[];
}
export function createStrategySearchPsroLook(input: { look: RawPsroLookArtifact;
  chunks: readonly RawPsroScoreChunk[]; protocol: ThresholdRacingProtocol }): StrategySearchPsroLook {
  if (!validateRawPsroLookArtifact(input.look, input.protocol)) throw new Error('PSRO raw look is invalid.');
  assembleRawPsroLook(input.look, input.chunks, input.protocol);
  const byId = new Map<string, StrategySearchPsroLookRow>();
  for (const chunk of input.chunks) {
    if (!validateRawPsroScoreChunk(chunk, input.protocol)) throw new Error('PSRO raw score chunk is invalid.');
    chunk.candidateIds.forEach((candidateId, index) => {
      if (byId.has(candidateId)) throw new Error('PSRO raw score candidate repeats.');
      const start = index * chunk.dimensions.blocks, end = start + chunk.dimensions.blocks;
      byId.set(candidateId, { candidateId, candidateCanonical: chunk.candidateCanonicals[index]!,
        scoreBytes: chunk.scoreBytes.slice(start, end), played: chunk.played.slice(start, end),
        telemetry: structuredClone(chunk.telemetryByCandidate[index]!) });
    });
  }
  const first = input.chunks[0];
  if (!first) throw new Error('PSRO raw look has no score chunks.');
  const rows = input.look.candidateIds.map((candidateId, index) => {
    const row = byId.get(candidateId);
    if (!row || row.candidateCanonical !== input.look.candidateCanonicals[index]) {
      throw new Error('PSRO raw score identity differs from its look.');
    }
    return row;
  });
  return { raceKind: input.look.raceKind, lookId: input.look.lookId, lookDepth: input.look.lookDepth,
    familySize: input.look.familySize, alpha: input.look.alpha, threshold: input.look.threshold,
    candidateIds: [...input.look.candidateIds], candidateCanonicals: [...input.look.candidateCanonicals],
    fullSchedule: structuredClone(first.fullSchedule), suffixSchedule: structuredClone(first.suffixSchedule),
    scheduleStart: input.look.scheduleStart, scheduleEnd: input.look.scheduleEnd, rows };
}
export interface StrategySearchPsroArtifact {
  schemaVersion: 3; experiment: 'strategy-search-psro-evidence'; evidenceId: string;
  matrixEvidenceHash: string; candidateIds: string[]; rawLooks: StrategySearchPsroLook[];
  semanticCheckpoint: unknown; finalStatus: 'complete'; evidenceHash: string;
}
export function createStrategySearchPsroArtifact(input: { evidenceId: string; matrixEvidenceHash: string;
  candidateIds: readonly string[]; rawLooks?: readonly StrategySearchPsroLook[];
  checkpoint: unknown; finalStatus: 'complete' }): StrategySearchPsroArtifact {
  const rawLooks = [...(input.rawLooks ?? [])].map((look) => structuredClone(look))
    .sort((left, right) => compareUtf16(left.lookId, right.lookId));
  if (!/^[0-9a-f]{64}$/.test(input.evidenceId) || !/^[0-9a-f]{64}$/.test(input.matrixEvidenceHash)
    || input.finalStatus !== 'complete' || !input.candidateIds.length
    || new Set(input.candidateIds).size !== input.candidateIds.length
    || new Set(rawLooks.map((look) => look.lookId)).size !== rawLooks.length
    || rawLooks.some((look) => !look.rows.length || look.rows.length !== look.candidateIds.length
      || look.rows.some((row, index) => row.candidateId !== look.candidateIds[index]
        || row.candidateCanonical !== look.candidateCanonicals[index]))) {
    throw new Error('PSRO semantic artifact input is invalid.');
  }
  const semanticCheckpoint = semantic(input.checkpoint);
  const base = { schemaVersion: 3 as const, experiment: 'strategy-search-psro-evidence' as const,
    evidenceId: input.evidenceId, matrixEvidenceHash: input.matrixEvidenceHash,
    candidateIds: [...input.candidateIds], rawLooks, semanticCheckpoint,
    finalStatus: input.finalStatus, evidenceHash: '' };
  return { ...base, evidenceHash: hash(base) };
}
export function validateStrategySearchPsroArtifact(value: unknown): value is StrategySearchPsroArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as StrategySearchPsroArtifact;
    return !containsRuntimeKey(held.semanticCheckpoint)
      && JSON.stringify(held) === JSON.stringify(createStrategySearchPsroArtifact({ evidenceId: held.evidenceId,
        matrixEvidenceHash: held.matrixEvidenceHash, candidateIds: held.candidateIds, rawLooks: held.rawLooks,
        checkpoint: held.semanticCheckpoint, finalStatus: held.finalStatus }));
  } catch { return false; }
}
