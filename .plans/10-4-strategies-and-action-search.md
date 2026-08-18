# Step 4: readable strategies, fixed baselines, and action search

Implements step 4 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 3.

## Objective

A strategy is a readable data structure. A strategy-driven agent buys from an ordered agenda and chooses Action-phase play by deterministic full search. Fixed baseline strategies give the first population something to beat.

## Strategy

```ts
export interface BuyAgendaEntry { cardId: string; desiredCount: number }  // desiredCount: non-negative integer

export interface Strategy {
  id: string;
  startingBuild: string[];              // definition ids, resolved cost at most 12
  buyAgenda: BuyAgendaEntry[];          // ordered
  treasureFallback: string[];           // for example ['gold', 'silver']
  preferredRange: RangeBand;
  weights: StateWeights;
  trashPriority: string[];              // Cull targets, best first
  reclaimPriority: string[];            // Reclaim targets, best first
  discardPriority: string[];            // Prism discards, best first
}

export interface StateWeights {
  damage: number;                   // opponent health lost this turn
  preferredRange: number;           // the range band matches preferredRange when the turn ends
  cardsDrawn: number;               // cards drawn this turn, counted from draw events
  moneyGained: number;              // money the Action phase leaves for the Buy phase
  trashed: number;                  // per card removed, using trashPriority rank
  reclaimed: number;                // a card put back on the deck, using reclaimPriority rank
  discarded: number;                // per card discarded, using discardPriority rank
  unspentMana: number;              // negative in a sensible strategy
  opponentOutOfAttackRange: number; // the final band matches no attack the owned deck holds
}
```

Every field is a plain number or a list of card ids, so a strategy prints as readable text and a mutation changes one named field.

The starting build is a separate field, as the design document requires, because the private 12-money build has a large effect before normal purchases.

`opponentOutOfAttackRange` was named `selfExposedRange`. That name read like the game's `exposed` condition from Feint, which it is unrelated to, and it described the wrong side. It is `1` when the final range band matches no attack in the player's **full owned deck** — every zone, not just the hand — and `0` otherwise.

## Buying

The agenda selects from the legal action list `runMatch` already passes to `chooseAction`. It does **not** recompute legality. That inherits supply exhaustion and overridden costs for free: `buyActions` stops offering an action pile once `supply` reaches 0, and it already prices everything through `resolveCard` (`src/game/engine.ts:93-98`). Recomputing with `cardDefinition` would make the Rigged melee calibration in the parent plan fail in a way that looks like a balance finding.

Buy the first agenda entry that is offered in `actions` and whose owned count is below `desiredCount`. Repeat while money remains. Then buy the first treasure in `treasureFallback` that is offered, **skipping any whose resolved cost is 0**. Stop when nothing is affordable.

Skipping cost-0 treasures is what makes the loop terminate. Copper costs 0, treasures are always available regardless of supply, and the engine has no per-turn buy cap, so a fallback list containing `copper` would buy forever. The committed baselines use `['gold','silver']` and are safe today, but step 6 mutates strategy fields, so the hang is reachable as soon as evolution runs. Step 3's `actionCapPerTurn` is the second line of defence.

**Owned count is the zone count**: `hand + play + draw + discard`. Not `player.purchases` as well — `buyCard` pushes the new card into `deck.discard` *and* into `player.purchases` (`src/game/engine.ts:274`), so counting both double-counts every purchase, and the starting build is already dealt into `deck.draw`. The zone count also stops counting a card after a Cull, which is the behaviour the agenda wants: a Culled card is genuinely gone and worth re-buying. `state.trash` is not a zone the player owns.

An agenda entry naming a card the kingdom does not sell is skipped, not an error. Mutation can produce one, and skipping keeps mutation simple.

## Starting build repair

`submitBuild` throws when a build names a card the kingdom does not sell and when the resolved cost exceeds 12 (`src/game/engine.ts:245-247`). Kingdom overrides re-price cards per kingdom, so a build that costs 12 in one kingdom costs more in another, and Rigged melee re-prices Heavy Blow deliberately.

`chooseStartingBuild` therefore repairs before returning: drop cards the market does not offer, then drop from the end until the resolved cost is at most 12. Leftover money is not spent — it carries into the first Buy phase as `firstBuyMoney` (`src/game/engine.ts:231,265`), where the agenda uses it.

## Action search

For each decision, search the complete Action-phase tree from the current state:

1. Enumerate every legal action, including every movement, direction, trash, reclaim, and discard choice, and the action that ends the phase.
2. Apply each, and recurse. Stop a branch when the phase ends or a player wins.
3. Score each terminal state with `StateWeights`.
4. Return the first action of the best-scoring branch.

Then apply that one action and search again from the new state, as the design document requires.

`chooseAction` dispatches explicitly: **Buy phase** → the agenda; **Action phase** → the search; **pending choice** → the search. Without this stated, `buy.ts` can be written as a function the runner never calls.

**Memoisation.** Key each visited state by a canonical string built from: both fighters' positions, health, and conditions; the acting player's hand as a sorted multiset of definition ids; the play area as a sorted multiset; the draw pile **in order**; the discard pile **in order**; mana; money; `positionChanged`; `rngState`; `pendingChoice`; and the Tactical Action count so far. Exclude `events`, `version`, and card instance ids, which differ without changing the game. Key on the state reached by applying commands, never on `action.id`, which embeds `state.version` (`src/game/engine.ts:24`).

Three of those fields are not optional:

- `positionChanged` drives Adapt's second draw (`src/game/effects.ts:168-174`). Without it, hand `[footwork, footwork, adapt]` at position 2 collides on `[stay, stay]` versus `[left, right]` — same position, same hand, same piles — and Adapt then draws 2 in one branch and 1 in the other. The memo returns the wrong subtree and the search picks the worse first action.
- Discard **order** matters because `draw` reshuffles the discard pile in array order with `rngState` (`src/game/engine.ts:115-127`). Two Prism discards of X-then-Y and Y-then-X share a multiset but shuffle to different hands.
- `money` is raised mid-phase by Stipend (`src/game/effects.ts:157-163`). It is derivable from the play-area multiset today, but only by accident.

The memo is **reused across decisions within one Action phase**. The engine is deterministic, so this is sound, and it recovers much of the cost of re-searching after every applied action.

**State limit.** Cap visited states for each decision. Start at 20000 and record the measured maximum. On overflow the search throws `ActionSearchOverflowError` from `src/sim/types.ts`; `runMatch` converts it to `outcome: 'aborted'`, `reason: 'actionSearchOverflow'`. It must not silently choose a weaker action. If measurement shows frequent overflow, beam search is the first fallback to evaluate, as the design document says; do not add it before the full search is measured.

**Choice branching.** Enumerate trash, reclaim, and discard choices in full rather than collapsing them to the strategy's priority list. The priority lists rank those outcomes in scoring and break ties, so the search stays faithful to "try every legal card order and choice". Cull adds at most one branch for each one- and two-card subset of the hand (`src/game/engine.ts:73-80`), which memoisation absorbs. Record the measured node counts; collapsing choices to the priority list is a fallback to evaluate only if measurement demands it.

## Scoring

Score the state reached **before** applying `endActionPhase`, relative to the state at the start of the search.

The snapshot matters. `endActionPhase` moves every treasure out of hand into play, adds their money to `player.money`, and sets `player.mana = 0`, all in one step (`src/game/engine.ts:260-267`). Scoring after it makes `weights.unspentMana` dead code and drops hand size by the number of treasures held. So score before it, and compute money by hand:

```text
money = player.money
      + sum(resolveCard(state, card).money for treasures in hand)
      + (player.firstBuyPending ? player.firstBuyMoney : 0)
```

Lethality is a **separate lexicographic key**, compared before the numeric score: a line that leaves the opponent at 0 health beats every line that does not, and ties between lethal lines fall through to the numeric score. A `1e9` sentinel is not safe, because step 6 mutates `StateWeights` and an unbounded weight can outrank it.

```text
score = weights.damage                   * (opponent health lost this turn)
      + weights.cardsDrawn               * (cards drawn this turn, from draw events)
      + weights.moneyGained              * (money, as computed above)
      + weights.trashed                  * (sum of trash ranks removed)
      + weights.reclaimed                * (reclaim rank recovered)
      + weights.discarded                * (sum of discard ranks discarded)
      + weights.preferredRange           * (1 when the final range band equals preferredRange)
      + weights.unspentMana              * (mana held before the phase ends)
      + weights.opponentOutOfAttackRange * (1 when the final band matches no attack the owned deck holds)
```

**Rank formula, and its sign.** For every priority list, `rank = list.length - index` for a listed card and `0` for an unlisted one. All three lists are best-first, so index 0 is the most-wanted card and must earn the **largest** contribution. Scoring the raw index would pay more for trashing the least-wanted card — a sign inversion that makes results plausible but wrong, and one that only a rank-sign test catches.

`cardsDrawn` counts `draw` events, not hand-size change. Playing a card also removes it from hand, so under a hand-size reading a positive weight biases the search *against* playing attacks.

Break an exact tie by enumerating actions in a fixed order, keeping the first strictly better result, then preferring the shorter **suffix**. A stable hash of the whole action sequence is not usable: a memo entry is keyed by state, not by path, so the hash of the full path is not knowable from a sub-search. Suffix length decomposes; a whole-path hash does not.

Aimed is deliberately not scored. It expires when the Buy phase ends, so an Aim that is never followed by a Volley is already worth only its draw.

## Baselines

Fixed strategies, defined as data and committed. Definition ids come from `src/game-data/cards.json`. Every starting build costs at most 12 at base prices; the repair rule above handles kingdoms that re-price them.

| Id | `preferredRange` | `startingBuild` (base cost) | `buyAgenda` (cardId × desiredCount) |
| --- | --- | --- | --- |
| `treasure-only` | `Near` | `[]` (0) | none |
| `melee-rush` | `Close` | `heavyBlow, drive, step` (11) | `heavyBlow×3, drive×2, feint×2, footwork×2` |
| `ranged-standard` | `Far` | `volley, aim, footwork` (11) | `volley×3, aim×3, steadyShot×2, footwork×2` |
| `mage-standard` | `Far` | `channel, arcBolt, leyStep, step` (11) | `fireball×2, arcBolt×3, channel×3, prism×1` |
| `engine-draw` | `Near` | `muster, stipend, footwork` (11) | `muster×3, adapt×2, stipend×2, steadyShot×2` |

`treasure-only` has an **empty** starting build on purpose, so the whole 12 carries into the first Buy phase as `firstBuyMoney` and is spent through `treasureFallback`. The earlier description said both "spends the starting budget on treasure" and "spends it through the buy agenda"; those are different builds, and this is the one meant.

`mage-standard` takes `Far` rather than "Any range", because `RangeBand` admits only `Close`, `Near`, and `Far` (`src/game/types.ts:7`). Its spells are range-free, so the weight is set to 0 and the value never matters.

Every baseline uses `treasureFallback: ['gold', 'silver']`, `trashPriority: ['copper']`, `reclaimPriority: ['gold', 'silver']`, `discardPriority: ['copper', 'silver']`, and these weights:

```text
damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2,
reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
```

with two overrides: `treasure-only` sets `damage 10, preferredRange 0, moneyGained 4` and everything else 0; `mage-standard` sets `preferredRange 0` and `unspentMana -3`.

These numbers are the starting population's yardstick, so they are recorded here rather than invented by the writer. Step 6 mutates them.

A baseline whose cards a kingdom does not sell still runs; its agenda entries and build cards are skipped.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/strategy.ts` | New. `Strategy`, `StateWeights`, rank helper, readable formatting. |
| `src/sim/buy.ts` | New. Agenda evaluation. |
| `src/sim/search.ts` | New. Action search, memo, state limit, scoring. |
| `src/sim/agents/strategyAgent.ts` | New. The `Agent` that step 3 defines, including build repair and phase dispatch. |
| `src/sim/baselines.ts` | New. The five fixed baseline strategies. |
| `test/sim/search.test.ts` | New. |
| `test/sim/buy.test.ts` | New. |
| `test/sim/match.test.ts` | Extended for checks 12 and 13. |

## Checks

Each uses a fixed hand, position, and strategy.

1. Finds an available lethal sequence when one exists, and still finds it under extreme but valid weights, proving lethality is lexicographic rather than a `1e9` sentinel.
2. Moves before attacking when movement unlocks lethal damage, for example Footwork to Close before Heavy Blow.
3. Plays Aim before Volley when that increases damage.
4. Uses a wall collision when Drive into a wall is the best line.
5. Orders Tactical Actions before Flurry when that increases damage.
6. With `weights.trashed > 0` and two trashable cards at ranks 0 and 2, the search trashes the **rank-0** card. Same shape for `reclaimed` and for a Prism `discarded`.
7. Returns the same choice from the same state and strategy across repeated calls, and across a JSON round-trip of the state and strategy. Not a fresh process: the engine reads no ambient state, so a second process would exercise the module loader rather than the search.
8. Memo on and memo off choose the same action for a fixed hand. This is the one check that catches a bad memo key.
9. A fixture where a net-zero move sequence unlocks Adapt's extra draw: the search takes it. Direct regression for `positionChanged`.
10. A state with leftover mana and treasures in hand: both `unspentMana` and `moneyGained` change the score.

Buy checks:

11. The agenda buys the first affordable entry below its desired count, then repeats while money remains, then stops at the desired count and falls through to treasure.
12. An agenda entry for a card the kingdom does not sell is skipped, and so is one whose pile is exhausted.
13. The agenda buys Heavy Blow at 5 money in a kingdom that overrides its cost to 3, proving costs resolve through the kingdom.
14. Buying a card up to `desiredCount` within one Buy phase stops there — no double count between `discard` and `purchases`. After Culling a bought card, the agenda buys it again.
15. A strategy with `copper` in `treasureFallback` finishes its Buy phase. Give the test a timeout so a hang fails rather than blocks the suite.
16. `chooseAction` in a Buy-phase state returns an agenda-driven `buyCard` or `endBuyPhase`, and always returns an element of the `actions` array it was given. Same assertion for the Action phase.
17. `chooseStartingBuild` for `melee-rush` does not throw in a kingdom without Heavy Blow, nor in a kingdom whose overrides raise costs above 12.

Search-limit checks:

18. A state limit of 1 makes the search throw `ActionSearchOverflowError` rather than return a weak action.
19. `runMatch` turns that into `outcome: 'aborted'`, `reason: 'actionSearchOverflow'`, with telemetry preserved.

Coverage check:

20. One short match per baseline pair per curated kingdom completes without throwing. Cheap, and it catches build and agenda repair broadly.

## Completion criterion

Strategies are readable data, the agent buys and plays through them, all twenty checks pass, and the four verification commands pass.

Record **measured wall-clock per decision and per match**, not only node counts. Every node applies an action through `applyAction`, which `structuredClone`s the whole `GameState` including the growing `events` array, and re-runs `listLegalActions` to resolve the id, so each node lists actions twice and node cost grows with match length. Against the parent plan's pairing counts this is the throughput risk for the whole goal. Step 8 fixes the cloning; step 4 is where the cost is created, so the measurement belongs here.
