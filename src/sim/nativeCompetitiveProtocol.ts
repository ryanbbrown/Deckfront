import { createHash } from 'node:crypto';
import { FIRST_PLAYER_HEALTH_PENALTY } from '../game';
import type { Kingdom } from '../game';
import { nativeKingdomInput } from './nativeGoldfishProtocol';
import { rulesFingerprint } from './rulesFingerprint';
import { INFINITE_COUNT, canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';
import type { MixtureSchedule } from './mixtureEvaluation';

export const NATIVE_COMPETITIVE_PROTOCOL_VERSION = 1;
export const NATIVE_COMPETITIVE_SCORER_VERSION = 'native-competitive-v1';

export interface CompetitiveKernelConfig {
  kingdomId: string;
  turnLimitPerPlayer: number;
  actionCapPerTurn: number;
  startingDraftEnabled: boolean;
}

export interface CompetitiveBlock {
  candidateIndex: number;
  opponentIndex: number;
  seed: number;
}

export function competitiveLoadId(
  kingdom: Kingdom, strategies: readonly Strategy[], config: CompetitiveKernelConfig
): string {
  return stableHash(JSON.stringify({ kingdomId: kingdom.id, strategyIds: strategies.map((strategy) => strategy.id),
    config, ruleFingerprint: rulesFingerprint(kingdom.id, config.turnLimitPerPlayer,
      config.actionCapPerTurn, config.startingDraftEnabled).hash }));
}

export function nativeCompetitiveLoadRequest(
  kingdom: Kingdom, strategies: readonly Strategy[], config: CompetitiveKernelConfig,
  threads: number, cpuRequest = threads
) {
  if (config.kingdomId !== kingdom.id) throw new Error('Competitive kingdom does not match its config.');
  if (!Number.isSafeInteger(threads) || threads < 1 || threads > cpuRequest) {
    throw new Error('Competitive native threads must be positive and no greater than CPU request.');
  }
  const loadId = competitiveLoadId(kingdom, strategies, config);
  return { type: 'load_competitive' as const, payload: {
    protocolVersion: NATIVE_COMPETITIVE_PROTOCOL_VERSION,
    scorerVersion: NATIVE_COMPETITIVE_SCORER_VERSION,
    loadId,
    ruleFingerprint: rulesFingerprint(kingdom.id, config.turnLimitPerPlayer,
      config.actionCapPerTurn, config.startingDraftEnabled).hash,
    kingdom: nativeKingdomInput(kingdom),
    strategies: strategies.map((strategy) => ({ ...strategy, canonicalStrategy: canonicalStrategy(strategy) })),
    turnLimitPerPlayer: config.turnLimitPerPlayer,
    actionCapPerTurn: config.actionCapPerTurn,
    startingDraftEnabled: config.startingDraftEnabled,
    infiniteCount: INFINITE_COUNT,
    firstPlayerHealthPenalty: FIRST_PLAYER_HEALTH_PENALTY,
    threads,
    cpuRequest
  } };
}

export function nativeCompetitiveScoreRequest(loadId: string, blocks: readonly CompetitiveBlock[]) {
  return { type: 'score_competitive' as const, payload: { loadId, blocks } };
}

export function nativeCompetitiveFixtureRequest(
  loadId: string, block: CompetitiveBlock, firstPlayer: 'ochre' | 'indigo'
) {
  return { type: 'fixture_competitive' as const, payload: {
    loadId, candidateIndex: block.candidateIndex, opponentIndex: block.opponentIndex,
    seed: block.seed, firstPlayer
  } };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0).map(([key, held]) =>
    `${JSON.stringify(key)}:${canonicalJson(held)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function nativeCompetitiveModalInput(
  kingdom: Kingdom, candidates: readonly Strategy[], residentStrategies: readonly Strategy[],
  schedule: MixtureSchedule, config: CompetitiveKernelConfig, threads: number, cpuRequest: number,
  lookId: string
) {
  const table: Strategy[] = [];
  const indexes = new Map<string, number>();
  for (const strategy of [...candidates, ...residentStrategies]) {
    const existing = indexes.get(strategy.id);
    if (existing !== undefined) {
      if (canonicalStrategy(table[existing]!) !== canonicalStrategy(strategy)) {
        throw new Error(`Competitive strategy id collision: ${strategy.id}.`);
      }
      continue;
    }
    indexes.set(strategy.id, table.length);
    table.push(strategy);
  }
  const loadRequest = nativeCompetitiveLoadRequest(kingdom, table, config, threads, cpuRequest);
  const value = { schemaVersion: 1, loadRequest, candidateCount: candidates.length, lookId,
    schedule: schedule.blocks.map((block) => {
      const opponentIndex = indexes.get(block.opponentId);
      if (opponentIndex === undefined) throw new Error(`Mixture opponent ${block.opponentId} is not resident.`);
      return { seed: block.seed, opponentIndex };
    }) };
  return { ...value, inputHash: createHash('sha256').update(canonicalJson(value)).digest('hex') };
}
