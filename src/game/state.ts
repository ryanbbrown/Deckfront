import { FIRST_MARKET } from './config';
import type { CardInstance, DeckState, GameState, PlayerId, PlayerState } from './types';

export const PLAYER_IDS: readonly PlayerId[] = ['ochre', 'indigo'];
export function opponent(playerId: PlayerId): PlayerId { return playerId === 'ochre' ? 'indigo' : 'ochre'; }
function emptyDeck(): DeckState { return { draw: [], hand: [], discard: [], play: [] }; }
function player(id: PlayerId): PlayerState {
  return { id, deck: emptyDeck(), money: 0, firstBuyMoney: 0, firstBuyPending: true, startingBuild: null, purchases: [] };
}
export interface CreateGameConfig { seed: number; firstPlayerId?: PlayerId | undefined }
export function createGame(config: number | CreateGameConfig): GameState {
  const seed = typeof config === 'number' ? config : config.seed;
  const firstPlayer = typeof config === 'number' ? 'ochre' : config.firstPlayerId ?? 'ochre';
  return {
    schemaVersion: 8, seed, rngState: seed >>> 0, version: 0, nextCardSerial: 1,
    activePlayerId: 'ochre', selectedFirstPlayerId: firstPlayer, phase: 'startingBuild', turn: 0, winner: null,
    players: { ochre: player('ochre'), indigo: player('indigo') },
    fighters: {
      ochre: { playerId: 'ochre', position: 2, health: 20, aimed: false, exposed: false },
      indigo: { playerId: 'indigo', position: 3, health: 20, aimed: false, exposed: false }
    },
    supply: Object.fromEntries(FIRST_MARKET.actionPiles.map((pile) => [pile.cardId, pile.count])),
    trash: [], actionsThisTurn: [], events: []
  };
}
export function cloneGame(state: GameState): GameState { return structuredClone(state); }
export function createCard(state: GameState, definitionId: string): CardInstance {
  return { id: `card-${state.nextCardSerial++}`, definitionId };
}
