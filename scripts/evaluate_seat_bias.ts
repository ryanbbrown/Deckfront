import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findPretrainedKingdom, pretrainedVariableCardSets } from '../src/server/pretrainedCatalog';
import { NATIVE_COMPETITIVE_PROTOCOL_VERSION, NATIVE_COMPETITIVE_SCORER_VERSION,
  NATIVE_SEAT_BIAS_PROTOCOL_VERSION } from '../src/sim/nativeCompetitiveProtocol';
import { NATIVE_GOLDFISH_SCORER_VERSION } from '../src/sim/nativeGoldfishProtocol';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { RustGoldfishScorer } from '../src/sim/rustGoldfishScorer';
import { buildSeatBiasReport, createSeatBiasSchedule, serializeSeatBiasReport,
  summarizeSeatBiasPenalty, validateSeatBiasConfig } from '../src/sim/seatBias';
import type { SeatBiasConfig, SeatBiasKingdomDiagnostic } from '../src/sim/seatBias';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

interface Options extends SeatBiasConfig {
  output: string;
  kingdomIds: string[];
}

const TURN_LIMIT_PER_PLAYER = 30;
const ACTION_CAP_PER_TURN = 200;
const CATALOG_FILE = path.resolve('src/server/pretrained-opponents.json');

function valueAfter(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${args[index]} needs a value.`);
  return value;
}

function integerOption(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    blocksPerKingdom: 20,
    gamesPerKingdom: 1000,
    penalties: [2, 3, 4],
    seed: 20260901,
    threads: 1,
    output: path.resolve('.data/seat-bias-160.json'),
    kingdomIds: []
  };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!;
    const value = valueAfter(args, index);
    switch (name) {
      case '--blocks-per-kingdom': options.blocksPerKingdom = integerOption(name, value); break;
      case '--games-per-kingdom': options.gamesPerKingdom = integerOption(name, value); break;
      case '--penalties': options.penalties = value.split(',').map((held) => integerOption(name, held)); break;
      case '--seed': options.seed = integerOption(name, value); break;
      case '--threads': options.threads = integerOption(name, value); break;
      case '--output': options.output = path.resolve(value); break;
      case '--kingdom': options.kingdomIds.push(...value.split(',').filter(Boolean)); break;
      default: throw new Error(`Unknown option ${name}.`);
    }
  }
  validateSeatBiasConfig(options);
  return options;
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

const options = parseOptions(process.argv.slice(2));
const catalog = pretrainedVariableCardSets().map((cardIds) => {
  const entry = findPretrainedKingdom(cardIds);
  if (!entry) throw new Error('Tracked pretrained catalog entry could not be loaded.');
  return entry;
});
const requested = new Set(options.kingdomIds);
if (requested.size !== options.kingdomIds.length) throw new Error('A requested kingdom is duplicated.');
for (const kingdomId of requested) {
  if (!catalog.some((entry) => entry.id === kingdomId)) throw new Error(`Unknown pretrained kingdom ${kingdomId}.`);
}
const selected = requested.size ? catalog.filter((entry) => requested.has(entry.id)) : catalog;
const executable = process.env.HEXDECK_GOLDFISH_BIN ?? path.resolve('rust/target/release/hexdeck-goldfish');
const scorer = new RustGoldfishScorer(options.threads, options.threads, executable);
const diagnostics: SeatBiasKingdomDiagnostic[] = [];
try {
  for (const entry of selected) {
    const kingdom = strategySearchKingdom(entry.id);
    const positivePlans = entry.plans.filter((plan) => plan.equilibriumWeight > 0);
    const schedule = createSeatBiasSchedule({
      kingdomId: entry.id,
      globalSeed: options.seed,
      blocksPerKingdom: options.blocksPerKingdom,
      gamesPerKingdom: options.gamesPerKingdom,
      weights: positivePlans.map((plan) => plan.equilibriumWeight)
    });
    const kernelConfig = {
      kingdomId: entry.id,
      turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
      actionCapPerTurn: ACTION_CAP_PER_TURN,
      startingDraftEnabled: false
    } as const;
    const loadId = await scorer.loadCompetitive(
      kingdom, positivePlans.map((plan) => plan.strategy), kernelConfig, options.threads, options.threads
    );
    const native = await scorer.scoreSeatBias(loadId, schedule.blocks, options.penalties);
    diagnostics.push({
      kingdomId: entry.id,
      kingdomName: kingdom.name,
      startingHealth: kingdom.startingHealth,
      ruleFingerprint: rulesFingerprint(entry.id, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false).hash,
      catalogPlanCount: entry.plans.length,
      positiveWeightPlanCount: positivePlans.length,
      samplingSeed: schedule.samplingSeed,
      matchedPairCount: schedule.blocks.length,
      ochreStrategyCounts: schedule.ochreStrategyCounts,
      indigoStrategyCounts: schedule.indigoStrategyCounts,
      penalties: native.penalties.map((penalty) =>
        summarizeSeatBiasPenalty(schedule, options.blocksPerKingdom, penalty))
    });
  }
} finally {
  await scorer.close();
}

const planCount = catalog.reduce((sum, entry) => sum + entry.plans.length, 0);
const positiveWeightPlanCount = catalog.reduce((sum, entry) =>
  sum + entry.plans.filter((plan) => plan.equilibriumWeight > 0).length, 0);
const report = buildSeatBiasReport({
  protocol: {
    seatBias: NATIVE_SEAT_BIAS_PROTOCOL_VERSION,
    competitiveVersion: NATIVE_COMPETITIVE_PROTOCOL_VERSION,
    competitiveScorer: NATIVE_COMPETITIVE_SCORER_VERSION
  },
  catalog: {
    schemaVersion: 1,
    sha256: await sha256(CATALOG_FILE),
    kingdomCount: catalog.length,
    planCount,
    positiveWeightPlanCount
  },
  kernel: {
    scorerVersion: NATIVE_GOLDFISH_SCORER_VERSION,
    sha256: await sha256(executable)
  }
}, options, diagnostics);
await mkdir(path.dirname(options.output), { recursive: true });
await writeFile(options.output, serializeSeatBiasReport(report));
for (const aggregate of report.aggregate) {
  const current = aggregate.penalty === report.currentRule.penalty
    ? ` (current: ${report.currentRule.firstPlayerStartingHealth} health from ${report.currentRule.catalogStartingHealth})`
    : '';
  const interval = aggregate.confidence95
    ? `[${aggregate.confidence95.lower.toFixed(4)}, ${aggregate.confidence95.upper.toFixed(4)}]`
    : 'n/a';
  console.log(`Penalty ${aggregate.penalty}${current}: score ${aggregate.firstPlayerScore.toFixed(4)}; `
    + `W/L/D/A ${aggregate.firstPlayerWins}/${aggregate.secondPlayerWins}/${aggregate.draws}/${aggregate.aborts}; `
    + `95% MC interval ${interval}`);
}
console.log(`Wrote ${selected.length} kingdom${selected.length === 1 ? '' : 's'} to ${options.output}.`);
