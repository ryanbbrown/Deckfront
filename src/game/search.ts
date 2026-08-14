import { applyAction, listLegalActions } from './engine';
import { cardDefinition } from './config';
import type { GameState, LegalAction, PlayerId, SearchResult } from './types';

interface CachedResult {
  points: number;
  actions: LegalAction[];
}

function searchKey(state: GameState): string {
  return JSON.stringify({
    activePlayerId: state.activePlayerId,
    phase: state.phase,
    scores: state.scores,
    winner: state.winner,
    players: state.players,
    pieces: state.pieces,
    blocks: state.blocks,
    supply: state.supply,
    trash: state.trash,
    turn: state.turn,
    rngState: state.rngState,
    nextCardSerial: state.nextCardSerial,
    nextBlockSerial: state.nextBlockSerial
  });
}

function tacticalActions(state: GameState): LegalAction[] {
  return listLegalActions(state).filter((action) => {
    if (state.phase === 'respawn') return action.command.type === 'respawn';
    return action.command.type !== 'enterBuyPhase';
  });
}

function actionPriority(action: LegalAction): number {
  switch (action.command.type) {
    case 'playPress':
    case 'playCorner': return 6;
    case 'playShove':
    case 'playDrive':
    case 'playBreaker':
    case 'playPull':
    case 'playSweep': return 5;
    case 'baselineMove': return 4;
    case 'playDash':
    case 'playVault':
    case 'playRelay': return 3;
    default: return 1;
  }
}

function displacementBudget(state: GameState, playerId: PlayerId): number {
  return state.players[playerId].deck.hand.reduce((total, card) => {
    switch (cardDefinition(card.definitionId).mechanic) {
      case 'press':
      case 'corner': return total + 2;
      case 'shove':
      case 'drive':
      case 'breaker':
      case 'pull':
      case 'sweep': return total + 1;
      default: return total;
    }
  }, 0);
}

function ringOutUpperBound(state: GameState, playerId: PlayerId): number {
  let budget = displacementBudget(state, playerId);
  const minimumSteps = Object.values(state.pieces)
    .filter((piece) => piece.ownerId !== playerId && piece.position)
    .map((piece) => {
      const position = piece.position!;
      const depth = Math.max(Math.abs(position.q), Math.abs(position.r), Math.abs(position.q + position.r));
      return 3 - depth;
    })
    .sort((left, right) => left - right);
  let ringOuts = 0;
  for (const steps of minimumSteps) {
    if (steps > budget) break;
    budget -= steps;
    ringOuts += 1;
  }
  return ringOuts;
}

export function findMaximumPoints(state: GameState): SearchResult {
  if (state.phase !== 'action' && state.phase !== 'respawn') {
    throw new Error('Tactical search requires an action or respawn phase.');
  }
  const playerId: PlayerId = state.activePlayerId;
  const initialScore = state.scores[playerId];
  const maximumPossiblePoints = Math.min(
    5 - initialScore,
    ringOutUpperBound(state, playerId)
  );
  if (maximumPossiblePoints === 0) return { points: 0, actions: [], exploredStates: 1 };
  const memo = new Map<string, CachedResult>();
  let exploredStates = 0;

  function visit(current: GameState): CachedResult {
    exploredStates += 1;
    if (current.winner || current.phase === 'ended' || current.activePlayerId !== playerId) {
      return { points: current.scores[playerId] - initialScore, actions: [] };
    }
    const key = searchKey(current);
    const cached = memo.get(key);
    if (cached) return cached;
    let best: CachedResult = { points: current.scores[playerId] - initialScore, actions: [] };
    const candidates = tacticalActions(current).map((action) => {
      const next = applyAction(current, action.id);
      return { action, next, points: next.scores[playerId] - initialScore };
    }).sort((left, right) =>
      right.points - left.points
      || actionPriority(right.action) - actionPriority(left.action)
      || left.action.id.localeCompare(right.action.id)
    );
    for (const { action, next } of candidates) {
      const candidate = visit(next);
      const withAction = { points: candidate.points, actions: [action, ...candidate.actions] };
      if (withAction.points > best.points) best = withAction;
      if (best.points >= maximumPossiblePoints) break;
    }
    memo.set(key, best);
    return best;
  }

  const result = visit(state);
  return { ...result, exploredStates };
}
