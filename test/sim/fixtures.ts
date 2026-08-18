import { applyAction, assertInvariants, createCard, createGame, listLegalActions, submitStartingBuild } from '../../src/game';
import type { CardInstance, GameState, LegalAction, RangeBand } from '../../src/game';
import { DEFAULT_STATE_LIMIT, createMemo, searchAction, searchBaseline } from '../../src/sim/search';
import type { SearchMemo } from '../../src/sim/search';
import type { StateWeights, Strategy } from '../../src/sim/strategy';

export interface ArenaOptions {
  kingdomId?: string;
  seed?: number;
  hand?: readonly string[];
  draw?: readonly string[];
  discard?: readonly string[];
  ochre?: number;
  indigo?: number;
  health?: number;
  mana?: number;
  money?: number;
  aimed?: boolean;
  firstBuyPending?: boolean;
}

/**
 * Replacing ochre's zones throws away cards `createCard` already counted, so the serial runs ahead of
 * the cards that survive and `checkInvariants` rejects the state. Renumbering keeps the ids unique
 * and restores the count the invariant compares against. A card is frozen, so each one is replaced
 * rather than edited.
 */
function renumberCards(state: GameState): void {
  let serial = 0;
  const renumber = (cards: readonly CardInstance[]): CardInstance[] =>
    cards.map((card) => Object.freeze({ ...card, id: `card-${(serial += 1)}` }));
  state.trash = renumber(state.trash);
  for (const player of Object.values(state.players)) {
    const deck = player.deck;
    deck.draw = renumber(deck.draw);
    deck.hand = renumber(deck.hand);
    deck.discard = renumber(deck.discard);
    deck.play = renumber(deck.play);
  }
  state.nextCardSerial = serial + 1;
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
  state.fighters.ochre.position = options.ochre ?? 2;
  state.fighters.indigo.position = options.indigo ?? 3;
  if (options.health !== undefined) state.fighters.indigo.health = options.health;
  if (options.mana !== undefined) state.players.ochre.mana = options.mana;
  if (options.money !== undefined) state.players.ochre.money = options.money;
  if (options.aimed) state.fighters.ochre.aimed = true;
  if (options.firstBuyPending === false) state.players.ochre.firstBuyPending = false;
  renumberCards(state);
  // Every search test runs on a fixture state, so a malformed one would prove nothing.
  assertInvariants(state);
  return state;
}

export function weights(overrides: Partial<StateWeights> = {}): StateWeights {
  return {
    damage: 0, preferredRange: 0, cardsDrawn: 0, moneyGained: 0, trashed: 0,
    reclaimed: 0, discarded: 0, unspentMana: 0, opponentOutOfAttackRange: 0, ...overrides
  };
}

export function strategy(overrides: Partial<Strategy> = {}): Strategy {
  const preferredRange: RangeBand = 'Near';
  return {
    id: 'test-strategy', startingBuild: [], buyAgenda: [], treasureFallback: ['gold', 'silver'],
    preferredRange, weights: weights(), trashPriority: [], reclaimPriority: [], discardPriority: [], ...overrides
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
