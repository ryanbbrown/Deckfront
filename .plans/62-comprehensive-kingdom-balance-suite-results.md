# Comprehensive kingdom balance suite results

## Result

`balance-suite-v4` selects 160 kingdoms: 128 tuning and 32 validation. It is the smallest integer count that can meet the recorded thresholds. Counts below 160 cannot give every variable card 32 tuning and 8 validation appearances.

The manifest digest is `312e47bc0f756bc9b3932a37cbf7e9d4ef8378f170f8f445f02330ff398d90d6`.

This suite is an opportunity design. It gives a later strategy search repeated chances to use cards and interactions. It does not prove that any card is balanced. It does not prove that search closes the game or finds every competitive strategy.

## Why the old suite had 100 kingdoms

The reason is recorded in BB thread `thr_ghnwzhzcbh`:

- Event 64604 proposed 100 because runs took about ten minutes and asked for low-overlap sets.
- Event 64751 corrected the eligible pool to 19 cards and recommended a deterministic 100 rows. It expected about 53 appearances per card and 26 appearances per pair, with 80 tuning and 20 validation rows.
- Event 64756 accepted the recommendation.
- Plan 20 then fixed 100. It did not compare other counts. It did not include a power calculation, coverage stopping rule, or campaign budget calculation.

The original committed v1 suite had 19 variable cards:

- `19 choose 10 = 92,378` legal card sets;
- 52–53 appearances per card;
- 24–31 appearances per pair;
- 7–17 appearances per triple;
- all 171 pairs covered;
- all 969 triples covered;
- maximum overlap 8.

One hundred was a practical round number and a dense design for 19 cards. It was not evidence that 100 stays sufficient after the pool grows.

## Current market space

The current data has 46 cards: 3 Treasures and 43 Actions. Step and Focus are fixed in every market. Scrap is not a market pile. The variable pool therefore has 40 cards.

- Actual space: `40 choose 10 = 847,660,528`.
- Approximate 45-card space: `45 choose 10 = 3,190,187,286`.

For a random 10-card subset of 40:

- named card probability: `10/40 = 1/4`;
- named pair probability: `10×9/(40×39) = 3/52`;
- named triple probability: `10×9×8/(40×39×38) = 3/247`.

For the 45-card comparison, the same probabilities are `2/9`, `1/22`, and `4/473`.

For `m` independent random rows:

- expected appearances: `m×p`;
- expected uncovered items: `N×(1-p)^m`;
- union-bound failure for fewer than `r` appearances: `N×Σ(i=0…r-1) choose(m,i)p^i(1-p)^(m-i)`.

The formulas sample rows with replacement. The union bound is conservative. It does not assume that different card or interaction events are independent.

## Random expectations

| Rows | Card mean | Pair mean | Triple mean | Expected uncovered pairs | Expected uncovered triples |
|---:|---:|---:|---:|---:|---:|
| 50 | 12.500 | 2.885 | 0.607 | 39.970 | 5,362.911 |
| 100 | 25.000 | 5.769 | 1.215 | 2.048 | 2,911.014 |
| 150 | 37.500 | 8.654 | 1.822 | 0.105 | 1,580.112 |
| 152 | 38.000 | 8.769 | 1.846 | 0.093 | 1,541.962 |
| 156 | 39.000 | 9.000 | 1.895 | 0.073 | 1,468.403 |
| 160 | 40.000 | 9.231 | 1.943 | 0.058 | 1,398.352 |
| 200 | 50.000 | 11.538 | 2.429 | 0.005 | 857.692 |

Conservative 95% random-sampling bounds are:

- every card once: 24 rows;
- every pair once: 163;
- every triple once: 998;
- every card at least 40 times: 236;
- every pair at least 8 times: 401;
- all 96 priority pairs at least 12 times: 455;
- all 60 required triples at least 4 times: 1,090.

Random sampling wastes exposure through frequency variation. The deterministic design uses exact quotas and targeted interaction coverage.

## Deterministic lower bounds

- Pair coverage once needs at least 20 rows by the Schönheim bound.
- Triple coverage once needs at least 88 rows by the Schönheim bound.
- Eight appearances for all pairs needs at least 139 rows by incidence counting.
- Nine appearances for all pairs needs at least 156 rows by incidence counting.
- The chosen 32 tuning plus 8 validation card exposure needs at least 160 rows.

The 160-row lower bound comes from the measurement-resolution requirement, not complete pair or triple enumeration. Forty appearances give about 7.9 percentage points of worst-case binomial standard error. This is a resolution description, not a confidence interval over all kingdoms.

## Candidate curve

| Rows | Card min | Pair min | Validation pair min | Priority full/validation | Required triple full/validation | Covered triples | Triple share | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 50 | 12 | 0 | 0 | 2/0 | 0/0 | 4,726 | 47.83% | Fail |
| 100 | 25 | 2 | 0 | 5/0 | 1/0 | 7,419 | 75.09% | Fail |
| 150 | 37 | 5 | 0 | 9/1 | 2/0 | 8,830 | 89.37% | Fail |
| 152 | 38 | 5 | 0 | 9/1 | 2/0 | 8,840 | 89.47% | Fail |
| 156 | 39 | 5 | 0 | 9/1 | 2/0 | 8,906 | 90.14% | Fail |
| **160** | **40** | **8** | **1** | **12/2** | **4/1** | **9,115** | **92.26%** | **Pass** |
| 200 | 50 | 8 | 1 | 12/2 | 4/1 | 9,478 | 95.93% | Pass |

The 200-row extension adds 363 covered triples, a gain of 3.67 percentage points, for 40 more kingdoms. It does not change the first passing count. The marginal gain does not justify a 25% larger campaign under the recorded thresholds.

The selected design is a versioned fixed-seed covering result. Its checked-in source records split-isolated quota-preserving swap search seeds, attempt bounds, tie-breaking, and a stable source digest. Manifest generation replays that result, measures every threshold, and rejects stale card data or provenance. The 200-row comparison extends the selected design with fixed-seed balanced rows.

## Selected coverage

Every variable card appears exactly:

- 40 times in the full suite;
- 32 times in tuning;
- 8 times in validation.

Across all 780 pairs:

- minimum 8;
- maximum 14;
- standard deviation 1.5277;
- all pairs appear in validation;
- every priority pair appears at least 12 times in full and twice in validation.

Across all 9,880 triples:

- 9,115 covered;
- 765 uncovered;
- 92.257% covered;
- every required triple appears at least 4 times in full and once in validation.

The 60 required triples are representative. They cover Mana sequencing, Feint, Bull Rush, Flurry, Aim, Salvage Shot, distance and movement, trash and payoff, Reforge, and Improvise. They are not every plausible interaction.

## Process-smoke subset

`balance-smoke-v1` is a single-set process check, not a tuning and validation corpus. It compares 25 through 30 rows from the 128 tuning kingdoms. Every candidate covers all 96 priority pairs, all 60 required triples, and all 14 route labels at least once.

| Rows | Card range | Broad pairs | Pair share | Broad triples | Triple share |
|---:|---:|---:|---:|---:|---:|
| 25 | 4–10 | 654 / 780 | 83.85% | 2,743 / 9,880 | 27.76% |
| 26 | 5–11 | 673 / 780 | 86.28% | 2,841 / 9,880 | 28.76% |
| 27 | 6–10 | 676 / 780 | 86.67% | 2,942 / 9,880 | 29.78% |
| 28 | 6–11 | 693 / 780 | 88.85% | 3,037 / 9,880 | 30.74% |
| 29 | 6–9 | 711 / 780 | 91.15% | 3,142 / 9,880 | 31.80% |
| **30** | **6–10** | **719 / 780** | **92.18%** | **3,245 / 9,880** | **32.84%** |

The selected 30 uses only tuning kingdoms. A three-validation-row alternative covers 731 pairs and 3,255 triples, gains of 12 and 10. That is not enough to consume held-back rows. A tuning-only card-balanced alternative raises the card minimum from 6 to 7 but covers 22 fewer pairs and 23 fewer triples. The smoke objective prefers interaction breadth after every card and named interaction is present.

This is the best fixed design found by binary feasibility search and deterministic one-row exchange ascent under that objective. It is not a proof of the global subset optimum. Regenerate its measured manifest with `npm run balance:smoke:manifest`; the committed source is `src/sim/balance-smoke-suite-manifest.json`.

## Families, mechanics, costs, and routes

The versioned taxonomy includes:

- Mana, Melee, Ranged, and Engine families;
- low, middle, and high costs;
- direct damage and setup;
- draw;
- variable movement;
- economy and gain;
- Mana source and payoff;
- trash, discard, and recovery;
- copy scaling;
- distance payoff;
- family-discard payoff;
- multi-family payoff.

All route quotas pass, including focused Mana, Melee, and Ranged rows. Every route group has validation exposure. The manifest records the exact predicates, row labels, totals, and validation totals.

## Distinctness

For two random rows, `P(J=j)=choose(10,j)choose(30,10-j)/choose(40,10)` and expected overlap is 2.5.

The selected deterministic suite has:

- 12,720 row pairs;
- mean overlap 2.4528;
- median 2;
- P90 4;
- P95 4;
- P99 5;
- maximum 6;
- mean Jaccard 0.1445;
- maximum Jaccard `6/14 = 0.4286`;
- no duplicate card sets.

Overlap histogram:

| Shared cards | Row pairs |
|---:|---:|
| 0 | 360 |
| 1 | 2,131 |
| 2 | 4,222 |
| 3 | 3,845 |
| 4 | 1,764 |
| 5 | 354 |
| 6 | 44 |

The nine authored rows obey the same limit. Current Duel and Three-Way Engine share six cards, which is the authored maximum.

## Anchors and controls

The suite includes all five browser kingdoms as human-play controls. It includes the frozen `deep-beam-tuning-009` card set as a strategy-search continuity anchor.

Three adversarial controls have explicit purposes:

- thin Mana: all Mana payoffs and no variable Mana source, to measure dependence on Focus;
- fixed movement: positional attacks and no variable movement card, to measure dependence on Step;
- high-cost choke: eight high-cost cards and no Stipend or Reforge, to measure slow economy and search failure.

Authored rows count in every quota and distinctness measure. They are not exemptions.

## Residual blind spots

The 765 uncovered triples include these larger family patterns:

- Engine + Mana + Melee: 123;
- Engine + Mana + Ranged: 106;
- Engine + Melee + Ranged: 76;
- Mana + Melee + Ranged: 74;
- Engine + Engine + Mana: 75.

The full pattern table is in the manifest. The suite does not guarantee complete four-card or higher-order coverage. It does not systematically measure every cost ordering, supply race, opponent response, or search failure. Deterministic row selection can also create design-specific effects.

Combinatorial coverage is only opportunity. Later artifacts must still measure offered cards, starting builds, plans, acquisitions, matchups, equilibrium support, draws, and search consistency.

## Conditional campaign estimate

At 160 kingdoms, one pool per kingdom gives these totals:

- native 500,000-policy local time at 30.005 seconds each: 4,800.8 seconds, or 1.33 hours;
- Modal product time at 84.479 seconds each: 13,516.6 seconds, or 3.75 sequential hours;
- fixed-reservoir PSRO at 42.6–90.9 seconds each: 1.89–4.04 hours, mean 3.06 hours;
- measured Modal product cost at $0.010355–$0.018497 each: $1.66–$2.96;
- worst reservation at $0.281925 each: $45.11;
- full ordered-space measured cost at $0.37159 each: $59.45.

A provisional three-pool multiplier gives:

- 4.00 local hours;
- 11.26 sequential Modal product hours;
- 5.68–12.12 fixed-reservoir hours;
- $4.97–$8.88 measured product cost;
- $135.32 worst reservation;
- $178.36 if the ordered-space cost were repeated three times.

These values are conditional estimates. The Kingdom 009 consistency goal still owns the production competitive protocol, pool multiplier, attack work, runtime model, and artifact contract. No campaign ran. No estimate authorizes spending.

## Reproduction

```sh
npm run balance:suite:manifest -- --check
npm run balance:suite:validate
npm run balance:suite:design-report -- --check
```

- Active manifest: `src/sim/balance-suite-manifest.json`.
- Covering-design source: `src/sim/balance-suite-covering-design-v1.json`.
- Frozen strategy-search source: `src/sim/deep-beam-balance-suite-v3.json`.
- Design report: `.html/kingdom-suite-design.html`.

The full v4 campaign guard is `pending-k009-consistency`. Full-mode launch paths fail before adapter calls or artifact writes. Smoke simulation and pairing-worker use remain available for later protocol integration.
