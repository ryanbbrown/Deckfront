import type { CardDefinition, CardId, GameConfig, GameState, PlayerState } from './types';
import type { Rng } from './random';
import { shuffle } from './random';

export function setupGame(config: GameConfig, rng: Rng): GameState {
  const cards = Object.fromEntries(config.cards.map((card) => [card.id, card])) as Record<CardId, CardDefinition>;
  const supply = Object.fromEntries(config.supply.map((pile) => [pile.card, pile.count])) as Record<CardId, number>;
  const players: PlayerState[] = Array.from({ length: config.players }, (_, index) => {
    const player: PlayerState = {
      id: `P${index + 1}`,
      draw: shuffle(config.setup.startingDeck, rng),
      hand: [],
      discard: [],
      play: [],
      actions: config.setup.initialActions,
      buys: config.setup.initialBuys,
      money: config.setup.initialMoney,
      attributes: { ...config.setup.attributes },
      persistentAttributes: {},
      vpCounters: 0,
      turnsTaken: 0
    };
    drawCards(player, config.setup.handSize, rng);
    return player;
  });

  return {
    config,
    cards,
    players,
    activePlayer: 0,
    phase: 'action',
    supply,
    trash: [],
    ended: false
  };
}

export function activePlayer(state: GameState): PlayerState {
  return state.players[state.activePlayer] as PlayerState;
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    supply: { ...state.supply },
    trash: [...state.trash],
    ...(state.pending ? { pending: clonePending(state.pending) } : {}),
    players: state.players.map((player) => ({
      ...player,
      draw: [...player.draw],
      hand: [...player.hand],
      discard: [...player.discard],
      play: [...player.play],
      attributes: { ...player.attributes },
      persistentAttributes: { ...(player.persistentAttributes ?? {}) }
    }))
  };
}

function clonePending(pending: NonNullable<GameState['pending']>): NonNullable<GameState['pending']> {
  return {
    ...pending,
    effects: [...pending.effects],
    ...(pending.exposed ? { exposed: [...pending.exposed] } : {}),
    ...(pending.choices ? { choices: [...pending.choices] } : {})
  };
}

export function drawCards(player: PlayerState, count: number, rng: Rng): CardId[] {
  const drawn: CardId[] = [];
  for (let drawnCount = 0; drawnCount < count; drawnCount += 1) {
    ensureDrawHasCards(player, rng);
    const card = player.draw.shift();
    if (card === undefined) {
      break;
    }
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

export function takeTopCards(player: PlayerState, count: number, rng: Rng): CardId[] {
  const taken: CardId[] = [];
  for (let takenCount = 0; takenCount < count; takenCount += 1) {
    ensureDrawHasCards(player, rng);
    const card = player.draw.shift();
    if (card === undefined) {
      break;
    }
    taken.push(card);
  }
  return taken;
}

export function resetTurnResources(player: PlayerState, config: GameConfig): void {
  player.actions = config.setup.initialActions;
  player.buys = config.setup.initialBuys;
  player.money = config.setup.initialMoney;
  player.attributes = { ...config.setup.attributes };
  player.persistentAttributes ??= {};
}

function ensureDrawHasCards(player: PlayerState, rng: Rng): void {
  if (player.draw.length === 0 && player.discard.length > 0) {
    player.draw = shuffle(player.discard, rng);
    player.discard = [];
  }
}
