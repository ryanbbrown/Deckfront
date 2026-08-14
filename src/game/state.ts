import { FIRST_MARKET, STARTING_DECK } from './config';
import { SeededRandom, shuffle } from './random';
import type {
  CardInstance, DeckState, GameState, PieceId, PieceState, PlayerId, PlayerState
} from './types';

export const PLAYER_IDS: readonly PlayerId[] = ['ochre', 'indigo'];

const STARTING_POSITIONS: Record<PieceId, { q: number; r: number }> = {
  'ochre-a': { q: -1, r: 0 },
  'ochre-b': { q: -1, r: 1 },
  'indigo-a': { q: 1, r: -1 },
  'indigo-b': { q: 1, r: 0 }
};

export const RESPAWN_ANCHORS: Record<PlayerId, readonly [{ q: number; r: number }, { q: number; r: number }]> = {
  ochre: [STARTING_POSITIONS['ochre-a'], STARTING_POSITIONS['ochre-b']],
  indigo: [STARTING_POSITIONS['indigo-a'], STARTING_POSITIONS['indigo-b']]
};

export function opponent(playerId: PlayerId): PlayerId {
  return playerId === 'ochre' ? 'indigo' : 'ochre';
}

function createCard(definitionId: string, serial: number): CardInstance {
  return { id: `card-${serial}`, definitionId };
}

function createDeck(random: SeededRandom, nextSerial: { value: number }): DeckState {
  const cards = STARTING_DECK.map((definitionId) => createCard(definitionId, nextSerial.value++));
  const shuffled = shuffle(cards, random);
  return { draw: shuffled.slice(5), hand: shuffled.slice(0, 5), discard: [], play: [] };
}

function createPlayer(id: PlayerId, random: SeededRandom, nextSerial: { value: number }): PlayerState {
  return { id, deck: createDeck(random, nextSerial), money: 0, buys: 1, turnsTaken: 0 };
}

function createPiece(id: PieceId, ownerId: PlayerId): PieceState {
  return {
    id,
    ownerId,
    position: { ...STARTING_POSITIONS[id] },
    needsRespawn: false,
    baselineMoves: 0,
    braced: false,
    pinned: null
  };
}

export function createGame(seed: number): GameState {
  const random = new SeededRandom(seed);
  const activePlayerId = PLAYER_IDS[random.nextInt(PLAYER_IDS.length)] as PlayerId;
  const serial = { value: 1 };
  const players = {
    ochre: createPlayer('ochre', random, serial),
    indigo: createPlayer('indigo', random, serial)
  };
  const state: GameState = {
    schemaVersion: 1,
    seed,
    rngState: random.snapshot(),
    version: 0,
    nextCardSerial: serial.value,
    nextBlockSerial: 1,
    activePlayerId,
    phase: 'action',
    scores: { ochre: 0, indigo: 0 },
    winner: null,
    players,
    pieces: {
      'ochre-a': createPiece('ochre-a', 'ochre'),
      'ochre-b': createPiece('ochre-b', 'ochre'),
      'indigo-a': createPiece('indigo-a', 'indigo'),
      'indigo-b': createPiece('indigo-b', 'indigo')
    },
    blocks: [],
    supply: Object.fromEntries(
      [...FIRST_MARKET.basicPiles, ...FIRST_MARKET.kingdomPiles].map((pile) => [pile.cardId, pile.count])
    ),
    trash: [],
    turn: { displacedPieceIds: [], pressSetupPieceIds: [] },
    events: []
  };
  startTurn(state);
  return state;
}

export function cloneGame(state: GameState): GameState {
  return structuredClone(state);
}

export function startTurn(state: GameState): void {
  const playerId = state.activePlayerId;
  for (const piece of Object.values(state.pieces)) {
    if (piece.ownerId !== playerId) continue;
    piece.braced = false;
    piece.baselineMoves = piece.pinned ? 0 : 1;
  }
  state.players[playerId].money = 0;
  state.players[playerId].buys = 1;
  state.turn = { displacedPieceIds: [], pressSetupPieceIds: [] };
  state.phase = Object.values(state.pieces).some(
    (piece) => piece.ownerId === playerId && piece.needsRespawn
  ) ? 'respawn' : 'action';
}

export function createPurchasedCard(state: GameState, definitionId: string): CardInstance {
  const card = createCard(definitionId, state.nextCardSerial);
  state.nextCardSerial += 1;
  return card;
}
