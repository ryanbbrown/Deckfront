import { createHash } from 'node:crypto';
import type { StrategySearchMatrixArtifact, StrategySearchMatrixManifest } from './strategySearchMatrix';
import { validateStrategySearchMatrixArtifact } from './strategySearchMatrix';
import type { StrategySearchPsroArtifact } from './strategySearchPsro';
import { validateStrategySearchPsroArtifact } from './strategySearchPsro';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export type CampaignStageKind = 'goldfish' | 'matrix' | 'psro';
export type CampaignStageCompleteness = 'complete' | 'incomplete' | 'terminal-incomplete';
export interface CampaignStageControlMarker {
  schemaVersion: 2; experiment: 'strategy-search-stage-control'; stage: CampaignStageKind;
  evidenceId: string; status: CampaignStageCompleteness; artifactHashes: Record<string, string>;
  reason?: string; markerHash: string;
}
export function campaignStageOutputRoot(stageRoot: string): string {
  if (!stageRoot || stageRoot.includes('\\') || stageRoot.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Strategy-search stage root is invalid.');
  }
  return `${stageRoot}/output`;
}
export function campaignStageControlPath(stageRoot: string, status: CampaignStageCompleteness): string {
  campaignStageOutputRoot(stageRoot); return `${stageRoot}/control/${status}.json`;
}
export function createCampaignStageControlMarker(input: { stage: CampaignStageKind; evidenceId?: string;
  stageId?: string; status: CampaignStageCompleteness; artifactHashes: Readonly<Record<string, string>>;
  reason?: string }): CampaignStageControlMarker {
  const evidenceId = input.evidenceId ?? input.stageId ?? '';
  if (!sha(evidenceId) || !Object.keys(input.artifactHashes).length
    || Object.values(input.artifactHashes).some((value) => !sha(value))
    || input.status === 'complete' && input.reason !== undefined
    || input.status !== 'complete' && !input.reason) throw new Error('Stage marker input is invalid.');
  const base = { schemaVersion: 2 as const, experiment: 'strategy-search-stage-control' as const,
    stage: input.stage, evidenceId, status: input.status,
    artifactHashes: Object.fromEntries(Object.entries(input.artifactHashes).sort()),
    ...(input.reason === undefined ? {} : { reason: input.reason }), markerHash: '' };
  return { ...base, markerHash: hash(base) };
}
export function validateCampaignStageControlMarker(value: unknown,
  expected?: CampaignStageControlMarker): value is CampaignStageControlMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const held = value as CampaignStageControlMarker;
    const rebuilt = createCampaignStageControlMarker({ stage: held.stage, evidenceId: held.evidenceId,
      status: held.status, artifactHashes: held.artifactHashes,
      ...(held.reason === undefined ? {} : { reason: held.reason }) });
    return JSON.stringify(held) === JSON.stringify(rebuilt) && (!expected || JSON.stringify(held) === JSON.stringify(expected));
  } catch { return false; }
}
export function validateCampaignMatrixStage(input: { evidenceId?: string; stageId?: string;
  manifest: StrategySearchMatrixManifest; artifact: StrategySearchMatrixArtifact;
  fileHashes: Readonly<Record<string, string>>; marker: unknown }): boolean {
  const evidenceId = input.evidenceId ?? input.stageId ?? '';
  return input.manifest.source.evidenceId === evidenceId
    && validateStrategySearchMatrixArtifact(input.artifact, input.manifest)
    && validateCampaignStageControlMarker(input.marker, createCampaignStageControlMarker({ stage: 'matrix',
      evidenceId, status: 'complete', artifactHashes: input.fileHashes }));
}
export function validateCampaignPsroStage(input: { evidenceId?: string; stageId?: string;
  artifact: StrategySearchPsroArtifact; fileHashes: Readonly<Record<string, string>>; marker: unknown }): boolean {
  const evidenceId = input.evidenceId ?? input.stageId ?? '';
  return validateStrategySearchPsroArtifact(input.artifact) && input.artifact.evidenceId === evidenceId
    && input.artifact.finalStatus === 'complete'
    && validateCampaignStageControlMarker(input.marker, createCampaignStageControlMarker({ stage: 'psro',
      evidenceId, status: 'complete', artifactHashes: input.fileHashes }));
}
