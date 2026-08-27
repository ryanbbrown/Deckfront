import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  deriveLaunchAuthorizationToken, deriveSourceImageIdentity, parseCampaignSelectionManifest,
  parseStrategySearchCampaignManifest,
  runtimeCeilings, runtimeFitsAuthorizedCeilings, validateCampaignContentIndex, validateCampaignState
} from '../src/sim/strategySearchCampaign';
import type {
  CampaignContentIndex, CampaignState, ParsedCampaignManifest, SourceImageIdentity
} from '../src/sim/strategySearchCampaign';
import {
  createCampaignLaunchBundle, createCampaignPlanSummary, createCampaignResumeLaunchBundle,
  createCampaignSourceRepair, deriveCampaignSourceRepairToken, validateCampaignSelection
} from '../src/sim/strategySearchCampaignOperator';
import type {
  CampaignLaunchBundle
} from '../src/sim/strategySearchCampaignOperator';
import {
  installCampaignArchives, validateCampaignArchiveManifest
} from '../src/sim/strategySearchCampaignArchive';
import { validateCampaignSchedulerCheckpoint } from '../src/sim/strategySearchScheduler';

interface CampaignDownloadSummary {
  schemaVersion: 1; indexHash: string; indexBytes: number; entryCount: number;
  archiveManifestHash: string; archiveCount: number;
}
interface CampaignRemoteStatus {
  state: CampaignState | null;
  scheduler: unknown;
  download: CampaignDownloadSummary | null;
  controllerCall: unknown;
}
export interface CampaignOperatorAdapter {
  status(input: { campaignRoot: string; evidenceHash: string }): CampaignRemoteStatus;
  run(input: { bundle: CampaignLaunchBundle; stagingRoot: string; destinationRoot: string }): unknown;
  recover?(input: { campaignRoot: string; evidenceHash: string; target: string }): unknown;
}

const SOURCE_EXCLUDED = new Set(['.git', 'node_modules', '.experiments', '.reviews', '.data',
  'dist', 'dist-sim', 'dist-benchmark', 'target']);
function includedSourcePath(relative: string): boolean {
  const components = relative.split('/'), name = components.at(-1)!.toLocaleLowerCase('en-US');
  return !components.some((component) => SOURCE_EXCLUDED.has(component.toLocaleLowerCase('en-US')))
    && name !== '.env' && !name.startsWith('.env.') && !name.includes('credential')
    && !name.endsWith('.pem') && !name.endsWith('.key');
}
function git(root: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
}
export function deriveTrackedCampaignSourceImage(root: string): SourceImageIdentity {
  const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=no']).toString('utf8')
    .split('\0').filter(Boolean);
  const files = git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
    .filter(includedSourcePath).map((relative) => ({ path: relative,
      content: fs.readFileSync(path.join(root, ...relative.split('/'))) }));
  return deriveSourceImageIdentity({ gitVersion: git(root, ['rev-parse', 'HEAD']).toString('utf8').trim(),
    files, dirtyTrackedPaths: dirty });
}
function exact(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function lastJson(output: string): unknown {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]!) as unknown; } catch { /* Modal can print non-JSON progress lines. */ }
  }
  throw new Error('Modal campaign adapter returned no JSON result.');
}
export class ModalCampaignOperatorAdapter implements CampaignOperatorAdapter {
  status(input: { campaignRoot: string; evidenceHash: string }): CampaignRemoteStatus {
    const output = execFileSync('modal', ['run', 'modal/native_strategy_search.py::campaign_status_entry',
      '--campaign-root', input.campaignRoot, '--evidence-hash', input.evidenceHash], { encoding: 'utf8' });
    return lastJson(output) as CampaignRemoteStatus;
  }
  recover(input: { campaignRoot: string; evidenceHash: string; target: string }): unknown {
    const output = execFileSync('modal', ['run', 'modal/native_strategy_search.py::campaign_recover_entry',
      '--campaign-root', input.campaignRoot, '--evidence-hash', input.evidenceHash,
      '--target', input.target, '--assertion', 'no-live-modal-call-exists'], { encoding: 'utf8' });
    return lastJson(output);
  }
  run(input: { bundle: CampaignLaunchBundle; stagingRoot: string; destinationRoot: string }): unknown {
    fs.mkdirSync(input.stagingRoot, { recursive: true });
    const temporary = path.join(input.stagingRoot, 'launch-bundle.json');
    fs.writeFileSync(temporary, `${JSON.stringify(input.bundle, null, 2)}\n`, { mode: 0o600 });
    try {
      const output = execFileSync('modal', ['run', 'modal/native_strategy_search.py::campaign_run_entry',
        '--launch-config', temporary, '--download-dir', input.stagingRoot,
      '--existing-root', input.destinationRoot], { encoding: 'utf8' });
      return lastJson(output);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
function installControlFile(source: string, destination: string): void {
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  const descriptor = fs.openSync(temporary, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, destination);
}
function writeLocalDownloadSummary(destination: string, value: Record<string, unknown>): void {
  const temporary = path.join(destination, `.download-summary.tmp-${process.pid}`);
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
  const descriptor = fs.openSync(temporary, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, path.join(destination, 'download-summary.json'));
}
function readLocalDownloadSummary(destination: string, evidenceHash: string): { complete: boolean } | undefined {
  const file = path.join(destination, 'download-summary.json');
  if (!fs.existsSync(file)) return undefined;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16 * 1024) {
    throw new Error('Local campaign download summary is unsafe or unbounded.');
  }
  const value = readJson(file) as Record<string, unknown>;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(
    ['schemaVersion', 'evidenceHash', 'indexHash', 'archiveManifestHash', 'complete'].sort())
    || value.schemaVersion !== 1 || value.evidenceHash !== evidenceHash
    || typeof value.complete !== 'boolean' || !/^[0-9a-f]{64}$/.test(String(value.indexHash))
    || !/^[0-9a-f]{64}$/.test(String(value.archiveManifestHash))) {
    throw new Error('Local campaign download summary is invalid.');
  }
  return { complete: value.complete };
}
function loadInputs(manifestFile: string, selectionFile: string): ParsedCampaignManifest {
  const parsed = parseStrategySearchCampaignManifest(readJson(manifestFile));
  const selection = parseCampaignSelectionManifest(fs.readFileSync(selectionFile));
  validateCampaignSelection(parsed, selection);
  return parsed;
}
function verifyCurrentSource(root: string, parsed: ParsedCampaignManifest): void {
  const current = deriveTrackedCampaignSourceImage(root);
  if (!exact(current, parsed.manifest.evidence.sourceImage)) {
    throw new Error('Campaign manifest source-image identity differs from the clean tracked worktree.');
  }
}
function campaignRoot(parsed: ParsedCampaignManifest): string {
  return `campaigns/${parsed.manifest.evidence.campaignId}/${parsed.evidenceHash}`;
}
function summarizeStatus(status: CampaignRemoteStatus, parsed: ParsedCampaignManifest,
  local?: { complete: boolean }): Record<string, unknown> {
  if (status.state !== null && (!validateCampaignState(status.state)
    || status.state.evidenceHash !== parsed.evidenceHash)) throw new Error('Remote campaign state is invalid.');
  if (status.scheduler !== null && !validateCampaignSchedulerCheckpoint(status.scheduler)) {
    throw new Error('Remote campaign scheduler is invalid.');
  }
  if (status.download !== null && (status.download.schemaVersion !== 1
    || !/^[0-9a-f]{64}$/.test(status.download.indexHash)
    || !/^[0-9a-f]{64}$/.test(status.download.archiveManifestHash)
    || ![status.download.indexBytes, status.download.entryCount, status.download.archiveCount]
      .every((value) => Number.isSafeInteger(value) && value >= 0))) {
    throw new Error('Remote campaign download summary is invalid.');
  }
  const stages = status.state ? Object.values(status.state.stages) : [];
  const counts = Object.fromEntries(['pending', 'ready', 'active', 'incomplete', 'terminal-incomplete', 'complete']
    .map((state) => [state, stages.filter((stage) => stage.status === state).length]));
  const scheduler = status.scheduler as { tasks?: Array<{ status: string; containers: number; cpus: number;
    callId: string | null }> } | null;
  const active = scheduler?.tasks?.filter((task) => task.status === 'active' || task.status === 'launching') ?? [];
  return { evidenceHash: parsed.evidenceHash, remoteExists: status.state !== null, stageCounts: counts,
    activeContainers: active.reduce((sum, task) => sum + task.containers, 0),
    activeCpus: active.reduce((sum, task) => sum + task.cpus, 0),
    activeCallIds: active.flatMap((task) => task.callId ? [task.callId] : []),
    downloadSummary: status.download,
    reasons: stages.filter((stage) => stage.reason).map((stage) => stage.reason),
    paidEvidenceComplete: Boolean(status.state && Object.entries(status.state.stages)
      .filter(([key]) => key.endsWith(':psro')).every(([, stage]) => stage.status === 'complete')),
    localDownloadComplete: local?.complete ?? false, workspaceBudget: 'operator-managed-not-verified' };
}

export function validateDownloadedCampaign(root: string, parsed: ParsedCampaignManifest): {
  complete: boolean; state: CampaignState; index: CampaignContentIndex
} {
  const index = readJson(path.join(root, 'content-index.json'));
  const archives = readJson(path.join(root, 'archives.json'));
  if (!validateCampaignContentIndex(index) || !validateCampaignArchiveManifest(archives, index)) {
    throw new Error('Downloaded campaign index or archive manifest is invalid.');
  }
  const state = readJson(path.join(root, 'state.json'));
  const scheduler = readJson(path.join(root, 'scheduler.json'));
  if (!validateCampaignState(state) || state.evidenceHash !== parsed.evidenceHash
    || !validateCampaignSchedulerCheckpoint(scheduler) || scheduler.evidenceHash !== parsed.evidenceHash) {
    throw new Error('Downloaded campaign state or scheduler is invalid.');
  }
  for (const [stageKey, stage] of Object.entries(state.stages)) {
    if (!['complete', 'incomplete', 'terminal-incomplete'].includes(stage.status)) continue;
    const [kingdomId, kind] = stageKey.split(':') as [string, 'goldfish' | 'matrix' | 'psro'];
    const marker = path.join(root, 'kingdoms', kingdomId, kind, 'control', `${stage.status}.json`);
    if (!fs.existsSync(marker)) {
      if (stage.status === 'incomplete' && !stage.artifactPaths?.length) continue;
      throw new Error(`Downloaded campaign stage marker is missing: ${stageKey}`);
    }
    const request = { campaignRoot: root, stage: kind, stageId: stage.id,
      stageRoot: `kingdoms/${kingdomId}/${kind}`, expectedStatus: stage.status };
    const result = spawnSync('npx', ['tsx', 'scripts/strategy_search_campaign_validate_stage.ts'], {
      cwd: process.cwd(), input: JSON.stringify(request), encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Downloaded campaign stage is invalid: ${stageKey}: ${result.stderr}`);
  }
  return { complete: Object.entries(state.stages).filter(([key]) => key.endsWith(':psro'))
    .every(([, stage]) => stage.status === 'complete'), state, index };
}

export function executeCampaignOperation(input: {
  operation: 'plan' | 'status' | 'run' | 'recover' | 'resume-plan' | 'resume';
  manifestFile: string; selectionFile: string; authorizationToken?: string; sourceRepairToken?: string;
  recoveryTarget?: string; root?: string; adapter?: CampaignOperatorAdapter
}): Record<string, unknown> {
  const root = input.root ?? process.cwd(), parsed = loadInputs(input.manifestFile, input.selectionFile);
  if (input.operation === 'plan') {
    verifyCurrentSource(root, parsed);
    const token = deriveLaunchAuthorizationToken(parsed.evidenceHash, runtimeCeilings(parsed.manifest.runtime));
    return { ...createCampaignPlanSummary(parsed, token) };
  }
  if (input.operation === 'resume-plan') {
    const repair = createCampaignSourceRepair(parsed, deriveTrackedCampaignSourceImage(root));
    return { campaignEvidenceHash: parsed.evidenceHash, artifactBuildVersion: repair.artifactBuildVersion,
      executionSourceVersion: repair.executionSourceImage.gitVersion, repairId: repair.repairId,
      lineageHash: repair.lineageHash, sourceRepairToken: deriveCampaignSourceRepairToken(repair),
      campaignCostGate: 'none', workspaceBudget: 'operator-managed-not-verified' };
  }
  const adapter = input.adapter ?? new ModalCampaignOperatorAdapter();
  const remote = adapter.status({ campaignRoot: campaignRoot(parsed), evidenceHash: parsed.evidenceHash });
  const destination = path.resolve(root, parsed.manifest.runtime.downloadRoot,
    parsed.manifest.evidence.campaignId, parsed.evidenceHash);
  const local = readLocalDownloadSummary(destination, parsed.evidenceHash);
  if (input.operation === 'status') return summarizeStatus(remote, parsed, local);
  summarizeStatus(remote, parsed, local);
  const executionSourceImage = input.operation === 'resume' ? deriveTrackedCampaignSourceImage(root) : undefined;
  if (input.operation !== 'resume' && input.operation !== 'recover') verifyCurrentSource(root, parsed);
  if (input.operation === 'recover') {
    if (!input.recoveryTarget || !adapter.recover) throw new Error('Recovery needs an explicit ambiguous launch target.');
    return { outcome: adapter.recover({ campaignRoot: campaignRoot(parsed), evidenceHash: parsed.evidenceHash,
      target: input.recoveryTarget }), evidenceHash: parsed.evidenceHash };
  }
  if (input.operation === 'resume' && !remote.state) {
    throw new Error('Source-repair resume requires the existing prior-evidence campaign state.');
  }
  if (input.operation === 'resume' && !input.sourceRepairToken) {
    throw new Error('Source-repair resume requires the exact resume-plan authorization token.');
  }
  if (!remote.state && !input.authorizationToken) throw new Error('First campaign launch requires the plan authorization token.');
  if (remote.state && (remote.state.authorizedCeilings === null
    || !runtimeFitsAuthorizedCeilings(parsed.manifest.runtime, remote.state.authorizedCeilings))
    && !input.authorizationToken) {
    throw new Error('Campaign runtime increase requires a new plan authorization token.');
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-campaign-download-'));
  try {
    const bundle = input.operation === 'resume'
      ? createCampaignResumeLaunchBundle(parsed, executionSourceImage!, input.sourceRepairToken!,
        input.authorizationToken)
      : createCampaignLaunchBundle(parsed, input.authorizationToken);
    const outcome = adapter.run({ bundle, stagingRoot: staging, destinationRoot: destination });
    const index = readJson(path.join(staging, 'content-index.json'));
    const archives = readJson(path.join(staging, 'archives.json'));
    if (!validateCampaignContentIndex(index) || !validateCampaignArchiveManifest(archives, index)) {
      throw new Error('Campaign adapter downloaded an invalid content index or archive manifest.');
    }
    installCampaignArchives({ stagingRoot: staging, destinationRoot: destination, index, archiveManifest: archives });
    installControlFile(path.join(staging, 'content-index.json'), path.join(destination, 'content-index.json'));
    installControlFile(path.join(staging, 'archives.json'), path.join(destination, 'archives.json'));
    const validation = validateDownloadedCampaign(destination, parsed);
    writeLocalDownloadSummary(destination, { schemaVersion: 1, evidenceHash: parsed.evidenceHash,
      indexHash: index.indexHash, archiveManifestHash: archives.manifestHash, complete: validation.complete });
    if (!validation.complete) throw new Error('Campaign remains incomplete after validated download.');
    return { outcome, destination, evidenceHash: parsed.evidenceHash, complete: true };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

function option(args: readonly string[], name: string, required = true): string | undefined {
  const index = args.indexOf(`--${name}`), value = index < 0 ? undefined : args[index + 1];
  if (required && (!value || value.startsWith('--'))) throw new Error(`--${name} is required.`);
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation, ...args] = process.argv.slice(2);
  if (!['plan', 'status', 'run', 'recover', 'resume-plan', 'resume'].includes(operation ?? '')) {
    throw new Error('Use plan, status, run, recover, resume-plan, or resume.');
  }
  const known = new Set(['--manifest', '--selection-manifest', '--authorize', '--authorize-source-repair',
    '--assert-no-live-call']);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith('--')) {
      throw new Error(`Unknown or incomplete campaign option ${args[index] ?? ''}.`);
    }
  }
  const authorizationToken = option(args, 'authorize', false);
  const sourceRepairToken = option(args, 'authorize-source-repair', false);
  const recoveryTarget = option(args, 'assert-no-live-call', false);
  const result = executeCampaignOperation({
    operation: operation as 'plan' | 'status' | 'run' | 'recover' | 'resume-plan' | 'resume',
    manifestFile: path.resolve(option(args, 'manifest')!),
    selectionFile: path.resolve(option(args, 'selection-manifest')!),
    ...(authorizationToken ? { authorizationToken } : {}),
    ...(sourceRepairToken ? { sourceRepairToken } : {}),
    ...(recoveryTarget ? { recoveryTarget } : {}) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
