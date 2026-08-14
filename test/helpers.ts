import { applyCommand, createGame } from '../src/game';
import { startTurn } from '../src/game/state';
import type { CardInstance, Coordinate, GameCommand, GameState, PieceId, PlayerId } from '../src/game';

export function gameFor(playerId: PlayerId = 'ochre'): GameState {
  const state = createGame(12345);
  state.activePlayerId = playerId;
  state.phase = 'action';
  startTurn(state);
  return state;
}

export function setPosition(state: GameState, pieceId: PieceId, position: Coordinate | null): void {
  state.pieces[pieceId].position = position ? { ...position } : null;
  state.pieces[pieceId].needsRespawn = position === null;
}

export function giveCard(state: GameState, definitionId: string, playerId = state.activePlayerId): CardInstance {
  const card = { id: `card-${state.nextCardSerial++}`, definitionId };
  state.players[playerId].deck.hand.push(card);
  return card;
}

export function clearHand(state: GameState, playerId = state.activePlayerId): void {
  const deck = state.players[playerId].deck;
  deck.discard.push(...deck.hand);
  deck.hand = [];
}

export function play(state: GameState, command: GameCommand): GameState {
  return applyCommand(state, command);
}
