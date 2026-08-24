# Strategy search results

## What we ran

- A 34-kingdom partial suite before the latest balance changes. Ranged strategies held 44.3% pure share plus 25.3% mixed Melee/Ranged share, so we increased Melee and Mage damage.
- The same deterministic 10 full kingdoms twice after those changes: once with the ordinary deep beam and once with family-stratified beam. Games used 50 health, draft off, and purchase ladders with up to 8 active slots.
- Focused forced-Mage searches in kingdoms 001, 002, 007, and 008 to check for strategies omitted by the main search.
- Several human playtests. The trained strategies usually beat the user’s first plan, including Mobile Skirmish and Draw Chain. The user beat some earlier strategies and exposed tactical issues that were then fixed.

## Main results

- Ordinary deep beam took about 42 minutes for 10 kingdoms. Its selected metagame was 42.8% Ranged, 39.1% Melee, 8.8% Melee/Ranged, 6.8% Mage, and 2.5% Melee/Mage.
- Stratified deep beam took 1 hour 21 minutes for the same 10 kingdoms. Its selected metagame was 42.3% Melee, 40.1% Ranged, 10.0% Melee/Ranged, and 7.5% Mage.
- Equilibrium post-processing was stable inside each discovered matrix. For example, Mage’s selected share was 7.5254%, with a feasible equilibrium range of 7.5253% to 7.5255%.
- Strategy generation was not stable. Forced Mage scored 75.2% in kingdom 002 and 71.3% in kingdom 007 against lotteries that had omitted those responses.
- Kingdom 001 changed from 68.1% Mage in one run to effectively 100% Melee in another. A different Mage strategy then scored 88.8% against the Melee lottery. This was a search-population failure, not equilibrium-selection ambiguity.
- Kingdom 008 was a useful counterexample: a Mage response scored 54.5% against an older lottery, but only about 5% after stronger non-Mage strategies entered. Not every omitted-looking archetype remained strong.

## Current conclusion

The search produces strategies that are strong enough for useful human opponents, but it does not consistently close the strategy population. Different runs discover materially different strategic regions, and another short search can still find decisive counters. Beam search and its early pruning are the leading suspected cause. The next approved baseline is scaled random proposal generation with racing; no behavioral-vector system has been approved.
