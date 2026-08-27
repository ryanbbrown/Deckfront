import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  exists: boolean; campaignExecutionId: string; status: 'missing' | 'running' | 'complete' | 'failed';
  report?: Record<string, unknown>;
}
export interface StrategySearchOperatorAdapter {
  status(input: { campaignExecutionId: string }): StrategySearchRemoteStatus;
  run(input: { bundle: StrategySearchLaunchBundle; destinationRoot: string }): unknown;
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
export function deriveTrackedStrategySearchSourceImage(root: string): SourceImageIdentity {
  const expectedPaths = executableSourcePaths(root);
  const tracked = new Set(git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const missing = expectedPaths.filter((entry) => !tracked.has(entry) || !fs.existsSync(path.join(root, entry)));
  if (missing.length) throw new Error(`Executable image allowlist has missing or untracked files: ${missing.join(', ')}`);
  const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean)
    .map((entry) => entry.slice(3)).filter((entry) => expectedPaths.includes(entry));
  return deriveSourceImageIdentity({ expectedPaths, dirtyExecutablePaths: dirty,
    files: expectedPaths.map((relative) => ({ path: relative, content: fs.readFileSync(path.join(root, relative)) })) });
}
function lastJson(output: string): unknown {
  for (const line of output.split('\n').reverse()) {
    try { return JSON.parse(line) as unknown; } catch { /* Modal can emit progress lines. */ }
  }
  throw new Error('Modal strategy-search adapter returned no JSON.');
}
export class ModalStrategySearchOperatorAdapter implements StrategySearchOperatorAdapter {
  status(input: { campaignExecutionId: string }): StrategySearchRemoteStatus {
    return lastJson(execFileSync('modal', ['run', 'modal/native_strategy_search.py::strategy_search_status_entry',
      '--campaign-execution-id', input.campaignExecutionId], { encoding: 'utf8' })) as StrategySearchRemoteStatus;
  }
  run(input: { bundle: StrategySearchLaunchBundle; destinationRoot: string }): unknown {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-strategy-search-'));
    const bundleFile = path.join(directory, 'bundle.json'); fs.writeFileSync(bundleFile, `${JSON.stringify(input.bundle)}\n`);
    try {
      const outcome = lastJson(execFileSync('modal', ['run', 'modal/native_strategy_search.py::strategy_search_run_entry',
        '--launch-config', bundleFile, '--download-dir', input.destinationRoot], { encoding: 'utf8' }));
      for (const task of input.bundle.tasks.filter((entry) => entry.stage === 'psro')) {
        const evidenceRoot = path.join(input.destinationRoot, 'evidence', task.evidenceId);
        for (const [stage, relative] of [['goldfish-one-reduce', 'goldfish/top-500000.json'],
          ['goldfish-two-reduce', 'goldfish/reservoir.json'], ['matrix', 'matrix/evidence.json'],
          ['psro', 'psro/evidence.json']] as const) {
          execFileSync('npx', ['tsx', 'scripts/strategy_search_validate_artifact.ts', '--stage', stage,
            '--file', path.join(evidenceRoot, relative), '--evidence-id', task.evidenceId,
            '--kingdom', task.kingdomId, '--evidence-root', evidenceRoot],
          { cwd: process.cwd(), stdio: 'pipe' });
        }
      }
      return outcome;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
function parseInput(requestFile: string, root: string): ParsedStrategySearchRequest {
  const request = parseStrategySearchRequest(JSON.parse(fs.readFileSync(requestFile, 'utf8')) as unknown);
  return deriveStrategySearch({ request, sourceImage: deriveTrackedStrategySearchSourceImage(root) });
}
export function executeStrategySearchOperation(input: { operation: 'plan' | 'status' | 'run'; requestFile: string;
  authorizationToken?: string; root?: string; adapter?: StrategySearchOperatorAdapter }): Record<string, unknown> {
  const root = input.root ?? process.cwd(), parsed = parseInput(input.requestFile, root);
  if (input.operation === 'plan') return { ...createStrategySearchPlanSummary(parsed) };
  const adapter = input.adapter ?? new ModalStrategySearchOperatorAdapter();
  const status = adapter.status({ campaignExecutionId: parsed.campaignExecutionId });
  if (status.campaignExecutionId !== parsed.campaignExecutionId) throw new Error('Remote execution identity differs.');
  if (input.operation === 'status') return { ...status, orderedEvidenceIds: parsed.kingdoms.map((entry) => entry.evidenceId) };
  if (!input.authorizationToken || !validateLaunchAuthorizationToken(input.authorizationToken, parsed)) {
    throw new Error('Run requires the exact authorization token printed by plan.');
  }
  const destinationRoot = path.resolve(root, parsed.downloadRoot);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const outcome = adapter.run({ bundle: createStrategySearchLaunchBundle(parsed), destinationRoot });
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
  const result = executeStrategySearchOperation({ operation: operation as 'plan' | 'status' | 'run',
    requestFile: path.resolve(option(args, 'request')!), ...(authorizationToken ? { authorizationToken } : {}) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
