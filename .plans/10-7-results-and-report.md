# Step 7: machine-readable results and the Markdown report

Implements step 7 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 6.

## Objective

An experiment writes machine-readable output and a concise Markdown report. Partial output survives a time or generation limit.

## Command line

```sh
npm run experiment -- --kingdom <id> --mode smoke|full
```

Options: `--kingdom`, `--mode`, `--seed`, `--deadline-minutes`, `--generations`, `--candidates`, `--leaders`, `--seeds`, `--out`. The mode sets the defaults; an explicit option may only lower a limit, never raise it above the approved maximum. Reject a value that would raise a limit, and say so.

## Output

Output goes to `.experiments/<kingdom-id>/`. `.gitignore` already ignores `.experiments/**` except `report.md`, so only the report is committed.

| File | Content |
| --- | --- |
| `run.json` | The resolved config, the complete resolved kingdom including overrides, the run seed, the actual limits, the start and end times, and the stop reason. |
| `generations.jsonl` | One line for each generation: leaders, scores, match count, overflow count, and elapsed time. |
| `tournament.json` | The final round robin: entrants, the pairwise win table, and the ranking. |
| `strategies.json` | Every leader, current and retained, in the readable strategy form. |
| `telemetry.json` | Aggregated card telemetry across the run. |
| `report.md` | The concise Markdown report. |

Write `run.json` before the first generation, and append to `generations.jsonl` from the `onGeneration` callback, so a run killed at any point leaves usable output. Write the stop reason into `run.json` when the run ends, whether it ended by generations, deadline, or error.

## Report

The report is concise and answers the questions the design document lists:

1. Run header: kingdom, mode, seed, actual limits, elapsed time, stop reason, and the calibration result when the kingdom has one.
2. Final ranking with scores.
3. Pairwise win-rate table.
4. Card inclusion and copy counts among leaders.
5. Melee, ranged, mage, and mixed representation, classified by the attack cards a leader actually bought.
6. Turns to win, and damage by card.
7. Dead draws by cause: range, mana, and other.
8. First-player and arena-side advantage.
9. The top leaders printed as readable strategies.

State findings as measurements. Only rigged melee has a pass-or-fail check. Do not describe another kingdom's result as a failure.

## Classification

A leader is melee, ranged, mage, or mixed by the attack cards it bought:

- melee: Drive, Feint, Flurry, Heavy Blow, Strike;
- ranged: Aim, Volley, Quick Shot, Steady Shot, Shot;
- mage: Arc Bolt, Fireball, Starfire.

A leader with attacks from more than one family, none holding a majority of its attack cards, is mixed. A leader that bought no attack is `none`. Record this classification rule in the report so a reader can check it.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/experiment.ts` | New. Run orchestration and output writing. |
| `src/sim/report.ts` | New. Markdown report generation. |
| `src/sim/cli.ts` | New. Argument parsing and the entry point. |
| `package.json` | The `experiment` script, using `tsx`, which the project already has. |
| `test/sim/report.test.ts` | New. |

## Checks

1. `run.json` exists before the first generation ends, and records the resolved kingdom with its overrides.
2. A run stopped at its deadline leaves `run.json` with a `deadline` stop reason and every finished generation in `generations.jsonl`.
3. The report renders from a fixed synthetic tournament result and matches an expected snapshot for the ranking, the pairwise table, and the classification counts.
4. The CLI rejects a limit above the approved maximum and accepts a lower one.
5. Family classification puts a leader with two Heavy Blows and one Volley in melee, and one with two Volleys and two Heavy Blows in mixed.
6. The calibration section appears for `rigged-melee` and is absent for the others.

## Completion criterion

An experiment writes the listed files, the report answers the listed questions, partial output survives a limit, the checks pass, and the four verification commands pass.
