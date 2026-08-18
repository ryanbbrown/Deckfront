import { repairBuild } from '../build';
import { chooseBuyAction } from '../buy';
import { DEFAULT_STATE_LIMIT, createMemo, searchAction, searchBaseline } from '../search';
import type { SearchBaseline, SearchMemo } from '../search';
import type { Strategy } from '../strategy';
import type { Agent } from '../types';

export interface StrategyAgentOptions {
  stateLimit?: number;
  memo?: boolean;
  onSearch?: (report: { visited: number; milliseconds: number }) => void;
}

export function strategyAgent(strategy: Strategy, options: StrategyAgentOptions = {}): Agent {
  const stateLimit = options.stateLimit ?? DEFAULT_STATE_LIMIT;
  const useMemo = options.memo ?? true;
  const observer = options.onSearch;
  let phaseKey = '';
  let baseline: SearchBaseline | null = null;
  let memo: SearchMemo | null = null;

  return {
    id: strategy.id,
    chooseStartingBuild(state) { return repairBuild(state, strategy.startingBuild); },
    chooseAction(state, playerId, actions) {
      if (state.phase === 'buy') return chooseBuyAction(state, playerId, actions, strategy);

      // One baseline and one memo serve every decision of an Action phase. Nothing binds an agent to
      // a single match, and a round robin reuses one agent per strategy, so a shorter event log than
      // the recorded index means a new match started and both must be rebuilt: the phase key alone
      // repeats across matches.
      const current = `${state.turn}:${playerId}`;
      if (current !== phaseKey || !baseline || state.events.length < baseline.eventIndex) {
        phaseKey = current;
        baseline = searchBaseline(state, playerId);
        memo = useMemo ? createMemo() : null;
      }

      // The clock reads only when someone is listening: this is the loop the goal's throughput rests on.
      if (!observer) return searchAction(state, playerId, actions, strategy, baseline, { stateLimit, memo }).action;
      const started = performance.now();
      const outcome = searchAction(state, playerId, actions, strategy, baseline, { stateLimit, memo });
      observer({ visited: outcome.visited, milliseconds: performance.now() - started });
      return outcome.action;
    }
  };
}
