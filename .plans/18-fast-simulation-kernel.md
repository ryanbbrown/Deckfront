# Fast simulation kernel

## Goal

Increase simulation throughput without changing the strategy model, PSRO search, game rules, or product engine. Replace the expensive full action-tree pilot with one deterministic shared pilot. Run simulations through a compact mutable kernel. Keep the immutable game engine and full-tree pilot as independent correctness references.

## Decisions

- A strategy still contains only `startingBuild`, `buyAgenda`, and `repeatPurchase`.
- All strategies use the same tactical play policy.
- The policy does not inspect the hidden order of the draw pile.
- The policy replans after a card draws or recovers a card.
- The immutable engine remains the product and UI implementation.
- The simulator uses a separate compact kernel behind the existing pairing result contract.
- The full-tree search remains available only for comparison diagnostics.
- Match and PSRO result order remains deterministic at every worker count.

## 1. Deterministic tactical pilot

Add one small tactical-planner interface. It accepts only the visible action state that is needed to choose the next action. It returns a semantic choice, not a product-engine object or card instance ID.

The planner will use explicit rules for the current mechanics:

- Play unconditional draw, money, mana, and damage cards when they cannot make the turn worse.
- Replan after every draw.
- Recover the highest-cost discard card before later draw effects when possible.
- Move before Adapt when movement enables its extra draw.
- Preserve Aim for Volley and consume an existing Aim before playing another Aim.
- Consume Feint with a close attack before playing another Feint.
- Play Flurry after other tactical actions so its damage uses the largest count.
- Select the best affordable spell set from the mana available after mana actions.
- Select movement and range attacks with a bounded dynamic program over five board positions and aggregate card counts. Do not enumerate permutations of equivalent actions.
- Play Prism only when its mana and draw can improve the turn after its required discard. Discard the card with the lowest current-turn value.
- Resolve Cull after draws. Compare trashing zero, one, or two Coppers and retiring Cull. Keep the best finite buy-plan progress first, then Copper removal, then Cull retirement when Cull is obsolete.
- End the action phase when no remaining action can improve the shared objective.

The ordering objective remains: lethal result, damage, buy-plan progress, Copper removal, obsolete Cull removal, draw, and remaining attack potential.

## 2. Independent behavior validation

Keep the existing full-tree pilot and immutable engine as an oracle path.

- Add public-seam scenarios for Aim and Volley, Feint, Flurry, movement, mana and spells, Prism, Cull, and Reclaim.
- Add a comparison command that samples real decisions and reports semantic action agreement between the new pilot and the full-tree pilot.
- Compare complete match results on all curated kingdoms, multiple seeds, both first-player choices, and side swaps.
- Report outcome, reason, turns, and telemetry differences. Do not hide expected policy differences.
- Require deterministic repeated results for the new pilot.

## 3. Compact mutable simulation kernel

Add a simulation-only match module with a narrow input and the existing `MatchResult` output.

- Resolve kingdom cards once into numeric indexes and compact mechanic data.
- Store hands, draw piles, discard piles, play areas, supply, positions, health, mana, money, and tactical flags in mutable arrays and numbers.
- Implement the existing deterministic shuffle and all current card mechanics.
- Count telemetry directly instead of storing and slicing the complete event history.
- Apply the same starting-build, buy-agenda, repeat-purchase, first-player, side-swap, turn-limit, and action-cap rules.
- Make strategy pairings use this kernel by default.
- Keep generic `runMatch` unchanged for the product engine, tests, and oracle comparison.
- Remove production action-search limits and overflow handling after no production path can enter the tree search.

## 4. Preserve the immutable product engine

Do not rewrite the UI engine around simulator data structures. The product engine remains readable, immutable, and event-producing. The compact kernel is allowed to duplicate rule execution because its behavior is checked at the complete-match seam against the product engine.

## 5. Worker efficiency

Measure again after the per-game work is smaller.

- Record throughput at 1, 2, 4, 6, 8, 10, and 12 workers.
- Measure worker busy time and coordinator wall time for matrix fills and response-oracle evaluations.
- Confirm that mixture evaluation already distributes seed blocks from one candidate across workers.
- Test small ordered job batches per worker only if message overhead becomes material.
- Test splitting a matrix cell by seed block only if row additions leave cores idle and the change can preserve early-stop rules.
- Keep dynamic scheduling and fold results in submission order.
- Choose the worker count and batching policy from measured throughput, not core count alone.

## Files and interfaces

- Add `src/sim/tacticalPilot.ts` for the shared bounded planner.
- Add `src/sim/tacticalAgent.ts` as the immutable-engine adapter.
- Add `src/sim/simulationKernel.ts` as the compact production simulator.
- Update `src/sim/pairing.ts` to call the compact simulator.
- Keep `src/sim/search.ts` and `src/sim/agents/strategyAgent.ts` as oracle-only code.
- Add a pilot comparison script and focused public-seam tests.
- Update worker code only after profiling shows a useful change.
- Update `README.md` and simulator scripts to describe and measure the current implementation.

## Verification

- Focused tactical-policy tests pass.
- Compact-kernel matches are deterministic.
- Product-engine and compact-kernel complete-match comparisons cover every curated kingdom.
- The comparison report gives action agreement and full-match outcome differences against full search.
- Existing PSRO, matrix, pairing, report, and bundle tests pass.
- `npm run build:sim`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- A compiled Current Duel benchmark reports games per second and 1-to-12-worker scaling before and after the change.
- No simulator production run can fail with `actionSearchOverflow`.

## Completion boundary

Stop after the low-risk pilot, kernel, and measured worker improvements. Do not start a Rust port, change the PSRO method, or do a broader Provincial research comparison in this plan.

## Implementation result

Completed on an Apple M4 Pro with Node.js 22.23.1:

- Current Duel full-tree reference: 790 games/s median.
- Shared tactical pilot on the immutable engine: 4,014 games/s median.
- Compact production kernel: 42,014 games/s median after warm-up, with no search overflow path.
- Four workers: about 66,000 games/s for one-seed jobs and 102,000 games/s for 25-seed jobs.
- Eight-job worker messages improved the one-seed four-worker test from 58,965 to 65,916 games/s.
- More than four workers reduced throughput on both measured workloads.
- The compact kernel and immutable engine produced exact complete `MatchResult` values across 640 matches. The sample included all five curated kingdoms, diagnostic strategies, random legal strategies, two seeds, both first-player seats, and both arena sides.
- Against the old full-tree pilot, the shared pilot agreed on 84.8% of recorded Action-phase decisions. It produced the same winner in 83.2% of 250 individual samples. Across 50 diagnostic matchup cells with 100 games per cell, it kept the same winner direction in 88.0% of cells and changed the mean win rate by 10.2 percentage points. These differences remain visible because the old pilot used a complete tree over a synthetic hidden-deck order, while the shared pilot uses only visible state.
