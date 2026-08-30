import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { deriveTrackedStrategySearchSourceImage, streamProcess } from './strategy_search_source';
import { deriveStrategySearch } from '../src/sim/strategySearchCampaign';
import { loadRustInitialMatrixEvidence, loadRustStrategySearchKingdomEvidence } from '../src/sim/rustStrategySearchEvidence';
import {
  abandonPsroLaunch, buildMatrixBatchReport, buildPsroBatchReport, comparePsroScientificFiles,
  createPsroExecutionState, createPsroModalPlanSummary, derivePsroModalPlan, latestPsroAttempt,
  parsePsroModalRequest, pendingPsroAttempts, psroLedgerEntries, psroLedgerTotalUsd, PSRO_INPUT_RELATIVES,
  PSRO_MODAL_MEMORY_MIB, recordPsroAttemptResult, reservePsroRun, selectPsroLaunches,
  validatePsroModalAuthorizationToken
} from '../src/sim/strategySearchPsroModal';
import type {
  ParsedPsroModalPlan, PsroExecutionAttempt, PsroExecutionState, PsroModalRequest
} from '../src/sim/strategySearchPsroModal';

const RUNTIME = 'modal/strategy_search_psro_runtime.py';
const COMPUTE_MODULE = 'modal/native_strategy_search.py';
const POLL_SECONDS = 15;

export function psroStatusTimeoutMs(attemptCount: number): number {
  return 120_000 + 1_000 * attemptCount;
}

export function psroLaunchTimeoutMs(kingdomCount: number): number {
  return 300_000 + 5_000 * kingdomCount;
}

export function psroDownloadTimeoutMs(kingdomCount: number): number {
  return 600_000 + 10_000 * kingdomCount;
}

function writeAtomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const descriptor = fs.openSync(temporary, 'w');
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function regularFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`PSRO input is not a regular file: ${file}`);
}

function binary(root = process.cwd()): string {
  const file = process.env.HEXDECK_GOLDFISH_BIN ?? path.join(root, 'rust', 'target', 'release', 'hexdeck-goldfish');
  regularFile(file);
  fs.accessSync(file, fs.constants.X_OK);
  return file;
}

function readRequest(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

export function derivePsroPlanFromDisk(requestFile: string, evidenceRoot: string,
  projectRoot = process.cwd()): ParsedPsroModalPlan {
  const request = parsePsroModalRequest(readRequest(requestFile));
  const sourceImage = deriveTrackedStrategySearchSourceImage(projectRoot);
  const scientific = derivePsroModalPlanInputs(request, sourceImage, evidenceRoot);
  return derivePsroModalPlan({ request, sourceImage, inputSha256: scientific });
}

function derivePsroModalPlanInputs(request: PsroModalRequest, sourceImage: ReturnType<typeof deriveTrackedStrategySearchSourceImage>,
  evidenceRoot: string): Record<string, Record<string, string>> {
  const identity = derivePsroModalPlanIdentities(request, sourceImage);
  return Object.fromEntries(identity.map((kingdom) => [kingdom.evidenceId,
    Object.fromEntries(PSRO_INPUT_RELATIVES.map((relative) => {
      const file = path.join(evidenceRoot, kingdom.kingdomId, relative);
      regularFile(file);
      return [relative, sha256File(file)];
    }))]));
}

function derivePsroModalPlanIdentities(request: PsroModalRequest,
  sourceImage: ReturnType<typeof deriveTrackedStrategySearchSourceImage>) {
  return deriveStrategySearch({ request: { kingdomIds: request.kingdomIds,
    maxActiveCpus: request.maxActiveCpus }, sourceImage }).kingdoms;
}

function reportFile(root: string, executionId: string): string {
  return path.join(root, 'modal-psro', executionId, 'report.json');
}

function stateFile(executionId: string): string {
  return path.join(os.homedir(), '.hexdeck-modal-psro', `${executionId}.json`);
}

function loadState(file: string, executionId: string): PsroExecutionState {
  if (!fs.existsSync(file)) return createPsroExecutionState(executionId);
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as PsroExecutionState;
  if (value.protocol !== 'modal-psro-execution-state-v1' || value.executionId !== executionId
    || !Array.isArray(value.attempts) || !Array.isArray(value.runReservations)) {
    throw new Error('Modal PSRO execution state is malformed.');
  }
  return value;
}

interface HeldLock { release(): Promise<void> }
async function takeExecutionLock(executionId: string): Promise<HeldLock> {
  const lock = path.join(os.homedir(), '.hexdeck-modal-psro', `${executionId}.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const code = 'import fcntl,sys\nf=open(sys.argv[1],"a+")\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nprint("locked",flush=True)\nsys.stdin.read()';
  const child = spawn('python3', ['-c', code, lock], { stdio: ['pipe', 'pipe', 'pipe'] });
  const message = await new Promise<string>((resolve, reject) => {
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.includes('\n')) resolve(stdout.trim()); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('exit', (status) => { if (!stdout.includes('locked')) reject(new Error(
      `Another PSRO client holds ${lock}${stderr.trim() ? `: ${stderr.trim()}` : ` (status ${status})`}.`)); });
    child.once('error', reject);
  });
  if (message !== 'locked') throw new Error(`Could not lock PSRO execution ${executionId}.`);
  return { release: async () => { child.stdin.end(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); } };
}

async function measured<T>(operation: () => Promise<T>): Promise<{ value: T; wallMs: number }> {
  const started = performance.now(), value = await operation();
  return { value, wallMs: Number((performance.now() - started).toFixed(3)) };
}

async function modalRuntime(entry: 'preflight_entry' | 'launch_entry' | 'status_entry' | 'download_entry',
  options: Record<string, string>, timeoutMs: number): Promise<Record<string, unknown>> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-runtime-'));
  const resultFile = path.join(directory, 'result.json');
  try {
    const args = ['run', `${RUNTIME}::${entry}`, ...Object.entries({ ...options, resultFile })
      .flatMap(([name, value]) => [`--${name.replace(/[A-Z]/g, (held) => `-${held.toLowerCase()}`)}`, value])];
    await streamProcess({ executable: 'modal', args, phase: `psro-${entry}`, timeoutMs });
    return JSON.parse(fs.readFileSync(resultFile, 'utf8')) as Record<string, unknown>;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function computeAppName(digest: string): string { return `hexdeck-strategy-${digest.slice(0, 24)}`; }

export interface PsroModalOperatorAdapter {
  deploy(plan: ParsedPsroModalPlan): Promise<Record<string, unknown>>;
  preflight(plan: ParsedPsroModalPlan): Promise<Record<string, unknown>>;
  launch(plan: ParsedPsroModalPlan, statePath: string, attempts: readonly PsroExecutionAttempt[],
    root: string): Promise<Record<string, unknown>>;
  status(statePath: string): Promise<Record<string, unknown>>;
  download(plan: ParsedPsroModalPlan, state: PsroExecutionState, root: string): Promise<Record<string, unknown>>;
}

export class ModalPsroOperatorAdapter implements PsroModalOperatorAdapter {
  async deploy(plan: ParsedPsroModalPlan): Promise<Record<string, unknown>> {
    const appName = computeAppName(plan.sourceImage.digest);
    await streamProcess({ executable: 'modal', phase: 'psro-image-deploy', timeoutMs: 900_000,
      args: ['deploy', '--name', appName, COMPUTE_MODULE] });
    return { computeAppName: appName };
  }
  async preflight(plan: ParsedPsroModalPlan): Promise<Record<string, unknown>> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-preflight-'));
    const configFile = path.join(directory, 'config.json');
    try {
      writeAtomicJson(configFile, { computeAppName: computeAppName(plan.sourceImage.digest),
        sourceImage: plan.sourceImage });
      return await modalRuntime('preflight_entry', { configFile }, 240_000);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  async launch(plan: ParsedPsroModalPlan, statePath: string, attempts: readonly PsroExecutionAttempt[],
    root: string): Promise<Record<string, unknown>> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-launch-'));
    const configFile = path.join(directory, 'config.json'), intentFile = path.join(directory, 'launch-intent.json');
    try {
      writeAtomicJson(intentFile, { protocol: 'modal-psro-launch-intent-v1', executionId: plan.executionId,
        deploymentDigest: plan.sourceImage.digest, launches: attempts.map((attempt) => ({
          kingdomId: attempt.kingdomId, evidenceId: attempt.evidenceId, launchId: attempt.launchId,
          boundUsd: attempt.boundUsd })) });
      const kingdoms = attempts.map((attempt) => {
        const evidenceRoot = `evidence/${attempt.evidenceId}`;
        const local = (relative: string) => path.join(root, attempt.kingdomId, relative);
        const inputSha256 = Object.fromEntries(PSRO_INPUT_RELATIVES.map((relative) => [
          `${evidenceRoot}/${relative}`, plan.inputSha256[attempt.evidenceId]![relative]]));
        return { kingdomId: attempt.kingdomId, launchId: attempt.launchId,
          goldfishPaths: [`${evidenceRoot}/goldfish/top-500000.hgf`, `${evidenceRoot}/goldfish/reservoir.hgf`],
          matrixUploads: ['pairs.hgm', 'purchases.hgm', 'matrix.hgm', 'self-play-v1.hst'].map((name) => ({
            localPath: local(`matrix/${name}`), remotePath: `${evidenceRoot}/matrix/${name}`,
            sha256: plan.inputSha256[attempt.evidenceId]![`matrix/${name}` as keyof typeof plan.inputSha256[string]] })),
          jobConfig: { sourceImage: plan.sourceImage, kingdomId: attempt.kingdomId,
            evidenceId: attempt.evidenceId, launchId: attempt.launchId, threads: plan.request.workerCores,
            cpu: plan.request.workerCores, memoryMiB: PSRO_MODAL_MEMORY_MIB,
            topPath: `${evidenceRoot}/goldfish/top-500000.hgf`,
            reservoirPath: `${evidenceRoot}/goldfish/reservoir.hgf`, matrixDir: `${evidenceRoot}/matrix`,
            outPath: attempt.remoteOutPath, inputSha256 } };
      });
      writeAtomicJson(configFile, { computeAppName: computeAppName(plan.sourceImage.digest),
        workerCores: plan.request.workerCores, timeoutSeconds: plan.functionTimeoutSeconds,
        slots: plan.slots, launchIntentFile: intentFile,
        launchIntentRemote: `psro-executions/${plan.executionId}/launch-intent.json`, kingdoms });
      return await modalRuntime('launch_entry', { configFile, stateFile: statePath }, psroLaunchTimeoutMs(kingdoms.length));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  async status(statePath: string): Promise<Record<string, unknown>> {
    const attemptCount = (JSON.parse(fs.readFileSync(statePath, 'utf8')) as PsroExecutionState).attempts.length;
    return modalRuntime('status_entry', { stateFile: statePath }, psroStatusTimeoutMs(attemptCount));
  }
  async download(plan: ParsedPsroModalPlan, state: PsroExecutionState,
    root: string): Promise<Record<string, unknown>> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-download-'));
    const configFile = path.join(directory, 'config.json');
    try {
      const kingdoms = plan.kingdoms.flatMap((kingdom) => {
        const attempt = latestPsroAttempt(state, kingdom.kingdomId);
        return attempt?.status === 'complete' ? [{ kingdomId: kingdom.kingdomId,
          remoteOutPath: attempt.remoteOutPath,
          destination: path.join(root, kingdom.kingdomId, 'psro') }] : [];
      });
      writeAtomicJson(configFile, { kingdoms });
      return await modalRuntime('download_entry', { configFile }, psroDownloadTimeoutMs(kingdoms.length));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}

function refreshMeasuredCosts(state: PsroExecutionState): void {
  for (const attempt of state.attempts) {
    const report = attempt.result;
    if (attempt.status === 'complete' && report && typeof report.measuredCostUsd === 'number') {
      recordPsroAttemptResult(attempt, { status: 'complete', measuredCostUsd: report.measuredCostUsd,
        result: report });
    }
  }
}

function structuralValidation(plan: ParsedPsroModalPlan, root: string, deepVerify: boolean): Record<string, unknown> {
  const started = performance.now(), executable = binary();
  const kingdoms = plan.kingdoms.flatMap((kingdom) => {
    const base = path.join(root, kingdom.kingdomId);
    if (!fs.existsSync(path.join(base, 'psro', 'run-report.json'))) return [];
    const evidence = loadRustStrategySearchKingdomEvidence({ kingdomId: kingdom.kingdomId,
      topFile: path.join(base, 'goldfish', 'top-500000.hgf'),
      reservoirFile: path.join(base, 'goldfish', 'reservoir.hgf'), initialMatrixDir: path.join(base, 'matrix'),
      psroDir: path.join(base, 'psro') }, { binary: executable });
    if (deepVerify) execFileSync(executable, ['psro-verify', '--kingdom', kingdom.kingdomId,
      '--top-file', path.join(base, 'goldfish', 'top-500000.hgf'), '--reservoir', path.join(base, 'goldfish', 'reservoir.hgf'),
      '--matrix-dir', path.join(base, 'matrix'), '--out', path.join(base, 'psro')], { stdio: 'inherit' });
    return [{ kingdomId: kingdom.kingdomId, valid: true, searches: evidence.completion.searchCount,
      admissions: evidence.completion.admissionCount, finalMatrixSize: evidence.completion.finalStrategyNumbers.length }];
  });
  return { allValid: kingdoms.length === plan.kingdoms.length, kingdoms,
    wallMs: Number((performance.now() - started).toFixed(3)) };
}

function executionReport(plan: ParsedPsroModalPlan, state: PsroExecutionState, timings: Record<string, number>,
  validation: Record<string, unknown>): Record<string, unknown> {
  const attempts = state.attempts.map((attempt) => {
    const report = attempt.result ?? {};
    const totalGames = Number(report.totalGames ?? 0), rustElapsedMs = Number(report.rustElapsedMs ?? 0);
    return { kingdomId: attempt.kingdomId, evidenceId: attempt.evidenceId, launchId: attempt.launchId,
      callId: attempt.callId, deploymentDigest: attempt.deploymentDigest,
      spawnEpochMs: attempt.spawnEpochMs, startEpochMs: report.workerStartedEpochMs,
      finishEpochMs: report.workerFinishedEpochMs,
      queueDelayMs: Number(report.workerStartedEpochMs ?? 0) - Number(attempt.spawnEpochMs ?? 0),
      jobWallMs: report.jobWallMs, rustElapsedMs, totalGames, gamesPerSecond: report.gamesPerSecond,
      gamesPerCoreSecond: rustElapsedMs > 0 ? totalGames / (rustElapsedMs / 1000) / plan.request.workerCores : 0,
      transitionCount: report.transitionCount, nonTransitionShare: report.nonTransitionShare,
      commitCount: report.commitCount, volumeCommitMs: report.volumeCommitMs, commitShare: report.commitShare,
      maxResidentSetSizeMiB: report.maxResidentSetSizeMiB,
      costUsd: attempt.measuredCostUsd ?? attempt.boundUsd,
      costBasis: attempt.measuredCostUsd === undefined ? 'reserved' : 'measured', status: attempt.status };
  });
  const starts = attempts.map((attempt) => Number(attempt.spawnEpochMs)).filter(Number.isFinite);
  const finishes = attempts.map((attempt) => Number(attempt.finishEpochMs)).filter(Number.isFinite);
  const events = attempts.flatMap((attempt) => Number.isFinite(Number(attempt.startEpochMs))
    && Number.isFinite(Number(attempt.finishEpochMs)) ? [[Number(attempt.startEpochMs), 1],
      [Number(attempt.finishEpochMs), -1]] as Array<[number, number]> : []).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0, peak = 0; for (const [, delta] of events) { active += delta; peak = Math.max(peak, active); }
  return { protocol: 'modal-psro-batch-report-v1', route: 'psro-batch-v1', executionId: plan.executionId,
    timings, attempts, structuralValidation: validation, batch: {
      makespanMs: starts.length && finishes.length ? Math.max(...finishes) - Math.min(...starts) : 0,
      peakConcurrentMachines: peak, ledgerTotalUsd: psroLedgerTotalUsd(state),
      maxCostUsd: plan.request.maxCostUsd, ledger: psroLedgerEntries(state) } };
}

async function runDownload(plan: ParsedPsroModalPlan, state: PsroExecutionState, root: string,
  adapter: PsroModalOperatorAdapter, deepVerify: boolean, compareWith?: string): Promise<Record<string, unknown>> {
  const download = await measured(() => adapter.download(plan, state, root));
  const validation = structuralValidation(plan, root, deepVerify);
  const batch = buildPsroBatchReport(root); writeAtomicJson(path.join(root, 'psro-batch-report.json'), batch);
  const comparison = compareWith ? plan.kingdoms.map((kingdom) => ({ kingdomId: kingdom.kingdomId,
    files: comparePsroScientificFiles(path.join(root, kingdom.kingdomId, 'psro'),
      path.join(compareWith, kingdom.kingdomId, 'psro')) })) : undefined;
  return { download: download.value, downloadWallMs: download.wallMs, validation,
    ...(comparison ? { comparison } : {}) };
}

export async function executePsroModalOperation(input: { operation: 'plan' | 'run' | 'status' | 'download';
  requestFile: string; root: string; authorizationToken?: string; deepVerify?: boolean;
  compareWith?: string; abandonLaunch?: string; adapter?: PsroModalOperatorAdapter;
  sleep?: (ms: number) => Promise<void> }): Promise<Record<string, unknown>> {
  const plan = derivePsroPlanFromDisk(input.requestFile, input.root);
  if (input.operation === 'plan') return { ...createPsroModalPlanSummary(plan) };
  if (input.operation === 'run' && (!input.authorizationToken
    || !validatePsroModalAuthorizationToken(input.authorizationToken, plan))) {
    throw new Error('Paid PSRO run requires the exact authorization token printed by plan.');
  }
  const adapter = input.adapter ?? new ModalPsroOperatorAdapter(), statePath = stateFile(plan.executionId);
  if (input.operation === 'status') {
    const state = loadState(statePath, plan.executionId);
    if (state.attempts.length) await adapter.status(statePath);
    const refreshed = loadState(statePath, plan.executionId); refreshMeasuredCosts(refreshed); writeAtomicJson(statePath, refreshed);
    return { executionId: plan.executionId, kingdoms: plan.kingdoms.map((kingdom) => ({ kingdomId: kingdom.kingdomId,
      state: latestPsroAttempt(refreshed, kingdom.kingdomId)?.status ?? 'queued',
      attempt: latestPsroAttempt(refreshed, kingdom.kingdomId) ?? null })),
      activeMachines: pendingPsroAttempts(refreshed).length, ledger: psroLedgerEntries(refreshed),
      ledgerTotalUsd: psroLedgerTotalUsd(refreshed), maxCostUsd: plan.request.maxCostUsd };
  }
  if (input.operation === 'download') {
    const state = loadState(statePath, plan.executionId);
    if (state.attempts.length) await adapter.status(statePath);
    const refreshed = loadState(statePath, plan.executionId); refreshMeasuredCosts(refreshed);
    const result = await runDownload(plan, refreshed, input.root, adapter, input.deepVerify ?? false, input.compareWith);
    writeAtomicJson(statePath, refreshed); return { executionId: plan.executionId, ...result };
  }

  const lock = await takeExecutionLock(plan.executionId), timings: Record<string, number> = {};
  try {
    let state = loadState(statePath, plan.executionId);
    if (state.attempts.length) { const status = await measured(() => adapter.status(statePath)); timings.resumeStatus = status.wallMs;
      state = loadState(statePath, plan.executionId); refreshMeasuredCosts(state); }
    if (input.abandonLaunch) abandonPsroLaunch(state, input.abandonLaunch);
    const runId = randomUUID();
    reservePsroRun(state, { runId, deploymentDigest: plan.sourceImage.digest,
      maxCostUsd: plan.request.maxCostUsd });
    writeAtomicJson(statePath, state);
    if (!pendingPsroAttempts(state).length) {
      const deployment = await measured(() => adapter.deploy(plan)); timings.imageBuildAndDeploy = deployment.wallMs;
      const readiness = await measured(() => adapter.preflight(plan)); timings.readinessAndCanary = readiness.wallMs;
    }
    const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let launchSequence = state.attempts.length;
    while (plan.kingdoms.some((kingdom) => latestPsroAttempt(state, kingdom.kingdomId)?.status !== 'complete')) {
      const launches = selectPsroLaunches({ state, plan, deploymentDigest: plan.sourceImage.digest,
        launchId: (kingdomId) => `${runId}-${String(++launchSequence).padStart(3, '0')}-${kingdomId}` });
      if (launches.length) {
        writeAtomicJson(statePath, state);
        const launched = await measured(() => adapter.launch(plan, statePath, launches, input.root));
        timings.launch = (timings.launch ?? 0) + launched.wallMs;
        state = loadState(statePath, plan.executionId);
      }
      const unknown = state.attempts.find((attempt) => attempt.status === 'unknown');
      if (unknown) throw new Error(`PSRO launch ${unknown.launchId} is unknown. Check Modal, then use --abandon-launch ${unknown.launchId}.`);
      if (pendingPsroAttempts(state).length) {
        await sleep(POLL_SECONDS * 1000);
        const polled = await adapter.status(statePath); void polled;
        state = loadState(statePath, plan.executionId); refreshMeasuredCosts(state); writeAtomicJson(statePath, state);
      } else if (!launches.length) throw new Error('PSRO execution has incomplete work but no launchable kingdom.');
    }
    const downloaded = await runDownload(plan, state, input.root, adapter, input.deepVerify ?? false, input.compareWith);
    timings.download = downloaded.downloadWallMs as number;
    timings.structuralValidation = (downloaded.validation as { wallMs: number }).wallMs;
    const report = executionReport(plan, state, timings, downloaded.validation as Record<string, unknown>);
    writeAtomicJson(reportFile(input.root, plan.executionId), report);
    writeAtomicJson(statePath, state);
    return { executionId: plan.executionId, reportFile: reportFile(input.root, plan.executionId),
      report, ...(downloaded.comparison ? { comparison: downloaded.comparison } : {}) };
  } finally { await lock.release(); }
}

export function runMatrixOperation(input: { requestFile: string; root: string; goldfishCampaign: string;
  deepVerify: boolean; projectRoot?: string }): Record<string, unknown> {
  const projectRoot = input.projectRoot ?? process.cwd(), sourceImage = deriveTrackedStrategySearchSourceImage(projectRoot);
  const requestValue = parsePsroModalRequest(readRequest(input.requestFile));
  const identities = derivePsroModalPlanIdentities(requestValue, sourceImage), executable = binary(projectRoot);
  const threads = os.availableParallelism();
  for (const kingdom of identities) {
    const base = path.join(input.root, kingdom.kingdomId), goldfish = path.join(base, 'goldfish');
    fs.mkdirSync(goldfish, { recursive: true });
    for (const name of ['top-500000.hgf', 'reservoir.hgf']) {
      const destination = path.join(goldfish, name);
      if (!fs.existsSync(destination)) {
        const source = path.join(projectRoot, '.data', 'strategy-search-goldfish', input.goldfishCampaign,
          'evidence', kingdom.evidenceId, 'goldfish', name);
        regularFile(source); fs.copyFileSync(source, destination);
      }
    }
    const matrix = path.join(base, 'matrix'), report = path.join(input.root, 'logs', `${kingdom.kingdomId}-matrix-report.json`);
    if (!fs.existsSync(path.join(matrix, 'matrix.hgm'))) {
      fs.mkdirSync(path.dirname(report), { recursive: true });
      execFileSync(executable, ['matrix', '--kingdom', kingdom.kingdomId,
        '--reservoir', path.join(goldfish, 'reservoir.hgf'), '--out', matrix,
        '--threads', String(threads), '--report', report], { cwd: projectRoot, stdio: 'inherit' });
    }
    loadRustInitialMatrixEvidence({ kingdomId: kingdom.kingdomId,
      topFile: path.join(goldfish, 'top-500000.hgf'), reservoirFile: path.join(goldfish, 'reservoir.hgf'),
      matrixDir: matrix });
    if (input.deepVerify) execFileSync(executable, ['matrix-verify', '--kingdom', kingdom.kingdomId,
      '--reservoir', path.join(goldfish, 'reservoir.hgf'), '--out', matrix], { cwd: projectRoot, stdio: 'inherit' });
  }
  const rows = fs.readdirSync(input.root, { withFileTypes: true }).filter((entry) => entry.isDirectory()
    && fs.existsSync(path.join(input.root, entry.name, 'matrix', 'matrix.hgm'))).map((entry) => {
      const evidence = loadRustInitialMatrixEvidence({ kingdomId: entry.name,
        topFile: path.join(input.root, entry.name, 'goldfish', 'top-500000.hgf'),
        reservoirFile: path.join(input.root, entry.name, 'goldfish', 'reservoir.hgf'),
        matrixDir: path.join(input.root, entry.name, 'matrix') });
      return { kingdomId: entry.name, strategyCount: evidence.strategyCount, gameCount: evidence.gameCount };
    });
  const report = buildMatrixBatchReport(input.root, rows);
  writeAtomicJson(path.join(input.root, 'matrix-batch-report.json'), report);
  return { ...report };
}

function parseOptions(args: readonly string[], allowed: ReadonlySet<string>): { values: Record<string, string>; flags: Set<string> } {
  const values: Record<string, string> = {}, flags = new Set<string>();
  for (let index = 0; index < args.length;) {
    const name = args[index]!;
    if (!allowed.has(name)) throw new Error(`Unknown PSRO Modal option ${name}.`);
    if (name === '--verify') { flags.add(name); index += 1; continue; }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} needs a value.`);
    values[name] = value; index += 2;
  }
  return { values, flags };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation, ...args] = process.argv.slice(2);
  if (!['matrix', 'plan', 'run', 'status', 'download', 'report'].includes(operation ?? '')) {
    throw new Error('Use matrix, plan, run, status, download, or report. No paid operation is the default.');
  }
  if (operation === 'report') {
    const parsed = parseOptions(args, new Set(['--root'])), root = path.resolve(parsed.values['--root'] ?? '');
    if (!parsed.values['--root']) throw new Error('--root is required.');
    const report = buildPsroBatchReport(root); writeAtomicJson(path.join(root, 'psro-batch-report.json'), report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const allowed = new Set(['--request', '--root', '--authorize', '--goldfish-campaign', '--compare-with',
      '--abandon-launch', '--verify']);
    const parsed = parseOptions(args, allowed);
    if (!parsed.values['--request'] || !parsed.values['--root']) throw new Error('--request and --root are required.');
    const requestFile = path.resolve(parsed.values['--request']), root = path.resolve(parsed.values['--root']);
    const deepVerify = parsed.flags.has('--verify');
    if (operation === 'matrix') {
      if (!parsed.values['--goldfish-campaign']) throw new Error('--goldfish-campaign is required for matrix.');
      const result = runMatrixOperation({ requestFile, root,
        goldfishCampaign: parsed.values['--goldfish-campaign'], deepVerify });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const authorizationToken = parsed.values['--authorize'];
      const compareWith = parsed.values['--compare-with'];
      const abandonLaunch = parsed.values['--abandon-launch'];
      const result = await executePsroModalOperation({ operation: operation as 'plan' | 'run' | 'status' | 'download',
        requestFile, root, deepVerify, ...(authorizationToken ? { authorizationToken } : {}),
        ...(compareWith ? { compareWith: path.resolve(compareWith) } : {}),
        ...(abandonLaunch ? { abandonLaunch } : {}) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  }
}
