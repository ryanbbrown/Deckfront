# Strategy search evidence and next pilot

## Purpose

This document records what the strategy-discovery experiments established, what remains unreliable, and the smallest next test that addresses behavioral coverage without building a large new search system first.

## Current game and policy scope

The current deep-search experiments use:

- 10 variable kingdom cards, plus always-available Step and Focus and the three treasures;
- 50 starting health;
- a six-space board;
- draft off: 7 Copper and 3 Scrap;
- the shared tactical pilot for action play;
- an ordered purchase ladder with 10 stored slots and up to 8 active slots in deep search;
- the current card values, including the Melee and Mage damage increases.

Every conclusion applies to this policy class and tactical pilot. It does not establish optimal human play.

## Evidence timeline

### Old-card discovery checkpoint

The first purchase-ladder and racing work improved the original saved kingdom:

- response smoke test: 1.3 seconds;
- full PSRO: 14.3 seconds and 706,344 matches;
- independent staged sweep: 19.9 seconds and 1,657,008 matches;
- total: 34.2 seconds;
- observed challenger score fell from 78.75% to 55.75%.

This showed that the ladder representation and racing could improve one old-card case quickly. It did not test the new combo-card space.

### New-card PSRO exposed missing responses

On two new-card kingdoms, the slower staged search found strong responses against the PSRO mixtures:

- Current Duel: 66.7%;
- Three-Way Engine: 69.2%.

The staged searches used about 4.5 million matches and took 77 to 118 seconds per kingdom. This established that the fast PSRO populations were closed only inside their discovered matrices.

### Draft-off beam and human playtests

The draft-off beam produced strategies strong enough for useful playtests:

- the user beat the first Ranged Chain strategy, then lost the next two attempts;
- the user’s first Mobile Skirmish plan lost;
- the user lost the first Draw Chain deep playtest;
- Draw Chain deep beat Draw Chain shallow with 64.9% over 3,200 games;
- Draw Chain deep took 330 seconds; shallow took 91 seconds.

These results show that discovered strategies can be strong against humans. They do not show search closure.

Human play also exposed tactical-policy and representation limits:

- Regroup sifting was initially undervalued;
- the beam originally constructed only short purchase ladders;
- the reconstructed human Regroup/Peppering plan depended on tactical ordering;
- draft-off comparison scripts initially used the wrong starting rules;
- tactical fixes improved parity, discard decisions, and longer-ladder support.

### First broad metagame sample before the latest balance changes

The first partial 100-kingdom run completed 34 kingdoms before it was stopped. Its selected equilibrium shares were:

| Archetype | Selected share |
|---|---:|
| Ranged | 44.3% |
| Melee + Ranged | 25.3% |
| Melee | 19.2% |
| Mage | 10.6% |
| Melee + Mage | 0.7% |

Together with human play, this motivated stronger Melee and Mage damage.

### Ten-kingdom pilot after damage changes, before stratified beam

The same deterministic first 10 kingdoms produced:

| Archetype | Selected share |
|---|---:|
| Ranged | 42.8% |
| Melee | 39.1% |
| Melee + Ranged | 8.8% |
| Mage | 6.8% |
| Melee + Mage | 2.5% |

The run took about 42 minutes. Melee improved, mainly through Drive, not only Jab. Mage remained low.

A forced-Mage search then found omitted responses:

| Kingdom | Forced-Mage score against saved lottery |
|---|---:|
| 002 | 75.2% |
| 007 | 71.3% |
| 008 | 54.5% |

The same tactical pilot played these strategies. The omission was therefore in macro-strategy generation, not only action execution.

### Ten-kingdom stratified-beam pilot

The stratified beam reserved separate unrestricted, Mage, Melee, and Ranged lanes. The complete 10-kingdom run took 1 hour 21 minutes and produced:

| Archetype | Selected share |
|---|---:|
| Melee | 42.3% |
| Ranged | 40.1% |
| Melee + Ranged | 10.0% |
| Mage | 7.5% |

Mage appeared in more kingdoms but did not gain material metagame weight.

The strongest diagnostic was kingdom 001:

- its earlier matrix had 68.1% Mage;
- the stratified matrix moved to effectively 100% Melee;
- the surviving old Mage strategy scored only 20.4% against the stronger Melee lottery;
- a different forced Mage strategy then scored 88.8% against that lottery;
- a later fixed-target beam with stronger finalist selection found another Mage response scoring 98.6%.

This means two things happened together: the newer search found genuinely stronger Melee play, and the end-to-end process still stopped before adding an obvious Mage response.

Kingdom 008 showed the opposite case:

- a forced Mage response scored 54.5% against the older lottery;
- after stronger non-Mage responses entered, the same Mage plan scored about 5.1%;
- a fresh forced Mage search scored only 9.5%.

Mage was genuinely weak in that kingdom’s final discovered matrix.

### Equilibrium ranges

The selected/minimum/maximum archetype report showed that equilibrium selection is not causing the large run-to-run changes:

| Archetype | Selected | Minimum | Maximum |
|---|---:|---:|---:|
| Melee | 42.3245% | 42.3244% | 42.3245% |
| Ranged | 40.1501% | 40.1500% | 40.1502% |
| Melee + Ranged | 10.0000% | 10.0000% | 10.0000% |
| Mage | 7.5254% | 7.5253% | 7.5255% |

Inside each discovered matrix, the archetype distribution is effectively fixed. The instability comes from which strategies enter the matrix.

### One-step response-optimizer pilot

Beam, uniform random racing, CEM, and MCTS were tested against four already-bad frozen lotteries. After review fixes, all four found confirmed responses in all four kingdoms. Those results validate the shared grammar, budget accounting, finalist rerace, and held-out scoring harness.

They do **not** establish which optimizer produces a consistently closed final lottery. The targets were already known to be exploitable, so the scores saturated. Do not use this pilot to select the final generator.

The simple random arm is still useful evidence about scale:

- it sampled length uniformly from 0 to 7;
- it sampled every finite slot token and terminal floor uniformly;
- it generated 22,779 unique legal policies in the 60,000-block kingdom-001 run;
- it raced batches on 1, 2, 4, and 8 blocks before the common finalist rerace.

It was random in syntax space. It did not maximize semantic or behavioral distinctness.

## Current baseline

Use the current stratified deep-beam suite as the implementation baseline, not as a trusted optimum:

- same first 10 deterministic kingdoms;
- 50 health and draft off;
- up to 8 active slots;
- 10 workers;
- three double-oracle iterations;
- 1 hour 21 minutes recorded search time;
- selected metagame: 42.3% Melee, 40.1% Ranged, 10.0% Melee + Ranged, 7.5% Mage;
- known failure: an omitted kingdom-001 Mage response scored 88.8% against its final lottery.

A new method should beat this baseline on consistency, not only produce a different archetype chart.

## What the behavioral vector would replace

A behavioral vector is not a complete optimizer. It is a representation and selection rule.

It would replace:

- beam edit distance as the main notion of strategy similarity;
- card-family lane quotas as the main diversity mechanism;
- syntactic deduplication as the only population-coverage check.

It would not by itself replace Random, CEM, MCTS, or evolutionary generation. Those methods can propose complete policies. The vector decides which proposals cover new strategic behavior and which are redundant.

The smallest useful design is:

1. generate many complete policies with simple random sampling;
2. describe each policy with a low-cost semantic vector;
3. select a max-min diverse coreset in that vector space;
4. simulate and race the coreset;
5. retain both strong policies and strong representatives of distinct regions.

This uses scaling and simple combinatorics before a learned embedding, DPP-PSRO, or MAP-Elites system.

## A simple first strategy vector

Start with card roles already present in card definitions and telemetry. Do not begin with a learned model.

For each purchase ladder, aggregate planned early, middle, and fallback weight for:

- Melee, Ranged, and Mage damage;
- unconditional versus setup-dependent damage;
- mana production and mana spending;
- draw amount;
- cantrip count;
- sifting and discard;
- trashing;
- economy;
- movement;
- range control;
- finite engine goals versus infinite fallback;
- active plan length.

Normalize quantities so one high desired count does not dominate every distance. Keep order by using early, middle, and fallback buckets rather than one unordered total.

This vector is deliberately simple. It should make a Muster-to-Regroup substitution smaller than replacing a Ranged package with a Melee package, while still distinguishing draw from sifting.

## How to validate the vector quickly

### Step 1: no-search sanity check

On one full kingdom with all three damage families:

1. generate 10,000 to 20,000 legal random ladders;
2. calculate the simple vector without simulations;
3. select nearest, medium-distance, and farthest strategy pairs;
4. produce a compact review file with card names, ladder order, and distances;
5. have the user label whether each pair feels strategically same, related, or different.

This tests whether the representation matches domain judgment before it controls search.

### Step 2: held-out payoff check

Use a per-kingdom probe panel selected automatically from the existing strategy archive:

1. select a representative probe coreset from existing payoff rows;
2. simulate sampled strategies against those probes;
3. hide some opponents from the vector;
4. test whether vector-nearest strategies also have similar payoff rows against the hidden opponents.

The probe strategies do not need to be manually authored. The panel stays fixed for one evaluation epoch and refreshes between epochs.

### Step 3: simple search ablation

Compare under the same simulation budget and random seeds:

- plain random racing;
- semantic-diverse random racing;
- current stratified beam.

Run at least three independent seeds on one full kingdom, then the same first 10 kingdoms if the result is stable.

Measure:

- number of semantic regions proposed, evaluated, and represented by finalists;
- held-out response quality during each search round;
- overlap and distance between independent-run archives;
- cross-run challenge: strategies from run A against run B’s final lottery and vice versa;
- final lottery change after one fresh continuation budget;
- total matches and runtime.

The new method succeeds if independent runs cover similar behavioral regions and stop finding large cross-run exploits under the same or lower compute than the current baseline.

## Random-first recommendation

The next generator should be simpler than the current beam:

1. generate at least 20,000 complete random ladders;
2. enforce canonical syntactic uniqueness;
3. select a semantically diverse coreset before expensive simulation;
4. use common-seed successive racing;
5. mutate or cross only the best representatives inside each semantic region;
6. keep an archive across equilibrium updates.

This is not fully random after the initial proposal stage. Randomness supplies broad coverage. The semantic vector prevents the budget from being spent on thousands of functionally similar ladders.

## Stop-slot finding

The current stop semantics are easy to misread:

```text
stop threshold T = stop buying when remaining money is greater than or equal to T
```

The response grammar currently permits prefix stops at 2, 4, and 6, plus a terminal no-buy floor at 0.

A high-money stop can prevent a strategy from buying several cheap fallback cards after its preferred finite goals are complete. That can limit deck dilution. However, remaining money does not carry to the next turn, so money alone is a weak signal for whether another card is harmful.

For the simple random-first pilot:

- remove prefix stop slots;
- require an infinite fallback purchase;
- let finite desired counts limit engine components;
- end the Buy phase naturally when no wanted affordable card remains;
- run no-buy as a separate ablation, not a common terminal floor.

If stopping is still useful, replace the money threshold with a state condition that expresses the reason:

- maximum deck size;
- engine goals complete;
- only non-cantrip fallback cards remain;
- game is too late for a purchase to cycle;
- health or expected turns remaining.

Do not add those conditions until the stopless ablation shows a real loss.

## Decision before implementation

The quickest defensible next step is the vector sanity check plus the plain-random versus semantic-diverse-random ablation. It uses the current simulator, racing, and policy grammar. It does not require implementing full DPP-PSRO, PSD-PSRO, MAP-Elites, or a learned embedding.

A separate Claude Code Fable 5 thread is reviewing this direction and may recommend a different architecture. Incorporate that review before committing to a larger search rewrite.
