import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { canonicalStrategySearchJson, deriveStrategySearch } from './strategySearchCampaign';
import type { KingdomEvidenceIdentity, SourceImageIdentity } from './strategySearchCampaign';
import { strategySearchKingdoms } from './strategySearchKingdoms';

export const PSRO_MODAL_ROUTE = 'psro-batch-v1' as const;
export const PSRO_MODAL_CPU_USD_PER_CORE_SECOND = 0.0000131;
export const PSRO_MODAL_MEMORY_USD_PER_GIB_SECOND = 0.00000222;
export const PSRO_MODAL_HARD_COST_CAP_USD = 100;
export const PSRO_MODAL_MEMORY_MIB = 8192;
export const PSRO_MODAL_MIN_WALL_SECONDS = 300;
export const PSRO_MODAL_MAX_WALL_SECONDS = 21_600;
export const PSRO_MODAL_TIMEOUT_MARGIN_SECONDS = 60;
export const PSRO_MODAL_ATTEMPT_MARGIN_SECONDS = 120;
export const PSRO_MODAL_SCALEDOWN_SECONDS = 10;
export const PSRO_MODAL_READINESS_RESERVATION_USD = 180
  * (PSRO_MODAL_CPU_USD_PER_CORE_SECOND + 2 * PSRO_MODAL_MEMORY_USD_PER_GIB_SECOND)
  + 120 * (PSRO_MODAL_CPU_USD_PER_CORE_SECOND + 4 * PSRO_MODAL_MEMORY_USD_PER_GIB_SECOND);
export const PSRO_INPUT_RELATIVES = ['goldfish/top-500000.hgf', 'goldfish/reservoir.hgf',
  'matrix/pairs.hgm', 'matrix/purchases.hgm', 'matrix/matrix.hgm',
  'matrix/self-play-v1.hst'] as const;
export const PSRO_DOWNLOAD_EXCLUSIONS = new Set(['lease.json', 'progress.json', 'job-report.json']);

const registeredKingdoms = new Set(strategySearchKingdoms.map((kingdom) => kingdom.id));
const identifier = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const sha = z.string().regex(/^[0-9a-f]{64}$/u);
export const psroModalRequestSchema = z.object({
  kingdomIds: z.array(identifier).min(1),
  workerCores: z.number().int().safe().min(1).max(64),
  maxActiveCpus: z.number().int().safe().min(1),
  maxWallSecondsPerKingdom: z.number().int().safe().min(PSRO_MODAL_MIN_WALL_SECONDS)
    .max(PSRO_MODAL_MAX_WALL_SECONDS),
  maxCostUsd: z.number().positive().finite().max(PSRO_MODAL_HARD_COST_CAP_USD)
}).strict().superRefine((request, context) => {
  if (new Set(request.kingdomIds).size !== request.kingdomIds.length) {
    context.addIssue({ code: 'custom', path: ['kingdomIds'], message: 'Kingdom IDs must be unique.' });
  }
  request.kingdomIds.forEach((kingdomId, index) => {
    if (!registeredKingdoms.has(kingdomId)) context.addIssue({ code: 'custom', path: ['kingdomIds', index],
      message: `Unknown registered kingdom ${kingdomId}.` });
  });
  if (request.maxActiveCpus < request.workerCores) context.addIssue({ code: 'custom',
    path: ['maxActiveCpus'], message: 'maxActiveCpus must fit one complete worker.' });
});
export type PsroModalRequest = z.infer<typeof psroModalRequestSchema>;

export function parsePsroModalRequest(value: unknown): PsroModalRequest {
  return psroModalRequestSchema.parse(value);
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export type PsroInputHashes = Record<string, Record<typeof PSRO_INPUT_RELATIVES[number], string>>;

function validateInputHashes(input: unknown, evidenceIds: readonly string[]): PsroInputHashes {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('PSRO input hashes are malformed.');
  const held = input as Record<string, unknown>;
  if (Object.keys(held).length !== evidenceIds.length || evidenceIds.some((evidenceId) => !(evidenceId in held))) {
    throw new Error('PSRO input hash evidence IDs differ from the request.');
  }
  const inputSchema = z.object({ 'goldfish/top-500000.hgf': sha, 'goldfish/reservoir.hgf': sha,
    'matrix/pairs.hgm': sha, 'matrix/purchases.hgm': sha, 'matrix/matrix.hgm': sha,
    'matrix/self-play-v1.hst': sha }).strict();
  return Object.fromEntries(evidenceIds.map((evidenceId) =>
    [evidenceId, inputSchema.parse(held[evidenceId])])) as PsroInputHashes;
}

export interface PsroModalCostGuard {
  cpuUsdPerCoreSecond: typeof PSRO_MODAL_CPU_USD_PER_CORE_SECOND;
  memoryUsdPerGibSecond: typeof PSRO_MODAL_MEMORY_USD_PER_GIB_SECOND;
  hardMaximumCostUsd: typeof PSRO_MODAL_HARD_COST_CAP_USD;
  requestedMaximumCostUsd: number;
  attemptBoundUsd: number;
  launchAttemptBoundUsd: number;
  readinessReservationUsd: typeof PSRO_MODAL_READINESS_RESERVATION_USD;
  launchBoundUsd: number;
}

export function psroAttemptBoundUsd(request: PsroModalRequest): number {
  return (request.workerCores * PSRO_MODAL_CPU_USD_PER_CORE_SECOND
    + PSRO_MODAL_MEMORY_MIB / 1024 * PSRO_MODAL_MEMORY_USD_PER_GIB_SECOND)
    * (request.maxWallSecondsPerKingdom + PSRO_MODAL_ATTEMPT_MARGIN_SECONDS);
}

export interface ParsedPsroModalPlan {
  request: PsroModalRequest;
  sourceImage: SourceImageIdentity;
  kingdoms: KingdomEvidenceIdentity[];
  inputSha256: PsroInputHashes;
  slots: number;
  unusedCpuCapacity: number;
  functionTimeoutSeconds: number;
  costGuard: PsroModalCostGuard;
  executionId: string;
  authorizationToken: string;
}

export function derivePsroModalPlan(input: { request: unknown; sourceImage: SourceImageIdentity;
  inputSha256: unknown }): ParsedPsroModalPlan {
  const request = parsePsroModalRequest(input.request);
  const scientific = deriveStrategySearch({ request: { kingdomIds: request.kingdomIds,
    maxActiveCpus: request.maxActiveCpus }, sourceImage: input.sourceImage });
  const evidenceIds = scientific.kingdoms.map((kingdom) => kingdom.evidenceId);
  const inputSha256 = validateInputHashes(input.inputSha256, evidenceIds);
  const slots = Math.floor(request.maxActiveCpus / request.workerCores);
  const attemptBoundUsd = psroAttemptBoundUsd(request);
  const launchAttemptBoundUsd = attemptBoundUsd * request.kingdomIds.length;
  const costGuard: PsroModalCostGuard = { cpuUsdPerCoreSecond: PSRO_MODAL_CPU_USD_PER_CORE_SECOND,
    memoryUsdPerGibSecond: PSRO_MODAL_MEMORY_USD_PER_GIB_SECOND,
    hardMaximumCostUsd: PSRO_MODAL_HARD_COST_CAP_USD, requestedMaximumCostUsd: request.maxCostUsd,
    attemptBoundUsd, launchAttemptBoundUsd,
    readinessReservationUsd: PSRO_MODAL_READINESS_RESERVATION_USD,
    launchBoundUsd: launchAttemptBoundUsd + PSRO_MODAL_READINESS_RESERVATION_USD };
  if (costGuard.launchBoundUsd > request.maxCostUsd) throw new Error(
    `PSRO launch bound $${costGuard.launchBoundUsd.toFixed(6)} exceeds request limit $${request.maxCostUsd.toFixed(6)}.`);
  const executionId = digest(canonicalStrategySearchJson({ route: PSRO_MODAL_ROUTE,
    scientificDigest: input.sourceImage.scientificDigest, orderedEvidenceIds: evidenceIds,
    inputSha256, workerCores: request.workerCores }));
  const authorizationToken = `${PSRO_MODAL_ROUTE}.${digest(canonicalStrategySearchJson({ request,
    deploymentDigest: input.sourceImage.digest, orderedEvidenceIds: evidenceIds,
    inputSha256, executionId, costGuard }))}`;
  return { request, sourceImage: structuredClone(input.sourceImage), kingdoms: scientific.kingdoms,
    inputSha256, slots, unusedCpuCapacity: request.maxActiveCpus - slots * request.workerCores,
    functionTimeoutSeconds: request.maxWallSecondsPerKingdom + PSRO_MODAL_TIMEOUT_MARGIN_SECONDS,
    costGuard, executionId, authorizationToken };
}

export function validatePsroModalAuthorizationToken(token: string, plan: ParsedPsroModalPlan): boolean {
  const left = Buffer.from(token), right = Buffer.from(plan.authorizationToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface PsroModalPlanSummary {
  route: typeof PSRO_MODAL_ROUTE;
  paidExecution: false;
  executionId: string;
  orderedEvidenceIds: string[];
  slots: number;
  unusedCpuCapacity: number;
  resources: { workerCores: number; memoryMiB: typeof PSRO_MODAL_MEMORY_MIB };
  timeouts: { maximumWallSecondsPerKingdom: number; functionTimeoutSeconds: number };
  costGuard: PsroModalCostGuard;
  authorizationToken: string;
}

export function createPsroModalPlanSummary(plan: ParsedPsroModalPlan): PsroModalPlanSummary {
  return { route: PSRO_MODAL_ROUTE, paidExecution: false, executionId: plan.executionId,
    orderedEvidenceIds: plan.kingdoms.map((kingdom) => kingdom.evidenceId), slots: plan.slots,
    unusedCpuCapacity: plan.unusedCpuCapacity,
    resources: { workerCores: plan.request.workerCores, memoryMiB: PSRO_MODAL_MEMORY_MIB },
    timeouts: { maximumWallSecondsPerKingdom: plan.request.maxWallSecondsPerKingdom,
      functionTimeoutSeconds: plan.functionTimeoutSeconds }, costGuard: structuredClone(plan.costGuard),
    authorizationToken: plan.authorizationToken };
}

export type PsroAttemptStatus = 'launching' | 'unknown' | 'pending' | 'complete' | 'failed' | 'abandoned';
export interface PsroExecutionAttempt {
  kingdomId: string;
  evidenceId: string;
  launchId: string;
  deploymentDigest: string;
  remoteOutPath: string;
  boundUsd: number;
  callId: string | null;
  status: PsroAttemptStatus;
  createdEpochMs: number;
  spawnEpochMs?: number;
  measuredCostUsd?: number;
  result?: Record<string, unknown>;
  error?: string;
}
export interface PsroRunReservation {
  runId: string;
  deploymentDigest: string;
  reservedUsd: number;
  createdEpochMs: number;
}
export interface PsroExecutionState {
  protocol: 'modal-psro-execution-state-v1';
  executionId: string;
  attempts: PsroExecutionAttempt[];
  runReservations: PsroRunReservation[];
}

export function createPsroExecutionState(executionId: string): PsroExecutionState {
  sha.parse(executionId);
  return { protocol: 'modal-psro-execution-state-v1', executionId, attempts: [], runReservations: [] };
}

export function psroLedgerEntries(state: PsroExecutionState): Array<Record<string, unknown>> {
  return [...state.runReservations.map((entry) => ({ type: 'readiness', id: entry.runId,
    costUsd: entry.reservedUsd, basis: 'reserved' })), ...state.attempts.map((entry) => ({ type: 'attempt',
    id: entry.launchId, kingdomId: entry.kingdomId,
    costUsd: entry.measuredCostUsd ?? entry.boundUsd,
    basis: entry.measuredCostUsd === undefined ? 'reserved' : 'measured', status: entry.status }))];
}

export function psroLedgerTotalUsd(state: PsroExecutionState): number {
  return psroLedgerEntries(state).reduce((sum, entry) => sum + Number(entry.costUsd), 0);
}

function requireLedgerRoom(state: PsroExecutionState, amount: number, maximum: number): void {
  if (psroLedgerTotalUsd(state) + amount > maximum + Number.EPSILON) {
    throw new Error(`PSRO ledger would exceed maxCostUsd ${maximum}.`);
  }
}

export function reservePsroRun(state: PsroExecutionState, input: { runId: string;
  deploymentDigest: string; maxCostUsd: number; now?: number }): void {
  if (state.runReservations.some((entry) => entry.runId === input.runId)) return;
  requireLedgerRoom(state, PSRO_MODAL_READINESS_RESERVATION_USD, input.maxCostUsd);
  state.runReservations.push({ runId: input.runId, deploymentDigest: input.deploymentDigest,
    reservedUsd: PSRO_MODAL_READINESS_RESERVATION_USD, createdEpochMs: input.now ?? Date.now() });
}

export function pendingPsroAttempts(state: PsroExecutionState): PsroExecutionAttempt[] {
  return state.attempts.filter((attempt) => attempt.status === 'pending');
}

export function latestPsroAttempt(state: PsroExecutionState, kingdomId: string): PsroExecutionAttempt | undefined {
  return state.attempts.filter((attempt) => attempt.kingdomId === kingdomId).at(-1);
}

export function abandonPsroLaunch(state: PsroExecutionState, launchId: string): void {
  const attempt = state.attempts.find((entry) => entry.launchId === launchId);
  if (!attempt || !['launching', 'unknown'].includes(attempt.status) || attempt.callId !== null) {
    throw new Error(`PSRO launch ${launchId} cannot be abandoned.`);
  }
  attempt.status = 'abandoned';
}

export function adoptPsroLease(state: PsroExecutionState, input: { launchId: string; callId: string }): void {
  const attempt = state.attempts.find((entry) => entry.launchId === input.launchId);
  if (!attempt || attempt.callId !== null || !['launching', 'unknown'].includes(attempt.status)) {
    throw new Error(`PSRO launch ${input.launchId} cannot adopt a lease.`);
  }
  attempt.callId = input.callId;
  attempt.status = 'pending';
}

export function recordPsroAttemptResult(attempt: PsroExecutionAttempt, input: { status: 'complete' | 'failed';
  measuredCostUsd?: number; result?: Record<string, unknown>; error?: string }): void {
  attempt.status = input.status;
  if (input.measuredCostUsd !== undefined) attempt.measuredCostUsd = input.measuredCostUsd;
  if (input.result) attempt.result = structuredClone(input.result);
  if (input.error) attempt.error = input.error;
}

export function selectPsroLaunches(input: { state: PsroExecutionState; plan: ParsedPsroModalPlan;
  deploymentDigest: string; launchId: (kingdomId: string) => string; now?: number }): PsroExecutionAttempt[] {
  const pending = pendingPsroAttempts(input.state);
  if (pending.some((attempt) => attempt.deploymentDigest !== input.deploymentDigest)) {
    throw new Error('Pending PSRO calls use a different deployment digest.');
  }
  let capacity = input.plan.slots - pending.length;
  if (capacity <= 0) return [];
  const launches: PsroExecutionAttempt[] = [];
  for (const kingdom of input.plan.kingdoms) {
    if (capacity <= 0) break;
    const latest = latestPsroAttempt(input.state, kingdom.kingdomId);
    if (latest?.status === 'complete' || latest?.status === 'pending') continue;
    if (latest && ['launching', 'unknown'].includes(latest.status)) {
      latest.status = 'unknown';
      continue;
    }
    requireLedgerRoom(input.state, input.plan.costGuard.attemptBoundUsd,
      input.plan.request.maxCostUsd);
    const launchId = input.launchId(kingdom.kingdomId);
    if (input.state.attempts.some((attempt) => attempt.launchId === launchId)) {
      throw new Error(`Duplicate PSRO launch ID ${launchId}.`);
    }
    const attempt: PsroExecutionAttempt = { kingdomId: kingdom.kingdomId,
      evidenceId: kingdom.evidenceId, launchId, deploymentDigest: input.deploymentDigest,
      remoteOutPath: `psro-executions/${input.plan.executionId}/${kingdom.evidenceId}`,
      boundUsd: input.plan.costGuard.attemptBoundUsd, callId: null, status: 'launching',
      createdEpochMs: input.now ?? Date.now() };
    input.state.attempts.push(attempt);
    launches.push(attempt);
    capacity -= 1;
  }
  return launches;
}

export function selectPsroDownloadFiles(paths: readonly string[]): string[] {
  return [...paths].filter((held) => !PSRO_DOWNLOAD_EXCLUSIONS.has(path.posix.basename(held))).sort();
}

export interface ScientificFileComparison {
  path: string;
  identical: boolean;
  leftSha256?: string;
  rightSha256?: string;
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const held = path.join(directory, name), stat = fs.lstatSync(held);
      if (stat.isDirectory()) visit(held);
      else if (stat.isFile()) files.push(path.relative(root, held).split(path.sep).join('/'));
    }
  };
  visit(root);
  return files;
}

export function comparePsroScientificFiles(left: string, right: string): ScientificFileComparison[] {
  const scientific = (file: string): boolean => /(?:\.h(?:pl|pa|pc|pd|gm|st)|^run-report\.json$)/u.test(file);
  const paths = [...new Set([...walkFiles(left), ...walkFiles(right)].filter(scientific))].sort();
  return paths.map((relative) => {
    const leftFile = path.join(left, relative), rightFile = path.join(right, relative);
    const leftSha256 = fs.existsSync(leftFile) ? digest(fs.readFileSync(leftFile)) : undefined;
    const rightSha256 = fs.existsSync(rightFile) ? digest(fs.readFileSync(rightFile)) : undefined;
    return { path: relative, identical: leftSha256 !== undefined && leftSha256 === rightSha256,
      ...(leftSha256 ? { leftSha256 } : {}), ...(rightSha256 ? { rightSha256 } : {}) };
  });
}

function fileSha256(file: string): string { return digest(fs.readFileSync(file)); }

export interface PsroBatchReport {
  protocol: 'routine-psro-batch-report-v1';
  confirmedQueueCap: 100;
  stoppingRule: 'two-consecutive-clean-full-searches';
  allValid: boolean;
  missingKingdomIds: string[];
  kingdoms: Array<{ kingdomId: string; reportPath: string; reportSha256: string;
    searches: number; admissions: number; finalMatrixSize: number; cleanFinalSearches: 2 }>;
}

export function buildPsroBatchReport(root: string): PsroBatchReport {
  const rows = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const reportFile = path.join(root, entry.name, 'psro', 'run-report.json');
      if (!fs.existsSync(reportFile)) return [];
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Record<string, unknown>;
      for (const field of ['searches', 'admissions', 'finalMatrixSize'] as const) {
        if (!Number.isSafeInteger(report[field]) || Number(report[field]) < 0) {
          throw new Error(`${reportFile}: ${field} is invalid.`);
        }
      }
      return [{ kingdomId: entry.name,
        reportPath: path.relative(root, reportFile).split(path.sep).join('/'),
        reportSha256: fileSha256(reportFile), searches: Number(report.searches),
        admissions: Number(report.admissions), finalMatrixSize: Number(report.finalMatrixSize),
        cleanFinalSearches: 2 as const }];
    }).sort((left, right) => left.kingdomId.localeCompare(right.kingdomId));
  return { protocol: 'routine-psro-batch-report-v1', confirmedQueueCap: 100,
    stoppingRule: 'two-consecutive-clean-full-searches', allValid: rows.length > 0,
    missingKingdomIds: [], kingdoms: rows };
}

export interface MatrixBatchRow { kingdomId: string; reportPath: string; reportSha256: string;
  strategyCount: number; gameCount: number }
export interface MatrixBatchReport { protocol: 'routine-matrix-batch-report-v1'; allValid: boolean;
  missingKingdomIds: string[]; kingdoms: MatrixBatchRow[] }

export function buildMatrixBatchReport(root: string, rows: readonly Omit<MatrixBatchRow,
  'reportPath' | 'reportSha256'>[]): MatrixBatchReport {
  const kingdoms = rows.map((row) => {
    const reportFile = path.join(root, 'logs', `${row.kingdomId}-matrix-report.json`);
    return { ...row, reportPath: path.relative(root, reportFile).split(path.sep).join('/'),
      reportSha256: fileSha256(reportFile) };
  }).sort((left, right) => left.kingdomId.localeCompare(right.kingdomId));
  return { protocol: 'routine-matrix-batch-report-v1', allValid: kingdoms.length > 0,
    missingKingdomIds: [], kingdoms };
}
