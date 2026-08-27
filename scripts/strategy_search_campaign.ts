import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  deriveSourceImageIdentity, deriveStrategySearch, parseStrategySearchRequest,
  validateLaunchAuthorizationToken
} from '../src/sim/strategySearchCampaign';
import type { ParsedStrategySearchRequest, SourceImageIdentity } from '../src/sim/strategySearchCampaign';
import {
  createStrategySearchLaunchBundle, createStrategySearchPlanSummary
} from '../src/sim/strategySearchCampaignOperator';
import type { StrategySearchLaunchBundle } from '../src/sim/strategySearchCampaignOperator';

export interface StrategySearchRemoteStatus {
  exists: boolean; campaignExecutionId: string;
  status: 'missing' | 'preparing' | 'starting' | 'running' | 'stale' | 'complete' | 'failed';
  phase: 'missing' | 'image-preparing' | 'startup-failed' | 'controller-starting' | 'controller-running'
    | 'controller-stale' | 'complete' | 'failed';
  report?: Record<string, unknown>; startedMs?: number; usefulWorkStartedMs?: number;
  failedMs?: number; failure?: string;
  activeTaskCount?: number | null; submittedTaskCount?: number; completedTaskCount?: number;
  readyTaskCount?: number; launchingTaskCount?: number; retryBackoffTaskCount?: number;
  failedTaskCount?: number; blockedTaskCount?: number; jobStatusCounts?: Record<string, number>;
  commonLastError?: { count: number; message: string } | null;
  controllerLeaseUntilMs?: number | null; controllerLeaseLive?: boolean;
  activeCpus?: number | null; submittedCpus?: number; activeStages?: string[];
}
type Awaitable<T> = T | Promise<T>;
export interface StrategySearchOperatorAdapter {
  status(input: { campaignExecutionId: string }): Awaitable<StrategySearchRemoteStatus>;
  run(input: { bundle: StrategySearchLaunchBundle; destinationRoot: string }): Awaitable<unknown>;
}
function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
export function executableSourcePaths(root: string): string[] {
  const file = path.join(root, 'strategy-search-image-files.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string') || new Set(value).size !== value.length
    || !value.includes('strategy-search-image-files.json')) throw new Error('Executable image allowlist is invalid.');
  return [...value].sort();
}
export function validateStrategySearchImageClosure(root: string, expectedPaths: readonly string[]): void {
  const allowed = new Set(expectedPaths), dependencyPattern = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]/g;
  for (const source of expectedPaths.filter((entry) => /\.(?:[cm]?js|tsx?)$/.test(entry))) {
    const text = fs.readFileSync(path.join(root, source), 'utf8'); dependencyPattern.lastIndex = 0;
    for (const match of text.matchAll(dependencyPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier?.startsWith('.')) continue;
      const base = path.resolve(root, path.dirname(source), specifier);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, 'index.ts'),
        path.join(base, 'index.tsx')];
      const dependency = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!dependency) throw new Error(`Runtime dependency ${specifier} imported by ${source} cannot be resolved.`);
      const relative = path.relative(root, dependency).split(path.sep).join('/');
      if (relative.startsWith('../') || !allowed.has(relative)) {
        throw new Error(`Executable image allowlist omits runtime dependency ${relative} imported by ${source}.`);
      }
    }
  }
}
export function deriveTrackedStrategySearchSourceImage(root: string): SourceImageIdentity {
  const expectedPaths = executableSourcePaths(root);
  validateStrategySearchImageClosure(root, expectedPaths);
  const scientificPaths = JSON.parse(fs.readFileSync(path.join(root,
    'strategy-search-scientific-files.json'), 'utf8')) as unknown;
  if (!Array.isArray(scientificPaths) || scientificPaths.some((entry) => typeof entry !== 'string')
    || scientificPaths.some((entry) => !expectedPaths.includes(entry))) {
    throw new Error('Scientific source allowlist is invalid.');
  }
  const tracked = new Set(git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const missing = expectedPaths.filter((entry) => !tracked.has(entry) || !fs.existsSync(path.join(root, entry)));
  if (missing.length) throw new Error(`Executable image allowlist has missing or untracked files: ${missing.join(', ')}`);
  const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean)
    .map((entry) => entry.slice(3)).filter((entry) => expectedPaths.includes(entry));
  return deriveSourceImageIdentity({ expectedPaths, scientificPaths, dirtyExecutablePaths: dirty,
    files: expectedPaths.map((relative) => ({ path: relative, content: fs.readFileSync(path.join(root, relative)) })) });
}
function lastJson(output: string): unknown {
  for (const line of output.split('\n').reverse()) {
    try { return JSON.parse(line) as unknown; } catch { /* Modal can emit progress lines. */ }
  }
  throw new Error('Modal strategy-search adapter returned no JSON.');
}
function writeAtomicJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
type DeepValidatorRunner = (executable: string, args: readonly string[], options: {
  cwd: string; stdio: 'pipe' }) => unknown;
export function measurePostDownloadValidations(input: { bundle: StrategySearchLaunchBundle;
  destinationRoot: string }, run: DeepValidatorRunner = execFileSync,
  now: () => number = () => performance.now()): { metrics: Record<string, unknown>; error?: unknown } {
  const started = now(), artifacts: Array<Record<string, unknown>> = []; let failure: unknown;
  for (const task of input.bundle.tasks.filter((entry) => entry.stage === 'psro')) {
    const evidenceRoot = path.join(input.destinationRoot, 'evidence', task.evidenceId);
    for (const [stage, relative] of [['goldfish-one-reduce', 'goldfish/top-500000.hgf'],
      ['goldfish-two-reduce', 'goldfish/reservoir.hgf'], ['matrix', 'matrix/evidence.json'],
      ['psro', 'psro/evidence.json']] as const) {
      const file = path.join(evidenceRoot, relative), validationStarted = now(), bytes = fs.statSync(file).size;
      try {
        run('npx', ['tsx', 'scripts/strategy_search_subprocess.ts', '--entry', 'validator',
          '--kingdom', task.kingdomId, '--', '--stage', stage, '--file', file,
          '--evidence-id', task.evidenceId, '--kingdom', task.kingdomId,
          '--evidence-root', evidenceRoot], { cwd: process.cwd(), stdio: 'pipe' });
        artifacts.push({ evidenceId: task.evidenceId, stage, path: path.relative(input.destinationRoot, file),
          bytes, wallMs: Number((now() - validationStarted).toFixed(3)), status: 'success' });
      } catch (error) {
        artifacts.push({ evidenceId: task.evidenceId, stage, path: path.relative(input.destinationRoot, file),
          bytes, wallMs: Number((now() - validationStarted).toFixed(3)), status: 'failed',
          error: error instanceof Error ? error.message : String(error) });
        failure = error; break;
      }
    }
    if (failure) break;
  }
  return { metrics: { bytes: artifacts.reduce((sum, artifact) => sum + Number(artifact.bytes), 0),
    wallMs: Number((now() - started).toFixed(3)), artifacts }, ...(failure ? { error: failure } : {}) };
}
function computeAppName(sourceDigest: string): string {
  return `hexdeck-strategy-${sourceDigest.slice(0, 24)}`;
}
export function streamProcess(input: { executable: string; phase: string; args: string[];
  timeoutMs: number }): Promise<string> {
  const startedMs = Date.now();
  process.stdout.write(`${JSON.stringify({ type: `${input.phase}-started`, startedMs,
    command: [input.executable, ...input.args] })}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutTail = '', stderrTail = '', timedOut = false;
    const append = (tail: string, chunk: Buffer): string => (tail + chunk.toString()).slice(-4_000_000);
    child.stdout.on('data', (chunk: Buffer) => { process.stdout.write(chunk); stdoutTail = append(stdoutTail, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(chunk); stderrTail = append(stderrTail, chunk); });
    let forceKill: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5000); }, input.timeoutMs);
    child.on('error', (error) => { clearTimeout(timeout); if (forceKill) clearTimeout(forceKill); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout); if (forceKill) clearTimeout(forceKill);
      const finishedMs = Date.now(), event = { startedMs, finishedMs, elapsedMs: finishedMs - startedMs };
      if (code === 0 && !timedOut) {
        process.stdout.write(`${JSON.stringify({ type: `${input.phase}-complete`, ...event })}\n`);
        resolve(stdoutTail);
      } else {
        process.stdout.write(`${JSON.stringify({ type: `${input.phase}-failed`, ...event,
          code, signal, timedOut })}\n`);
        const failureTail = `${stderrTail}\n${stdoutTail}`.slice(-4000);
        reject(new Error(`Modal ${input.phase} failed: ${failureTail}`));
      }
    });
  });
}
function streamModal(input: { phase: string; args: string[]; timeoutMs: number }): Promise<string> {
  return streamProcess({ executable: 'modal', ...input });
}
export class ModalStrategySearchOperatorAdapter implements StrategySearchOperatorAdapter {
  async status(input: { campaignExecutionId: string }): Promise<StrategySearchRemoteStatus> {
    return lastJson(await streamModal({ phase: 'strategy-search-status', timeoutMs: 90_000,
      args: ['run', 'modal/strategy_search_status.py::status_entry',
        '--campaign-execution-id', input.campaignExecutionId] })) as StrategySearchRemoteStatus;
  }
  async run(input: { bundle: StrategySearchLaunchBundle; destinationRoot: string }): Promise<unknown> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-strategy-search-'));
    const bundleFile = path.join(directory, 'bundle.json');
    const preflightFile = path.join(directory, 'compute-preflight.json');
    const failureFile = path.join(directory, 'compute-failure.json');
    fs.writeFileSync(bundleFile, `${JSON.stringify(input.bundle)}\n`);
    const computeApp = computeAppName(input.bundle.sourceImage.digest);
    try {
      process.stdout.write(`${JSON.stringify({ type: 'strategy-search-compute-preflight-planned',
        computeAppName: computeApp, sourceDigest: input.bundle.sourceImage.digest })}\n`);
      await streamModal({ phase: 'strategy-search-preflight-state', timeoutMs: 90_000,
        args: ['run', 'modal/strategy_search_status.py::begin_preflight_entry',
          '--campaign-execution-id', input.bundle.campaignExecutionId,
          '--source-digest', input.bundle.sourceImage.digest, '--compute-app-name', computeApp] });
      try {
        await streamModal({ phase: 'strategy-search-compute-deploy', timeoutMs: 900_000,
          args: ['deploy', '--name', computeApp, 'modal/native_strategy_search.py'] });
        await streamModal({ phase: 'strategy-search-compute-readiness', timeoutMs: 240_000,
          args: ['run', 'modal/strategy_search_runtime.py::compute_preflight_entry', '--launch-config', bundleFile,
            '--compute-app-name', computeApp, '--result-file', preflightFile] });
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        fs.writeFileSync(failureFile, `${JSON.stringify({ error: failure })}\n`);
        try {
          await streamModal({ phase: 'strategy-search-preflight-failure', timeoutMs: 90_000,
            args: ['run', 'modal/strategy_search_status.py::fail_preflight_entry',
              '--campaign-execution-id', input.bundle.campaignExecutionId,
              '--source-digest', input.bundle.sourceImage.digest, '--compute-app-name', computeApp,
              '--failure-file', failureFile] });
        } catch (persistenceError) {
          process.stderr.write(`Could not persist strategy-search preflight failure: ${String(persistenceError)}\n`);
        }
        throw error;
      }
      const preflight = JSON.parse(fs.readFileSync(preflightFile, 'utf8')) as Record<string, unknown>;
      if (preflight.ready !== true || preflight.sourceDigest !== input.bundle.sourceImage.digest
        || preflight.computeAppName !== computeApp) {
        throw new Error('Modal compute preflight returned the wrong source identity.');
      }
      const preparation = lastJson(await streamModal({ phase: 'strategy-search-execution-prepare', timeoutMs: 90_000,
        args: ['run', 'modal/strategy_search_status.py::prepare_entry', '--launch-config', bundleFile,
          '--compute-preflight', preflightFile] })) as Record<string, unknown>;
      if (preparation.campaignExecutionId !== input.bundle.campaignExecutionId) {
        throw new Error('Modal execution preparation returned the wrong campaign ID.');
      }
      process.stdout.write(`${JSON.stringify({ type: 'strategy-search-acceptance-clock-started',
        computeAppName: computeApp, ...preparation })}\n`);
      await streamModal({ phase: 'strategy-search-deployed-run',
        timeoutMs: (input.bundle.controller.timeoutSeconds + 60) * 1000,
        args: ['run', 'modal/strategy_search_runtime.py::run_deployed_entry', '--launch-config', bundleFile,
          '--compute-app-name', computeApp, '--download-dir', input.destinationRoot,
          '--startup-timeout-seconds', '120'] });
      const reportFile = path.join(input.destinationRoot, 'report.json');
      const outcome = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Record<string, unknown>;
      const validation = measurePostDownloadValidations(input);
      const finalOutcome = { ...outcome, clientOperations: {
        ...(outcome.clientOperations as Record<string, unknown> | undefined),
        postDownloadValidation: validation.metrics } };
      writeAtomicJson(reportFile, finalOutcome);
      if (validation.error) throw validation.error;
      return finalOutcome;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
function parseInput(requestFile: string, root: string): ParsedStrategySearchRequest {
  const request = parseStrategySearchRequest(JSON.parse(fs.readFileSync(requestFile, 'utf8')) as unknown);
  return deriveStrategySearch({ request, sourceImage: deriveTrackedStrategySearchSourceImage(root) });
}
export async function executeStrategySearchOperation(input: { operation: 'plan' | 'status' | 'run'; requestFile: string;
  authorizationToken?: string; root?: string; adapter?: StrategySearchOperatorAdapter }): Promise<Record<string, unknown>> {
  const root = input.root ?? process.cwd(), parsed = parseInput(input.requestFile, root);
  if (input.operation === 'plan') return { ...createStrategySearchPlanSummary(parsed) };
  const adapter = input.adapter ?? new ModalStrategySearchOperatorAdapter();
  if (input.operation === 'status') {
    const status = await adapter.status({ campaignExecutionId: parsed.campaignExecutionId });
    if (status.campaignExecutionId !== parsed.campaignExecutionId) throw new Error('Remote execution identity differs.');
    return { ...status, orderedEvidenceIds: parsed.kingdoms.map((entry) => entry.evidenceId) };
  }
  if (!input.authorizationToken || !validateLaunchAuthorizationToken(input.authorizationToken, parsed)) {
    throw new Error('Run requires the exact authorization token printed by plan.');
  }
  const destinationRoot = path.resolve(root, parsed.downloadRoot);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const outcome = await adapter.run({ bundle: createStrategySearchLaunchBundle(parsed), destinationRoot });
  return { campaignExecutionId: parsed.campaignExecutionId, destinationRoot, outcome };
}
function option(args: readonly string[], name: string, required = true): string | undefined {
  const index = args.indexOf(`--${name}`), value = index < 0 ? undefined : args[index + 1];
  if (required && (!value || value.startsWith('--'))) throw new Error(`--${name} is required.`);
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation, ...args] = process.argv.slice(2);
  if (!['plan', 'status', 'run'].includes(operation ?? '')) throw new Error('Use plan, status, or run.');
  const known = new Set(['--request', '--authorize']);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith('--')) {
      throw new Error(`Unknown or incomplete strategy-search option ${args[index] ?? ''}.`);
    }
  }
  const authorizationToken = option(args, 'authorize', false);
  const result = await executeStrategySearchOperation({ operation: operation as 'plan' | 'status' | 'run',
    requestFile: path.resolve(option(args, 'request')!), ...(authorizationToken ? { authorizationToken } : {}) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
