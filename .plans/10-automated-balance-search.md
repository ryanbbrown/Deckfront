# Automated balance search

## Status

Implemented design, amended by [11-search-performance.md](./11-search-performance.md). Card values are authoritative in [09-card-list.md](./09-card-list.md).

## Goal

Find strong, readable strategies for a chosen kingdom, then show which cards and strategy families are dominant, viable, or ignored. The system finds balance risks; manual playtests still decide whether cards are fun and understandable.

A **kingdom** is one fixed market plus rule values such as starting health. A **strategy** contains:

- a starting build;
- an ordered buy agenda;
- preferred range;
- action-state scoring;
- trash and discard priorities.

The starting build and buy agenda evolve together as one strategy. Seed coherent pairs, but do not require them to use one card family. Independent mutations must remain possible so the search can find mixed decks and strategic pivots.

## Method

Use the main ideas from [Provincial](https://graphics.stanford.edu/~mdfisher/DominionAI.html):

- run games without the browser or generative AI;
- represent strategies in a readable form;
- seed the first population with sensible strategy shapes;
- evolve strategies through repeated competition;
- keep several leaders because strategies may counter each other;
- finish with a tournament and pairwise win table.

Useful references are [TestChamber.cpp](https://github.com/techmatt/Provincial/blob/master/DominionDLL/TestChamber.cpp), [BuyAgenda.cpp](https://github.com/techmatt/Provincial/blob/master/DominionDLL/BuyAgenda.cpp), and [PlayerHeuristic.cpp](https://github.com/techmatt/Provincial/blob/master/DominionDLL/PlayerHeuristic.cpp). Reuse the ideas, not the code.

Do not start with a neural network. Readable search fits the current strategy space and explains balance results. Reconsider machine learning only if this strategy form cannot recover known strong play.

## Playing a hand

For each Action phase:

1. Try every legal card order and choice, including cards drawn during the search.
2. Stop a branch when the player ends the phase or wins.
3. Rank final states by immediate win, damage, preferred range, useful deck changes, and explicit strategy preferences.
4. Choose the first action from the best branch, then search again after the state changes.

A harmless draw card is normally worth playing, but movement can enable one attack and disable another. Immediate damage also cannot judge trashing, discarding, or reclaiming without strategy preferences.

Memoize repeated states. If a search exceeds its explicit state limit, report the overflow. Do not silently substitute a weak action. Beam search, which keeps only the best fixed number of partial sequences, is the first fallback to evaluate after the full search works.

Programmatic action-search checks must prove that it:

- finds an available lethal sequence;
- moves before attacking when movement unlocks lethal damage;
- plays Aim before Volley when that increases damage;
- uses a wall collision when it is the best line;
- orders Tactical Actions before Flurry when that increases damage;
- follows configured trash and reclaim priorities in fixed states;
- returns the same choice from the same state and strategy.

## Buying cards

Use an ordered list of card and desired-count pairs. Buy the first affordable card below its desired count, then repeat while money remains. End with simple Treasure fallbacks.

Example:

```text
Volley ×2 -> Aim ×2 -> Footwork ×3 -> Gold -> Silver
```

The starting build is a separate strategy field because the private 12-money build has a large effect before normal purchases.

## Evolution and tournament

One generation:

1. Test every candidate against every leader over shared seeds.
2. Swap first player and arena side for each pairing.
3. Score wins as 1, draws as 0.5, and losses as 0. Keep each four-orientation seed block intact.
4. Keep several strong, meaningfully different candidates as the next leaders.
5. Create the next population by mutating those leaders.

Mutations may change the starting build, agenda cards and order, desired counts, preferred range, state-scoring weights, and deck-change priorities. Some mutations change one part; some change a related package. Budget validity is the only hard coherence constraint.

Leader selection must be deterministic. Rank by the mean of per-opponent pairing means, drop exact duplicate strategies, then keep the top leaders. An exact sign test may stop a settled pairing before its 100-game maximum. Break an equal score by a stable hash of the strategy. Do not add a diversity or distance metric. The first run does not have enough data to define one, and an arbitrary threshold would hide real results.

Keep leaders from earlier generations. A final round-robin tournament between current and retained leaders reports the complete matchup table. Run independent searches from different populations when time permits.

## Initial kingdoms

Cull, Copper, Silver, and Gold are available in every kingdom. Step, Strike, and Shot are not present in these initial kingdoms. Action piles contain ten cards unless an experiment says otherwise.

Kingdom 1 has eight market piles. The others have ten. This is intended, because kingdom 1 keeps the current duel market. Starting health is 20 unless the kingdom says otherwise.

1. **Current duel, 20 health:** Footwork, Muster, Feint, Drive, Flurry, Aim, Volley, Adapt. Explore revised melee against ranged play.
2. **Three-way open, 20 health:** Footwork, Stipend, Drive, Heavy Blow, Aim, Volley, Channel, Ley Step, Arc Bolt, Fireball. Explore melee, ranged, mage, and mixed decks. No outcome is assumed.
3. **Three-way engine, 30 health:** Footwork, Muster, Stipend, Reclaim, Adapt, Heavy Blow, Steady Shot, Channel, Prism, Fireball. Test whether longer games reward deck improvement and combinations.
4. **Range-rich mixed, 20 health:** Footwork, Adapt, Quick Shot, Steady Shot, Aim, Volley, Drive, Heavy Blow, Channel, Arc Bolt. Expect ranged cards to appear most often because the market gives that family the deepest support.
5. **Rigged melee, 20 health:** Use Three-way open, but Heavy Blow costs 3 and deals 6. Expect Heavy Blow in almost every leader and expect its strategies to dominate. This override is a calibration fixture, not a proposed card value.

Only Rigged melee is a hard balance-search calibration. Unexpected results in the other kingdoms are findings, not implementation failures. Range-rich mixed has a broad expectation, not a fixed win-rate requirement.

### Rigged melee calibration check

The check passes when either condition is true:

- the top strategy in the final round-robin buys at least one Heavy Blow;
- at least 80 percent of the final leaders buy at least one Heavy Blow.

This threshold is a sanity check on the search, not a measured balance target. If the check fails after the repair cap in `GOAL.md`, record it as a blocker with its numbers in `PROGRESS.md` and stop. Do not tune the threshold, the kingdom, or the strategies to make it pass, and do not keep retrying beyond the cap.

## Card-value experiments

Apply explicit card overrides in experiment configuration without changing canonical definitions. Use the same seeds and opponents for every value in a grid. Reports compare:

- pairwise win rates;
- card inclusion and copy counts among leaders;
- melee, ranged, mage, and mixed representation;
- turns to win and damage by card;
- dead draws caused by range, mana, or missing setup;
- first-player and arena-side advantage.

## Code layout

- Simulation and search code lives in `src/sim/`. It must not import from `src/client/` or `src/server/`.
- The command-line entry point is `npm run experiment -- --kingdom <id> --mode smoke|full`.
- Machine-readable output and the Markdown report go to `.experiments/<kingdom-id>/`.
- `.experiments/` is ignored by Git, except for the final Markdown reports, which are committed.

## Implementation order

1. Implement and verify the card batch in [09-card-list.md](./09-card-list.md).
2. Make kingdoms, starting health, and card overrides explicit inputs. `src/game/state.ts` and `src/game/invariants.ts` both hard-code 20 health today. The invariant must use the configured starting health as its upper limit.
3. Add the deterministic match runner and telemetry.
4. Add readable strategies, complete per-kingdom seeds, and action search.
5. Add the five kingdoms and calibration checks.
6. Add evolution, retained leaders, and tournaments.
7. Write machine-readable results and a concise Markdown report.
8. Profile complete experiments and first remove avoidable cloning and event recording.
9. Port only the simulation core if measured runtime blocks useful experiments. Keep TypeScript as the reference and compare both engines with identical seeded fixtures.

## Initial run limits

Use a small smoke run before the full search:

- smoke: 20 candidates, 3 leaders, 5 generations, 5 shared seeds;
- full: at most 100 candidates, 5 leaders, and 32 generations;
- 25 shared seeds with four balanced orientations per full pairing, for 100 games maximum;
- 30 turns per player before recording a draw;
- 1 to 16 deterministic pairing workers, with 10 by default;
- partial populations and results preserved at every limit.

The implementation may lower the full run size after measuring throughput, but it must record the actual limits used. It must not increase these limits during the unattended run.

The 8-hour budget in `GOAL.md` covers the complete goal, not only the search. Measure throughput after the smoke run, then size the full run so that it ends with at least 45 minutes left for final verification, reporting, and `PROGRESS.md`. Stop the search at that point even if generations remain.
