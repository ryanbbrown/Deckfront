# Experiments

Use one entry per experiment.

## E001 - Baseline territory-v1 on sketch-v1

Status: complete
Runs:
- `.games/e001-rush-vs-engine-a`
- `.games/e001-rush-vs-engine-b`
- `.games/e001-center-vs-flank-a`
- `.games/e001-center-vs-flank-b`

Ruleset: `rulesets/territory-v1`
Map: `maps/sketch-v1.json`

Hypothesis:
Baseline territory-v1 should show whether early board pressure, slower deck scaling, central control, and flank/support play are all plausible.

Changed:
None. Baseline ruleset and map.

Result:
Score: 68 / 100.

All four replay bundles validated. Evidence quality was `partial` for every run because the starter board snapshot used damaged units, while the written rules say units start at max HP.

Observed:
- Board tension was strong; supply centers consistently mattered.
- Early pressure looked viable and may be too strong.
- Slower deck-engine scaling did not prove it can stabilize against early pressure.
- Center/flank play was more contested than rush-vs-engine.
- Healing/support and deck-damage timing need clearer rules.

Decision:
Iterate near baseline. Before testing bigger variants, rerun E001-style matchups from a max-HP starter board and clarify support healing, deck damage, and board-phase ordering.

## Template

```md
## E000 - Title

Status:
Run:
Ruleset:
Map:

Hypothesis:

Changed:

Result:

Decision:
```
