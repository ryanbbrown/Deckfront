import fs from 'node:fs';
import { registerKingdom } from '../src/game';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { nativeScoreBatchRequest, nativeRuleFingerprint } from '../src/sim/nativeGoldfishProtocol';
import { ORDERED_PRODUCT_KINGDOM, orderedProductTarget } from '../src/sim/orderedGoldfishProduct';
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
function option(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

const start = integer('start-position');
const end = integer('end-position');
const threads = integer('threads');
const cpu = integer('cpu');
const seeds = option('seeds').split(',').map((value) => Number(value));
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? 'compact' : process.argv[modeIndex + 1];
if (end < start || threads < 1 || cpu < 1 || !seeds.length
  || seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)
  || new Set(seeds).size !== seeds.length || !['full', 'compact'].includes(mode ?? '')) {
  throw new Error('Invalid shard bounds, seeds, or score mode.');
}
const target = orderedProductTarget(option('kingdom', ORDERED_PRODUCT_KINGDOM));
const kingdom = deepBeamSuite.kingdoms.find((entry) => entry.id === target.kingdomId);
if (!kingdom) throw new Error(`Ordered product kingdom is not registered: ${target.kingdomId}`);
registerKingdom(kingdom);
const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdom.id));
const strategies = [...representativeCandidateIndices(space.candidateCount, end - start, start)]
  .map((index) => space.candidateAt(index));
const config = { kingdomId: kingdom.id, seeds, turnLimit: 30, actionCapPerTurn: 200 };
const request = nativeScoreBatchRequest(kingdom, strategies, config, threads, mode as 'full' | 'compact');
fs.writeFileSync(option('request'), `${JSON.stringify(request)}\n`);
fs.writeFileSync(option('metadata'), `${JSON.stringify({
  kingdomId: kingdom.id,
  completeCount: strategies.length,
  candidateDigest: stableHash(strategies.map(canonicalStrategy).join('\n')),
  ruleFingerprint: nativeRuleFingerprint(kingdom.id, 30, 200), shuffleSeeds: seeds, cpu, threads,
  firstCanonical: strategies.length ? canonicalStrategy(strategies[0]!) : null,
  lastCanonical: strategies.length ? canonicalStrategy(strategies.at(-1)!) : null
}, null, 2)}\n`);
