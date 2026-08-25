import { anytimeConfidenceBounds, anytimeMeanEvidence, holmStepDown } from './anytimeMeanEvidence';
import { acquisitionEquivalentClasses, completeAcquisitionEvidenceKey } from './lotteryAcquisition';
import type { AcquisitionEquivalentClass, FullCandidateEvidence } from './lotteryAcquisition';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const ORDERED_FULL_PSRO_VERSION = 'ordered-reservoir-full-psro-v1' as const;
export const ORDERED_FULL_PSRO_RUNS = Object.freeze([1, 2] as const);
export const ORDERED_FULL_PSRO_INITIAL_STRATEGIES = 50;
export const ORDERED_FULL_PSRO_SCREEN_BLOCKS = 25;
export const ORDERED_FULL_PSRO_SCREEN_CHUNK = 250;
export const ORDERED_FULL_PSRO_MATRIX_WIDTH = 128;
export const ORDERED_FULL_PSRO_CONFIRMATION_WIDTH = 512;
export const ORDERED_FULL_PSRO_SCAN_CAP = 10;
export const ORDERED_FULL_PSRO_CONFIRMATION_LOOKS = Object.freeze([200, 800, 3_200, 6_400] as const);
export const ORDERED_FULL_PSRO_CONTINUATION_WIDTHS = Object.freeze([128, 32, 8] as const);
export const ORDERED_FULL_PSRO_ADMISSION_ALPHA = 0.005;
export const ORDERED_FULL_PSRO_RETIREMENT_ALPHA = 0.025;

export interface OrderedFullPsroProtocol {
  version: typeof ORDERED_FULL_PSRO_VERSION;
  initialStrategies: 50;
  screenLanes: 2;
  screenBlocksPerLane: 25;
  laneTier: 100;
  pooledTier: 200;
  pooledBoundaryAudit: 64;
  rankBandAuditPerBand: 16;
  confirmationWidth: 512;
  confirmationLooks: readonly [200, 800, 3_200, 6_400];
  continuationWidths: readonly [128, 32, 8];
  admissionAlphaPerScan: 0.005;
  retirementAlpha: 0.025;
  matrixDepths: readonly [50, 100, 200];
  matrixWidth: 128;
  scanCap: 10;
  panelBlocks: 1_000;
  initialPanels: 3;
  maximumPanels: 5;
  crossPlayBlocks: 10_000;
}

export const ORDERED_FULL_PSRO_PROTOCOL: Readonly<OrderedFullPsroProtocol> = Object.freeze({
  version: ORDERED_FULL_PSRO_VERSION, initialStrategies: 50, screenLanes: 2, screenBlocksPerLane: 25,
  laneTier: 100, pooledTier: 200, pooledBoundaryAudit: 64, rankBandAuditPerBand: 16,
  confirmationWidth: 512, confirmationLooks: [200, 800, 3_200, 6_400] as const,
  continuationWidths: [128, 32, 8] as const,
  admissionAlphaPerScan: 0.005, retirementAlpha: 0.025, matrixDepths: [50, 100, 200] as const,
  matrixWidth: 128, scanCap: 10, panelBlocks: 1_000, initialPanels: 3, maximumPanels: 5,
  crossPlayBlocks: 10_000
});

function uint32(value: string): number { return Number.parseInt(stableHash(value).slice(0, 8), 16) >>> 0; }
function seedOffset(label: string, count: number): number {
  if (label === 'matrix' && count === 200) return 0;
  const screen = /^scan:(\d+):screen:([ab]):(blocks|sampling)$/.exec(label);
  if (screen) {
    const scan = Number(screen[1]);
    if (scan >= ORDERED_FULL_PSRO_SCAN_CAP || (screen[3] === 'blocks' ? count !== 25 : count !== 1)) {
      throw new Error('Full PSRO screen seed namespace is invalid.');
    }
    return 1_000 + scan * 7_000 + (screen[2] === 'a' ? 0 : 30) + (screen[3] === 'sampling' ? 25 : 0);
  }
  const confirmation = /^scan:(\d+):confirmation:(blocks|sampling)$/.exec(label);
  if (confirmation) {
    const scan = Number(confirmation[1]);
    if (scan >= ORDERED_FULL_PSRO_SCAN_CAP || (confirmation[2] === 'blocks' ? count !== 6_400 : count !== 1)) {
      throw new Error('Full PSRO confirmation seed namespace is invalid.');
    }
    return 1_000 + scan * 7_000 + 100 + (confirmation[2] === 'sampling' ? 6_400 : 0);
  }
  const panel = /^panel:(\d+)$/.exec(label);
  if (panel && count === 1_000 && Number(panel[1]) >= 1 && Number(panel[1]) <= 5) {
    return 72_000 + (Number(panel[1]) - 1) * 1_000;
  }
  if (label === 'comparison:row:blocks' && count === 10_000) return 80_000;
  if (label === 'comparison:row:sampling' && count === 1) return 90_000;
  if (label === 'comparison:column:blocks' && count === 10_000) return 80_000;
  if (label === 'comparison:column:sampling' && count === 1) return 90_000;
  const historicalAudit = /^audit:historical:([1-5]):root$/.exec(label);
  if (historicalAudit && count === 1) return 100_000 + Number(historicalAudit[1]);
  throw new Error(`Unknown full PSRO seed namespace ${label}.`);
}
export function orderedFullPsroSeeds(
  reservoirHash: string, run: 1 | 2, label: string, count: number
): number[] {
  if (!/^[0-9a-f]{9,}$/.test(reservoirHash) || !ORDERED_FULL_PSRO_RUNS.includes(run)
    || !Number.isSafeInteger(count) || count < 1) throw new Error('Full PSRO seed input is invalid.');
  const root = uint32(`${ORDERED_FULL_PSRO_VERSION}:${reservoirHash}`), offset = seedOffset(label, count);
  const runOffset = (run - 1) * 1_000_000;
  return Array.from({ length: count }, (_unused, index) => (root + runOffset + offset + index) >>> 0);
}

export function validateOrderedFullPsroSeedPlan(reservoirHash: string): boolean {
  try {
    const all = new Set<number>();
    const add = (run: 1 | 2, label: string, count: number) => {
      for (const seed of orderedFullPsroSeeds(reservoirHash, run, label, count)) {
        if (all.has(seed)) throw new Error('Full PSRO seed namespaces collided.');
        all.add(seed);
      }
    };
    for (const run of ORDERED_FULL_PSRO_RUNS) {
      add(run, 'matrix', 200);
      for (let scan = 0; scan < ORDERED_FULL_PSRO_SCAN_CAP; scan += 1) {
        for (const lane of ['a', 'b']) {
          add(run, `scan:${scan}:screen:${lane}:blocks`, 25);
          add(run, `scan:${scan}:screen:${lane}:sampling`, 1);
        }
        add(run, `scan:${scan}:confirmation:blocks`, 6_400);
        add(run, `scan:${scan}:confirmation:sampling`, 1);
      }
      for (let panel = 1; panel <= 5; panel += 1) add(run, `panel:${panel}`, 1_000);
      for (let historical = 1; historical <= 5; historical += 1) {
        add(run, `audit:historical:${historical}:root`, 1);
      }
    }
    add(1, 'comparison:row:blocks', 10_000); add(1, 'comparison:row:sampling', 1);
    add(2, 'comparison:column:blocks', 10_000); add(2, 'comparison:column:sampling', 1);
    return true;
  } catch { return false; }
}

export interface FullScreenCandidate {
  goldfishRank: number;
  strategyId: string;
  canonicalStrategy: string;
  laneA: number[];
  laneB: number[];
}

export interface FullScreenSelection {
  strategyIds: string[];
  laneATierIds: string[];
  laneBTierIds: string[];
  pooledTierIds: string[];
  boundaryAuditIds: string[];
  rankBandAuditIds: string[];
  boundaries: { laneA: number; laneB: number; pooled: number };
  tieWidths: { laneA: number; laneB: number; pooled: number; boundaryAudit: number };
  selectedWidth: number;
  widthExceeded: boolean;
  scoreEquivalentGroups: string[][];
}

function mean(values: readonly number[]): number {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('Screen scores are invalid.');
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function ranked(rows: readonly FullScreenCandidate[], score: (row: FullScreenCandidate) => number) {
  return [...rows].map((row) => ({ row, score: score(row) })).sort((left, right) =>
    right.score - left.score || compareUtf16(left.row.strategyId, right.row.strategyId));
}
function completeTier(rows: ReturnType<typeof ranked>, count: number): { ids: string[]; boundary: number } {
  if (rows.length < count) throw new Error(`Screen tier ${count} exceeds the field.`);
  const boundary = rows[count - 1]!.score;
  return { boundary, ids: rows.filter((entry) => entry.score >= boundary).map((entry) => entry.row.strategyId) };
}
function rankBand(rank: number): number {
  if (rank <= 1_000) return 0;
  if (rank <= 5_000) return 1;
  if (rank <= 10_000) return 2;
  return 3;
}

export function selectFullScreenCandidates(
  rows: readonly FullScreenCandidate[], options: { allowOversize?: boolean } = {}
): FullScreenSelection {
  if (new Set(rows.map((row) => row.strategyId)).size !== rows.length || rows.some((row) =>
    row.laneA.length !== 25 || row.laneB.length !== 25 || row.goldfishRank < 51 || row.goldfishRank > 20_000)) {
    throw new Error('Full screen rows are invalid.');
  }
  const laneA = ranked(rows, (row) => mean(row.laneA));
  const laneB = ranked(rows, (row) => mean(row.laneB));
  const pooled = ranked(rows, (row) => mean([...row.laneA, ...row.laneB]));
  const a = completeTier(laneA, 100), b = completeTier(laneB, 100), p = completeTier(pooled, 200);
  const selected = new Set([...a.ids, ...b.ids, ...p.ids]);
  const boundaryAuditIds: string[] = [];
  const below = pooled.filter((entry) => entry.score < p.boundary);
  for (let index = 0; index < below.length && boundaryAuditIds.length < 64;) {
    const score = below[index]!.score; let end = index;
    while (end < below.length && below[end]!.score === score) end += 1;
    for (const entry of below.slice(index, end)) if (!selected.has(entry.row.strategyId)) {
      selected.add(entry.row.strategyId); boundaryAuditIds.push(entry.row.strategyId);
    }
    index = end;
  }
  const rankBandAuditIds: string[] = [];
  for (let band = 0; band < 4; band += 1) {
    const held = rows.filter((row) => rankBand(row.goldfishRank) === band && !selected.has(row.strategyId))
      .sort((left, right) => stableHash(`${ORDERED_FULL_PSRO_VERSION}:audit:${left.strategyId}`)
        .localeCompare(stableHash(`${ORDERED_FULL_PSRO_VERSION}:audit:${right.strategyId}`))
        || compareUtf16(left.strategyId, right.strategyId)).slice(0, 16);
    for (const row of held) { selected.add(row.strategyId); rankBandAuditIds.push(row.strategyId); }
  }
  const widthExceeded = selected.size > ORDERED_FULL_PSRO_CONFIRMATION_WIDTH;
  if (widthExceeded && !options.allowOversize) throw new Error('screen-width-unresolved');
  const scoreGroups = new Map<string, string[]>();
  for (const row of rows) {
    const key = stableHash(JSON.stringify([...row.laneA, ...row.laneB]));
    scoreGroups.set(key, [...(scoreGroups.get(key) ?? []), row.strategyId]);
  }
  return { strategyIds: [...selected].sort(compareUtf16), laneATierIds: a.ids, laneBTierIds: b.ids,
    pooledTierIds: p.ids, boundaryAuditIds, rankBandAuditIds,
    boundaries: { laneA: a.boundary, laneB: b.boundary, pooled: p.boundary },
    tieWidths: { laneA: laneA.filter((entry) => entry.score === a.boundary).length,
      laneB: laneB.filter((entry) => entry.score === b.boundary).length,
      pooled: pooled.filter((entry) => entry.score === p.boundary).length,
      boundaryAudit: boundaryAuditIds.length }, selectedWidth: selected.size, widthExceeded,
    scoreEquivalentGroups: [...scoreGroups.values()].filter((ids) => ids.length > 1)
      .map((ids) => ids.sort(compareUtf16)).sort((left, right) => compareUtf16(left[0]!, right[0]!)) };
}

export type ConfirmationDecision = 'retired' | 'admitted' | 'continue' | 'unresolved';
export interface ConfirmationCandidateDecision {
  strategyId: string;
  blocks: number;
  mean: number;
  bounds95: { lower: number; upper: number };
  admissionPValue: number;
  adjustedAdmissionPValue: number;
  retirementPValue: number;
  decision: ConfirmationDecision;
}

export function decideConfirmationLook(
  rows: readonly { strategyId: string; blockScores: readonly number[] }[], finalLook = false
): ConfirmationCandidateDecision[] {
  if (!rows.length || new Set(rows.map((row) => row.strategyId)).size !== rows.length
    || rows.some((row) => !ORDERED_FULL_PSRO_CONFIRMATION_LOOKS.includes(row.blockScores.length as never))) {
    throw new Error('Confirmation look is invalid.');
  }
  const raw = rows.map((row) => ({ row,
    admission: anytimeMeanEvidence(row.blockScores, 0.5, 'greater').pValue,
    retirement: anytimeMeanEvidence(row.blockScores, 0.51, 'less').pValue }));
  const holm = new Map(holmStepDown(raw.map((entry) => ({ id: entry.row.strategyId,
    pValue: entry.admission })), ORDERED_FULL_PSRO_ADMISSION_ALPHA).map((entry) => [entry.id, entry]));
  return raw.map((entry): ConfirmationCandidateDecision => {
    const adjusted = holm.get(entry.row.strategyId)!;
    const retired = entry.retirement <= ORDERED_FULL_PSRO_RETIREMENT_ALPHA;
    const admitted = !retired && adjusted.rejected;
    return { strategyId: entry.row.strategyId, blocks: entry.row.blockScores.length,
      mean: mean(entry.row.blockScores), bounds95: anytimeConfidenceBounds(entry.row.blockScores),
      admissionPValue: entry.admission, adjustedAdmissionPValue: adjusted.adjustedPValue,
      retirementPValue: entry.retirement,
      decision: retired ? 'retired' : admitted ? 'admitted' : finalLook ? 'unresolved' : 'continue' };
  }).sort((left, right) => compareUtf16(left.strategyId, right.strategyId));
}

export interface ShadowEquivalentClass extends AcquisitionEquivalentClass {
  activeRepresentativeId: string;
}
export interface CollapsedAdmissions {
  representatives: FullCandidateEvidence[];
  shadows: ShadowEquivalentClass[];
  retainedShadowIds: string[];
  divergedShadowIds: string[];
}

export function shadowAnchorSyntheticId(input: {
  run: 1 | 2; scan: number; representativeId: string; blocks: number;
}): string {
  if (!ORDERED_FULL_PSRO_RUNS.includes(input.run) || !Number.isSafeInteger(input.scan) || input.scan < 0
    || input.scan >= ORDERED_FULL_PSRO_SCAN_CAP || !input.representativeId
    || !ORDERED_FULL_PSRO_CONFIRMATION_LOOKS.includes(input.blocks as never)) {
    throw new Error('Shadow anchor identity input is invalid.');
  }
  return `shadow-anchor-${stableHash(JSON.stringify(input))}`;
}

export function collapseAcquisitionEquivalentAdmissions(input: {
  evidence: readonly FullCandidateEvidence[];
  admittedIds: ReadonlySet<string>;
  existingShadows: readonly ShadowEquivalentClass[];
  anchorEvidence: ReadonlyMap<string, FullCandidateEvidence>;
}): CollapsedAdmissions {
  const shadowById = new Map(input.existingShadows.flatMap((group) => group.shadowIds.map((id) => [id, group])));
  const retainedShadowIds: string[] = [], divergedShadowIds: string[] = [], newEvidence: FullCandidateEvidence[] = [];
  for (const evidence of input.evidence) {
    const existing = shadowById.get(evidence.strategy.id);
    if (!existing) {
      if (input.admittedIds.has(evidence.strategy.id)) newEvidence.push(evidence);
      continue;
    }
    const anchor = input.anchorEvidence.get(`${existing.activeRepresentativeId}:${evidence.blocks.length}`);
    if (!anchor) throw new Error(`Missing shadow anchor ${existing.activeRepresentativeId}:${evidence.blocks.length}.`);
    if (completeAcquisitionEvidenceKey(anchor) === completeAcquisitionEvidenceKey(evidence)) {
      retainedShadowIds.push(evidence.strategy.id);
    } else {
      divergedShadowIds.push(evidence.strategy.id);
      if (input.admittedIds.has(evidence.strategy.id)) newEvidence.push(evidence);
    }
  }
  const classes = acquisitionEquivalentClasses(newEvidence);
  const byId = new Map(newEvidence.map((entry) => [entry.strategy.id, entry]));
  return { representatives: classes.map((group) => byId.get(group.representativeId)!),
    shadows: classes.filter((group) => group.shadowIds.length).map((group) => ({ ...group,
      activeRepresentativeId: group.representativeId })), retainedShadowIds: retainedShadowIds.sort(compareUtf16),
    divergedShadowIds: divergedShadowIds.sort(compareUtf16) };
}

export type FullPsroStopReason = 'running' | 'protocol-closure' | 'screen-width-unresolved'
  | 'confirmation-width-unresolved' | 'confirmation-unresolved' | 'matrix-width-unresolved'
  | 'matrix-precision-unresolved' | 'scan-cap-unresolved' | 'support-width-unresolved'
  | 'acquisition-panel-unresolved';
export interface FullPsroState {
  scan: number;
  matrixDepth: 50 | 100 | 200;
  cleanAtDepth: number;
  status: 'running' | 'complete' | 'unresolved';
  stopReason: FullPsroStopReason;
}
export function initialFullPsroState(): FullPsroState {
  return { scan: 0, matrixDepth: 50, cleanAtDepth: 0, status: 'running', stopReason: 'running' };
}
export function transitionFullPsroState(state: FullPsroState, input: {
  representativeAdmissions: number; unresolved: number; precisionStable?: boolean;
}): FullPsroState {
  if (state.status !== 'running') throw new Error('Terminal full PSRO state cannot transition.');
  const scan = state.scan + 1;
  if (input.unresolved) return { ...state, scan, status: 'unresolved', stopReason: 'confirmation-unresolved' };
  if (input.representativeAdmissions) {
    if (scan >= ORDERED_FULL_PSRO_SCAN_CAP) return { ...state, scan, cleanAtDepth: 0,
      status: 'unresolved', stopReason: 'scan-cap-unresolved' };
    return { ...state, scan, cleanAtDepth: 0 };
  }
  if (state.matrixDepth === 50) return { ...state, scan, matrixDepth: 100, cleanAtDepth: 0 };
  const cleanAtDepth = state.cleanAtDepth + 1;
  if (cleanAtDepth < 2) return scan >= ORDERED_FULL_PSRO_SCAN_CAP
    ? { ...state, scan, cleanAtDepth, status: 'unresolved', stopReason: 'scan-cap-unresolved' }
    : { ...state, scan, cleanAtDepth };
  if (input.precisionStable === undefined) throw new Error('Matrix precision decision is missing.');
  if (input.precisionStable) return { ...state, scan, cleanAtDepth, status: 'complete', stopReason: 'protocol-closure' };
  if (state.matrixDepth === 100) return scan >= ORDERED_FULL_PSRO_SCAN_CAP
    ? { ...state, scan, cleanAtDepth, status: 'unresolved', stopReason: 'scan-cap-unresolved' }
    : { ...state, scan, matrixDepth: 200, cleanAtDepth: 0 };
  return { ...state, scan, cleanAtDepth, status: 'unresolved', stopReason: 'matrix-precision-unresolved' };
}

export interface OrderedFullPsroCheckpoint {
  schemaVersion: 1;
  experiment: 'ordered-reservoir-full-psro-checkpoint';
  version: typeof ORDERED_FULL_PSRO_VERSION;
  run: 1 | 2;
  kingdomId: 'deep-beam-tuning-009';
  rulesFingerprint: string;
  reservoirHash: string;
  poolHash: string;
  sourceRankedSha256: string;
  protocol: OrderedFullPsroProtocol;
  state: FullPsroState;
  activeStrategyIds: string[];
  shadowClasses: ShadowEquivalentClass[];
  matrixEvidenceHash: string;
  scanEvidenceHashes: string[];
  panelEvidenceHashes: string[];
  auditEvidenceHashes: string[];
  terminalEvidenceHash: string | null;
  elapsedMs: number;
  evidenceHash: string;
}
function checkpointHash(value: Omit<OrderedFullPsroCheckpoint, 'evidenceHash' | 'elapsedMs'>): string {
  return stableHash(JSON.stringify(value));
}
export function createOrderedFullPsroCheckpoint(
  input: Omit<OrderedFullPsroCheckpoint, 'schemaVersion' | 'experiment' | 'version' | 'protocol' | 'evidenceHash'>
): OrderedFullPsroCheckpoint {
  const base = { schemaVersion: 1 as const, experiment: 'ordered-reservoir-full-psro-checkpoint' as const,
    version: ORDERED_FULL_PSRO_VERSION, protocol: { ...ORDERED_FULL_PSRO_PROTOCOL }, ...input };
  const held = structuredClone(base) as Partial<typeof base>; delete held.elapsedMs;
  return { ...base, evidenceHash: checkpointHash(
    held as Omit<OrderedFullPsroCheckpoint, 'evidenceHash' | 'elapsedMs'>) };
}
export function validateOrderedFullPsroCheckpoint(value: unknown): value is OrderedFullPsroCheckpoint {
  try {
    if (!value || typeof value !== 'object') return false;
    const held = value as OrderedFullPsroCheckpoint;
    if (held.schemaVersion !== 1 || held.experiment !== 'ordered-reservoir-full-psro-checkpoint'
      || held.version !== ORDERED_FULL_PSRO_VERSION || !ORDERED_FULL_PSRO_RUNS.includes(held.run)
      || held.kingdomId !== 'deep-beam-tuning-009' || !/^[0-9a-f]{9,}$/.test(held.rulesFingerprint)
      || JSON.stringify(held.protocol) !== JSON.stringify(ORDERED_FULL_PSRO_PROTOCOL)
      || new Set(held.activeStrategyIds).size !== held.activeStrategyIds.length
      || held.activeStrategyIds.length > ORDERED_FULL_PSRO_MATRIX_WIDTH
      || !Array.isArray(held.shadowClasses) || !Array.isArray(held.scanEvidenceHashes)
      || !Array.isArray(held.panelEvidenceHashes) || !Array.isArray(held.auditEvidenceHashes)
      || held.auditEvidenceHashes.length > 5 || held.scanEvidenceHashes.length !== held.state.scan
      || (held.state.status === 'unresolved') !== (typeof held.terminalEvidenceHash === 'string')
      || (held.terminalEvidenceHash !== null && !held.terminalEvidenceHash)
      || !Number.isFinite(held.elapsedMs) || held.elapsedMs < 0) return false;
    const active = new Set(held.activeStrategyIds), shadows = new Set<string>();
    for (const group of held.shadowClasses) {
      if (!active.has(group.activeRepresentativeId) || group.representativeId !== group.activeRepresentativeId
        || group.memberIds[0] !== group.representativeId || !group.shadowIds.length
        || group.shadowIds.some((id) => active.has(id) || shadows.has(id) || !group.memberIds.includes(id))) return false;
      group.shadowIds.forEach((id) => shadows.add(id));
    }
    const copy = structuredClone(held) as Partial<OrderedFullPsroCheckpoint>; delete copy.evidenceHash; delete copy.elapsedMs;
    return held.evidenceHash === checkpointHash(copy as Omit<OrderedFullPsroCheckpoint, 'evidenceHash' | 'elapsedMs'>);
  } catch { return false; }
}

export function validateOrderedFullPsroCheckpointIdentity(checkpoint: unknown, expected: {
  run: 1 | 2; kingdomId: 'deep-beam-tuning-009'; rulesFingerprint: string;
  reservoirHash: string; poolHash: string; sourceRankedSha256: string;
}): checkpoint is OrderedFullPsroCheckpoint {
  return validateOrderedFullPsroCheckpoint(checkpoint) && checkpoint.run === expected.run
    && checkpoint.kingdomId === expected.kingdomId
    && checkpoint.rulesFingerprint === expected.rulesFingerprint
    && checkpoint.reservoirHash === expected.reservoirHash && checkpoint.poolHash === expected.poolHash
    && checkpoint.sourceRankedSha256 === expected.sourceRankedSha256;
}

export interface DeepValidatedResumeTransition {
  scan: number;
  summaryHash: string;
  childHashes: string[];
  stateBefore: FullPsroState;
  stateAfter: FullPsroState;
  activeStrategyIdsBefore: string[];
  activeStrategyIdsAfter: string[];
  shadowClassesBefore: ShadowEquivalentClass[];
  shadowClassesAfter: ShadowEquivalentClass[];
}

export function validateOrderedFullPsroResumeChain(input: {
  checkpoint: OrderedFullPsroCheckpoint;
  initialActiveStrategyIds: readonly string[];
  transitions: readonly DeepValidatedResumeTransition[];
}): boolean {
  try {
    if (!validateOrderedFullPsroCheckpoint(input.checkpoint)
      || input.transitions.length !== input.checkpoint.scanEvidenceHashes.length) return false;
    let state = initialFullPsroState();
    let active = [...input.initialActiveStrategyIds].sort(compareUtf16);
    let shadows: ShadowEquivalentClass[] = [];
    const childHashes = new Set<string>();
    for (let index = 0; index < input.transitions.length; index += 1) {
      const step = input.transitions[index]!;
      if (step.scan !== index || step.summaryHash !== input.checkpoint.scanEvidenceHashes[index]
        || !step.childHashes.length || step.childHashes.some((hash) => !hash || childHashes.has(hash))
        || JSON.stringify(step.stateBefore) !== JSON.stringify(state)
        || JSON.stringify(step.activeStrategyIdsBefore) !== JSON.stringify(active)
        || JSON.stringify(step.shadowClassesBefore) !== JSON.stringify(shadows)) return false;
      step.childHashes.forEach((hash) => childHashes.add(hash));
      state = step.stateAfter; active = [...step.activeStrategyIdsAfter]; shadows = structuredClone(step.shadowClassesAfter);
      if (state.scan !== index + 1 || new Set(active).size !== active.length
        || active.length > ORDERED_FULL_PSRO_MATRIX_WIDTH) return false;
    }
    return JSON.stringify(state) === JSON.stringify(input.checkpoint.state)
      && JSON.stringify(active) === JSON.stringify(input.checkpoint.activeStrategyIds)
      && JSON.stringify(shadows) === JSON.stringify(input.checkpoint.shadowClasses);
  } catch { return false; }
}

export function strategyMap(strategies: readonly Strategy[]): Map<string, Strategy> {
  const map = new Map<string, Strategy>();
  for (const strategy of strategies) {
    const held = map.get(strategy.id);
    if (held && canonicalStrategy(held) !== canonicalStrategy(strategy)) throw new Error(`Strategy collision ${strategy.id}.`);
    map.set(strategy.id, strategy);
  }
  return map;
}
