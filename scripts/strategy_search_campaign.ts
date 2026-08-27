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
  createCampaignLaunchBundle, createCampaignPlanSummary, validateCampaignSelection
} from '../src/sim/strategySearchCampaignOperator';
import type {
  CampaignLaunchBundle
} from '../src/sim/strategySearchCampaignOperator';
import {
  installCampaignArchives, validateCampaignArchiveManifest
} from '../src/sim/strategySearchCampaignArchive';
import type { CampaignArchiveManifest } from '../src/sim/strategySearchCampaignArchive';
import { validateCampaignSchedulerCheckpoint } from '../src/sim/strategySearchScheduler';

interface CampaignRemoteStatus {
  state: CampaignState | null;
  scheduler: unknown;
  contentIndex: CampaignContentIndex | null;
  archives: CampaignArchiveManifest | null;
  controllerCall: unknown;
}
export interface CampaignOperatorAdapter {
  status(input: { campaignRoot: string; evidenceHash: string }): CampaignRemoteStatus;
  run(input: { bundle: CampaignLaunchBundle; stagingRoot: string; destinationRoot: string }): unknown;
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
  local?: ReturnType<typeof validateDownloadedCampaign>): Record<string, unknown> {
  if (status.state !== null && (!validateCampaignState(status.state)
    || status.state.evidenceHash !== parsed.evidenceHash)) throw new Error('Remote campaign state is invalid.');
  if (status.scheduler !== null && !validateCampaignSchedulerCheckpoint(status.scheduler)) {
    throw new Error('Remote campaign scheduler is invalid.');
  }
  if (status.contentIndex !== null && !validateCampaignContentIndex(status.contentIndex)) {
    throw new Error('Remote campaign content index is invalid.');
  }
  if (status.archives !== null && (!status.contentIndex
    || !validateCampaignArchiveManifest(status.archives, status.contentIndex))) {
    throw new Error('Remote campaign archive manifest is invalid.');
  }
  const stages = status.state ? Object.values(status.state.stages) : [];
  const counts = Object.fromEntries(['pending', 'ready', 'active', 'incomplete', 'terminal-incomplete', 'complete']
    .map((state) => [state, stages.filter((stage) => stage.status === state).length]));
  const active = stages.filter((stage) => stage.status === 'active');
  return { evidenceHash: parsed.evidenceHash, remoteExists: status.state !== null, stageCounts: counts,
    activeContainers: active.reduce((sum, stage) => sum + (stage.resources?.containers ?? 0), 0),
    activeCpus: active.reduce((sum, stage) => sum + (stage.resources?.cpus ?? 0), 0),
    activeCallIds: active.map((stage) => stage.callId),
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

export function executeCampaignOperation(input: { operation: 'plan' | 'status' | 'run';
  manifestFile: string; selectionFile: string; authorizationToken?: string; root?: string;
  adapter?: CampaignOperatorAdapter }): Record<string, unknown> {
  const root = input.root ?? process.cwd(), parsed = loadInputs(input.manifestFile, input.selectionFile);
  if (input.operation === 'plan') {
    verifyCurrentSource(root, parsed);
    const token = deriveLaunchAuthorizationToken(parsed.evidenceHash, runtimeCeilings(parsed.manifest.runtime));
    return { ...createCampaignPlanSummary(parsed, token) };
  }
  const adapter = input.adapter ?? new ModalCampaignOperatorAdapter();
  const remote = adapter.status({ campaignRoot: campaignRoot(parsed), evidenceHash: parsed.evidenceHash });
  const destination = path.resolve(root, parsed.manifest.runtime.downloadRoot,
    parsed.manifest.evidence.campaignId, parsed.evidenceHash);
  const local = fs.existsSync(path.join(destination, 'content-index.json'))
    ? validateDownloadedCampaign(destination, parsed) : undefined;
  if (input.operation === 'status') return summarizeStatus(remote, parsed, local);
  summarizeStatus(remote, parsed, local);
  verifyCurrentSource(root, parsed);
  if (!remote.state && !input.authorizationToken) throw new Error('First campaign launch requires the plan authorization token.');
  if (remote.state && !runtimeFitsAuthorizedCeilings(parsed.manifest.runtime,
    remote.state.authorizedCeilings ?? ({} as never)) && !input.authorizationToken) {
    throw new Error('Campaign runtime increase requires a new plan authorization token.');
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-campaign-download-'));
  try {
    const bundle = createCampaignLaunchBundle(parsed, input.authorizationToken);
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
  if (!['plan', 'status', 'run'].includes(operation ?? '')) throw new Error('Use plan, status, or run.');
  const known = new Set(['--manifest', '--selection-manifest', '--authorize']);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith('--')) {
      throw new Error(`Unknown or incomplete campaign option ${args[index] ?? ''}.`);
    }
  }
  const authorizationToken = option(args, 'authorize', false);
  const result = executeCampaignOperation({ operation: operation as 'plan' | 'status' | 'run',
    manifestFile: path.resolve(option(args, 'manifest')!),
    selectionFile: path.resolve(option(args, 'selection-manifest')!),
    ...(authorizationToken ? { authorizationToken } : {}) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
