import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { deriveTrackedStrategySearchSourceImage, streamProcess } from './strategy_search_source';
import {
  createGoldfishModalLaunchBundle, createGoldfishModalPlanSummary, deriveGoldfishModalRequest,
  GOLDFISH_MODAL_ROUTE, validateGoldfishModalAuthorizationToken
} from '../src/sim/strategySearchGoldfishModal';
import type {
  GoldfishModalLaunchBundle, ParsedGoldfishModalRequest
} from '../src/sim/strategySearchGoldfishModal';

export interface GoldfishModalOperatorAdapter {
  run(input: { bundle: GoldfishModalLaunchBundle; destinationRoot: string;
    deepVerify: boolean }): Promise<unknown> | unknown;
}

function lastJson(output: string): Record<string, unknown> {
  for (const line of output.split('\n').reverse()) {
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* Modal can emit progress lines. */ }
  }
  throw new Error('Modal Goldfish adapter returned no JSON object.');
}

function writeAtomicJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

async function streamModal(input: { phase: string; args: string[]; timeoutMs: number }): Promise<string> {
  return streamProcess({ executable: 'modal', ...input });
}

async function measured<T>(operation: () => Promise<T>): Promise<{ value: T; wallMs: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, wallMs: Number((performance.now() - started).toFixed(3)) };
}

function computeAppName(sourceDigest: string): string {
  return `hexdeck-strategy-${sourceDigest.slice(0, 24)}`;
}

type GoldfishValidatorRunner = (executable: string, args: readonly string[], options: {
  cwd: string; stdio: 'pipe';
}) => unknown;

export function measureGoldfishPostDownloadValidations(input: {
  bundle: GoldfishModalLaunchBundle; destinationRoot: string;
}, run: GoldfishValidatorRunner = execFileSync, now: () => number = () => performance.now()): {
  metrics: { bytes: number; wallMs: number; artifacts: Array<Record<string, unknown>> }; error?: unknown;
} {
  const started = now(), artifacts: Array<Record<string, unknown>> = [];
  let failure: unknown;
  const kingdomTasks = [...new Map(input.bundle.tasks.map((task) => [task.evidenceId, task])).values()];
  for (const task of kingdomTasks) {
    const evidenceRoot = path.join(input.destinationRoot, 'evidence', task.evidenceId);
    for (const [stage, relative] of [['goldfish-one-reduce', 'goldfish/top-500000.hgf'],
      ['goldfish-two-reduce', 'goldfish/reservoir.hgf']] as const) {
      const file = path.join(evidenceRoot, relative), validationStarted = now();
      const bytes = fs.statSync(file).size;
      try {
        run('npx', ['tsx', 'scripts/strategy_search_subprocess.ts', '--entry', 'validator',
          '--kingdom', task.kingdomId, '--', '--stage', stage, '--file', file,
          '--evidence-id', task.evidenceId, '--kingdom', task.kingdomId,
          '--evidence-root', evidenceRoot], { cwd: process.cwd(), stdio: 'pipe' });
        artifacts.push({ evidenceId: task.evidenceId, stage,
          path: path.relative(input.destinationRoot, file), bytes,
          wallMs: Number((now() - validationStarted).toFixed(3)), status: 'success' });
      } catch (error) {
        artifacts.push({ evidenceId: task.evidenceId, stage,
          path: path.relative(input.destinationRoot, file), bytes,
          wallMs: Number((now() - validationStarted).toFixed(3)), status: 'failed',
          error: error instanceof Error ? error.message : String(error) });
        failure = error;
        break;
      }
    }
    if (failure) break;
  }
  return { metrics: { bytes: artifacts.reduce((sum, entry) => sum + Number(entry.bytes), 0),
    wallMs: Number((now() - started).toFixed(3)), artifacts }, ...(failure ? { error: failure } : {}) };
}

export function createGoldfishOperatorReport(input: {
  report: Record<string, unknown>;
  preflightStateWallMs: number;
  imageBuildAndDeployWallMs: number;
  startupReadinessAndCanaryWallMs: number;
  executionPreparationWallMs: number;
  controllerCommandWallMs: number;
  postDownloadValidation: { bytes: number; wallMs: number; artifacts: Array<Record<string, unknown>> };
  totalOperatorWallMs: number;
}): Record<string, unknown> {
  const client = input.report.clientOperations as Record<string, unknown> | undefined;
  const downloads = client?.downloads as Record<string, unknown> | undefined;
  const downloadWallMs = Number(downloads?.wallMs ?? 0);
  const stageWall = input.report.stageWallMs as Record<string, number> | undefined;
  return { ...input.report, route: GOLDFISH_MODAL_ROUTE, scientificStageWallMs: {
    'goldfish-one-reduce': stageWall?.['goldfish-one-reduce'] ?? 0,
    'goldfish-two-reduce': stageWall?.['goldfish-two-reduce'] ?? 0
  }, operatorWallMs: { preflightState: input.preflightStateWallMs,
    imageBuildAndDeploy: input.imageBuildAndDeployWallMs,
    startupReadinessAndCanary: input.startupReadinessAndCanaryWallMs,
    executionPreparation: input.executionPreparationWallMs,
    scientificController: Math.max(0, Number((input.controllerCommandWallMs - downloadWallMs).toFixed(3))),
    finalDownload: downloadWallMs, postDownloadVerification: input.postDownloadValidation.wallMs,
    total: input.totalOperatorWallMs },
  clientOperations: { ...client, postDownloadValidation: input.postDownloadValidation } };
}

export class ModalGoldfishOperatorAdapter implements GoldfishModalOperatorAdapter {
  async run(input: { bundle: GoldfishModalLaunchBundle; destinationRoot: string;
    deepVerify: boolean }): Promise<unknown> {
    const operatorStarted = performance.now();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-modal-'));
    const bundleFile = path.join(directory, 'bundle.json');
    const preflightFile = path.join(directory, 'compute-preflight.json');
    const failureFile = path.join(directory, 'compute-failure.json');
    fs.writeFileSync(bundleFile, `${JSON.stringify(input.bundle)}\n`);
    const computeApp = computeAppName(input.bundle.sourceImage.digest);
    try {
      const preflightState = await measured(() => streamModal({ phase: 'goldfish-preflight-state', timeoutMs: 90_000,
        args: ['run', 'modal/strategy_search_status.py::begin_preflight_entry',
          '--campaign-execution-id', input.bundle.campaignExecutionId,
          '--source-digest', input.bundle.sourceImage.digest, '--compute-app-name', computeApp] }));
      let deployment: { wallMs: number }, readiness: { wallMs: number };
      try {
        deployment = await measured(() => streamModal({ phase: 'goldfish-image-deploy', timeoutMs: 900_000,
          args: ['deploy', '--name', computeApp, 'modal/native_strategy_search.py'] }));
        readiness = await measured(() => streamModal({ phase: 'goldfish-startup-readiness', timeoutMs: 240_000,
          args: ['run', 'modal/strategy_search_runtime.py::compute_preflight_entry',
            '--launch-config', bundleFile, '--compute-app-name', computeApp, '--result-file', preflightFile] }));
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        fs.writeFileSync(failureFile, `${JSON.stringify({ error: failure })}\n`);
        try {
          await streamModal({ phase: 'goldfish-preflight-failure', timeoutMs: 90_000,
            args: ['run', 'modal/strategy_search_status.py::fail_preflight_entry',
              '--campaign-execution-id', input.bundle.campaignExecutionId,
              '--source-digest', input.bundle.sourceImage.digest, '--compute-app-name', computeApp,
              '--failure-file', failureFile] });
        } catch (persistenceError) {
          process.stderr.write(`Could not persist Goldfish preflight failure: ${String(persistenceError)}\n`);
        }
        throw error;
      }
      const preflight = JSON.parse(fs.readFileSync(preflightFile, 'utf8')) as Record<string, unknown>;
      if (preflight.ready !== true || preflight.sourceDigest !== input.bundle.sourceImage.digest
        || preflight.computeAppName !== computeApp) {
        throw new Error('Modal Goldfish preflight returned the wrong source identity.');
      }
      const preparation = await measured(() => streamModal({ phase: 'goldfish-execution-prepare', timeoutMs: 90_000,
        args: ['run', 'modal/strategy_search_status.py::prepare_entry', '--launch-config', bundleFile,
          '--compute-preflight', preflightFile] }));
      const preparationResult = lastJson(preparation.value);
      if (preparationResult.campaignExecutionId !== input.bundle.campaignExecutionId) {
        throw new Error('Modal Goldfish preparation returned the wrong execution ID.');
      }
      const controller = await measured(() => streamModal({ phase: 'goldfish-scientific-run',
        timeoutMs: (input.bundle.controller.maxWallSeconds + 180) * 1000,
        args: ['run', 'modal/strategy_search_runtime.py::run_deployed_entry',
          '--launch-config', bundleFile, '--compute-app-name', computeApp,
          '--download-dir', input.destinationRoot, '--startup-timeout-seconds', '120'] }));
      void controller.value;
      const reportFile = path.join(input.destinationRoot, 'report.json');
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Record<string, unknown>;
      const validation = input.deepVerify ? measureGoldfishPostDownloadValidations(input) : {
        metrics: { bytes: 0, wallMs: 0, artifacts: [] }
      };
      const finalReport = createGoldfishOperatorReport({ report,
        preflightStateWallMs: preflightState.wallMs,
        imageBuildAndDeployWallMs: deployment.wallMs,
        startupReadinessAndCanaryWallMs: readiness.wallMs,
        executionPreparationWallMs: preparation.wallMs,
        controllerCommandWallMs: controller.wallMs,
        postDownloadValidation: validation.metrics,
        totalOperatorWallMs: Number((performance.now() - operatorStarted).toFixed(3)) });
      writeAtomicJson(reportFile, finalReport);
      if (validation.error) throw validation.error;
      return finalReport;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function parseInput(requestFile: string, root: string): ParsedGoldfishModalRequest {
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as unknown;
  return deriveGoldfishModalRequest({ request, sourceImage: deriveTrackedStrategySearchSourceImage(root) });
}

export async function executeGoldfishModalOperation(input: {
  operation: 'plan' | 'run'; requestFile: string; authorizationToken?: string; deepVerify?: boolean;
  root?: string; adapter?: GoldfishModalOperatorAdapter;
}): Promise<Record<string, unknown>> {
  const root = input.root ?? process.cwd(), parsed = parseInput(input.requestFile, root);
  if (input.operation === 'plan') return { ...createGoldfishModalPlanSummary(parsed) };
  if (!input.authorizationToken
    || !validateGoldfishModalAuthorizationToken(input.authorizationToken, parsed)) {
    throw new Error('Paid Goldfish run requires the exact authorization token printed by plan.');
  }
  const destinationRoot = path.resolve(root, parsed.downloadRoot);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const adapter = input.adapter ?? new ModalGoldfishOperatorAdapter();
  const outcome = await adapter.run({ bundle: createGoldfishModalLaunchBundle(parsed), destinationRoot,
    deepVerify: input.deepVerify ?? false });
  return { campaignExecutionId: parsed.campaignExecutionId, destinationRoot, outcome };
}

function option(args: readonly string[], name: string, required = true): string | undefined {
  const index = args.indexOf(`--${name}`), value = index < 0 ? undefined : args[index + 1];
  if (required && (!value || value.startsWith('--'))) throw new Error(`--${name} is required.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation, ...args] = process.argv.slice(2);
  if (!['plan', 'run'].includes(operation ?? '')) {
    throw new Error('Use plan or run. No paid operation is the default.');
  }
  const known = new Set(['--request', '--authorize']);
  let deepVerify = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--verify') { deepVerify = true; index += 1; continue; }
    if (!known.has(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith('--')) {
      throw new Error(`Unknown or incomplete Goldfish Modal option ${args[index] ?? ''}.`);
    }
    index += 2;
  }
  const authorizationToken = option(args, 'authorize', false);
  const result = await executeGoldfishModalOperation({ operation: operation as 'plan' | 'run',
    requestFile: path.resolve(option(args, 'request')!), deepVerify,
    ...(authorizationToken ? { authorizationToken } : {}) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
