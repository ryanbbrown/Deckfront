import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import rawSmokeManifest from '../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };

export interface SelfPlayBackfillOptions {
  root: string;
  binary: string;
  threads: number;
  report: string;
}

interface RustBackfillSummary {
  command: 'self-play-backfill';
  valid: true;
  kingdomId: string;
  initialStrategyCount: number;
  finalStrategyCount: number;
  scoredStrategyCount: number;
  gameCount: number;
  initialBytes: number;
  finalBytes: number;
}

const DEFAULT_ROOT = path.join('.data', 'strategy-search-30');
const DEFAULT_BINARY = path.join('rust', 'target', 'release', 'hexdeck-goldfish');
const DEFAULT_REPORT = path.join(DEFAULT_ROOT, 'self-play-backfill-v1.json');
const sha256File = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function parseSelfPlayBackfillCli(args: readonly string[]): SelfPlayBackfillOptions {
  const options: SelfPlayBackfillOptions = { root: DEFAULT_ROOT, binary: DEFAULT_BINARY, threads: 10,
    report: DEFAULT_REPORT };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--root') options.root = value;
    else if (flag === '--binary') options.binary = value;
    else if (flag === '--threads') options.threads = Number(value);
    else if (flag === '--report') options.report = value;
    else throw new Error(`Unknown option ${flag}.`);
  }
  if (!Number.isSafeInteger(options.threads) || options.threads < 1) throw new Error('--threads must be a positive integer.');
  return options;
}

function runOne(options: SelfPlayBackfillOptions, kingdomId: string): RustBackfillSummary {
  const base = path.join(options.root, kingdomId);
  const args = ['self-play-backfill', '--kingdom', kingdomId,
    '--top-file', path.join(base, 'goldfish', 'top-500000.hgf'),
    '--reservoir', path.join(base, 'goldfish', 'reservoir.hgf'),
    '--matrix-dir', path.join(base, 'matrix'), '--out', path.join(base, 'psro'),
    '--threads', String(options.threads)];
  const result = spawnSync(options.binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.signal || result.status !== 0) {
    throw new Error(`${kingdomId}: self-play backfill failed${result.signal ? ` with ${result.signal}` : ''}: ${(result.stderr ?? '').slice(-4_000).trim()}`);
  }
  const line = (result.stdout ?? '').trim().split(/\r?\n/u).filter(Boolean).at(-1);
  let summary: unknown;
  try { summary = line ? JSON.parse(line) : null; } catch { summary = null; }
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error(`${kingdomId}: backfill summary is not JSON.`);
  const held = summary as Partial<RustBackfillSummary>;
  if (held.command !== 'self-play-backfill' || held.valid !== true || held.kingdomId !== kingdomId
    || !Number.isSafeInteger(held.initialStrategyCount) || !Number.isSafeInteger(held.finalStrategyCount)
    || !Number.isSafeInteger(held.scoredStrategyCount) || !Number.isSafeInteger(held.gameCount)) {
    throw new Error(`${kingdomId}: backfill summary differs from the request.`);
  }
  return held as RustBackfillSummary;
}

export function backfillRustStrategySearchSelfPlay(options: SelfPlayBackfillOptions): Record<string, unknown> {
  const kingdomIds = (rawSmokeManifest as { selectedKingdomIds: string[] }).selectedKingdomIds;
  if (kingdomIds.length !== 30 || new Set(kingdomIds).size !== 30) throw new Error('Self-play backfill needs the exact 30 smoke kingdoms.');
  const binarySha256 = sha256File(options.binary);
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const summaries = kingdomIds.map((kingdomId, index) => {
    const summary = runOne(options, kingdomId), base = path.join(options.root, kingdomId);
    const initialFile = path.join(base, 'matrix', 'self-play-v1.hst');
    const finalFile = summary.finalStrategyCount === summary.initialStrategyCount
      ? initialFile : path.join(base, 'psro', 'self-play-v1.hst');
    const row = { ...summary, initial: { path: path.relative(options.root, initialFile).split(path.sep).join('/'),
      sha256: sha256File(initialFile) }, final: { path: path.relative(options.root, finalFile).split(path.sep).join('/'),
      sha256: sha256File(finalFile) } };
    process.stderr.write(`Backfilled ${index + 1}/${kingdomIds.length}: ${kingdomId}; scored ${summary.scoredStrategyCount} strategies.\n`);
    return row;
  });
  const report = { schemaVersion: 1, protocol: 'rust-self-play-backfill-v1', kingdomIds, gitCommit,
    binarySha256,
    totalStrategies: summaries.reduce((sum, row) => sum + row.finalStrategyCount, 0),
    scoredStrategiesThisRun: summaries.reduce((sum, row) => sum + row.scoredStrategyCount, 0),
    totalGames: summaries.reduce((sum, row) => sum + row.finalStrategyCount * 250, 0), summaries };
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  const temporary = `${options.report}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, options.report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseSelfPlayBackfillCli(process.argv.slice(2));
    const report = backfillRustStrategySearchSelfPlay(options);
    process.stdout.write(`${JSON.stringify({ report: options.report, totalGames: report.totalGames })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
