import { kingdomMarket, marketCost } from '../../game';
import type { GameState } from '../../game';
import { chooseBuyAction } from '../buy';
import { DEFAULT_STATE_LIMIT, createMemo, searchAction, searchBaseline } from '../search';
import type { SearchBaseline, SearchMemo } from '../search';
import type { Strategy } from '../strategy';
import type { Agent } from '../types';

/** `submitBuild` and `finishSetup` both settle the starting build against this budget. */
export const STARTING_BUDGET = 12;

export interface StrategyAgentOptions {
  stateLimit?: number;
  memo?: boolean;
  onSearch?: (report: { visited: number; milliseconds: number }) => void;
}

/**
 * Drops cards the market does not offer, then drops from the end until the resolved cost fits the
 * budget. Kingdom overrides re-price cards, so a build that fits one kingdom can overrun another.
 * Leftover money is not spent: it carries into the first Buy phase as `firstBuyMoney`.
 */
export function repairBuild(state: GameState, build: readonly string[]): string[] {
  const offered = new Set(kingdomMarket(state.kingdomId).map((definition) => definition.id));
  const kept = build.filter((cardId) => offered.has(cardId));
  while (kept.length && marketCost(state, kept) > STARTING_BUDGET) kept.pop();
  return kept;
}

export function strategyAgent(strategy: Strategy, options: StrategyAgentOptions = {}): Agent {
  const stateLimit = options.stateLimit ?? DEFAULT_STATE_LIMIT;
  const useMemo = options.memo ?? true;
  let phaseKey = '';
  let baseline: SearchBaseline | null = null;
  let memo: SearchMemo | null = null;

  return {
    id: strategy.id,
    chooseStartingBuild(state) { return repairBuild(state, strategy.startingBuild); },
    chooseAction(state, playerId, actions) {
      if (state.phase === 'buy') return chooseBuyAction(state, playerId, actions, strategy);

      // One baseline and one memo serve every decision of an Action phase.
      const current = `${state.turn}:${playerId}`;
      if (current !== phaseKey) {
        phaseKey = current;
        baseline = searchBaseline(state, playerId);
        memo = useMemo ? createMemo() : null;
      }
      const started = performance.now();
      const outcome = searchAction(state, playerId, actions, strategy, baseline!, { stateLimit, memo });
      options.onSearch?.({ visited: outcome.visited, milliseconds: performance.now() - started });
      return outcome.action;
    }
  };
}
