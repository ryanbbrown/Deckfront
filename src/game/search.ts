import { applyAction, listLegalActions } from './engine';
import type { GameState, SearchResult } from './types';

export function findMaximumPoints(state: GameState): SearchResult {
  if (state.phase !== 'action') throw new Error('Tactical search requires the action phase.');
  const playerId = state.activePlayerId;
  let bestPoints = 0;
  let best = [] as ReturnType<typeof listLegalActions>;
  const actions = listLegalActions(state);
  for (const action of actions) {
    const next = applyAction(state, action.id);
    const points = next.scores[playerId] - state.scores[playerId];
    if (points > bestPoints) { bestPoints = points; best = [action]; }
    else if (points === bestPoints && points > 0) best.push(action);
  }
  return { points: bestPoints, actions: best, exploredStates: actions.length + 1 };
}
