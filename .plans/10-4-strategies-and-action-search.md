# Step 4: readable strategies, fixed baselines, and action search

Implements step 4 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 3.

## Objective

A strategy is a readable data structure. A strategy-driven agent buys from an ordered agenda and chooses Action-phase play by deterministic full search. Fixed baseline strategies give the first population something to beat.

## Strategy

```ts
export interface BuyAgendaEntry { cardId: string; desiredCount: number }

export interface Strategy {
  id: string;
  startingBuild: string[];              // definition ids, total cost at most 12
  buyAgenda: BuyAgendaEntry[];          // ordered
  treasureFallback: string[];           // for example ['gold', 'silver']
  preferredRange: RangeBand;
  weights: StateWeights;
  trashPriority: string[];              // Cull targets, best first
  reclaimPriority: string[];            // Reclaim targets, best first
  discardPriority: string[];            // Prism discards, best first
}

export interface StateWeights {
  damage: number;          // damage dealt to the opponent this turn
  preferredRange: number;  // the range band matches preferredRange when the turn ends
  cardsDrawn: number;      // net cards added to hand this turn
  moneyGained: number;     // money the Action phase leaves for the Buy phase
  trashed: number;         // per card removed, using trashPriority rank
  reclaimed: number;       // a card put back on the deck, using reclaimPriority rank
  unspentMana: number;     // negative in a sensible strategy
  selfExposedRange: number; // the opponent is left at a range this strategy cannot attack
}
```

Every field is a plain number or a list of card ids, so a strategy prints as readable text and a mutation changes one named field.

The starting build is a separate field, as the design document requires, because the private 12-money build has a large effect before normal purchases.

## Buying

Buy the first agenda entry that is affordable and whose owned count is below `desiredCount`. Repeat while money remains. Then buy the first affordable treasure in `treasureFallback`. Stop when nothing is affordable.

Owned count counts every copy the player owns in every zone, plus copies bought earlier in the same Buy phase. Use `player.purchases` and the starting build, not only the discard pile.

An agenda entry naming a card that the kingdom does not sell is skipped, not an error. Mutation can produce one, and skipping keeps mutation simple.

## Action search

For each decision, search the complete Action-phase tree from the current state:

1. Enumerate every legal action, including every movement, direction, trash, reclaim, and discard choice, and the action that ends the phase.
2. Apply each, and recurse. Stop a branch when the phase ends or a player wins.
3. Score each terminal state with `StateWeights`. An immediate win scores above every other line.
4. Return the first action of the best-scoring branch.

Then apply that one action and search again from the new state, as the design document requires.

**Memoisation.** Key each visited state by a canonical string built from: both fighters' positions, health, and conditions; the acting player's hand as a sorted multiset of definition ids; the play area as a sorted multiset; the draw pile in order; the discard pile as a sorted multiset; mana; `pendingChoice`; and the Tactical Action count so far. Exclude `events`, `version`, and card instance ids, which differ without changing the game.

**State limit.** Cap visited states for each decision. Start at 20000 and record the measured maximum. On overflow, the search reports `actionSearchOverflow`. The runner records that as an explicit match result and stops the match. It must not silently choose a weaker action. If measurement shows frequent overflow, beam search is the first fallback to evaluate, as the design document says; do not add it before the full search is measured.

**Choice branching.** Enumerate trash, reclaim, and discard choices in full rather than collapsing them to the strategy's priority list. The priority lists rank those outcomes in scoring and break ties, so the search stays faithful to "try every legal card order and choice". Cull adds at most one branch for each one- and two-card subset of the hand, which memoisation absorbs. Record the measured node counts; collapsing choices to the priority list is a fallback to evaluate only if measurement demands it.

## Scoring

Score a terminal state relative to the state at the start of the search:

```text
score = 1e9                        when the opponent is at 0 health
      + weights.damage       * (opponent health lost this turn)
      + weights.cardsDrawn   * (hand size change)
      + weights.moneyGained  * (money available for the Buy phase)
      + weights.trashed      * (sum of trash priority ranks removed)
      + weights.reclaimed    * (reclaim priority rank recovered)
      + weights.preferredRange * (1 when the final range band equals preferredRange)
      + weights.unspentMana  * (mana left when the phase ends)
      + weights.selfExposedRange * (1 when the final band matches no attack the deck holds)
```

Break an exact tie by the shorter action sequence, then by a stable hash of the sequence, so the same state and strategy always give the same choice.

Aimed is deliberately not scored. It expires when the Buy phase ends, so an Aim that is never followed by a Volley is already worth only its draw.

## Baselines

Fixed strategies, defined as data and committed:

| Id | Shape |
| --- | --- |
| `treasure-only` | No action cards. Spends the starting budget on treasure and buys Gold then Silver. Spends the starting budget through the buy agenda, which the design document allows. |
| `melee-rush` | Close preference. Heavy Blow, Drive, Feint, Footwork. |
| `ranged-standard` | Far preference. Volley, Aim, Steady Shot, Footwork. |
| `mage-standard` | Any range. Channel, Arc Bolt, Fireball, Prism. |
| `engine-draw` | Muster, Stipend, Adapt, Footwork, with a late attack. |

A baseline whose cards a kingdom does not sell still runs; its agenda entries are skipped.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/strategy.ts` | New. `Strategy`, `StateWeights`, readable formatting. |
| `src/sim/buy.ts` | New. Agenda evaluation. |
| `src/sim/search.ts` | New. Action search, memo, state limit, scoring. |
| `src/sim/agents/strategyAgent.ts` | New. The `Agent` that step 3 defines. |
| `src/sim/baselines.ts` | New. The fixed baseline strategies. |
| `test/sim/search.test.ts` | New. |
| `test/sim/buy.test.ts` | New. |

## Checks

The design document requires these programmatic action-search checks. Each uses a fixed hand, position, and strategy.

1. Finds an available lethal sequence when one exists.
2. Moves before attacking when movement unlocks lethal damage, for example Footwork to Close before Heavy Blow.
3. Plays Aim before Volley when that increases damage.
4. Uses a wall collision when Drive into a wall is the best line.
5. Orders Tactical Actions before Flurry when that increases damage.
6. Follows the configured trash and reclaim priorities in fixed states.
7. Returns the same choice from the same state and strategy, across repeated calls and a fresh process.

Buy checks:

8. The agenda buys the first affordable entry below its desired count, then repeats while money remains.
9. The agenda stops at the desired count and falls through to treasure.
10. An agenda entry for a card the kingdom does not sell is skipped.

Search-limit checks:

11. A state limit of 1 makes the search report overflow rather than return a weak action.
12. The runner turns an overflow into a match result with reason `actionSearchOverflow`.

## Completion criterion

Strategies are readable data, the agent buys and plays through them, all twelve checks pass, and the four verification commands pass.
