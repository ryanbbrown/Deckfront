# Why Deckfront uses 160 markets

Deckfront has 40 variable market cards. A game uses 10 of them, which gives 847,660,528 possible ten-card variable markets. Every game adds the same 6 fixed piles for a total of 16 market piles.

The current website does not choose from that full space. It chooses one of 160 fixed markets with saved AI strategies. This keeps game setup fast and gives the balance work a repeatable set of card combinations.

The 160 are a deterministic coverage suite, not a random sample. “Representative” means they give every card, important interaction, cost band, and broad strategy route repeated opportunities to matter. It does not mean results from the suite are a statistical estimate for all 847 million possible markets.

The website calls each set of 10 variable market piles a numbered battlefield. Public numbers come from stable internal catalog IDs: `balance-tuning-001` through `balance-tuning-128` are Battlefields 1 through 128, and `balance-validation-001` through `balance-validation-032` are Battlefields 129 through 160. The array position does not define the public number.

## Why 160

The suite has 128 tuning markets and 32 validation markets. Tuning markets can guide card changes. Validation markets are held back to check those changes.

Each variable card appears exactly:

- 40 times across the full suite;
- 32 times in tuning;
- 8 times in validation.

A smaller suite cannot meet those exposure requirements. One hundred sixty was the first tested size that passed every recorded coverage and distinctness threshold.

## Card and interaction coverage

The suite covers all 780 possible card pairs.

- Every pair appears at least 8 times.
- Every pair appears at least once in validation.
- Ninety-six priority pairs appear at least 12 times, including at least twice in validation.

The suite covers 9,140 of the 9,880 possible card triples, or 92.51%. Sixty selected triples represent interactions that need repeated attention, including Mana sequencing, movement and range, trashing, setup cards, family-specific discard costs, and mixed-family damage. Each selected triple appears at least 4 times, including at least once in validation.

The design also requires repeated markets for:

- Mana, Melee, and Ranged routes;
- mixed damage families;
- draw-heavy and deck-shaping strategies;
- movement and distance payoffs;
- low-, middle-, and high-cost cards;
- focused and mixed markets.

Nine authored markets remain in the suite as human-play anchors, continuity checks, and deliberately difficult controls.

## Distinct markets

No two markets are identical. No pair of markets shares more than 6 of its 10 variable cards.

Across all 12,720 pairs of markets:

- the mean overlap is 2.45 cards;
- 99% share no more than 5 cards;
- the maximum overlap is 6 cards.

This limits repeated near-copies while preserving the card and interaction quotas.

## What the suite can show

The suite gives strategy search repeated chances to use each card in different contexts. Results can expose:

- cards that are rarely bought or played;
- one strategy family crowding out the others;
- dominant card combinations;
- markets that depend too heavily on the fixed economy, movement, or Mana cards;
- changes that work on tuning markets but fail on held-back validation markets.

The suite does not prove that every card is balanced. Coverage only creates an opportunity for a card or interaction to matter. The AI search must still find and test the relevant strategies.

## Current website and future markets

For the initial public playtest, the website selects from these 160 markets and loads AI strategies computed in advance for the selected market. It does not train a new opponent when a game starts.

A future version can generate a new ten-card market and train its AI on demand. That requires training to become fast and consistent enough that repeated runs on the same market recover the same strategies, card choices, or behaviorally equivalent plans.

## Sources

- [`src/sim/balance-suite-manifest.json`](../src/sim/balance-suite-manifest.json) contains the selected markets and measured coverage.
- [`src/sim/balanceSuiteDesign.ts`](../src/sim/balanceSuiteDesign.ts) defines the frozen coverage thresholds and selection method.
- [`.plans/61-comprehensive-kingdom-balance-suite.md`](../.plans/61-comprehensive-kingdom-balance-suite.md) records the design and its limits.
- [`.plans/62-comprehensive-kingdom-balance-suite-results.md`](../.plans/62-comprehensive-kingdom-balance-suite-results.md) records the selected result and detailed measurements.
