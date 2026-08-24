import { applyAction, assertInvariants, createCard, createGame, listLegalActions, submitStartingBuild } from '../../src/game';
import type { CardInstance, GameState, LegalAction } from '../../src/game';
import { DEFAULT_STATE_LIMIT, createMemo, searchAction, searchBaseline } from '../../src/sim/search';
import type { SearchMemo } from '../../src/sim/search';
import type { Strategy } from '../../src/sim/strategy';

export interface ArenaOptions {
  kingdomId?: string;
  seed?: number;
  hand?: readonly string[];
  draw?: readonly string[];
  discard?: readonly string[];
  indigoHand?: readonly string[];
  indigoDraw?: readonly string[];
  indigoDiscard?: readonly string[];
  ochre?: number;
  indigo?: number;
  health?: number;
  mana?: number;
  money?: number;
  aimed?: boolean;
  firstBuyPending?: boolean;
  startingBuild?: readonly string[];
  purchases?: readonly string[];
}

function allCards(state: GameState): CardInstance[] {
  return [
    ...state.trash,
    ...Object.values(state.players).flatMap((player) =>
      [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play])
  ];
}

/**
 * Replacing ochre's zones throws away cards `createCard` already counted, so the serial runs ahead of
 * the cards that survive and `checkInvariants` rejects the state. Renumbering keeps the ids unique
 * and restores the count the invariant compares against. It runs before any clone exists, so it is
 * the one place that edits a card in place.
 */
function renumberCards(state: GameState): void {
  const cards = allCards(state);
  cards.forEach((card, index) => { card.id = `card-${index + 1}`; });
  state.nextCardSerial = cards.length + 1;
}

/** A ready Action-phase state with ochre's zones, positions, and resources set by hand. */
export function arena(options: ArenaOptions = {}): GameState {
  const empty = createGame({ seed: options.seed ?? 1, kingdomId: options.kingdomId ?? 'distance-duel' });
  const state = submitStartingBuild(submitStartingBuild(empty, 'ochre', []), 'indigo', []);
  const deck = state.players.ochre.deck;
  deck.hand = (options.hand ?? []).map((id) => createCard(state, id));
  deck.draw = (options.draw ?? []).map((id) => createCard(state, id));
  deck.discard = (options.discard ?? []).map((id) => createCard(state, id));
  deck.play = [];
  const indigoDeck = state.players.indigo.deck;
  if (options.indigoHand) indigoDeck.hand = options.indigoHand.map((id) => createCard(state, id));
  if (options.indigoDraw) indigoDeck.draw = options.indigoDraw.map((id) => createCard(state, id));
  if (options.indigoDiscard) indigoDeck.discard = options.indigoDiscard.map((id) => createCard(state, id));
  if (options.indigoHand || options.indigoDraw || options.indigoDiscard) indigoDeck.play = [];
  state.fighters.ochre.position = options.ochre ?? 3;
  state.fighters.indigo.position = options.indigo ?? 4;
  if (options.health !== undefined) state.fighters.indigo.health = options.health;
  if (options.mana !== undefined) state.players.ochre.mana = options.mana;
  if (options.money !== undefined) state.players.ochre.money = options.money;
  if (options.aimed) state.fighters.ochre.aimed = true;
  if (options.firstBuyPending === false) state.players.ochre.firstBuyPending = false;
  if (options.startingBuild) state.players.ochre.startingBuild = [...options.startingBuild];
  if (options.purchases) state.players.ochre.purchases = [...options.purchases];
  renumberCards(state);
  // Every search test runs on a fixture state, so a malformed one would prove nothing.
  assertInvariants(state);
  return state;
}

export function strategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: 'test-strategy', startingBuild: [], buyAgenda: [], repeatPurchase: 'footwork', ...overrides
  };
}

export interface ChooseOptions { stateLimit?: number; memo?: SearchMemo | null }

/** Runs one Action-phase decision from `state`, the way the strategy agent does. */
export function choose(state: GameState, plan: Strategy, options: ChooseOptions = {}): LegalAction {
  return searchAction(state, 'ochre', listLegalActions(state), plan, searchBaseline(state, 'ochre'), {
    stateLimit: options.stateLimit ?? DEFAULT_STATE_LIMIT,
    memo: options.memo === undefined ? createMemo() : options.memo
  }).action;
}

/** Plays the whole Action phase and returns the state the search stops at, before the phase ends. */
export function playPhase(state: GameState, plan: Strategy, options: ChooseOptions = {}): GameState {
  const memo = options.memo === undefined ? createMemo() : options.memo;
  const baseline = searchBaseline(state, 'ochre');
  let current = state;
  for (let guard = 0; guard < 100; guard += 1) {
    if (current.winner || current.phase !== 'action') return current;
    const outcome = searchAction(current, 'ochre', listLegalActions(current), plan, baseline, {
      stateLimit: options.stateLimit ?? DEFAULT_STATE_LIMIT, memo
    });
    if (outcome.action.command.type === 'endActionPhase') return current;
    current = applyAction(current, outcome.action.id);
  }
  throw new Error('The Action phase did not finish.');
}
