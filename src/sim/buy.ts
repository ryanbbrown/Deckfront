import { resolveCard } from '../game';
import type { GameState, LegalAction, PlayerId } from '../game';
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

function finiteStillAvailable(state: GameState, strategy: Strategy, acquired: readonly number[], supply: Readonly<Record<string, number>>): boolean {
  return strategy.buyAgenda.some((entry, index) =>
    entry.cardId !== 'copper'
    && acquired[index]! < entry.desiredCount
    && resolveCard(state, entry.cardId).cost > 0
    && pileAvailable(state, entry.cardId, supply)
  );
}

export interface PurchaseProjection {
  finite: readonly number[];
  repeated: number;
}

/** Projects the exact shared Buy policy without changing the game state. */
export function projectPurchases(
  state: GameState, playerId: PlayerId, money: number, strategy: Strategy
): PurchaseProjection {
  const acquired = strategy.buyAgenda.map((entry) => acquiredCount(state, playerId, entry.cardId));
  const finite = strategy.buyAgenda.map(() => 0);
  const supply = { ...state.supply };
  let repeated = 0;

  while (true) {
    let bought = false;
    for (let index = 0; index < strategy.buyAgenda.length; index += 1) {
      const entry = strategy.buyAgenda[index]!;
      if (entry.cardId === 'copper' || acquired[index]! >= entry.desiredCount) continue;
      const definition = resolveCard(state, entry.cardId);
      if (definition.cost <= 0 || !pileAvailable(state, entry.cardId, supply) || definition.cost > money) continue;
      money -= definition.cost;
      acquired[index]! += 1;
      finite[index]! += 1;
      if (definition.type === 'action') supply[entry.cardId] = (supply[entry.cardId] ?? 0) - 1;
      bought = true;
      break;
    }
    if (bought) continue;
    if (finiteStillAvailable(state, strategy, acquired, supply)) break;
    if (strategy.repeatPurchase === 'copper') break;
    const repeat = resolveCard(state, strategy.repeatPurchase);
    if (repeat.cost <= 0 || repeat.cost > money || !pileAvailable(state, strategy.repeatPurchase, supply)) break;
    money -= repeat.cost;
    repeated += 1;
    if (repeat.type === 'action') supply[strategy.repeatPurchase] = (supply[strategy.repeatPurchase] ?? 0) - 1;
  }
  return { finite, repeated };
}

/** Picks one legal Buy action according to the normalized executable purchase plan. */
export function chooseBuyAction(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], strategy: Strategy
): LegalAction {
  const offered = (cardId: string): LegalAction | undefined => cardId === 'copper'
    ? undefined
    : actions.find((action) => action.command.type === 'buyCard' && action.command.definitionId === cardId);

  for (const entry of strategy.buyAgenda) {
    if (entry.desiredCount <= 0 || entry.cardId === 'copper' || resolveCard(state, entry.cardId).cost <= 0) continue;
    if (acquiredCount(state, playerId, entry.cardId) >= entry.desiredCount) continue;
    const action = offered(entry.cardId);
    if (action) return action;
  }

  const everyFiniteDoneOrUnavailable = strategy.buyAgenda.every((entry) =>
    entry.cardId === 'copper'
    || resolveCard(state, entry.cardId).cost <= 0
    || acquiredCount(state, playerId, entry.cardId) >= entry.desiredCount
    || !pileAvailable(state, entry.cardId)
  );
  if (everyFiniteDoneOrUnavailable && strategy.repeatPurchase !== 'copper') {
    const action = offered(strategy.repeatPurchase);
    if (action && resolveCard(state, strategy.repeatPurchase).cost > 0) return action;
  }

  const end = actions.find((action) => action.command.type === 'endBuyPhase');
  if (!end) throw new Error('The Buy phase offered no way to end it.');
  return end;
}
