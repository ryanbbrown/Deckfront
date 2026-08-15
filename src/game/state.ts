import { FIRST_MARKET, STARTING_DECK } from './config';
import { SeededRandom, shuffle } from './random';
import type { CardInstance, DeckState, GameState, PieceId, PieceState, PlayerId, PlayerState } from './types';

export const PLAYER_IDS: readonly PlayerId[] = ['ochre', 'indigo'];
const STARTING_POSITIONS: Record<PieceId, { q: number; r: number }> = {
  'ochre-a': { q: -1, r: 0 }, 'ochre-b': { q: -1, r: 1 },
  'indigo-a': { q: 1, r: -1 }, 'indigo-b': { q: 1, r: 0 }
};
export const RESPAWN_ANCHORS: Record<PlayerId, readonly [{ q: number; r: number }, { q: number; r: number }]> = {
  ochre: [STARTING_POSITIONS['ochre-a'], STARTING_POSITIONS['ochre-b']],
  indigo: [STARTING_POSITIONS['indigo-a'], STARTING_POSITIONS['indigo-b']]
};
export function opponent(playerId: PlayerId): PlayerId { return playerId === 'ochre' ? 'indigo' : 'ochre'; }
function createCard(definitionId: string, serial: number): CardInstance { return { id: `card-${serial}`, definitionId }; }
function createDeck(random: SeededRandom, nextSerial: { value: number }): DeckState {
  const cards = STARTING_DECK.map((definitionId) => createCard(definitionId, nextSerial.value++));
  const shuffled = shuffle(cards, random);
  return { draw: shuffled.slice(5), hand: shuffled.slice(0, 5), discard: [], play: [] };
}
function createPlayer(id: PlayerId, random: SeededRandom, nextSerial: { value: number }): PlayerState {
  return { id, deck: createDeck(random, nextSerial), money: 0, buys: 1, roundsCompleted: 0 };
}
function createPiece(id: PieceId, ownerId: PlayerId): PieceState {
  return { id, ownerId, position: { ...STARTING_POSITIONS[id] }, needsRespawn: false, baselineMoves: 1, braced: false, pinned: null };
}
export function createGame(seed: number): GameState {
  const random = new SeededRandom(seed);
  const serial = { value: 1 };
  const state: GameState = {
    schemaVersion: 2, seed, rngState: random.snapshot(), version: 0,
    nextCardSerial: serial.value, nextBlockSerial: 1,
    activePlayerId: 'ochre', phase: 'action',
    round: {
      number: 1, startingPlayerId: 'ochre', passedPlayerIds: [], purchaseOrder: [], purchaseIndex: 0,
      actionStep: 1, pressSetupPieceIds: [], relayUsed: { ochre: false, indigo: false }
    },
    scores: { ochre: 0, indigo: 0 }, winner: null,
    players: { ochre: createPlayer('ochre', random, serial), indigo: createPlayer('indigo', random, serial) },
    pieces: {
      'ochre-a': createPiece('ochre-a', 'ochre'), 'ochre-b': createPiece('ochre-b', 'ochre'),
      'indigo-a': createPiece('indigo-a', 'indigo'), 'indigo-b': createPiece('indigo-b', 'indigo')
    },
    blocks: [],
    supply: Object.fromEntries([...FIRST_MARKET.basicPiles, ...FIRST_MARKET.kingdomPiles].map((pile) => [pile.cardId, pile.count])),
    trash: [], events: []
  };
  state.nextCardSerial = serial.value;
  return state;
}
export function cloneGame(state: GameState): GameState { return structuredClone(state); }
export function createPurchasedCard(state: GameState, definitionId: string): CardInstance {
  return createCard(definitionId, state.nextCardSerial++);
}
