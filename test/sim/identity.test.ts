import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertInvariants } from '../../src/game';
import type { GameState } from '../../src/game';
import { strategyAgent } from '../../src/sim/agents/strategyAgent';
import { runMatch } from '../../src/sim/match';
import { diagnosticLabels, diagnosticStrategies } from '../../src/sim/baselines';
import { identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { MatchResult } from '../../src/sim/types';

/**
 * The oracle for every performance change in `.plans/10-8-profiling.md`. A faster clone or an apply
 * path that skips events must leave all of this untouched. `scripts/write_match_oracle.ts --rewrite`
 * regenerates the file, and doing that is a decision about the engine, not a way to pass this test.
 */
interface OracleCase {
  name: string;
  kingdomId: string;
  seed: number;
  ochre: string;
  indigo: string;
  firstPlayerId: 'ochre' | 'indigo';
  swapSides: boolean;
  result: MatchResult;
  state?: GameState;
}

const oraclePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'match-oracle.json'
);
const { cases } = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as { cases: OracleCase[] };

/** Headline facts written by hand, so a shrunken or silently regenerated oracle fails here first. */
const HEADLINES: Record<string, { outcome: string; reason: string; turns: number }> = {
  'three-way-engine:11': { outcome: 'ochre', reason: 'victory', turns: 22 },
  'three-way-engine:12': { outcome: 'ochre', reason: 'victory', turns: 21 },
  'range-rich-mixed:14': { outcome: 'indigo', reason: 'victory', turns: 20 },
  'current-duel:15': { outcome: 'draw', reason: 'turnLimit', turns: 200 },
  'three-way-open:16': { outcome: 'ochre', reason: 'victory', turns: 15 },
  'three-way-engine:17': { outcome: 'draw', reason: 'turnLimit', turns: 200 }
};

function key(entry: { kingdomId: string; seed: number }): string {
  return `${entry.kingdomId}:${entry.seed}`;
}

function oracleStrategy(kingdomId: string, label: string): Strategy {
  if (label === 'no-attack') return identify({
    id: label, startingBuild: [], buyAgenda: [], repeatPurchase: 'silver'
  });
  const labels = diagnosticLabels(kingdomId);
  const found = diagnosticStrategies(kingdomId).find((entry) => labels.get(entry.id) === label);
  if (!found) throw new Error(`No ${label} seed in ${kingdomId}.`);
  return found;
}

function play(entry: OracleCase): { result: MatchResult; state: GameState } {
  let last: GameState | null = null;
  const result = runMatch({
    kingdomId: entry.kingdomId,
    seed: entry.seed,
    firstPlayerId: entry.firstPlayerId,
    swapSides: entry.swapSides,
    turnLimitPerPlayer: 100,
    actionCapPerTurn: 200,
    agents: {
      ochre: strategyAgent(oracleStrategy(entry.kingdomId, entry.ochre)),
      indigo: strategyAgent(oracleStrategy(entry.kingdomId, entry.indigo))
    }
  }, (state) => { last = state; });
  return { result, state: last as unknown as GameState };
}

const played = new Map(cases.map((entry) => [key(entry), play(entry)]));

describe('match result identity', () => {
  it('covers every case the oracle is required to hold', () => {
    expect(cases.map(key).sort()).toEqual(Object.keys(HEADLINES).sort());
    // Mana and pending choices come from Channel, Prism, and Reclaim, which only `three-way-engine`
    // sells, and the quadratic clone cost only shows in a match that reaches the turn limit.
    const nearLimit = cases.filter((entry) => entry.result.turns >= 200);
    expect(nearLimit.some((entry) => entry.kingdomId === 'three-way-engine')).toBe(true);
    expect(cases.filter((entry) => entry.state).length).toBe(1);
  });

  it.each(cases.map((entry) => [key(entry), entry] as const))(
    '%s replays to the stored result',
    (id, entry) => {
      const { result } = played.get(id)!;
      expect(result).toEqual(entry.result);
      expect({ outcome: result.outcome, reason: result.reason, turns: result.turns })
        .toEqual(HEADLINES[id]);
    }
  );

  it.each(cases.filter((entry) => entry.state).map((entry) => [key(entry), entry] as const))(
    '%s replays to the stored final state and event log',
    (id, entry) => {
      const { state } = played.get(id)!;
      // Through JSON, because the oracle is JSON: an absent field and an `undefined` one are the
      // same there, and every value in `GameState` is JSON data.
      expect(JSON.parse(JSON.stringify(state)) as unknown).toEqual(entry.state);
      expect(state.events.length).toBe(entry.result.telemetry.eventCount);
    }
  );

  it.each(cases.map((entry) => [key(entry), entry] as const))(
    '%s ends with contiguous event sequences and a valid state',
    (id) => {
      const { state } = played.get(id)!;
      expect(state.events.map((event) => event.sequence)).toEqual(state.events.map((_, index) => index));
      expect(() => assertInvariants(state)).not.toThrow();
    }
  );
});
