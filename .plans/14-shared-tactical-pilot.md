# Shared tactical pilot

## Goal

Make evolution search only over the deck plan. Every strategy uses the same deterministic tactical pilot.

Test the finished simulator on `current-duel` and `three-way-engine`, then run one implementation review-panel cycle.

## Strategy model

A strategy contains:

- a starting build;
- an ordered list of finite acquisition targets, where each count means total copies acquired from setup and purchases; and
- one explicit card to buy repeatedly after the finite list is complete.

The repeated purchase is part of the purchase plan. It replaces the hidden treasure fallback. It may be any positive-cost market card except Copper and it mutates with the purchase plan.

Remove these per-strategy fields:

- preferred range;
- action-selection weights;
- trash priority;
- reclaim priority;
- discard priority; and
- treasure fallback.

Do not preserve the old strategy shape. Update seeds, artifacts, reports, tests, and documentation to describe the current shape.

## Purchase behavior

- Never generate, repair, or execute a plan that buys Copper.
- Count finite progress from starting-build copies plus the player's purchase history, not the cards still owned. Trashing a card does not put it back on the purchase list.
- Buy the first affordable finite entry that still has purchases remaining.
- After every finite entry is complete or unavailable, buy the explicit repeated card while it is affordable and available.
- End the Buy phase when the plan offers no legal purchase.
- Preserve supply limits and unlimited buys per Buy phase.

## Shared Action-phase search

Keep one deterministic pilot for every strategy. The pilot searches legal Action-phase lines and compares complete lines in this order:

1. win this turn;
2. deal more damage this turn;
3. achieve a better projected purchase-plan result with the money left for the Buy phase;
4. trash more Copper without violating the economy floor;
5. draw more cards when the earlier results tie;
6. end at the range with the best printed attack potential for the cards the player owns; and
7. use a stable final tie-break.

Purchase-plan results compare progress in plan order. One more purchase from an earlier finite entry beats progress in a later entry. The repeated purchase breaks ties after all finite entries.

Remove the preferred-range bonus and all mutable scoring weights. Range comes from the legal actions, their actual damage, and the fixed attack-potential tie-break.

## Hidden draw order

The pilot must not choose an action from the exact order of either hidden draw pile.

- Two otherwise identical observable states with different hidden draw orders must produce the same next action.
- After a card is actually drawn, the pilot may use the revealed hand for the next decision.
- Do not add full chance-tree or multi-turn search in this change.
- Use one simple deterministic hidden-order representation and prefer safe draw lines when all earlier outcomes tie.

## Cull

Cull may trash only Copper or the Cull card being played. The pilot must never choose another card as a Cull target.

Evaluate the legal choices to trash zero, one, or two Coppers. "Zero" means skip Cull unless Cull should trash itself.

- Preserve Copper when keeping it enables a better projected purchase this turn.
- When projected purchases tie, trash as many Coppers as possible.
- Set the economy floor from the cost of the repeated purchase.
- Count repeatable owned money from Treasure cards and cards that provide money during the Action phase. Do not count the one-time setup credit.
- Reject a Cull line that lowers repeatable owned money below the economy floor.
- When the player is at the economy floor, or owns no Copper, prefer trashing Cull itself over keeping a card that can no longer improve the deck under this rule.

The game engine continues to expose every legal Cull target for browser play. These restrictions belong to the shared simulator pilot.

## Reclaim and Prism

- Reclaim always selects the highest-cost card in the discard pile. Break equal costs deterministically. Recover nothing only when the discard pile is empty.
- Prism discard is chosen by the shared Action-phase search. It is not a strategy field.

## Evolution

Mutation may change only:

- starting-build membership;
- finite purchase membership;
- finite purchase order;
- finite purchase counts; and
- the repeated purchase.

Repair and canonical identity must remove no-op forms. At minimum:

- remove Copper purchases;
- remove duplicate finite entries;
- remove zero finite counts;
- remove a finite target that the starting build already satisfies; and
- ensure the repeated purchase is legal, positive-cost, and distinct from no behavior only where its execution differs.

Population uniqueness, strategy IDs, tournament deduplication, and reports use this normalized executable shape.

## Tests

Add tests at public simulator boundaries. The tests must fail for these regressions:

- permuting a hidden draw pile changes the pilot's next action;
- preferred range, mutable weights, or priority fields reappear in a strategy artifact;
- a strategy buys Copper;
- starting-build copies are bought again as finite purchases;
- a trashed purchased card is bought again because ownership fell;
- a completed finite plan does not use its repeated purchase;
- Cull trashes a non-Copper card;
- Cull sacrifices a planned purchase when a smaller trash choice preserves it;
- Cull keeps Copper when every choice produces the same purchase and the economy floor allows thinning;
- Cull removes repeatable money below the economy floor;
- Reclaim does not choose the highest-cost discarded card; or
- mutation and deduplication spend separate population slots on removed tactical fields.

Use literal states, commands, purchases, and strategy artifacts as test oracles. Do not assert private helper calls or reproduce the implementation inside tests.

## Validation

Run:

```sh
npm run build:sim
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Run compiled smoke experiments for `current-duel` and `three-way-engine` in a temporary root so committed reports and the user's existing experiment outputs remain unchanged. Confirm for each run:

- the command exits successfully;
- evolution and the final tournament complete;
- no match aborts;
- generated strategy records contain only the new strategy model; and
- no strategy plan contains Copper.

## Review

After implementation and both kingdom runs pass, run exactly one review-panel cycle in implementation mode against the clean pre-implementation SHA. Verify every finding, send required fixes to the same writer, and rerun the relevant validation. Do not run a second panel cycle.
