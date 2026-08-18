import { DEFAULT_KINGDOM_ID, kingdomOf, kingdomSupply } from './kingdom';
import type { CardInstance, DeckState, GameState, PlayerId, PlayerState } from './types';

export const PLAYER_IDS: readonly PlayerId[] = ['ochre', 'indigo'];
export function opponent(playerId: PlayerId): PlayerId { return playerId === 'ochre' ? 'indigo' : 'ochre'; }
function emptyDeck(): DeckState { return { draw: [], hand: [], discard: [], play: [] }; }
function player(id: PlayerId): PlayerState {
  return { id, deck: emptyDeck(), money: 0, mana: 0, positionChanged: false, firstBuyMoney: 0, firstBuyPending: true, startingBuild: null, purchases: [] };
}
export interface CreateGameConfig {
  seed: number;
  firstPlayerId?: PlayerId | undefined;
  kingdomId?: string | undefined;
  // Exchanges the two starting positions, which cancels the back-wall distance advantage over a pairing.
  swapSides?: boolean | undefined;
}
export function createGame(config: CreateGameConfig): GameState {
  const kingdom = kingdomOf(config.kingdomId ?? DEFAULT_KINGDOM_ID);
  const health = kingdom.startingHealth;
  const ochrePosition = config.swapSides ? 3 : 2;
  const indigoPosition = config.swapSides ? 2 : 3;
  return {
    schemaVersion: 8, seed: config.seed, rngState: config.seed >>> 0, version: 0, nextCardSerial: 1,
    kingdomId: kingdom.id, startingHealth: health,
    activePlayerId: 'ochre', selectedFirstPlayerId: config.firstPlayerId ?? 'ochre', phase: 'startingBuild', turn: 0, winner: null,
    players: { ochre: player('ochre'), indigo: player('indigo') },
    fighters: {
      ochre: { playerId: 'ochre', position: ochrePosition, health, aimed: false, exposed: false },
      indigo: { playerId: 'indigo', position: indigoPosition, health, aimed: false, exposed: false }
    },
    supply: kingdomSupply(kingdom),
    trash: [], actionsThisTurn: [], pendingChoice: null, events: []
  };
}
function cloneDeck(deck: DeckState): DeckState {
  return { draw: [...deck.draw], hand: [...deck.hand], discard: [...deck.discard], play: [...deck.play] };
}
function clonePlayer(state: PlayerState): PlayerState {
  return {
    ...state, deck: cloneDeck(state.deck), purchases: [...state.purchases],
    startingBuild: state.startingBuild ? [...state.startingBuild] : null
  };
}
/**
 * Copies every mutable zone and shares the `CardInstance` and `GameEvent` objects. Nothing in
 * `src/game/` edits either in place — a card is moved between zones and an event is a record of the
 * past — and `test/clone.test.ts` holds that boundary. `structuredClone` deep-copies the whole event
 * log on every action, which makes one game quadratic in its action count and cost 88% of a match.
 */
export function cloneGame(state: GameState): GameState {
  return {
    ...state,
    players: { ochre: clonePlayer(state.players.ochre), indigo: clonePlayer(state.players.indigo) },
    fighters: { ochre: { ...state.fighters.ochre }, indigo: { ...state.fighters.indigo } },
    supply: { ...state.supply },
    trash: [...state.trash],
    actionsThisTurn: [...state.actionsThisTurn],
    pendingChoice: state.pendingChoice ? { ...state.pendingChoice } : null,
    events: [...state.events]
  };
}
export function createCard(state: GameState, definitionId: string): CardInstance {
  return { id: `card-${state.nextCardSerial++}`, definitionId };
}
