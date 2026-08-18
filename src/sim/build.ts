import { createGame, kingdomEpoch, kingdomMarket, marketCost, resolveCard } from '../game';
import type { GameState } from '../game';

/** `submitBuild` and `finishSetup` both settle the starting build against this budget. */
export const STARTING_BUDGET = 12;

/**
 * The single build-repair rule for the project. Drops cards the market does not offer, then
 * repeatedly drops the most expensive card, ties broken by definition id ascending, until the
 * resolved cost fits the budget. Kingdom overrides re-price cards, so a build that fits one kingdom
 * can overrun another. Step 6 imports this for mutation repair: with two rules, a mutated build
 * would be repaired one way at mutation time and another at match time, so the recorded strategy
 * would not be the one that played.
 *
 * Leftover money is not spent. It carries into the first Buy phase as `firstBuyMoney`.
 */
export function repairBuild(state: GameState, build: readonly string[]): string[] {
  const offered = new Set(kingdomMarket(state.kingdomId).map((definition) => definition.id));
  const kept = build.filter((cardId) => offered.has(cardId));
  while (kept.length && marketCost(state, kept) > STARTING_BUDGET) {
    let worst = 0;
    for (let index = 1; index < kept.length; index += 1) {
      const cost = resolveCard(state, kept[index]!).cost;
      const highest = resolveCard(state, kept[worst]!).cost;
      if (cost > highest || (cost === highest && kept[index]! < kept[worst]!)) worst = index;
    }
    kept.splice(worst, 1);
  }
  return kept;
}

// One fresh game per kingdom. `resolveCard` and `marketCost` read nothing a played game changes, and
// mutation repairs a build thousands of times in a run. The probes are dropped whenever the registry
// is cleared, because the same id can come back with different piles and costs.
const probes = new Map<string, GameState>();
let probeEpoch = kingdomEpoch();

/** `repairBuild` where no game is in hand, for mutation and seeding. The same rule, not a second one. */
export function repairBuildIn(kingdomId: string, build: readonly string[]): string[] {
  if (probeEpoch !== kingdomEpoch()) { probes.clear(); probeEpoch = kingdomEpoch(); }
  let probe = probes.get(kingdomId);
  if (!probe) { probe = createGame({ seed: 1, kingdomId }); probes.set(kingdomId, probe); }
  return repairBuild(probe, build);
}
