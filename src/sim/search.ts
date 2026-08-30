import {
  CARDS, isTacticalAction, kingdomEpoch, listLegalActions, opponent, resolveCard
} from '../game';
import { applyLegalAction } from '../game/engine';
import type { CardInstance, CardMechanic, GameEvent, GameState, LegalAction, PlayerId } from '../game';
import { acquiredCount, projectPurchases } from './buy';
import type { PurchaseProjection } from './buy';
import { slotWantsMore } from './strategy';
import type { Strategy } from './strategy';
import { ActionSearchOverflowError } from './types';
import { buildAttackProfile, publicPositionAdvantage } from './positionValue';
import type { AttackProfile, ProfileCard } from './positionValue';
import { fixedTargetSelection } from './tacticalPilot';
import type { PilotCard } from './tacticalPilot';

export interface Branch {
  lethal: boolean;
  damage: number;
  purchases: PurchaseProjection;
  copperTrashed: number;
  obsoleteCullTrashed: number;
  cardsDrawn: number;
  positionValue: number;
  suffix: number;
}
export type SearchMemo = Map<string, Branch>;
export interface SearchBaseline { eventIndex: number; opponentHealth: number }
export interface SearchOptions { stateLimit: number; memo: SearchMemo | null }
export interface SearchOutcome { action: LegalAction; visited: number }

export const DEFAULT_STATE_LIMIT = 20000;
export const ATTACK_MECHANICS: ReadonlySet<CardMechanic> = new Set<CardMechanic>([
  'melee', 'ranged', 'repellingShot', 'spell', 'volley', 'drive', 'flurry', 'openingStrike', 'rally',
  'bullRush', 'longshot', 'salvageShot', 'precisionShot', 'discharge', 'cascade', 'overload',
  'discipline', 'improvise', 'scrap'
]);

let indexedEpoch = -1;
const cardIndexes = new Map<string, ReadonlyMap<string, number>>();

function cardIndex(kingdomId: string): ReadonlyMap<string, number> {
  const currentEpoch = kingdomEpoch();
  if (indexedEpoch !== currentEpoch) { cardIndexes.clear(); indexedEpoch = currentEpoch; }
  let index = cardIndexes.get(kingdomId);
  if (!index) {
    index = new Map(Object.values(CARDS).map((definition, position) => [definition.id, position]));
    cardIndexes.set(kingdomId, index);
  }
  return index;
}

export function createMemo(): SearchMemo { return new Map(); }
export function searchBaseline(state: GameState, playerId: PlayerId): SearchBaseline {
  return { eventIndex: state.events.length, opponentHealth: state.fighters[opponent(playerId)].health };
}

function detailText(event: GameEvent, key: string): string | null {
  const value = event.detail[key];
  return typeof value === 'string' ? value : null;
}
function detailNumber(event: GameEvent, key: string): number {
  const value = event.detail[key];
  return typeof value === 'number' ? value : 0;
}
function zones(state: GameState, playerId: PlayerId): readonly CardInstance[][] {
  const deck = state.players[playerId].deck;
  return [deck.draw, deck.hand, deck.discard, deck.play];
}

export function actionPhaseMoney(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  let money = player.money + (player.firstBuyPending ? player.firstBuyMoney : 0);
  for (const card of player.deck.hand) {
    const definition = resolveCard(state, card.definitionId);
    if (definition.type === 'treasure') money += definition.money ?? 0;
  }
  return money;
}

function repeatableMoney(state: GameState, playerId: PlayerId): number {
  let money = 0;
  for (const zone of zones(state, playerId)) {
    for (const card of zone) {
      const definition = resolveCard(state, card.definitionId);
      money += definition.type === 'treasure' ? definition.money ?? 0 : definition.values?.money ?? 0;
    }
  }
  return money;
}

/**
 * The cheapest card the plan still wants. Culling below this leaves money that can buy nothing, so a
 * Cull that drops permanent money under it has stopped paying for itself.
 */
function remainingPlanFloor(state: GameState, playerId: PlayerId, strategy: Strategy): number {
  let floor = Number.POSITIVE_INFINITY;
  for (const slot of strategy.buyPlan) {
    if (slot.kind !== 'buy' || !slotWantsMore(slot, acquiredCount(state, playerId, slot.cardId))) continue;
    floor = Math.min(floor, resolveCard(state, slot.cardId).cost);
  }
  return floor;
}

function ownedCount(state: GameState, playerId: PlayerId, definitionId: string): number {
  let total = 0;
  for (const zone of zones(state, playerId)) for (const card of zone) {
    if (card.definitionId === definitionId) total += 1;
  }
  return total;
}

function attackProfile(state: GameState, playerId: PlayerId): AttackProfile {
  function* definitions(): Iterable<ProfileCard> {
    for (const zone of zones(state, playerId)) for (const card of zone) {
      const definition = resolveCard(state, card.definitionId);
      yield { definitionId: definition.id, mechanic: definition.mechanic, values: definition.values ?? {} };
    }
  }
  return buildAttackProfile(definitions(), resolveCard(state, 'aim').values?.bonus ?? 0);
}

function eventTotals(state: GameState, playerId: PlayerId, baseline: SearchBaseline): {
  cardsDrawn: number; copperTrashed: number; cullTrashed: number;
} {
  let cardsDrawn = 0;
  let copperTrashed = 0;
  let cullTrashed = 0;
  for (let index = baseline.eventIndex; index < state.events.length; index += 1) {
    const event = state.events[index]!;
    if (event.playerId !== playerId) continue;
    if (event.type === 'draw') cardsDrawn += detailNumber(event, 'count');
    if (event.type === 'trash' && detailText(event, 'definitionId') === 'copper') copperTrashed += 1;
    if (event.type === 'trash' && detailText(event, 'definitionId') === 'cull') cullTrashed += 1;
  }
  return { cardsDrawn, copperTrashed, cullTrashed };
}

function branchAt(
  state: GameState, playerId: PlayerId, strategy: Strategy, baseline: SearchBaseline,
  opponentProfile: AttackProfile
): Branch {
  const events = eventTotals(state, playerId, baseline);
  let obsoleteCullTrashed = 0;
  if (events.cullTrashed > 0) {
    const cullIsObsolete = repeatableMoney(state, playerId) <= remainingPlanFloor(state, playerId, strategy)
      || ownedCount(state, playerId, 'copper') === 0;
    obsoleteCullTrashed = cullIsObsolete ? events.cullTrashed : 0;
  }
  return {
    lethal: state.fighters[opponent(playerId)].health === 0,
    damage: baseline.opponentHealth - state.fighters[opponent(playerId)].health,
    purchases: projectPurchases(state, playerId, actionPhaseMoney(state, playerId), strategy),
    copperTrashed: events.copperTrashed,
    obsoleteCullTrashed,
    cardsDrawn: events.cardsDrawn,
    positionValue: publicPositionAdvantage(
      attackProfile(state, playerId), opponentProfile,
      state.fighters[playerId].position, state.fighters[opponent(playerId)].position
    ),
    suffix: 0
  };
}

function comparePurchases(left: PurchaseProjection, right: PurchaseProjection): number {
  const length = Math.max(left.bought.length, right.bought.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.bought[index] ?? 0) - (right.bought[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function isBetter(candidate: Branch, best: Branch | null): boolean {
  if (!best) return true;
  if (candidate.lethal !== best.lethal) return candidate.lethal;
  if (candidate.damage !== best.damage) return candidate.damage > best.damage;
  const purchaseDifference = comparePurchases(candidate.purchases, best.purchases);
  if (purchaseDifference) return purchaseDifference > 0;
  if (candidate.copperTrashed !== best.copperTrashed) return candidate.copperTrashed > best.copperTrashed;
  if (candidate.obsoleteCullTrashed !== best.obsoleteCullTrashed) return candidate.obsoleteCullTrashed > best.obsoleteCullTrashed;
  if (candidate.cardsDrawn !== best.cardsDrawn) return candidate.cardsDrawn > best.cardsDrawn;
  if (candidate.positionValue !== best.positionValue) return candidate.positionValue > best.positionValue;
  if (candidate.suffix !== best.suffix) return candidate.suffix < best.suffix;
  return false;
}

/** The memo key is exact for the current search state, including ordered draw and discard piles. */
export function memoKey(state: GameState, playerId: PlayerId): string {
  const player = state.players[playerId];
  const mine = state.fighters[playerId];
  const foe = state.fighters[opponent(playerId)];
  const indexes = cardIndex(state.kingdomId);
  const indexOf = (card: CardInstance): number => {
    const index = indexes.get(card.definitionId);
    if (index === undefined) throw new Error(`Card ${card.definitionId} is not in kingdom ${state.kingdomId}.`);
    return index;
  };
  const counts = (cards: readonly CardInstance[]): string => {
    const values = Array<number>(indexes.size).fill(0);
    for (const card of cards) values[indexOf(card)]! += 1;
    return values.join(',');
  };
  const ordered = (cards: readonly CardInstance[]): string => cards.map(indexOf).join(',');
  const tactical = state.turnState.cardsPlayed.filter(isTacticalAction).length;
  const turn = state.turnState;
  const copies = Object.entries(turn.copiesPlayed).sort(([left], [right]) => left.localeCompare(right));
  const pending = state.pendingChoice;
  return [
    mine.position, mine.health, mine.aimed ? 1 : 0, mine.exposed ? 1 : 0,
    foe.position, foe.health, foe.aimed ? 1 : 0, foe.exposed ? 1 : 0,
    counts(player.deck.hand), counts(player.deck.play), ordered(player.deck.draw), ordered(player.deck.discard),
    player.mana, player.money, player.positionChanged ? 1 : 0, state.rngState,
    pending ? JSON.stringify(pending) : '-', tactical,
    turn.spacesMoved, turn.manaSpent, turn.spellsPlayed, turn.cardsPlayed.join(','),
    JSON.stringify(copies), turn.familiesPlayed.join(',')
  ].join('|');
}

function blindedState(state: GameState): GameState {
  const copy: GameState = {
    ...state,
    players: {
      ochre: { ...state.players.ochre, deck: { ...state.players.ochre.deck, draw: [...state.players.ochre.deck.draw] } },
      indigo: { ...state.players.indigo, deck: { ...state.players.indigo.deck, draw: [...state.players.indigo.deck.draw] } }
    }
  };
  const stable = (left: CardInstance, right: CardInstance): number =>
    left.definitionId.localeCompare(right.definitionId) || left.id.localeCompare(right.id);
  for (const playerId of ['ochre', 'indigo'] as const) {
    const draw = copy.players[playerId].deck.draw;
    let latestRecovery: GameEvent | undefined;
    for (let index = copy.events.length - 1; index >= 0; index -= 1) {
      const event = copy.events[index]!;
      if (event.playerId === playerId && event.type === 'recover') { latestRecovery = event; break; }
    }
    const knownTopId = typeof latestRecovery?.detail.cardInstanceId === 'string'
      && draw[0]?.id === latestRecovery.detail.cardInstanceId
      ? latestRecovery.detail.cardInstanceId
      : null;
    const hidden = knownTopId ? draw.slice(1) : draw;
    hidden.sort(stable);
    copy.players[playerId].deck.draw = knownTopId ? [draw[0]!, ...hidden] : hidden;
  }
  return copy;
}

function cardById(state: GameState, playerId: PlayerId, instanceId: string): CardInstance | undefined {
  for (const zone of zones(state, playerId)) {
    const found = zone.find((card) => card.id === instanceId);
    if (found) return found;
  }
  return undefined;
}

function allowedActions(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], strategy: Strategy
): readonly LegalAction[] {
  if (state.pendingChoice?.type === 'optionalTrash') {
    const scrap = state.players[playerId].deck.hand.find((card) => card.definitionId === 'scrap');
    if (scrap) return actions.filter((action) =>
      action.command.type === 'resolveOptionalTrash' && action.command.trashInstanceId === scrap.id);
  }

  if (state.pendingChoice?.type === 'recover') {
    const recoveries = actions.filter((action) => action.command.type === 'resolveRecover');
    if (!recoveries.length) return actions;
    return [[...recoveries].sort((left, right) => {
      const leftId = (left.command as Extract<typeof left.command, { type: 'resolveRecover' }>).recoverInstanceId;
      const rightId = (right.command as Extract<typeof right.command, { type: 'resolveRecover' }>).recoverInstanceId;
      const leftCard = cardById(state, playerId, leftId)!;
      const rightCard = cardById(state, playerId, rightId)!;
      return resolveCard(state, rightCard.definitionId).cost - resolveCard(state, leftCard.definitionId).cost
        || leftCard.definitionId.localeCompare(rightCard.definitionId)
        || leftCard.id.localeCompare(rightCard.id);
    })[0]!];
  }

  if (!actions.some((action) => action.command.type === 'playTargetedAction')) return actions;
  const floor = remainingPlanFloor(state, playerId, strategy);
  const availableMoney = repeatableMoney(state, playerId);
  const hand = state.players[playerId].deck.hand.map((instance, handIndex): PilotCard => {
    const definition = resolveCard(state, instance.definitionId);
    return {
      handIndex, definitionId: definition.id, mechanic: definition.mechanic, family: definition.family,
      cost: definition.cost, money: definition.money ?? 0, values: definition.values ?? {},
      enabled: true, movements: []
    };
  });
  return actions.filter((action) => {
    if (action.command.type !== 'playTargetedAction') return true;
    const source = cardById(state, playerId, action.command.cardInstanceId);
    if (!source) return false;
    if (source.definitionId !== 'cull') {
      const pilotCard = hand.find((card) => card.handIndex === state.players[playerId].deck.hand
        .findIndex((instance) => instance.id === source.id));
      if (!pilotCard) return false;
      const selected = fixedTargetSelection(pilotCard, hand);
      if (!selected) return true;
      const expected = [
        ...(selected.targetSelf ? [source.id] : []),
        ...(selected.targetHandIndexes ?? []).map((index) => state.players[playerId].deck.hand[index]?.id)
      ].filter((id): id is string => id !== undefined);
      return action.command.targetCardInstanceIds.length === expected.length
        && action.command.targetCardInstanceIds.every((id) => expected.includes(id));
    }
    const requiredScrap = state.players[playerId].deck.hand
      .filter((card) => card.definitionId === 'scrap').slice(0, 2);
    const selectedScrap = action.command.targetCardInstanceIds.filter((targetId) =>
      cardById(state, playerId, targetId)?.definitionId === 'scrap');
    if (selectedScrap.length !== requiredScrap.length
      || requiredScrap.some((card) => !selectedScrap.includes(card.id))) return false;
    let removedMoney = 0;
    let removedCopper = 0;
    let removesCull = false;
    for (const targetId of action.command.targetCardInstanceIds) {
      const card = cardById(state, playerId, targetId);
      if (!card) return false;
      if (!['scrap', 'copper'].includes(card.definitionId)
        && !(card.definitionId === 'cull' && targetId === action.command.cardInstanceId)) return false;
      if (targetId === action.command.cardInstanceId && requiredScrap.length > 0) return false;
      const definition = resolveCard(state, card.definitionId);
      if (card.definitionId === 'copper') removedCopper += 1;
      if (targetId === action.command.cardInstanceId) removesCull = true;
      removedMoney += definition.type === 'treasure' ? definition.money ?? 0 : definition.values?.money ?? 0;
    }
    const remainingMoney = availableMoney - removedMoney;
    const remainingCopper = ownedCount(state, playerId, 'copper') - removedCopper;
    if (removesCull && remainingMoney > floor && remainingCopper > 0) return false;
    return removedMoney === 0 || remainingMoney >= floor;
  });
}

/** Searches the shared, deterministic Action-phase policy over a canonical hidden-order state. */
export function searchAction(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[],
  strategy: Strategy, baseline: SearchBaseline, options: SearchOptions
): SearchOutcome {
  const root = blindedState(state);
  const opponentProfile = attackProfile(root, opponent(playerId));
  const memo = options.memo;
  let visited = 0;

  function step(current: GameState, action: LegalAction): Branch {
    if (action.command.type === 'endActionPhase') {
      return { ...branchAt(current, playerId, strategy, baseline, opponentProfile), suffix: 1 };
    }
    const child = visit(applyLegalAction(current, action));
    return { ...child, suffix: child.suffix + 1 };
  }

  function expand(current: GameState, available: readonly LegalAction[]): Branch {
    let best: Branch | null = null;
    for (const action of allowedActions(current, playerId, available, strategy)) {
      const candidate = step(current, action);
      if (isBetter(candidate, best)) best = candidate;
    }
    if (!best) throw new Error('The Action-phase search reached a state with no legal action.');
    return best;
  }

  function visit(current: GameState): Branch {
    if (current.winner || current.phase !== 'action') {
      return branchAt(current, playerId, strategy, baseline, opponentProfile);
    }
    const key = memo ? memoKey(current, playerId) : null;
    if (key !== null) {
      const cached = memo!.get(key);
      if (cached) return cached;
    }
    visited += 1;
    if (visited > options.stateLimit) {
      throw new ActionSearchOverflowError(`The Action-phase search passed its limit of ${options.stateLimit} states.`);
    }
    const best = expand(current, listLegalActions(current));
    if (key !== null) memo!.set(key, best);
    return best;
  }

  visited += 1;
  if (visited > options.stateLimit) {
    throw new ActionSearchOverflowError(`The Action-phase search passed its limit of ${options.stateLimit} states.`);
  }
  let bestAction: LegalAction | null = null;
  let bestBranch: Branch | null = null;
  for (const action of allowedActions(root, playerId, actions, strategy)) {
    const candidate = step(root, action);
    if (isBetter(candidate, bestBranch)) { bestBranch = candidate; bestAction = action; }
  }
  if (!bestAction) throw new Error('The Action-phase search was given no legal action.');
  return { action: bestAction, visited };
}
