import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { ModalCompetitiveEvaluator } from '../src/sim/modalCompetitiveEvaluator';
import type { CandidateEvaluation, MixtureSchedule } from '../src/sim/mixtureEvaluation';
import { RustCompetitiveEvaluator } from '../src/sim/rustCompetitiveEvaluator';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';
import type { Strategy } from '../src/sim/strategy';

interface SmokeFixture {
  schemaVersion: 1;
  kind: 'k007-threshold-broad-look-slice';
  kingdomId: string;
  lookId: string;
  candidates: Strategy[];
  opponents: Strategy[];
  schedule: MixtureSchedule;
  expectedScoreDigest: string;
}

interface SmokeOptions {
  mode: 'local' | 'modal';
  out: string;
  fixture: string;
}

const defaultFixture = path.resolve('test/sim/fixtures/k007-threshold-broad-look-slice.json');
const defaultOut = path.resolve('.experiments/modal-competitive-digest-smoke');
const config = { kingdomId: 'deep-beam-tuning-007', turnLimitPerPlayer: 30,
  actionCapPerTurn: 200, startingDraftEnabled: false } as const;
const runner = { async run() { throw new Error('Competitive evaluator owns digest smoke scoring.'); },
  async close() {} };

export function parseSmokeOptions(args: readonly string[]): SmokeOptions {
  const modes = ['--local', '--modal'].filter((flag) => args.includes(flag));
  if (modes.length !== 1) throw new Error('Use exactly one digest smoke mode: --local or --modal.');
  const value = (name: string) => {
    const index = args.indexOf(name), held = args[index + 1];
    if (index < 0 || !held || held.startsWith('--')) throw new Error(`${name} needs a value.`);
    return held;
  };
  const allowed = new Set([modes[0]!, '--out', '--fixture']);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index]!)) throw new Error(`Unknown digest smoke option ${args[index]}.`);
    if (args[index] === '--out' || args[index] === '--fixture') index += 1;
  }
  return { mode: modes[0] === '--local' ? 'local' : 'modal',
    out: args.includes('--out') ? path.resolve(value('--out')) : defaultOut,
    fixture: args.includes('--fixture') ? path.resolve(value('--fixture')) : defaultFixture };
}

function scoreDigest(rows: readonly CandidateEvaluation[]): string {
  const bytes = rows.flatMap((row) => row.blockScores.map((score) => score * 4));
  if (bytes.some((score) => !Number.isSafeInteger(score) || score < 0 || score > 4)) {
    throw new Error('Digest smoke received a non-quarter-point score.');
  }
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

async function localRows(fixture: SmokeFixture, kingdom: NonNullable<ReturnType<typeof deepBeamSuite.kingdoms.find>>) {
  const scorer = new RustGoldfishScorer(4);
  try {
    const resident = [...fixture.candidates, ...fixture.opponents];
    const evaluator = await RustCompetitiveEvaluator.create(scorer, kingdom, resident, config, 4);
    return await evaluator.evaluate(fixture.candidates,
      new Map(fixture.opponents.map((strategy) => [strategy.id, strategy])), fixture.schedule,
      runner as never, { ...config, scoreOnly: true });
  } finally { await scorer.close(); }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseSmokeOptions(args);
  const fixture = JSON.parse(fs.readFileSync(options.fixture, 'utf8')) as SmokeFixture;
  const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === fixture.kingdomId);
  if (fixture.schemaVersion !== 1 || fixture.kind !== 'k007-threshold-broad-look-slice'
    || !kingdom || fixture.candidates.length < 2 || fixture.schedule.blocks.length !== 8
    || !/^[0-9a-f]{64}$/.test(fixture.expectedScoreDigest)) {
    throw new Error('Competitive digest smoke fixture is invalid.');
  }
  registerKingdom(kingdom);
  const local = await localRows(fixture, kingdom);
  const localDigest = scoreDigest(local);
  if (localDigest !== fixture.expectedScoreDigest) {
    throw new Error(`Local Rust digest ${localDigest} differs from saved ${fixture.expectedScoreDigest}.`);
  }
  if (options.mode === 'local') {
    console.log(JSON.stringify({ mode: 'local', candidates: fixture.candidates.length,
      blocks: fixture.schedule.blocks.length, scoreDigest: localDigest, paidWork: false }, null, 2));
    return;
  }
  const buildVersion = process.env.HEXDECK_BUILD_VERSION
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const modal = new ModalCompetitiveEvaluator(kingdom, [...fixture.candidates, ...fixture.opponents],
    config, options.out, buildVersion);
  const remote = await modal.evaluate(fixture.candidates,
    new Map(fixture.opponents.map((strategy) => [strategy.id, strategy])), fixture.schedule,
    runner as never, { ...config, scoreOnly: true, lookId: fixture.lookId });
  const modalDigest = scoreDigest(remote);
  if (modalDigest !== localDigest) {
    throw new Error(`Modal digest ${modalDigest} differs from local Rust ${localDigest}.`);
  }
  console.log(JSON.stringify({ mode: 'modal', candidates: fixture.candidates.length,
    blocks: fixture.schedule.blocks.length, localDigest, modalDigest, match: true }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
