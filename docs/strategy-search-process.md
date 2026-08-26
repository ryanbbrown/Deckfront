# Strategy search process

This document describes the proposed process for producing one representative strategy lottery for a kingdom. The process starts with every strategy allowed by the candidate grammar and ends with checks that the final lottery is competitive and repeatable.

## 1. Generate every candidate strategy

Generate all **12,972,960** legal strategies in a fixed order.

The same kingdom and candidate grammar must always produce the same candidates in the same order.

## 2. Reduce the candidates with goldfish scoring

Goldfish scoring tests a strategy against a fixed target rather than another strategy.

1. Score all 12,972,960 strategies with the first goldfish seed.
2. Keep the best **500,000** strategies.
3. Score those 500,000 strategies with three additional goldfish seeds.
4. Combine the results from all four seeds.
5. Keep the best **20,000** strategies as the competitive reservoir.

This stage gives PSRO a repeatable candidate reservoir at a practical size. PSRO is the competitive search described in the remaining sections.

## 3. Create the first lottery

1. Take the top **50** strategies from the 20,000-strategy reservoir.
2. Play every pair of strategies for **50 blocks**.
3. Each block contains four games. The four games balance player seat, first player, and arena side.
4. Each pair therefore plays **200 games**.
5. Calculate the strategy weights that make this group hardest to exploit.

The weighted group is the current lottery. A strategy with 20% weight is selected in 20% of games drawn from that lottery.

## 4. Screen every strategy outside the lottery

Test every reservoir strategy that is not already in the matrix against the current lottery. The first screen tests 19,950 strategies.

Create two independent test schedules, called schedule A and schedule B.

For each schedule:

1. Draw 25 opponent strategies from the current lottery according to the lottery weights.
2. Use the same 25 opponents and game seeds for every candidate.
3. Play one four-game block against each opponent.

Each candidate receives:

- **100 games** in schedule A;
- **100 games** in schedule B;
- **200 screening games** in total.

Using the same schedule for every candidate makes their scores directly comparable. Using two independent schedules shows whether a candidate performed well consistently or only in one sample.

## 5. Choose candidates for fresh confirmation

Calculate three scores for every screened candidate:

- its win rate in schedule A;
- its win rate in schedule B;
- its combined win rate across both schedules.

Build one confirmation group from the union of these selections:

1. **Schedule A leaders:** include every candidate at or above the 100th-best schedule A score.
2. **Schedule B leaders:** include every candidate at or above the 100th-best schedule B score.
3. **Combined leaders:** include every candidate at or above the 200th-best combined score.
4. **Near-boundary checks:** starting immediately below the combined cutoff, include complete equal-score groups until at least 64 more candidates are included.
5. **Reservoir checks:** include 16 candidates selected by a fixed hash from each of these goldfish-rank ranges:
   - 51 to 1,000;
   - 1,001 to 5,000;
   - 5,001 to 10,000;
   - 10,001 to 20,000.

If several candidates have the same score at a cutoff, include all of them. If a candidate appears in more than one selection, count it once.

The confirmation group has a safety limit of **512 candidates**. The run stops instead of arbitrarily removing candidates if the union exceeds that limit.

This selection keeps:

- candidates that performed very well in either independent schedule;
- candidates that performed well across both schedules;
- candidates just below the combined cutoff;
- candidates that check whether screening missed another part of the reservoir.

## 6. Confirm selected candidates with fresh games

Do not reuse screening games for admission decisions. Test the selected candidates with new opponents and game seeds.

Use these cumulative confirmation stages:

| Stage | Blocks per remaining candidate | Games per remaining candidate |
|---|---:|---:|
| 1 | 200 | 800 |
| 2 | 800 | 3,200 |
| 3 | 3,200 | 12,800 |
| 4 | 6,400 | 25,600 |

After each stage:

- **Admit** a candidate when the evidence shows that its expected score is above 50%.
- **Remove** a candidate when the evidence shows that its expected score is below 51%.
- Continue testing every candidate that has neither decision.

At most:

- 128 undecided candidates may continue after 200 blocks;
- 32 may continue after 800 blocks;
- 8 may continue after 3,200 blocks.

The run stops if a continuation limit is exceeded or if any candidate remains undecided after 6,400 blocks.

Admission tests correct for testing many candidates. The protocol assigns a 0.5% false-admission allowance to each of at most ten screens, for a 5% total false-admission allowance across one run.

The gap from 50% to 51% is an indifference zone. The process admits proven counters above 50%, but it does not spend unlimited games distinguishing a 50.1% strategy from a 50.9% strategy.

## 7. Add confirmed counters to the matrix

Make every admission decision for each strategy before combining equivalent strategies.

Two admitted strategies may share one matrix representative only when all of their saved confirmation evidence is identical, including:

- every block score;
- every acquired card;
- every reached purchase-plan position;
- starting cards;
- all other saved game telemetry.

The other strategies in an identical group become shadow strategies. Shadow strategies remain in later screens. If a shadow strategy later behaves differently from its representative, it separates from that representative.

Add each distinct admitted representative to the matrix, simulate its required pairings, and calculate a new lottery. Then return to section 4 and screen every strategy outside the new matrix again.

The first production attempt had a matrix safety limit of **128 strategies**. Its first screen found **173 distinct admitted representatives**, so the run stopped. The limit is now **256 strategies**. This is an engineering safety limit, not a statistical threshold.

## 8. Decide when competitive search is complete

A screen is clean when:

- it admits no new matrix representatives;
- it leaves no confirmation candidate undecided.

Matrix pairings begin at 50 blocks, or 200 games, per strategy pair.

1. After the first clean screen at 50 blocks, increase every matrix pair to **100 blocks** and screen the reservoir again.
2. Require two consecutive clean screens at the final matrix depth.
3. Increase every matrix pair to **200 blocks** if the result changes materially between matrix depths.

A change is material when any of these conditions is true:

- a selected archetype share changes by more than 2 percentage points;
- an archetype's feasible weight-range endpoint changes by more than 2 percentage points;
- a strategy with at least 0.5% selected or possible weight changes archetype label;
- the strongest known pure counter changes by more than 0.5 percentage points.

The run stops unresolved after ten screens. A successful stop is called **protocol closure**. It means the search passed these tests; it is not mathematical proof that no excluded strategy can win.

## 9. Measure acquisitions and archetypes

After protocol closure, select every strategy that has either:

- more than negligible weight in the chosen lottery;
- at least 0.5% possible weight in another valid equilibrium.

The reporting group has a safety limit of 32 strategies.

Run three independent panels. In each panel, every reporting strategy plays 1,000 blocks against the lottery. Every panel includes self-play and at least 25 blocks against each reporting opponent.

Add exactly two more panels if the first three are unstable.

The panels pass when:

- every selected archetype share spans no more than 2 percentage points;
- every material card's share of action-card acquisitions spans no more than 2 percentage points;
- every material card's expected copies span no more than 0.02 copies per player-game;
- no strategy changes archetype label.

A card is material when it is at least 1% of action-card acquisitions or at least 0.02 expected copies per player-game.

All card and archetype reports use cards actually acquired during games. A card listed in a purchase plan but never acquired does not count.

## 10. Attack the final lottery with old reservoirs

Attack the unchanged final lottery with each of the five old Kingdom 009 reservoirs. Each old reservoir contains 20,000 strategies.

Use the existing historical attack process:

1. two independent staged screening passes;
2. a fresh 400-block confirmation for the finalists;
3. a confirmed attack only when the strict 95% lower confidence bound is above 50%.

These attacks are audit evidence. They do not add strategies to the new matrix or change the final lottery. The report records the exact strategy, its old reservoir rank, its score, and the cards it acquired.

## 11. Check whether the process is repeatable

Run the complete competitive process twice with independent game seeds but the same 20,000-strategy reservoir.

If both runs finish, play their final lotteries against each other for 10,000 blocks.

The two runs agree only when:

- direct cross-play is between 49% and 51%;
- the 95% confidence interval contains 50%;
- each selected archetype share differs by no more than 2 percentage points;
- each feasible archetype range endpoint differs by no more than 2 percentage points;
- each material card differs by no more than 2 percentage points in acquisition share and 0.02 expected copies per player-game;
- the total-variation distance between complete action-card acquisition distributions is no more than 0.05.

If every check passes, the first run is the preselected representative lottery. If a check fails, the process reports that the two runs are inconsistent and does not select a representative.
