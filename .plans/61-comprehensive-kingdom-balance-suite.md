# Comprehensive kingdom balance suite

## Goal

Create the smallest deterministic kingdom suite that gives useful balance evidence for the full current card pool. Replace the inherited 100-row assumption with measured coverage thresholds and a count selected from generated candidates.

This work creates the suite and proves its design. It does not change card values. It does not run the final strategy-search campaign. The Kingdom 009 work still owns the production competitive-search protocol.

## Current facts

- `src/game-data/cards.json` has 46 cards: 3 Treasure cards and 43 Action cards.
- A random market chooses 10 cards from the 40 IDs in `VARIABLE_ACTION_IDS`.
- Step and Focus are in every market. Scrap is a draft-off starting card and is never a market pile.
- The exact variable-market space is `40 choose 10 = 847,660,528`, not `45 choose 10`.
- Every suite row also has Copper, Silver, Gold, Step, and Focus through the game rules. A later draft-off campaign also has Scrap through its protocol.
- The current `balance-suite-v3` manifest has 100 rows. Every variable card appears 25 times. Pair counts are 3 through 9. It covers all 780 pairs and 7,843 of 9,880 triples. Its largest row overlap is 6 cards.
- `deep-beam-tuning-009` and the other strategy-search kingdoms currently come from the same manifest. Their definitions must stay frozen while the separate search-protocol work continues.

## What the old 100 meant

The result record must distinguish recorded history from later inference.

Recorded history:

- In BB thread `thr_ghnwzhzcbh`, event 64604, the user proposed 100 because the search was fast enough and asked for a set with low overlap.
- At event 64751, the assistant counted 19 variable cards and recommended 100 deterministic rows. The stated expectation was about 53 appearances per card and 26 appearances per pair, with an 80/20 tuning and validation split.
- The user accepted that proposal at event 64756.
- Plan 20 committed the fixed count. It did not compare suite sizes or give a statistical stopping rule.

The original committed v1 suite had 19 variable cards:

- `19 choose 10 = 92,378` possible rows;
- 52 or 53 appearances per card;
- 24 through 31 appearances per pair across the full suite;
- 7 through 17 appearances per triple;
- every one of the 171 pairs and 969 triples covered;
- largest overlap 8.

The old count was practical and dense for 19 cards. It was not a general result that 100 remains enough after the pool grows to 40 variable cards.

## Meaning of full understanding

The suite is an opportunity design. It shows whether search has repeated chances to use cards and interactions in varied markets. It does not prove that search found the best strategy, that a card is balanced, or that the deterministic rows represent a random population of all possible kingdoms.

The later campaign can support these questions:

- Does each card enter viable starting builds, finite plans, repeat plans, and actual acquisitions?
- Does card use change when a named partner, enabler, payoff, or competing route is present?
- Do important three-card interactions produce viable strategies?
- Do Mana, Melee, Ranged, engine, economy, draw, movement, trash, discard, and high-cost routes appear in both focused and mixed markets?
- Do anchors stay stable across search-protocol changes?
- Do deliberately difficult markets expose search or game-rule failures?

The suite does not support fine causal estimates. Forty card appearances give a worst-case binomial standard error of about 7.9 percentage points. The rows are deterministic, so this number describes measurement resolution only. It is not a confidence interval for all 847,660,528 kingdoms.

## Random baseline

For one random 10-card subset of the actual 40-card variable pool:

- named card probability: `10 / 40 = 1/4`;
- named pair probability: `10 × 9 / (40 × 39) = 3/52`;
- named triple probability: `10 × 9 × 8 / (40 × 39 × 38) = 3/247`.

The “about 45 cards” approximation is not the production market. For comparison, `45 choose 10 = 3,190,187,286`, with named-card probability `2/9`, pair probability `1/22`, and triple probability `4/473`. The result must show both models and then use the actual 40-card model for selection.

For `m` independent random rows sampled with replacement:

- expected appearances are `m × p`;
- expected uncovered items are `N × (1 - p)^m`;
- for at least `r` appearances per item, the union-bound failure probability is `N × Σ(i=0…r-1) choose(m,i) p^i (1-p)^(m-i)`.

The analysis must report exact expectations, expected uncovered counts, and this conservative success bound for 50, 100, 150, 152, 156, 160, and 200 rows. It must report these smallest row counts where the union-bound success probability is at least 95%:

- every card at least once: 24;
- every pair at least once: 163;
- every triple at least once: 998;
- every card at least 40 times: 236;
- every pair at least 8 times: 401;
- all 96 frozen priority pairs at least 12 times: 455;
- all 60 frozen required triples at least 4 times: 1,090.

The bounds assume independent rows sampled with replacement. Item events can depend on each other; the union bound does not assume that they are independent. Sampling distinct rows from the 847-million-row space changes these values negligibly at the candidate sizes.

For two random rows, report the exact overlap law `P(J=j) = choose(10,j) choose(30,10-j) / choose(40,10)` and `E[J] = 2.5`. Compare its overlap and Jaccard distribution with each deterministic candidate.

The deterministic covering lower bounds are different:

- one-time pair coverage: at least 20 rows by the Schönheim bound;
- one-time triple coverage: at least 88 rows by the Schönheim bound;
- eight appearances for every pair: at least 139 rows by incidence counting;
- nine appearances for every pair: at least 156 rows by incidence counting;
- 32 tuning and 8 validation appearances for every card: at least 160 rows.

Complete triple coverage is not a selection threshold. One exposure for every triple would spend rows on many interactions with no stated game meaning. The generator must cover the 60 frozen important triples repeatedly and report the unprioritized residual blind spots.

## Count selection rule

Generate and measure these required comparison candidates:

| Total | Tuning | Validation | Reason to include |
|---:|---:|---:|---|
| 50 | 40 | 10 | Lowest requested candidate and cheap campaign bound |
| 100 | 80 | 20 | Inherited count |
| 150 | 120 | 30 | Requested larger candidate |
| 152 | 120 | 32 | Measurement point with 30 tuning and 8 validation appearances per card |
| 156 | 124 | 32 | Nine-pair-incidence design point |
| 160 | 128 | 32 | Exact 32/8/40 card exposure with an 80/20 split |
| 200 | 160 | 40 | Requested upper comparison |

The 40-card exposure floor makes every count below 160 fail before optimization. The lower candidates remain in the report because they show the cost and coverage curve; they are not plausible passing candidates under this measurement-resolution choice.

Test 160 first. If it fails, test every integer count from 161 through 200 in order. For those counts, set validation size to `floor(total / 5)` and tuning size to the remainder. Select the first passing count. This is the smallest integer suite under the frozen thresholds, not only the smallest member of a sparse list. Still generate the 200-row comparison even if an earlier count passes.

Run a raw 160-row and 200-row coverage pilot before implementing the constrained optimizer. Record the pilot without changing the thresholds. If no count through 200 passes, generation must fail with diagnostics and produce no selected manifest; it must not silently weaken a threshold. Resolve that case by revising and reviewing this plan, not by choosing 200 automatically.

### Raw feasibility pilot

Before plan commit, the current v3 greedy-and-swap generator ran each required total as one split with seed `0x51a7c3d9`. It did not include authored rows, route quotas, priority interactions, the overlap-6 rule, or the new objective. It gives only a raw coverage check:

| Rows | Card range | Pair range | Covered triples | Triple share | Maximum overlap |
|---:|---:|---:|---:|---:|---:|
| 50 | 12–13 | 1–5 | 5,235 | 52.986% | 5 |
| 100 | 25 | 4–8 | 7,944 | 80.405% | 6 |
| 150 | 37–38 | 7–11 | 9,103 | 92.136% | 7 |
| 152 | 38 | 7–11 | 9,103 | 92.136% | 7 |
| 156 | 39 | 7–11 | 9,146 | 92.571% | 7 |
| 160 | 40 | 7–12 | 9,192 | 93.036% | 7 |
| 200 | 50 | 10–14 | 9,562 | 96.781% | 7 |

The pilot shows triple-coverage headroom at 160 and 200. It also shows that the old optimizer does not meet the new pair-minimum or overlap limit at 160. The constrained design, not this pilot, decides the count.

### Exposure thresholds

- Every variable card appears at least 40 times in the full suite.
- Every variable card appears at least 32 times in tuning and 8 times in validation.
- Card-frequency ranges are at most one in each split and in the full suite.
- Every one of the 780 pairs appears at least 8 times in the full suite.
- Every pair appears at least once in validation.
- Every priority pair appears at least 12 times in the full suite and at least twice in validation.
- Every one of the 60 required triples appears at least 4 times in the full suite and at least once in validation.
- At least 9,090 of all 9,880 triples, or 92%, appear at least once. Report every uncovered triple count by family pattern. Do not describe this as complete interaction coverage.

Forty card contexts give about 7.9 percentage points of worst-case binomial measurement resolution, with 32 contexts available for tuning and 8 untouched contexts for validation. Eight contexts per ordinary pair is a coarse conditional screen; 12 contexts for named pairs gives more room to separate partner effects. One or two validation contexts detect gross failures but do not estimate an interaction effect. The 92% broad triple floor limits unobserved context while the 60 named triples receive repeated exposure. These are practical measurement thresholds, not statistical confidence claims.

### Distinctness thresholds

- No duplicate card set.
- No two rows share more than 6 cards.
- Maximum Jaccard similarity is `6 / 14`, about 0.429.
- The 99th percentile overlap is at most 5 cards.
- Record overlap and Jaccard histograms, mean, median, 90th, 95th, 99th, and maximum.

### Kingdom validity

Every row must pass both the production registry and stricter suite validation:

- 40 starting health;
- exactly 10 distinct variable Action piles;
- exactly 10 cards per pile;
- no overrides;
- no fixed-market card in a variable pile.

`src/game/kingdom.ts` does not enforce the suite's exact pile count or exact pile size. The suite validator must enforce those rules itself and then register every row through the production code.

Copper, Silver, Gold, Step, Focus, and Scrap are available in every row. Every generated and authored row must also have:

- at least two cards in `directDamage`;
- at least one card in `drawSupport`, `economyOrGain`, `trash`, or `recovery`;
- at least one card costing 3 or less;
- at least one card costing 4 or more.

The adversarial rows are not exempt. Their missing variable route is narrower than these ordinary validity rules.

### Frozen taxonomy

Taxonomy version `kingdom-taxonomy-v1` uses these exact predicates and card lists. Expansion happens before candidate generation. Candidate results cannot change them.

- Family is the canonical `family` field: Mana, Melee, Ranged, or Engine.
- Cost bands are low `cost <= 3`, middle `cost = 4`, and high `cost >= 5`.
- `manaSource`: Channel, Ley Step, Attune, Prism.
- `manaPayoff`: Arc Bolt, Fireball, Starfire, Discharge, Cascade, Overload.
- `directDamage`: Arc Bolt, Fireball, Starfire, Discharge, Cascade, Overload, Jab, Strike, Drive, Heavy Blow, Opening Strike, Rally, Bull Rush, Flurry, Peppering Shot, Steady Shot, Repelling Shot, Longshot, Volley, Salvage Shot, Precision Shot, Discipline, Improvise.
- `damageSetup`: Feint, Aim.
- `drawSupport`: Channel, Attune, Prism, Feint, Jab, Aim, Peppering Shot, Salvage Shot, Footwork, Stipend, Reclaim, Regroup, Adapt, Muster, Regiment, Sharpen, Scour.
- `variableMovement`: Ley Step, Drive, Repelling Shot, Footwork.
- `economyOrGain`: Stipend, Reforge.
- `setup`: Feint, Aim, Footwork, Ley Step, Reclaim, Regroup, Adapt.
- `trash`: Discipline, Cull, Sharpen, Reforge, Scour.
- `discard`: Prism, Bull Rush, Salvage Shot, Regroup.
- `recovery`: Reclaim.
- `copyScaling`: Attune, Rally, Precision Shot.
- `distancePayoff`: Ley Step, Repelling Shot, Longshot, Volley.
- `familyDiscardPayoff`: Bull Rush, Salvage Shot.
- `multiFamilyPayoff`: Improvise.

The generator must validate every name and ID against current canonical card data. Every variable card must have exactly one family and one cost band. Every role-list member must be an eligible variable card. Store names for reading and IDs for identity in the manifest.

### Exact route and archetype predicates

A row gets a label only when it meets the exact predicate:

- `mana-route`: at least one `manaSource` and one `manaPayoff`.
- `melee-route`: at least two direct-damage Melee cards and at least one card in `variableMovement` or Feint.
- `ranged-route`: at least two direct-damage Ranged cards and at least one card in `variableMovement` or Aim.
- `draw-rich`: at least three `drawSupport` cards.
- `deck-shaping`: at least three cards in the union of `trash`, `recovery`, and `economyOrGain`.
- `high-cost-economy`: at least three high-cost cards and either Stipend or Reforge.
- `mana-melee`, `mana-ranged`, or `melee-ranged`: at least two `directDamage` cards in each named family. The third family may also be present.
- `all-damage-families`: at least one `directDamage` card in each of Mana, Melee, and Ranged.
- `improvise-mix`: Improvise plus `directDamage` cards from at least two of Mana, Melee, and Ranged.
- `mana-focused`: at least five Mana cards, including at least two `manaSource` and two `manaPayoff` cards.
- `melee-focused`: at least five Melee cards, including at least four `directDamage` cards.
- `ranged-focused`: at least five Ranged cards, including at least four `directDamage` cards.

The selected suite must contain, with at least one validation row in every group:

- 16 `mana-route` rows;
- 16 `melee-route` rows;
- 16 `ranged-route` rows;
- 16 `draw-rich` rows;
- 12 `deck-shaping` rows;
- 12 `high-cost-economy` rows;
- 8 rows for each named two-family damage label;
- 16 `all-damage-families` rows;
- 8 `improvise-mix` rows;
- 4 rows for each focused-family label.

Labels and quotas can overlap. The manifest records every row label and every achieved total and validation count.

## Frozen priority interactions

Interaction version `kingdom-interactions-v1` expands before any candidate is measured. Canonical pair and triple IDs sort their card IDs with the code-unit comparator.

### Priority pairs

Take the union of these exact products and lists:

1. `manaSource × manaPayoff`: 24 pairs.
2. Cascade with Arc Bolt, Fireball, Starfire, and Overload: 4 pairs.
3. Feint with Jab, Strike, Drive, Heavy Blow, Opening Strike, Rally, Bull Rush, and Flurry: 8 pairs.
4. Bull Rush with Jab, Strike, Drive, Heavy Blow, Opening Strike, Rally, and Flurry: 7 pairs.
5. Flurry with Jab, Regroup, Muster, and Footwork: 4 pairs.
6. Aim with Peppering Shot, Steady Shot, Repelling Shot, Longshot, Volley, Salvage Shot, and Precision Shot: 7 pairs.
7. Salvage Shot with Peppering Shot, Steady Shot, Repelling Shot, Longshot, Volley, and Precision Shot: 6 pairs.
8. each of Repelling Shot, Longshot, and Volley with each of Ley Step, Drive, and Footwork: 9 pairs.
9. each of Discipline, Cull, Sharpen, and Scour with Reclaim and Regroup: 8 pairs.
10. Reforge with Discipline, Cull, Jab, Peppering Shot, Footwork, Stipend, Starfire, Heavy Blow, Volley, and Regiment: 10 pairs.
11. Improvise with Fireball, Cascade, Overload, Heavy Blow, Bull Rush, Flurry, Volley, Salvage Shot, and Precision Shot: 9 pairs.

The union has exactly 96 pairs. No card has more than 10 priority partners; Reforge has 10.

### Required triples

Use these exact 60 triples, six in each stated measurement class:

| Class | Required triples |
|---|---|
| Mana sequencing | `channel+arcBolt+cascade`; `channel+fireball+overload`; `leyStep+fireball+cascade`; `leyStep+starfire+overload`; `attune+arcBolt+overload`; `prism+starfire+cascade` |
| Feint attack mix | `feint+jab+flurry`; `feint+strike+heavyBlow`; `feint+drive+openingStrike`; `feint+rally+bullRush`; `feint+bullRush+flurry`; `feint+heavyBlow+openingStrike` |
| Bull Rush fodder and support | `bullRush+jab+regroup`; `bullRush+strike+reclaim`; `bullRush+drive+footwork`; `bullRush+heavyBlow+muster`; `bullRush+rally+sharpen`; `bullRush+openingStrike+scour` |
| Flurry support | `flurry+jab+regroup`; `flurry+feint+muster`; `flurry+footwork+adapt`; `flurry+channel+attune`; `flurry+sharpen+reclaim`; `flurry+prism+regroup` |
| Aim attack mix | `aim+pepperingShot+salvageShot`; `aim+steadyShot+precisionShot`; `aim+repellingShot+longshot`; `aim+volley+salvageShot`; `aim+longshot+precisionShot`; `aim+repellingShot+volley` |
| Salvage Shot fodder and support | `salvageShot+pepperingShot+regroup`; `salvageShot+steadyShot+reclaim`; `salvageShot+repellingShot+footwork`; `salvageShot+longshot+muster`; `salvageShot+precisionShot+sharpen`; `salvageShot+volley+scour` |
| Distance and movement | `longshot+leyStep+aim`; `longshot+drive+salvageShot`; `longshot+footwork+aim`; `volley+leyStep+salvageShot`; `volley+footwork+aim`; `repellingShot+drive+aim` |
| Trash and payoff | `discipline+regroup+arcBolt`; `cull+reclaim+heavyBlow`; `sharpen+regroup+volley`; `scour+reclaim+improvise`; `cull+regroup+improvise`; `discipline+reclaim+precisionShot` |
| Reforge input and payoff | `reforge+discipline+starfire`; `reforge+cull+heavyBlow`; `reforge+jab+volley`; `reforge+pepperingShot+regiment`; `reforge+stipend+starfire`; `reforge+footwork+heavyBlow` |
| Improvise family mix | `improvise+fireball+heavyBlow`; `improvise+cascade+bullRush`; `improvise+overload+flurry`; `improvise+fireball+volley`; `improvise+cascade+salvageShot`; `improvise+bullRush+precisionShot` |

These lists are representative, not exhaustive. They include low and high costs, setup, draw, recovery, movement, discard fodder, and each damage-family pairing. The result must explain that all other triples receive only broad one-time coverage optimization.

### Incidence feasibility check

At 160 rows, each card appears 40 times and supplies 360 pair incidences. For a card with `d` priority partners, the full-suite lower requirement is `12d + 8(39-d) = 312 + 4d`. Since `d <= 10`, this is at most 352. In validation, each card appears 8 times and supplies 72 pair incidences; the lower requirement is `2d + (39-d) = 39 + d`, at most 49.

A card belongs to at most 11 required triples. Four full-suite appearances consume at least 44 of its 1,440 card-centered triple slots. One validation appearance consumes 11 of its 288 validation slots. A pair belongs to at most four required triples. These are necessary incidence checks, not a proof that a constrained design exists. Generation and validation provide the sufficiency evidence.

## Anchors and adversarial rows

Use these exact nine authored rows. They are never swapped. They count toward card, pair, triple, route, and distinctness measures, and the optimizer balances the generated rows around them.

| Split | Rationale ID | Exact card IDs |
|---|---|---|
| validation | `builtin-distance-duel` | `cull, footwork, feint, jab, drive, flurry, aim, pepperingShot, repellingShot, volley` |
| tuning | `builtin-current-duel` | `cull, channel, attune, arcBolt, cascade, feint, rally, aim, precisionShot, improvise` |
| tuning | `builtin-three-way-open` | `cull, leyStep, fireball, discharge, footwork, drive, longshot, volley, stipend, improvise` |
| validation | `builtin-three-way-engine` | `cull, channel, attune, overload, jab, rally, pepperingShot, precisionShot, regroup, improvise` |
| validation | `builtin-range-rich-mixed` | `cull, leyStep, adapt, fireball, bullRush, heavyBlow, aim, repellingShot, longshot, salvageShot` |
| tuning | `deep-beam-tuning-009` | `channel, improvise, longshot, precisionShot, reclaim, reforge, salvageShot, scour, sharpen, strike` |
| tuning | `thin-mana-control` | `arcBolt, fireball, starfire, discharge, cascade, overload, stipend, jab, pepperingShot, reclaim` |
| validation | `fixed-movement-control` | `feint, jab, strike, heavyBlow, openingStrike, rally, bullRush, flurry, longshot, volley` |
| tuning | `high-cost-choke` | `prism, starfire, cascade, overload, heavyBlow, flurry, volley, regiment, channel, strike` |

The first five rows are all five entries in `src/game-data/kingdoms.json`, including browser-default `distance-duel`. Their purpose is human-play continuity, not reuse of the four-entry experiment-only `CURATED_KINGDOM_IDS` list.

The thin-mana control has all six Mana payoffs but no variable `manaSource`; it measures dependence on always-available Focus. The fixed-movement control has positional attacks but no `variableMovement` card; it measures dependence on always-available Step. The high-cost choke has eight cards costing at least 5 and neither Stipend nor Reforge; it measures slow baseline economy and search failure.

The nine-row anchor overlap maximum is 6. `current-duel` and `three-way-engine` are the pair at 6. No authored row is exempt from the suite-wide maximum or percentile calculation. Store the full authored overlap matrix in the manifest and report.

Each authored row has `kind`, `rationaleId`, `reason`, split, and optional `sourceId` provenance. Reports separate authored-row results from balanced generated rows when that distinction changes an aggregate claim.

## Deterministic generator

Create one deep pure design module. Its small public interface must generate, measure, and validate a manifest. Keep optimizer details private.

The generator must:

1. Read the ordered variable card IDs and canonical card semantics from current game data.
2. Validate the frozen taxonomy, 96 priority pairs, 60 required triples, and incidence budgets before it builds a row.
3. Insert the nine authored rows in their frozen splits and measure their overlap matrix.
4. Allocate exact floor/ceiling card quotas for each split, including the authored rows.
5. Build remaining rows with a fixed seeded greedy search.
6. Improve rows with fixed-count quota-preserving swaps that never alter authored rows.
7. Compare objective tuples in a fixed order and use direct UTF-16 code-unit comparison, not `localeCompare`, as the final tie-break.
8. Store the exact base seed, seed derivation, restart count, candidates per step, swap attempts, and optimization passes in one immutable design spec and the manifest.
9. Reject duplicate rows, invalid rows, and rows above the overlap limit during construction.
10. Generate the seven required comparison sizes, then every integer from 160 until the first passing size, and always generate 200.
11. Measure every candidate with the same frozen predicates and apply the count selection rule.

A writer may tune optimizer constants while implementing the algorithm, before the first candidate manifest is committed. After that commit, constants are protocol and regeneration tests pin them. Candidate outcomes cannot change taxonomy, interactions, thresholds, split formulas, or the objective order.

The objective order is:

1. hard validity, duplicate, and overlap failures;
2. card quota deficits;
3. full and validation pair deficits;
4. priority-pair deficits;
5. required-triple deficits;
6. route and archetype deficits;
7. uncovered triple count;
8. pair-count variance;
9. overlap tail;
10. canonical row order.

Use the nearest-rank percentile: sort the observed values ascending and take one-based rank `ceil(p × count)`. For two ten-card rows, Jaccard similarity is `overlap / (20 - overlap)`. Round stored non-integer statistics to 12 decimal places; make threshold decisions from exact integer counts or unrounded values.

The implementation may use incremental indexes for speed. Re-running the public generator must still produce identical bytes in the same and a fresh process.

## Manifest

Replace `src/sim/balance-suite-manifest.json` with schema version 2 and suite version `balance-suite-v4`.

The manifest must contain:

- suite, schema, generator, taxonomy, and methodology versions;
- chosen count and the selection rule;
- candidate sizes and achieved candidate metrics;
- ordered variable card IDs;
- canonical variable, fixed-market, Treasure, and non-market card semantics;
- card-pool and taxonomy digests;
- fixed seeds, restart counts, optimizer passes, objective order, and tie-break rule;
- split definitions;
- expanded priority pairs and required triples with reasons and achieved counts;
- route and archetype thresholds and achieved counts;
- random baselines, exact combinatorics, deterministic lower bounds, and stated assumptions;
- card, pair, triple, route, overlap, and Jaccard statistics;
- each kingdom definition, split, route labels, row provenance, and row digest;
- residual uncovered-triple statistics;
- campaign protocol status `pending-k009-consistency`;
- one SHA-256 digest over canonical manifest content with the top-level digest omitted.

Canonical hashing recursively sorts object keys by direct UTF-16 code-unit comparison, preserves array order, serializes as compact UTF-8 JSON with JSON number and string rules, and omits only the digest field being calculated. A row digest hashes its canonical row object with `rowDigest` omitted. The top-level digest hashes the complete manifest with `digest` omitted but with all row digests present. The committed file itself is pretty JSON with two spaces and one final newline.

The manifest must not include a generation timestamp, absolute path, locale-dependent value, or current Git SHA. Those values would prevent stable regeneration or create a self-reference.

## Protect the strategy-search kingdoms

Copy the current `balance-suite-v3` file byte for byte to a clearly named frozen strategy-search manifest. Its base file SHA-256 is `4e7c9c889fc40b7d52532b756f17121a247d91497ac0e49f9acd7a150a0972a6`.

Make the frozen deep-beam source a standalone module. It may transform frozen `balance-*` definitions to `deep-beam-*`, but it must never register the frozen source IDs. `deepBeamSuite.ts` and its tests must stop importing `BALANCE_SUITE_MANIFEST` or any definition from `balanceSuite.ts`.

Pin these independent base literals in tests:

- 100 frozen card sets and the frozen file digest above;
- `deep-beam-tuning-009` cards: `channel, improvise, longshot, precisionShot, reclaim, reforge, salvageShot, scour, sharpen, strike`;
- draft-off Kingdom 009 rules fingerprint hash: `b5115138db0`.

Tests must also prove that random PSRO and staged Kingdom 009 code still resolve that exact kingdom, that v4 registration and deep-beam registration coexist, and that the new count cannot change any deep-beam definition. Registering frozen rows under their old `balance-*` IDs should collide with different v4 content; the frozen module must never do it.

This is research-protocol isolation, not a general compatibility layer.

## Runtime and reporting integration

- Register all selected v4 kingdoms in simulator-only code. Do not add them to the browser built-in registry.
- Keep unknown IDs invalid. Allow smoke simulation and compiled pairing-worker use so the future protocol can use the suite.
- Add one shared `pending-k009-consistency` campaign guard. `balanceSuite.runBatch`, `scripts/run_balance_suite.ts`, and generic `src/sim/cli.ts` full mode for any v4 ID must call it before they create a runner, invoke an adapter, or write a file. Tests inject an adapter and temporary root to prove that boundary. Smoke mode remains allowed.
- Make `scripts/validate_balance_suite.ts` validate the manifest and print its dynamic count and digest. Remove hard-coded `/100` output.
- Add `--check` to `scripts/generate_balance_suite_manifest.ts`. It must fail if fresh-process regeneration differs from the committed bytes.
- Keep balance-corpus model and renderer code dynamic for manifest split sizes, selected count, and overlap threshold. Remove its hard-coded 80, 20, 100, and overlap-8 prose. The public v4 report loader must fail closed before artifact reads because no approved v4 artifacts can exist yet.
- Retire the current active behavior of `strategy:report` while the protocol is pending. It must fail closed before artifact reads, and its reusable renderer must not print stale “v2,” “40 of 80,” or fixed-count prose. Do not silently bind it to v4 or to the frozen deep-beam file.
- Update `deepBeamSuite.test.ts` to use the frozen source as its oracle. Do not compare deep-beam rows with the new active manifest.
- Do not create fake result artifacts and do not run a paid or large campaign.

## Design report and result record

Add the `balance:suite:design-report` package command and a deterministic generator for `.html/kingdom-suite-design.html`. The command supports `--check` and `--output`. Open the committed file in the user's normal macOS Google Chrome after final validation. Do not render it inline.

The report and `.plans/62-comprehensive-kingdom-balance-suite-results.md` must include:

- the recorded old-suite decision and exact old v1 coverage;
- exact `45 choose 10` comparison, actual `40 choose 10` combinatorics, and random formulas;
- raw pilot results plus candidate tables for every required size and any tested integer between 160 and the selected count;
- card, pair, triple, route, overlap, and Jaccard coverage curves;
- marginal gains and the first passing count;
- lower bounds, practical bounds, and assumptions;
- random versus deterministic comparisons;
- anchors and their measurement reasons;
- residual triple and higher-order blind spots;
- a statement that combinatorial coverage does not prove balance or strategy-search closure;
- the pending K009 protocol dependency;
- later campaign estimates at the chosen count.

Use these measured per-run inputs for the estimate and label them as conditional:

- current native 500,000-policy pool: 30.005 seconds local, 84.479 seconds Modal;
- fixed-reservoir PSRO: 42.6 through 90.9 seconds, mean 68.8 seconds;
- Modal product measured cost: $0.010355 through $0.018497 per pool;
- Modal product worst-case reservation: $0.281925 per pool;
- full ordered-space Modal measured cost: $0.37159 per pool.

Report one-pool screening, three-pool provisional, and full ordered-space totals. State that the final multiplier, attack work, runtime, and cost remain pending until the K009 protocol is accepted. No estimate authorizes spending.

## Tests

Use public seams and independent oracles.

### Pure design tests

- Hand-count a small literal design for card, pair, triple, overlap, and Jaccard measures.
- Pin `40 choose 10 = 847,660,528`, card probability `1/4`, pair probability `3/52`, and triple probability `3/247` independently from the implementation.
- Prove fixed-seed byte identity in one process and through the generator CLI in a fresh process.
- Prove the committed top-level and row SHA-256 digests with independent hashing code.
- Prove the selected count is the first integer count that can meet every threshold: all counts below 160 fail the card-exposure lower bound, and every generated count from 160 to the selected count is measured in order.
- Prove 50, 100, 150, 152, and 156 each fail a named threshold. If 160 is not selected, prove it and every later tested count before the selected one fail. Prove the selected design passes all thresholds.
- Expand the frozen pair and triple rules independently and prove there are 96 unique pairs, 60 unique triples, maximum priority degree 10, and maximum required-triple membership 11.
- Pin the nearest-rank percentile and Jaccard calculations with literal examples.

### Sensitive manifest validation

Clone the committed manifest and make one mutation at a time. Validation must reject:

- wrong eligible card or card semantics;
- wrong seed, generator version, taxonomy version, or provenance;
- changed top-level or row digest;
- missing or duplicate kingdom;
- invalid pile, fixed card in a variable pile, or wrong pile count;
- card-frequency deficit;
- all-pair or validation-pair deficit;
- priority-pair deficit;
- required-triple deficit;
- route or archetype deficit;
- overlap above 6;
- stale candidate metrics or selected-count decision.

For each semantic mutation, recompute the affected row and top-level digests before validation. Digest-only mutations are separate tests. This prevents every semantic test from passing only because a stale digest was rejected.

Also mutate a row to nine piles, set a pile count to 9, insert Scrap, and add an override. Prove the suite validator rejects each case even where the production registry alone is permissive.

A test is sensitive only when the mutation would be accepted without the behavior under test. Do not use snapshots as the only oracle.

### Integration tests

- New v4 IDs register in the simulator and compiled pairing worker.
- The browser built-in registry remains unchanged.
- Frozen deep-beam definitions, the literal Kingdom 009 card list, and rules fingerprint stay exact; v4 and deep-beam register together without ID collisions.
- `balance-tuning-005` still exists and registers for existing simulator tests.
- Corpus aggregation and HTML labels use dynamic split, suite, and overlap values.
- The wrapper, `balanceSuite.runBatch`, generic full-mode CLI, balance corpus loader, and strategy report loader refuse while campaign protocol status is pending. Tests prove no adapter call or output file happens. Generic smoke mode remains usable.
- The design HTML has a package command, supports `--check` and `--output`, is deterministic across fresh processes, and contains the required formulas, curves, thresholds, count decision, blind spots, and campaign estimate.

## Documentation

Update `README.md` with only:

- the v4 manifest generation and validation commands;
- the selected count and split;
- the design-report command and file;
- the frozen legacy strategy-search manifest distinction;
- the fact that the production balance campaign is blocked on the K009 protocol and needs separate approval.

Remove or correct the existing 80/20 statement, the claim that `balance:suite:run` is currently usable, and the claim that deep-beam reads the active balance manifest.

Keep historical evidence in plan 62, not in a long README section.

## Review and commits

Use one plan review-panel round and one implementation review-panel round. This uses two of the allowed three rounds.

Commit checkpoints:

1. reviewed plan and plan-review synthesis outcome;
2. pure design module, frozen strategy-search source, manifest, and focused tests;
3. validation, report, documentation, result record, and final review fixes.

Record the pre-implementation SHA after the plan review is resolved. Use that SHA for the implementation review.

## Verification

Run:

```sh
npm run balance:suite:manifest -- --check
npm run balance:suite:validate
npm test -- --run test/sim/balanceSuite.test.ts test/sim/balanceCorpus.test.ts test/sim/deepBeamSuite.test.ts test/sim/bundle.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run build:sim
npm run test:e2e:manifest
npm run verify:native
npm run modal:test
npm run balance:suite:design-report
npm run balance:suite:design-report -- --check
report_copy=$(mktemp)
npm run balance:suite:design-report -- --output "$report_copy"
cmp .html/kingdom-suite-design.html "$report_copy"
rm "$report_copy"
shasum -a 256 .html/kingdom-suite-design.html
git diff --check
```

`npm run modal:test` is a local Python unit-test command. It does not launch paid Modal work. Do not run Playwright unless implementation changes browser behavior or the review finds a browser risk. Do not start Modal work or any large strategy-search campaign.

## Acceptance checks

- The result record states exactly why the old 100 was chosen and what it covered.
- Exact combinatorics, random expectations, high-probability bounds, deterministic lower bounds, and assumptions are present.
- All required candidate sizes are generated and compared.
- The selected count is the first count that passes the recorded thresholds.
- The committed manifest regenerates byte for byte and its digest is stable.
- Card, pair, required-triple, route, validity, duplicate, overlap, Jaccard, provenance, and digest checks pass.
- Residual unprioritized triple and higher-order blind spots are explicit.
- Frozen deep-beam and Kingdom 009 definitions are unchanged.
- The runner cannot launch the obsolete protocol.
- The design report and result record are committed and reproducible.
- Campaign runtime and cost are conditional, bounded, and do not imply approval.
- Required review rounds and verification pass.
