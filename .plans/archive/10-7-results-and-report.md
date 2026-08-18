> **Superseded:** Use [12-repository-cleanup.md](../12-repository-cleanup.md) for the current repository and browser scope. Use [09-card-list.md](../09-card-list.md), [10-automated-balance-search.md](../10-automated-balance-search.md), and [11-search-performance.md](../11-search-performance.md) for current game and simulator decisions.

# Step 7: machine-readable results and the Markdown report

Implements step 7 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 6.

## Objective

An experiment writes machine-readable output and a concise Markdown report. Partial output survives a time or generation limit.

## Command line

```sh
npm run experiment -- --kingdom <id> --mode smoke|full
```

Options: `--kingdom`, `--mode`, `--seed`, `--deadline-minutes`, `--generations`, `--candidates`, `--leaders`, `--seeds`.

`--out` is dropped. It escapes the `.gitignore` whitelist, nothing needs it, and the project rule is the simplest implementation that meets the requirement.

**Limits.** The mode sets the defaults. The maxima are the `design maximum` row of step 6's limits table and apply in **both** modes, so `--candidates 50` in smoke mode is legal and `--candidates 200` is rejected in either mode. Reject an out-of-range value with a message naming the maximum. This is the rule "an explicit option may only lower a limit, never raise it above the approved maximum", made implementable.

The full defaults are **below** the maxima, because the measured throughput of 11.3 matches per second makes the design-maximum run 41 hours. Step 6's limits table carries the arithmetic. The gap is deliberate: the maxima stay as approved ceilings, the defaults are what actually fits the deadline.

| Option | smoke default | full default | Maximum |
| --- | ---: | ---: | ---: |
| `--candidates` | 20 | 30 | 100 |
| `--leaders` | 3 | 4 | 5 |
| `--generations` | 5 | 32 | 32 |
| `--seeds` | 5 | 8 | 25 |
| `--deadline-minutes` | 30 | 240 | 420 |
| `--state-limit` | 20000 | 20000 | 20000 |

`--state-limit` is the Action-phase search's abort threshold, not a balance knob. It exists as an option because nothing else can exercise the abort path — the measured maximum is 297 visited states against the 20,000 default, so no real strategy overflows. Lowering it is a **recorded run limit** and belongs in `run.json` and the report header, because it changes which matches abort.

`--kingdom` accepts only the five curated ids. `distance-duel` is registered by default but is the browser kingdom, not an experiment kingdom; reject it with the five valid ids in the message.

Export a pure `parseExperimentOptions(argv)` so the option matrix is testable without a child process.

## Output

Output goes to `.experiments/<kingdom-id>/<mode>/`.

The **mode segment matters**: `GOAL.md` requires smoke results for all five kingdoms *and* a capped full run. Sharing one directory per kingdom would make the full run overwrite the committed smoke `report.md`, destroying the evidence the goal asks for. `.gitignore` already whitelists `!.experiments/**/report.md`, which still matches at this depth, so no ignore change is needed.

| File | Content |
| --- | --- |
| `run.json` | The resolved config, the resolved kingdom, the run seed, the actual limits, start and end times, and the stop reason. |
| `generations.jsonl` | One line per generation: leaders, scores, match count, overflow count, elapsed time, and whether it was partial. |
| `tournament.json` | The final round robin: entrants, the pairwise table, the ranking, and the calibration input. |
| `strategies.json` | Every leader, current and retained, in the readable strategy form. |
| `telemetry.json` | Aggregated telemetry, evolution and tournament reported separately. |
| `report.md` | The concise Markdown report. |

"The resolved kingdom" is the **resolved definitions from `kingdomMarket(kingdomId)`**, not the kingdom record plus its override map. Only the resolved form keeps a committed report reproducible against a later change to canonical card values.

**Durability.** Clear stale artifacts when the run starts, so a second run cannot append to the previous run's `generations.jsonl`. Write `run.json` before the first generation and rewrite it at the end. Every JSON snapshot is written to a temporary file and renamed, so a kill never leaves invalid JSON. `generations.jsonl` is appended from the `onGeneration` callback; a reader must tolerate a truncated final line.

**On error**, `run.json` records `stopReason: 'error'` with the message, `report.md` is still written with whatever is available, and the CLI exits non-zero.

**The calibration gate throws when every final leader is a fixed baseline, and step 7 must catch it.** Step 5 defines the final leader set as excluding baselines and specifies that an empty list throws. That case is reachable: it means evolution never produced a leader better than the yardstick, which is a **result**, and an important one. Catch it, record it as a blocker in `run.json` and in the report header naming the leaders that survived, and keep the rest of the run's output. A full run must not crash because the search did not beat its own baselines.

**When the generation count and the deadline are reached together**, the stop reason is `generations`: the run finished what it was asked to do.

## Deadline and the tournament reserve

The final tournament is the most expensive single step. `--deadline-minutes` is split: the tournament reserve is 20 percent of the deadline, and evolution gets the rest. `roundRobin` receives its own deadline from that reserve.

If the tournament does not finish, `run.json` records `tournamentComplete: false` and the report says so **in the header**. A `deadline` run that silently omits the ranking, the pairwise table, and the calibration result is the worst outcome for an unattended goal.

## Data sources

Step 6 aggregates telemetry onto both `GenerationResult` and `TournamentResult`, keyed by strategy id and split by orientation. Each report section names its source, so no number is ambiguous:

| Section | Source |
| --- | --- |
| Ranking, pairwise table, calibration | tournament |
| Card inclusion, family classification | tournament (these are questions about leaders) |
| Damage by card, turns to win, dead draws | evolution and tournament combined, labelled "all matches" |
| First-player and arena-side advantage | tournament (leader-versus-leader is the fair comparison) |

## Report

1. Run header: kingdom, mode, seed, actual limits, elapsed time, stop reason, total matches, **aborted matches and the overflow rate**, whether the tournament completed, and the calibration result when the kingdom has one.
2. Final ranking with mean score per completed game.
3. Pairwise **win-rate** table, computed from `PairRecord.played`.
4. Card inclusion and copy counts among leaders.
5. Melee, ranged, mage, mixed, and **`none`** representation.
6. Turns to win, and damage by card.
7. Dead draws by cause: `range`, `mana`, `setup`, and `other = total − range − mana`. State in the report that `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is therefore not part of `total`, unlike the other three.
8. First-player and arena-side advantage. "Arena-side advantage" means the win rate with `swapSides: false` against `swapSides: true`; use that one name.
9. The top leaders printed as readable strategies.

The overflow rate is in the header because `GOAL.md` requires action-search overflow to be an explicit result. Without it, a run where most matches aborted renders as a normal, credible result.

State findings as measurements. Only rigged melee has a pass-or-fail check. Do not describe another kingdom's result as a failure.

## Classification

A leader is melee, ranged, mage, mixed, or `none` by the attack cards it **acquired** — starting build plus purchases, the same definition step 5's calibration uses. One definition across both, stated once.

Counting purchases alone would mislabel every leader that concentrates its attacks in the 12-money starting build: in a kingdom where its agenda cards stay unaffordable, such a leader buys no attack at all and reads as `none` while its deck is pure melee.

- melee: Drive, Flurry, Heavy Blow, Strike;
- ranged: Volley, Quick Shot, Steady Shot, Shot;
- mage: Arc Bolt, Fireball, Starfire.

Aim and Feint are **not** counted. Neither deals damage, and counting them made the families asymmetric — the mage list counts no setup card either, so a leader with three Aim, one Volley, and two Heavy Blow would have scored ranged 4 against melee 2 and been labelled ranged, though melee was most of its damage.

A leader with attacks from more than one family, none holding a majority of its attack cards, is mixed. A leader that acquired no attack is `none`. Record this rule in the report so a reader can check it.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/experiment.ts` | New. Run orchestration, the deadline split, and durable output writing. |
| `src/sim/report.ts` | New. Pure Markdown rendering. |
| `src/sim/cli.ts` | New. `parseExperimentOptions` and the entry point. |
| `package.json` | The `experiment` script, using `tsx`, which the project already has. |
| `README.md` | The `npm run experiment` command and the `.experiments/` output. |
| `test/sim/report.test.ts` | New. |
| `test/sim/experiment.test.ts` | New. |
| `test/sim/cli.test.ts` | New. |

## Checks

1. `run.json` exists before the first generation ends — asserted from inside the first `onGeneration` callback, not after `evolve` returns — and records the resolved kingdom.
2. A deadline expiring during generation 3 leaves `run.json` with `stopReason: 'deadline'`, `generations.jsonl` holding exactly the finished generations plus the partial one, and every line parsing as JSON on its own.
3. A deadline expiring during the tournament leaves `tournamentComplete: false`, and the report renders and says so.
4. `renderReport` is a pure function of an explicit run summary, with times and elapsed passed in as data. Rendering the same synthetic run twice is byte-equal, including key order in every table. Expected output is inline, not a snapshot file, so a wrong table shows in the diff instead of being accepted by an update flag.
5. The CLI option matrix, table-driven over both modes: an accepted lower value and a rejected higher value for each limit, plus an unknown kingdom, `distance-duel`, an unknown option, and fractional, zero, and negative values.
6. Classification: 2 Heavy Blow + 1 Volley → melee; 2 Volley + 2 Heavy Blow → mixed; a 2/2/1 three-family split → mixed; no attacks → `none`; **attacks in the starting build only → the same family as if bought**; 3 Aim + 1 Volley + 2 Heavy Blow → melee, proving Aim is not counted.
7. The calibration section appears for `rigged-melee` and is absent for the others.
8. A pre-populated output directory is cleared: no generation line or final artifact from a previous run survives.
9. An injected error leaves `run.json` valid with `stopReason: 'error'`, writes `report.md`, and exits non-zero.
10. The renderer handles partial data: a run with no tournament result, and one with a high overflow count, both render without throwing and say so in the text.
11. File-writing tests use a temporary directory, never `.experiments/`.

## Completion criterion

An experiment writes the listed files, the report answers the listed questions from named sources, partial output survives a limit, the checks pass, and the four verification commands pass.
