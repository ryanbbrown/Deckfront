import { cardDefinition, cloneGame, createGame, listLegalActions } from '../src/game';
import type { CardInstance, GameCommand, GameState, PieceId, PlayerId } from '../src/game';

export function freshState(seed = 1): GameState { return createGame(seed); }

export function clearHands(state: GameState): void {
  for (const player of Object.values(state.players)) {
    player.deck.discard.push(...player.deck.hand, ...player.deck.play);
    player.deck.hand = [];
    player.deck.play = [];
  }
}

export function addCard(state: GameState, playerId: PlayerId, definitionId: string): CardInstance {
  cardDefinition(definitionId);
  const card = { id: `card-${state.nextCardSerial++}`, definitionId };
  state.players[playerId].deck.hand.push(card);
  return card;
}

export function setPosition(state: GameState, pieceId: PieceId, q: number, r: number): void {
  state.pieces[pieceId].position = { q, r };
  state.pieces[pieceId].needsRespawn = false;
}

export function actionFor(state: GameState, predicate: (command: GameCommand) => boolean) {
  const action = listLegalActions(state).find((candidate) => predicate(candidate.command));
  if (!action) throw new Error(`Missing legal action in ${JSON.stringify(listLegalActions(state))}`);
  return action;
}

export function commandOf<T extends GameCommand['type']>(state: GameState, type: T): Extract<GameCommand, { type: T }> {
  return actionFor(state, (command) => command.type === type).command as Extract<GameCommand, { type: T }>;
}

export function snapshot(state: GameState): GameState { return cloneGame(state); }
