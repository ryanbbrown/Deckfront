import { DEFAULT_KINGDOM_ID, kingdomOf, kingdomSupply } from './kingdom';
import { playerStartingHealth } from './config';
import { SeededRandom, shuffle } from './random';
import type { CardInstance, DeckState, GameState, PlayerId, PlayerState, TurnState } from './types';

export const PLAYER_IDS: readonly PlayerId[] = ['ochre', 'indigo'];
export function opponent(playerId: PlayerId): PlayerId { return playerId === 'ochre' ? 'indigo' : 'ochre'; }
function emptyDeck(): DeckState { return { draw: [], hand: [], discard: [], play: [] }; }
function player(id: PlayerId, startingDraftEnabled: boolean): PlayerState {
  return { id, deck: emptyDeck(), money: 0, mana: 0, carriedMana: 0, positionChanged: false, firstBuyMoney: 0,
    firstBuyPending: startingDraftEnabled, startingBuild: null, purchases: [] };
}
export function emptyTurnState(): TurnState {
  return { cardsPlayed: [], spacesMoved: 0, manaSpent: 0, spellsPlayed: 0, copiesPlayed: {}, familiesPlayed: [] };
}
export interface CreateGameConfig {
  seed: number; firstPlayerId?: PlayerId | undefined; kingdomId?: string | undefined;
  swapSides?: boolean | undefined; startingDraftEnabled?: boolean | undefined;
}
export function createGame(config: CreateGameConfig): GameState {
  const kingdom = kingdomOf(config.kingdomId ?? DEFAULT_KINGDOM_ID);
  const health = kingdom.startingHealth;
  const firstPlayerId = config.firstPlayerId ?? 'ochre';
  const draft = config.startingDraftEnabled ?? true;
  const state: GameState = {
    schemaVersion: 10, seed: config.seed, rngState: config.seed >>> 0, version: 0, nextCardSerial: 1,
    kingdomId: kingdom.id, startingHealth: health, startingDraftEnabled: draft,
    activePlayerId: draft ? 'ochre' : firstPlayerId, selectedFirstPlayerId: firstPlayerId,
    phase: draft ? 'startingBuild' : 'action', turn: draft ? 0 : 1, winner: null,
    players: { ochre: player('ochre', draft), indigo: player('indigo', draft) },
    fighters: {
      ochre: { playerId: 'ochre', position: config.swapSides ? 4 : 3,
        health: playerStartingHealth(health, firstPlayerId === 'ochre'), aimed: false, exposed: false },
      indigo: { playerId: 'indigo', position: config.swapSides ? 3 : 4,
        health: playerStartingHealth(health, firstPlayerId === 'indigo'), aimed: false, exposed: false }
    },
    supply: kingdomSupply(kingdom), trash: [], turnState: emptyTurnState(), pendingChoice: null, events: []
  };
  if (!draft) {
    const random = new SeededRandom(state.rngState);
    for (const playerId of PLAYER_IDS) {
      const definitions = [...Array<string>(7).fill('copper'), ...Array<string>(3).fill('scrap')];
      state.players[playerId].deck.draw = shuffle(definitions.map((id) => createCard(state, id)), random);
      for (let count = 0; count < 5; count += 1) state.players[playerId].deck.hand.push(state.players[playerId].deck.draw.shift()!);
    }
    state.rngState = random.snapshot();
    state.events.push({ sequence: 0, type: 'turn', playerId: firstPlayerId, detail: { turn: 1, activePlayerId: firstPlayerId } });
  }
  return state;
}
function cloneDeck(deck: DeckState): DeckState { return { draw: [...deck.draw], hand: [...deck.hand], discard: [...deck.discard], play: [...deck.play] }; }
function clonePlayer(state: PlayerState): PlayerState { return { ...state, deck: cloneDeck(state.deck), purchases: [...state.purchases], startingBuild: state.startingBuild ? [...state.startingBuild] : null }; }
export function cloneGame(state: GameState): GameState {
  return {
    ...state, players: { ochre: clonePlayer(state.players.ochre), indigo: clonePlayer(state.players.indigo) },
    fighters: { ochre: { ...state.fighters.ochre }, indigo: { ...state.fighters.indigo } }, supply: { ...state.supply },
    trash: [...state.trash], turnState: { ...state.turnState, cardsPlayed: [...state.turnState.cardsPlayed],
      copiesPlayed: { ...state.turnState.copiesPlayed }, familiesPlayed: [...state.turnState.familiesPlayed] },
    pendingChoice: state.pendingChoice ? { ...state.pendingChoice } : null, events: [...state.events]
  };
}
export function createCard(state: GameState, definitionId: string): CardInstance { return { id: `card-${state.nextCardSerial++}`, definitionId }; }
