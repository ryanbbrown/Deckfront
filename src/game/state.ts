import { DEFAULT_KINGDOM_ID, kingdomOf, kingdomSupply } from './kingdom';
import type { CardInstance, DeckState, GameState, PlayerId, PlayerState } from './types';

export const PLAYER_IDS: readonly PlayerId[] = ['ochre', 'indigo'];
export function opponent(playerId: PlayerId): PlayerId { return playerId === 'ochre' ? 'indigo' : 'ochre'; }
function emptyDeck(): DeckState { return { draw: [], hand: [], discard: [], play: [] }; }
function player(id: PlayerId): PlayerState {
  return { id, deck: emptyDeck(), money: 0, mana: 0, positionChanged: false, firstBuyMoney: 0, firstBuyPending: true, startingBuild: null, purchases: [] };
}
export interface CreateGameConfig { seed: number; firstPlayerId?: PlayerId | undefined; kingdomId?: string | undefined }
export function createGame(config: CreateGameConfig): GameState {
  const kingdom = kingdomOf(config.kingdomId ?? DEFAULT_KINGDOM_ID);
  const health = kingdom.startingHealth;
  return {
    schemaVersion: 8, seed: config.seed, rngState: config.seed >>> 0, version: 0, nextCardSerial: 1,
    kingdomId: kingdom.id, startingHealth: health,
    activePlayerId: 'ochre', selectedFirstPlayerId: config.firstPlayerId ?? 'ochre', phase: 'startingBuild', turn: 0, winner: null,
    players: { ochre: player('ochre'), indigo: player('indigo') },
    fighters: {
      ochre: { playerId: 'ochre', position: 2, health, aimed: false, exposed: false },
      indigo: { playerId: 'indigo', position: 3, health, aimed: false, exposed: false }
    },
    supply: kingdomSupply(kingdom),
    trash: [], actionsThisTurn: [], pendingChoice: null, events: []
  };
}
export function cloneGame(state: GameState): GameState { return structuredClone(state); }
export function createCard(state: GameState, definitionId: string): CardInstance {
  return { id: `card-${state.nextCardSerial++}`, definitionId };
}
