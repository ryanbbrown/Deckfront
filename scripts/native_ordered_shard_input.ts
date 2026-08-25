import fs from 'node:fs';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { nativeScoreBatchRequest, nativeRuleFingerprint } from '../src/sim/nativeGoldfishProtocol';
import {
  createOrderedCandidateSpace, orderedGoldfishCardIds, representativeCandidateIndices
} from '../src/sim/orderedGoldfishBenchmark';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';

function integer(name: string): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = Number(index < 0 ? Number.NaN : process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a nonnegative integer.`);
  return value;
}
function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

const start = integer('start-position');
const end = integer('end-position');
const threads = integer('threads');
const cpu = integer('cpu');
const shuffles = integer('shuffles');
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? 'compact' : process.argv[modeIndex + 1];
if (end < start || threads < 1 || cpu < 1 || shuffles < 1 || !['full', 'compact'].includes(mode ?? '')) {
  throw new Error('Invalid shard bounds or score mode.');
}
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === 'deep-beam-tuning-009')!;
registerKingdom(kingdom);
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
const strategies = [...representativeCandidateIndices(space.candidateCount, end - start, start)]
  .map((index) => space.candidateAt(index));
const config = { kingdomId: kingdom.id,
  seeds: Array.from({ length: shuffles }, (_unused, index) => 4_100_000 + index),
  turnLimit: 30, actionCapPerTurn: 200 };
const request = nativeScoreBatchRequest(kingdom, strategies, config, threads, mode as 'full' | 'compact');
fs.writeFileSync(option('request'), `${JSON.stringify(request)}\n`);
fs.writeFileSync(option('metadata'), `${JSON.stringify({
  completeCount: strategies.length,
  candidateDigest: stableHash(strategies.map(canonicalStrategy).join('\n')),
  ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200), cpu, threads,
  firstCanonical: strategies.length ? canonicalStrategy(strategies[0]!) : null,
  lastCanonical: strategies.length ? canonicalStrategy(strategies.at(-1)!) : null
}, null, 2)}\n`);
