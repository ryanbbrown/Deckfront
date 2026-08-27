import { createHash } from 'node:crypto';
import type { GoldfishArtifactV3, GoldfishReservoirV3 } from './strategySearchCompact';
import { validateGoldfishArtifactV3, validateGoldfishReservoirV3 } from './strategySearchCompact';
import {
  ORDERED_PRODUCT_GENERATOR, ORDERED_PRODUCT_TRAVERSAL, validateOrderedProductArtifact,
  validateOrderedProductReservoir
} from './orderedGoldfishProduct';
import { NATIVE_GOLDFISH_SCORER_VERSION } from './nativeGoldfishProtocol';
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
export function validateCampaignGoldfishStage(input: { evidenceId?: string; stageId?: string;
  ranked: GoldfishArtifactV3 | unknown; reservoir: GoldfishReservoirV3 | unknown;
  rankedSha256?: string; reservoirSha256?: string; rankedSidecarContent?: string;
  reservoirSidecarContent?: string; fileHashes: Readonly<Record<string, string>>; marker: unknown }): boolean {
  const evidenceId = input.evidenceId ?? input.stageId ?? '';
  const expected = createCampaignStageControlMarker({ stage: 'goldfish', evidenceId, status: 'complete',
    artifactHashes: input.fileHashes });
  if (!validateCampaignStageControlMarker(input.marker, expected)) return false;
  const ranked = input.ranked as GoldfishArtifactV3;
  if (ranked.schemaVersion === 3) {
    const reservoir = input.reservoir as GoldfishReservoirV3;
    return ranked.evidenceId === evidenceId && validateGoldfishArtifactV3(ranked)
      && reservoir.evidenceId === evidenceId && validateGoldfishReservoirV3(reservoir, ranked);
  }
  if (!validateOrderedProductArtifact(input.ranked) || !input.rankedSha256 || !input.reservoirSha256
    || !validateOrderedProductReservoir(input.reservoir, input.ranked, input.rankedSha256)
    || input.ranked.scorerVersion !== NATIVE_GOLDFISH_SCORER_VERSION
    || input.ranked.candidateSpace.generator !== ORDERED_PRODUCT_GENERATOR
    || input.ranked.candidateSpace.traversal !== ORDERED_PRODUCT_TRAVERSAL) return false;
  const rankedSidecar = `${input.rankedSha256}  ranked.json\n`;
  const reservoirSidecar = `${input.reservoirSha256}  reservoir.json\n`;
  return input.rankedSidecarContent === rankedSidecar && input.reservoirSidecarContent === reservoirSidecar
    && input.fileHashes['output/ranked.json'] === input.rankedSha256
    && input.fileHashes['output/reservoir.json'] === input.reservoirSha256
    && input.fileHashes['output/ranked.json.sha256'] === createHash('sha256').update(rankedSidecar).digest('hex')
    && input.fileHashes['output/reservoir.json.sha256'] === createHash('sha256').update(reservoirSidecar).digest('hex');
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
