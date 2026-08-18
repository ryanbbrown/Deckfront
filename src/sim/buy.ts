import { resolveCard } from '../game';
import type { GameState, LegalAction, PlayerId } from '../game';
import type { Strategy } from './strategy';

/**
 * The zones the player owns. `player.purchases` is deliberately excluded: `buyCard` pushes a bought
 * card into `deck.discard` and into `purchases`, so counting both double-counts every purchase. The
 * zone count also stops counting a Culled card, which is the behaviour the agenda wants.
 */
export function ownedCount(state: GameState, playerId: PlayerId, cardId: string): number {
  const deck = state.players[playerId].deck;
  let count = 0;
  for (const zone of [deck.draw, deck.hand, deck.discard, deck.play]) {
    for (const card of zone) if (card.definitionId === cardId) count += 1;
  }
  return count;
}

/**
 * Picks one Buy-phase action from the list `runMatch` supplied. It never recomputes legality, so
 * supply exhaustion and kingdom-overridden costs come for free.
 */
export function chooseBuyAction(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], strategy: Strategy
): LegalAction {
  const offered = (cardId: string): LegalAction | undefined =>
    actions.find((action) => action.command.type === 'buyCard' && action.command.definitionId === cardId);

  for (const entry of strategy.buyAgenda) {
    if (entry.desiredCount <= 0) continue;
    const action = offered(entry.cardId);
    // An agenda entry the kingdom does not sell, or whose pile is exhausted, is skipped, not an error.
    if (!action) continue;
    if (ownedCount(state, playerId, entry.cardId) >= entry.desiredCount) continue;
    return action;
  }

  for (const cardId of strategy.treasureFallback) {
    const action = offered(cardId);
    if (!action) continue;
    // A cost-0 treasure never reduces money, and the engine has no per-turn buy cap, so buying one
    // would loop forever.
    if (resolveCard(state, cardId).cost <= 0) continue;
    return action;
  }

  const end = actions.find((action) => action.command.type === 'endBuyPhase');
  if (!end) throw new Error('The Buy phase offered no way to end it.');
  return end;
}
