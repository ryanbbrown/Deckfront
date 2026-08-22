/**
 * Rewrites the match oracle that `test/sim/identity.test.ts` compares against. Plan
 * `.plans/10-8-profiling.md` requires the identity of every stored `MatchResult` to survive the
 * profiling changes, so a rewrite is a decision about the engine, not a way to make a test pass.
 * Justify a rewrite in the commit message and say which engine change moved the numbers.
 *
 * Run with: npx tsx scripts/write_match_oracle.ts --rewrite
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { strategyAgent } from '../src/sim/agents/strategyAgent';
import { runMatch } from '../src/sim/match';
import { diagnosticLabels, diagnosticStrategies } from '../src/sim/baselines';
import { INFINITE_COUNT, identify } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import type { GameState } from '../src/game';
import type { MatchResult } from '../src/sim/types';

interface OracleCase {
  name: string;
  kingdomId: string;
  seed: number;
  ochre: string;
  indigo: string;
  firstPlayerId: 'ochre' | 'indigo';
  swapSides: boolean;
  /** Set when the whole final state, including the event log, is compared by deep equality. */
  storeState: boolean;
}

const CASES: readonly OracleCase[] = [
  { name: 'mana and pending choices', kingdomId: 'three-way-engine', seed: 11, ochre: 'mage', indigo: 'engine', firstPlayerId: 'ochre', swapSides: false, storeState: true },
  { name: 'engine against money', kingdomId: 'three-way-engine', seed: 12, ochre: 'engine', indigo: 'money', firstPlayerId: 'indigo', swapSides: true, storeState: false },
  { name: 'ranged against mage', kingdomId: 'range-rich-mixed', seed: 14, ochre: 'ranged-volley', indigo: 'mage', firstPlayerId: 'indigo', swapSides: false, storeState: false },
  { name: 'no attacks, turn limit', kingdomId: 'current-duel', seed: 15, ochre: 'no-attack', indigo: 'no-attack', firstPlayerId: 'ochre', swapSides: false, storeState: false },
  { name: 'melee against mage', kingdomId: 'three-way-open', seed: 16, ochre: 'melee', indigo: 'mage', firstPlayerId: 'indigo', swapSides: true, storeState: false },
  { name: 'mana kingdom at the turn limit', kingdomId: 'three-way-engine', seed: 17, ochre: 'no-attack', indigo: 'no-attack', firstPlayerId: 'ochre', swapSides: false, storeState: false }
];

function oracleStrategy(kingdomId: string, label: string): Strategy {
  if (label === 'no-attack') return identify({
    id: label, startingBuild: [], buyPlan: [{ kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }]
  });
  const labels = diagnosticLabels(kingdomId);
  const found = diagnosticStrategies(kingdomId).find((entry) => labels.get(entry.id) === label);
  if (!found) throw new Error(`No ${label} seed in ${kingdomId}.`);
  return found;
}

export const ORACLE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'sim', 'fixtures', 'match-oracle.json'
);

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
  if (!last) throw new Error(`Match ${entry.kingdomId}/${entry.seed} produced no state.`);
  return { result, state: last };
}

if (!process.argv.includes('--rewrite')) {
  process.stderr.write('Pass --rewrite to replace the committed oracle. Read this file first.\n');
  process.exitCode = 1;
} else {
  const cases = CASES.map((entry) => {
    const { result, state } = play(entry);
    const { storeState, ...fixed } = entry;
    return { ...fixed, result, ...(storeState ? { state } : {}) };
  });
  fs.mkdirSync(path.dirname(ORACLE_PATH), { recursive: true });
  fs.writeFileSync(ORACLE_PATH, `${JSON.stringify({ cases }, null, 1)}\n`);
  process.stdout.write(`Wrote ${cases.length} cases to ${ORACLE_PATH}\n`);
}
