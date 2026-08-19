# Five-kingdom shared-pilot dashboard

## Goal

Run a fresh design-maximum balance search for all five curated kingdoms with the shared tactical
pilot from commit `33b9fed`, then replace the old dashboard with one generated from those runs.

The dashboard is evidence for the next balance discussion. This work does not change health, card
values, game rules, strategy mutation, or tactical play.

Do not run a review panel. The user must see and check the dashboard first.

## Source and kept decisions

Bring the dashboard generator, its test file, and its small test fixture forward from
`bb/balance-baseline-dashboard` at `4e2845d`. Copy only the useful dashboard work. Do not merge or
cherry-pick that branch because it is based on the obsolete pre-shared-pilot simulator.

Keep these user decisions:

- Remove planned-family, acquired-family, and preferred-range fields from every dashboard table.
- Do not show Copper as a purchase. A shared-pilot strategy cannot buy Copper.
- Give each finite purchase-plan position its own table column so plans can be compared from left to
  right.
- Show the repeated purchase as a separate column. This answers what the strategy buys after its
  finite plan ends.
- Explain tournament score as the mean of the per-opponent pairing means. For one opponent, the
  pairing mean is `(wins + half draws) / completed games`. The score is not raw win percentage.
- Keep the compact matchup heatmap, generation history, useful overview measures, and kingdom-wide
  damage evidence.

## Fresh full runs

Build `dist-sim/experiment.mjs` once from the approved implementation. Run the kingdoms one at a time
so five ten-worker jobs do not compete for the same CPU. `runExperiment` removes each target full-run
directory before it starts, so each command replaces all old machine artifacts and `report.md` for
that kingdom.

Use these exact limits for every run:

| Setting | Value |
| --- | ---: |
| Mode | `full` |
| Run seed | `1` |
| Candidates | `100` |
| Leaders kept | `5` |
| Generations | `32` |
| Shared seeds | `25` |
| Workers | `10` |
| Turn limit | `30` per player |
| Action cap | `200` per turn |
| Search state limit | `20,000` |
| Deadline | `420` minutes |

The deadline is the current CLI maximum. The 25 shared seeds retain the 100-game maximum per pairing,
with early stopping after a statistically settled four-orientation seed block.

Run this command for each of `current-duel`, `three-way-open`, `three-way-engine`,
`range-rich-mixed`, and `rigged-melee`:

```sh
node dist-sim/experiment.mjs --kingdom <kingdom-id> --mode full --seed 1 \
  --candidates 100 --leaders 5 --generations 32 --seeds 25 --workers 10 \
  --deadline-minutes 420 --state-limit 20000
```

Stop before dashboard generation if any command exits with an error, stops at its deadline, has an
incomplete generation or tournament, or records a blocker. A run may contain isolated evolution
overflows only when every selected generation leader has zero aborted games, the final tournament has
zero aborted games, and every tournament cell is complete. Show the evolution-abort rate in the
dashboard. Reject any selected-leader or tournament abort. A failed kingdom must be rerun from a clean
full-run directory; do not mix files from two attempts.

The five raw JSON and JSONL artifact sets remain ignored. Commit the five newly written
`.experiments/<kingdom-id>/full/report.md` files. These reports replace the three historical reports
and add current reports for the other two kingdoms.

## Current artifact validation

Adapt `scripts/write_balance_dashboard.ts` to the current artifact types and shared-pilot `Strategy`.
Before rendering, require all five kingdom ids exactly once and require these five files for each:

- `run.json`
- `generations.jsonl`
- `strategies.json`
- `telemetry.json`
- `tournament.json`

Reject a run unless it has the exact limits in this plan, full mode, seed 1,
`stopReason === 'generations'`, no error, no blockers, 32 ordered and complete generation rows, five distinct final
leader ids, and a complete non-partial tournament with every expected pair played. Require the
rigged-melee calibration result to be present and internally consistent; a calibration failure is a
result to display, not a reason to rerun. Require zero aborted games for every selected generation
leader and for the final tournament. Allow other evolution overflows only as a displayed run metric.

Validate all strategy records against the current executable shape:

- the only strategy fields are `id`, `startingBuild`, `buyAgenda`, and `repeatPurchase`;
- every finite entry has only `cardId` and positive integer `desiredCount`;
- every finite entry requires at least one purchase after starting-build copies are subtracted;
- Copper is absent from finite and repeated purchases;
- every card in the build and plan exists in the saved resolved kingdom market; and
- canonical strategy ids are unique and consistent across the final leaders, all generation leaders,
  tournament entrants, ranking, telemetry, and pairwise cells.

This exact shape and exact limit check makes pre-shared-pilot or lower-limit artifacts invalid. The
run files do not store a Git SHA, so the plan and the clean replacement run are the source provenance;
the generator must not claim that it verified a commit hash.

## Dashboard content

Generate one deterministic, self-contained `.html/balance-baseline.html`. It must contain all CSS and
data, make no network request, use no clock or random value, and produce identical bytes from the same
artifact files.

### Overview

Show one row per kingdom with:

- mean completed turns per player in won games;
- draw rate across completed evolution and tournament matches;
- first-player score from tournament orientation cells, with draws worth half a win;
- aborted-match rate;
- dominant kingdom-wide damage family and its damage share; and
- generation and tournament completion; and
- the rigged-melee calibration result.

Use an em dash for a zero denominator. Do not show planned-family or acquired-family summaries.

### Final leaders

Show the five final leaders in tournament-rank order. Use these columns:

1. rank;
2. tournament score;
3. short strategy id;
4. starting build;
5. finite purchase step 1;
6. finite purchase step 2, continuing to the longest finite plan among that kingdom's five leaders;
   and
7. repeated purchase.

For each finite step, show the card and the purchases still required after the starting build. The
display count is `max(0, desiredCount - copies in startingBuild)`. Keep the stored order. Render an em
dash when a leader has no entry at that position. The repeated purchase has no count because the
strategy keeps buying that card while it can.

Do not show family, range, acquired-card, or combined purchase-plan columns. Fixed seeds remain useful
opponents in the heatmap but do not belong in the five-row final-leader table unless one is a final
leader.

### Matchups, evolution, and damage

- Keep a compact heatmap for the five final leaders plus named fixed seeds. Deduplicate a strategy
  that is both. A cell is the exact row strategy score against the column strategy over completed
  games; draws count as half. Mark the diagonal and missing cells explicitly.
- Show all 32 generations with the exact five short strategy ids in rank order, the champion id,
  exact leader carryover from the prior generation, overlap with the final five, and the champion's
  final tournament rank or `not in tournament`. Do not derive or show a family label.
- Keep kingdom-wide damage and play totals by attack family and card. Damage from a card outside the
  known attack families belongs in an explicit `other` bucket. State that this is aggregate evidence,
  not per-strategy damage.
- Keep short, data-derived evidence text for game length, damage-family dominance, draws, and first
  player advantage. Do not hard-code claims such as ranged winning four kingdoms or mage having no
  leaders; compute the statements from the new runs or state the saved telemetry limit.
- Show rigged-melee calibration PASS or FAIL prominently in its overview row and kingdom section.
  State the saved top-final-leader Heavy Blow count and the number of final leaders that acquired
  Heavy Blow. When the saved result is FAIL, show how the fixed melee seed ranked against the best
  final leader so generation drift is visible.

## Focused tests

Port and rewrite `test/sim/balanceDashboard.test.ts` and
`test/sim/fixtures/balance-dashboard.ts` around literal shared-pilot strategy records. Test through the
generator's exported load, validation, transformation, and render boundaries.

The tests must fail for these regressions:

- a kingdom, artifact file, generation, final leader, tournament pair, or cross-file strategy id is
  missing or duplicated;
- a run is incomplete, errored, blocked, uses a lower limit, has a selected-leader or tournament
  abort, or uses the old strategy fields;
- the rigged-melee calibration is missing or inconsistent with the tournament ranking and acquisition
  telemetry;
- a finite or repeated purchase contains Copper;
- a build or purchase refers to a card outside the saved kingdom market;
- starting-build copies are not subtracted from a finite purchase step;
- finite steps are combined into one cell, reordered, or lose blank columns for shorter plans;
- the repeat purchase is absent or displayed as a finite count;
- final leaders are not in tournament-rank order;
- tournament score is shown as a decimal or described as raw win percentage;
- generation identity, adjacent carryover, final overlap, or champion final rank is wrong;
- a final leader and fixed seed are duplicated in the heatmap;
- draws, aborts, asymmetric orientations, zero denominators, self cells, or missing pairwise cells
  produce a false rate;
- unknown damage cards do not enter `other`;
- artifact text can inject HTML;
- the HTML contains a remote URL; or
- identical input produces different output bytes.

Use literal expected percentages, ids, card names, and table text. Do not calculate expected values
with the generator's helpers, use a full-run artifact as a test fixture, or approve the whole HTML with
a snapshot.

## Verification and independent cross-check

Run:

```sh
npm run build:sim
npm test
npm run typecheck
npm run lint
npm run build
npx tsx scripts/write_balance_dashboard.ts
cp .html/balance-baseline.html /tmp/hexdeck-balance-baseline-first.html
npx tsx scripts/write_balance_dashboard.ts
cmp /tmp/hexdeck-balance-baseline-first.html .html/balance-baseline.html
git diff --check
```

Cross-check the generated page without using generator functions. Read the raw JSON and JSONL with a
separate one-off Node or `jq` command and verify, for every kingdom:

- the five final ids equal generation 32's leaders and appear in the displayed rank order;
- the displayed top leader score equals its literal `tournament.json` score converted to a percent;
- the displayed starting build, each finite-step card and remaining count, and repeated purchase equal
  the top leader's literal `strategies.json` record; and
- at least two overview values, including first-player score or draw rate, equal an independent sum of
  the underlying telemetry and run counts.

Also compare the HTML's kingdom-wide damage totals with the five new Markdown reports or the literal
telemetry maps. Record the cross-check values in the implementation handoff; do not commit a second
derived data file.

## Visual QA and handoff

Open the generated file at a desktop viewport near 1440 by 900 and a narrow viewport near 390 by 844.
Check all five navigation links, sticky headers, horizontal table scrolling, heatmap labels, all 32
generation rows, long builds, different finite-plan lengths, and the repeat-purchase column. Fix text
overlap, clipped controls, or unreadable colors before handoff.

Update `README.md` with the exact full-run limits, generator command, ignored input requirement,
output path, and normal macOS Chrome open command. Commit the plan, generator, focused tests, fixture,
README change, five current Markdown reports, and generated HTML. Do not commit raw JSON or JSONL.

After the work is merged to `main`, open the committed file in the user's normal Google Chrome:

```sh
open -a "Google Chrome" .html/balance-baseline.html
```

Report each kingdom's elapsed time, matches, aborted matches, draw rate, top leader score, and whether
all 32 generations and the tournament completed. Give the user the clickable HTML path. Do not run a
review panel until the user asks for one after viewing the dashboard.
