import { resolveCard } from '../game';
import type { GameState, LegalAction, PlayerId } from '../game';
import { slotWantsMore } from './strategy';
import type { Strategy } from './strategy';

function occurrences(ids: readonly string[], cardId: string): number {
  return ids.reduce((total, id) => total + (id === cardId ? 1 : 0), 0);
}

/** Setup and purchase history are permanent acquisition progress, even after a card is trashed. */
export function acquiredCount(state: GameState, playerId: PlayerId, cardId: string): number {
  const player = state.players[playerId];
  return occurrences(player.startingBuild ?? [], cardId) + occurrences(player.purchases, cardId);
}

function pileAvailable(state: GameState, cardId: string, supply: Readonly<Record<string, number>> = state.supply): boolean {
  const definition = resolveCard(state, cardId);
  return definition.type === 'treasure' || (supply[cardId] ?? 0) > 0;
}

export interface PurchaseProjection {
  /** One entry per fixed slot, in ladder order. */
  bought: readonly number[];
}

/** Projects the exact shared Buy policy without changing the game state. */
export function projectPurchases(
  state: GameState, playerId: PlayerId, money: number, strategy: Strategy
): PurchaseProjection {
  const acquired = new Map<string, number>();
  for (const slot of strategy.buyPlan) if (slot.kind === 'buy' && !acquired.has(slot.cardId))
    acquired.set(slot.cardId, acquiredCount(state, playerId, slot.cardId));
  const bought = strategy.buyPlan.map(() => 0);
  const supply = { ...state.supply };

  while (true) {
    let purchased = false;
    let stopped = false;
    for (let index = 0; index < strategy.buyPlan.length; index += 1) {
      const slot = strategy.buyPlan[index]!;
      if (slot.kind === 'inactive') continue;
      if (slot.kind === 'stop') {
        if (money >= slot.threshold) { stopped = true; break; }
        continue;
      }
      const count = acquired.get(slot.cardId) ?? 0;
      if (slot.cardId === 'copper' || !slotWantsMore(slot, count)) continue;
      const definition = resolveCard(state, slot.cardId);
      if (definition.cost <= 0 || !pileAvailable(state, slot.cardId, supply) || definition.cost > money) continue;
      money -= definition.cost;
      acquired.set(slot.cardId, count + 1);
      bought[index]! += 1;
      if (definition.type === 'action') supply[slot.cardId] = (supply[slot.cardId] ?? 0) - 1;
      purchased = true;
      break;
    }
    if (stopped || !purchased) break;
  }
  return { bought };
}

/** Picks one legal Buy action by scanning the fixed ladder from top to bottom. */
export function chooseBuyAction(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], strategy: Strategy
): LegalAction {
  const end = actions.find((action) => action.command.type === 'endBuyPhase');
  if (!end) throw new Error('The Buy phase offered no way to end it.');
  const money = state.players[playerId].money;
  for (const slot of strategy.buyPlan) {
    if (slot.kind === 'inactive') continue;
    if (slot.kind === 'stop') {
      if (money >= slot.threshold) return end;
      continue;
    }
    if (slot.cardId === 'copper') continue;
    const definition = resolveCard(state, slot.cardId);
    if (definition.cost <= 0 || !slotWantsMore(slot, acquiredCount(state, playerId, slot.cardId))) continue;
    const action = actions.find((candidate) => candidate.command.type === 'buyCard'
      && candidate.command.definitionId === slot.cardId);
    if (action) return action;
  }
  return end;
}
