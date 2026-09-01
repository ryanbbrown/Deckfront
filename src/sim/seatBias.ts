import { FIRST_PLAYER_HEALTH_PENALTY, SeededRandom, playerStartingHealth } from '../game';
import type { CompetitiveBlock } from './nativeCompetitiveProtocol';
import { stableHash } from './strategy';
import type { NativeSeatBiasPenaltyScore } from './rustGoldfishScorer';

const RANDOM_HIGH_RANGE = 0x4000000;
const RANDOM_LOW_RANGE = 0x8000000;
const RANDOM_53_RANGE = 0x20000000000000;
const SEED_RANGE = 0x100000000;
const NORMAL_95 = 1.96;

export interface SeatBiasConfig {
  blocksPerKingdom: number;
  gamesPerKingdom: number;
  penalties: readonly number[];
  seed: number;
  threads: number;
}

export interface SeatBiasScheduleBlock extends CompetitiveBlock {
  uncertaintyBlockIndex: number;
}

export interface SeatBiasSchedule {
  kingdomId: string;
  samplingSeed: number;
  blocks: SeatBiasScheduleBlock[];
  ochreStrategyCounts: number[];
  indigoStrategyCounts: number[];
}

export interface SeatBiasCounts {
  firstPlayerWins: number;
  secondPlayerWins: number;
  draws: number;
  aborts: number;
  playedGames: number;
}

export interface SeatBiasInterval {
  lower: number;
  upper: number;
}

export interface SeatBiasMetric extends SeatBiasCounts {
  firstPlayerScore: number;
  monteCarloStandardError: number | null;
  confidence95: SeatBiasInterval | null;
}

export interface SeatBiasBlockDiagnostic extends SeatBiasCounts {
  blockIndex: number;
  firstPlayerScore: number | null;
}

export interface SeatBiasPenaltyDiagnostic extends SeatBiasMetric {
  penalty: number;
  attemptedGames: number;
  blocks: SeatBiasBlockDiagnostic[];
  abortReasons: Record<string, number>;
}

export interface SeatBiasKingdomDiagnostic {
  kingdomId: string;
  kingdomName: string;
  startingHealth: number;
  ruleFingerprint: string;
  catalogPlanCount: number;
  positiveWeightPlanCount: number;
  samplingSeed: number;
  matchedPairCount: number;
  ochreStrategyCounts: number[];
  indigoStrategyCounts: number[];
  penalties: SeatBiasPenaltyDiagnostic[];
}

export interface SeatBiasAggregateMetric extends SeatBiasMetric {
  penalty: number;
  attemptedGames: number;
  kingdomCount: number;
  crossKingdomStandardDeviation: number;
}

export interface SeatBiasReportIdentity {
  protocol: {
    seatBias: string;
    competitiveVersion: number;
    competitiveScorer: string;
  };
  catalog: {
    schemaVersion: number;
    sha256: string;
    kingdomCount: number;
    planCount: number;
    positiveWeightPlanCount: number;
  };
  kernel: {
    scorerVersion: string;
    sha256: string;
  };
}

export interface SeatBiasReport {
  schemaVersion: 1;
  identity: SeatBiasReportIdentity;
  config: {
    blocksPerKingdom: number;
    gamesPerKingdom: number;
    penalties: number[];
    seed: number;
    threads: number;
    kingdomIds: string[];
  };
  currentRule: {
    penalty: typeof FIRST_PLAYER_HEALTH_PENALTY;
    catalogStartingHealth: 50;
    firstPlayerStartingHealth: number;
  };
  aggregate: SeatBiasAggregateMetric[];
  kingdoms: SeatBiasKingdomDiagnostic[];
}

function validInteger(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function validateSeatBiasConfig(config: SeatBiasConfig): void {
  if (!validInteger(config.blocksPerKingdom, 1) || !validInteger(config.gamesPerKingdom, 2)
    || config.gamesPerKingdom % 2 !== 0
    || config.gamesPerKingdom % (2 * config.blocksPerKingdom) !== 0) {
    throw new Error('Games per kingdom must be even and divisible by twice the positive block count.');
  }
  if (!validInteger(config.seed, 0) || config.seed > 0xffff_ffff || config.threads !== 1) {
    throw new Error('Seat-bias evaluation needs a 32-bit seed and exactly one native thread.');
  }
  if (!config.penalties.length || new Set(config.penalties).size !== config.penalties.length
    || config.penalties.some((penalty) => !validInteger(penalty, 0))) {
    throw new Error('Seat-bias penalties must be unique non-negative integers.');
  }
}

function kingdomSeed(globalSeed: number, kingdomId: string): number {
  return Number.parseInt(stableHash(`seat-bias-v1:${globalSeed}:${kingdomId}`).slice(0, 8), 16) >>> 0;
}

function randomUnit53(random: SeededRandom): number {
  const high = random.nextInt(RANDOM_HIGH_RANGE);
  const low = random.nextInt(RANDOM_LOW_RANGE);
  return (high * RANDOM_LOW_RANGE + low) / RANDOM_53_RANGE;
}

function weightedIndex(random: SeededRandom, weights: readonly number[], total: number): number {
  const point = randomUnit53(random) * total;
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index]!;
    if (point < cumulative) return index;
  }
  return weights.length - 1;
}

export function createSeatBiasSchedule(input: {
  kingdomId: string;
  globalSeed: number;
  blocksPerKingdom: number;
  gamesPerKingdom: number;
  weights: readonly number[];
}): SeatBiasSchedule {
  validateSeatBiasConfig({ ...input, penalties: [3], seed: input.globalSeed, threads: 1 });
  if (!input.weights.length || input.weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error('Seat-bias sampling needs positive finite equilibrium weights.');
  }
  const total = input.weights.reduce((sum, weight) => sum + weight, 0);
  const samplingSeed = kingdomSeed(input.globalSeed, input.kingdomId);
  const random = new SeededRandom(samplingSeed);
  const pairCount = input.gamesPerKingdom / 2;
  const pairsPerBlock = pairCount / input.blocksPerKingdom;
  const ochreStrategyCounts = input.weights.map(() => 0);
  const indigoStrategyCounts = input.weights.map(() => 0);
  const blocks = Array.from({ length: pairCount }, (_unused, pairIndex): SeatBiasScheduleBlock => {
    const candidateIndex = weightedIndex(random, input.weights, total);
    const opponentIndex = weightedIndex(random, input.weights, total);
    ochreStrategyCounts[candidateIndex]! += 1;
    indigoStrategyCounts[opponentIndex]! += 1;
    return {
      candidateIndex,
      opponentIndex,
      seed: random.nextInt(SEED_RANGE),
      uncertaintyBlockIndex: Math.floor(pairIndex / pairsPerBlock)
    };
  });
  return { kingdomId: input.kingdomId, samplingSeed, blocks, ochreStrategyCounts, indigoStrategyCounts };
}

function emptyCounts(): SeatBiasCounts {
  return { firstPlayerWins: 0, secondPlayerWins: 0, draws: 0, aborts: 0, playedGames: 0 };
}

function addCounts(target: SeatBiasCounts, source: SeatBiasCounts): void {
  target.firstPlayerWins += source.firstPlayerWins;
  target.secondPlayerWins += source.secondPlayerWins;
  target.draws += source.draws;
  target.aborts += source.aborts;
  target.playedGames += source.playedGames;
}

function score(counts: SeatBiasCounts): number | null {
  return counts.playedGames
    ? (counts.firstPlayerWins + counts.draws * 0.5) / counts.playedGames
    : null;
}

function uncertainty(values: readonly number[], center: number): {
  monteCarloStandardError: number | null;
  confidence95: SeatBiasInterval | null;
} {
  if (values.length < 2) return { monteCarloStandardError: null, confidence95: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const monteCarloStandardError = Math.sqrt(variance / values.length);
  return { monteCarloStandardError, confidence95: {
    lower: Math.max(0, center - NORMAL_95 * monteCarloStandardError),
    upper: Math.min(1, center + NORMAL_95 * monteCarloStandardError)
  } };
}

export function summarizeSeatBiasPenalty(
  schedule: SeatBiasSchedule, blockCount: number, native: NativeSeatBiasPenaltyScore
): SeatBiasPenaltyDiagnostic {
  if (native.outcomes.length !== schedule.blocks.length * 2) {
    throw new Error(`Seat-bias penalty ${native.penalty} returned the wrong game count.`);
  }
  const abortByGame = new Map(native.aborts.map((abort) => {
    if (!validInteger(abort.blockIndex, 0) || abort.blockIndex >= schedule.blocks.length
      || ![0, 1].includes(abort.orientationIndex) || !abort.reason) {
      throw new Error(`Seat-bias penalty ${native.penalty} returned an invalid abort.`);
    }
    return [`${abort.blockIndex}:${abort.orientationIndex}`, abort.reason] as const;
  }));
  if (abortByGame.size !== native.aborts.length) {
    throw new Error(`Seat-bias penalty ${native.penalty} returned duplicate aborts.`);
  }
  const blockCounts = Array.from({ length: blockCount }, emptyCounts);
  const abortReasons: Record<string, number> = {};
  for (let pairIndex = 0; pairIndex < schedule.blocks.length; pairIndex += 1) {
    const block = schedule.blocks[pairIndex]!;
    const counts = blockCounts[block.uncertaintyBlockIndex];
    if (!counts) throw new Error('Seat-bias schedule has an invalid uncertainty block.');
    for (let orientationIndex = 0; orientationIndex < 2; orientationIndex += 1) {
      const outcome = native.outcomes[pairIndex * 2 + orientationIndex]!;
      if (outcome === 3) {
        counts.aborts += 1;
        const reason = abortByGame.get(`${pairIndex}:${orientationIndex}`);
        if (!reason) throw new Error(`Seat-bias penalty ${native.penalty} omitted an abort reason.`);
        abortReasons[reason] = (abortReasons[reason] ?? 0) + 1;
      } else if (outcome === 2) {
        counts.draws += 1;
        counts.playedGames += 1;
      } else if (outcome === orientationIndex) {
        counts.firstPlayerWins += 1;
        counts.playedGames += 1;
      } else if (outcome === (orientationIndex ^ 1)) {
        counts.secondPlayerWins += 1;
        counts.playedGames += 1;
      } else {
        throw new Error(`Seat-bias penalty ${native.penalty} returned invalid outcome ${outcome}.`);
      }
    }
  }
  if ([...abortByGame.keys()].some((key) => native.outcomes[
    Number(key.split(':')[0]) * 2 + Number(key.split(':')[1])
  ] !== 3)) throw new Error(`Seat-bias penalty ${native.penalty} attached a reason to a played game.`);
  const totals = emptyCounts();
  for (const counts of blockCounts) addCounts(totals, counts);
  const firstPlayerScore = score(totals);
  if (firstPlayerScore === null) throw new Error(`Seat-bias penalty ${native.penalty} has no played games.`);
  const blocks = blockCounts.map((counts, blockIndex): SeatBiasBlockDiagnostic => ({
    blockIndex, ...counts, firstPlayerScore: score(counts)
  }));
  const blockScores = blocks.flatMap((block) => block.firstPlayerScore === null ? [] : [block.firstPlayerScore]);
  return {
    penalty: native.penalty,
    attemptedGames: native.outcomes.length,
    ...totals,
    firstPlayerScore,
    ...uncertainty(blockScores, firstPlayerScore),
    blocks,
    abortReasons
  };
}

export function aggregateSeatBias(
  kingdoms: readonly SeatBiasKingdomDiagnostic[], penalties: readonly number[]
): SeatBiasAggregateMetric[] {
  if (!kingdoms.length) throw new Error('Seat-bias aggregation needs at least one kingdom.');
  return penalties.map((penalty): SeatBiasAggregateMetric => {
    const rows = kingdoms.map((kingdom) => {
      const row = kingdom.penalties.find((held) => held.penalty === penalty);
      if (!row) throw new Error(`Kingdom ${kingdom.kingdomId} is missing penalty ${penalty}.`);
      return row;
    });
    const totals = emptyCounts();
    for (const row of rows) addCounts(totals, row);
    const firstPlayerScore = rows.reduce((sum, row) => sum + row.firstPlayerScore, 0) / rows.length;
    const blockCount = rows[0]!.blocks.length;
    if (rows.some((row) => row.blocks.length !== blockCount)) {
      throw new Error('Seat-bias kingdoms have different uncertainty block counts.');
    }
    const aggregateBlockScores: number[] = [];
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
      const values = rows.map((row) => row.blocks[blockIndex]!.firstPlayerScore);
      if (values.some((value) => value === null)) continue;
      aggregateBlockScores.push((values as number[]).reduce((sum, value) => sum + value, 0) / values.length);
    }
    const crossVariance = rows.reduce((sum, row) => sum + (row.firstPlayerScore - firstPlayerScore) ** 2, 0)
      / rows.length;
    return {
      penalty,
      attemptedGames: rows.reduce((sum, row) => sum + row.attemptedGames, 0),
      kingdomCount: rows.length,
      ...totals,
      firstPlayerScore,
      ...uncertainty(aggregateBlockScores, firstPlayerScore),
      crossKingdomStandardDeviation: Math.sqrt(crossVariance)
    };
  });
}

export function buildSeatBiasReport(
  identity: SeatBiasReportIdentity, config: SeatBiasConfig, kingdoms: readonly SeatBiasKingdomDiagnostic[]
): SeatBiasReport {
  validateSeatBiasConfig(config);
  if (kingdoms.some((kingdom) => kingdom.startingHealth !== 50)) {
    throw new Error('The tracked seat-bias catalog must use base health 50.');
  }
  return {
    schemaVersion: 1,
    identity,
    config: {
      blocksPerKingdom: config.blocksPerKingdom,
      gamesPerKingdom: config.gamesPerKingdom,
      penalties: [...config.penalties],
      seed: config.seed,
      threads: config.threads,
      kingdomIds: kingdoms.map((kingdom) => kingdom.kingdomId)
    },
    currentRule: { penalty: FIRST_PLAYER_HEALTH_PENALTY, catalogStartingHealth: 50,
      firstPlayerStartingHealth: playerStartingHealth(50, true) },
    aggregate: aggregateSeatBias(kingdoms, config.penalties),
    kingdoms: [...kingdoms]
  };
}

export function serializeSeatBiasReport(report: SeatBiasReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
