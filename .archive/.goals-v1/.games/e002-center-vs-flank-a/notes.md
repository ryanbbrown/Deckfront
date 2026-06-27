# E002 Center vs Flank A Notes

## Strategy

P1 followed the assigned center plan: early nearby center captures, then a guardian/marksman core around center-north and center. Buys leaned toward Silver, Blast, and Training as the CLI hands allowed; Copper was never bought.

P2 followed the assigned flank plan: scouts took west-south, center-south, and southeast pressure, with healer/druid/raider support arriving behind them. Buys leaned into Potion/Healer and supplemental Silver; Copper was never bought.

## Rules Calls

- Deck damage was only assigned as bonus damage on legal unit attacks. Unused damage was left unused rather than treated as direct spell damage.
- Training's `upgradeDamage` was applied only when actually produced on turn 15, permanently increasing `P1-guardian-1` attack from 4 to 5.
- Deck healing was applied only to friendly damaged units and capped at max HP. Some produced healing had no useful target and was unused.
- Board phase order used: start-of-turn win check note, supply income, movement/capture, upgrades, attacks, healing, recruitment, advance turn.
- Druid/healer unit healing remained ambiguous. This replay relied on deck healing and did not give druid/healer units separate free healing actions.

## Ambiguities And Limitations

- The run used the deck CLI's default `territory-v1` starting deck because the requested initializer only supplies board state, and there is no dedicated CLI mechanic for the 7 Copper plus 12 draft-coin setup described in `board-rules.md`.
- The replay generator performed movement, occupancy, range, blocked-hex, supply, recruitment, and capture checks, but `validate-run` only validates replay continuity/schema.
- The helper script `generate-replay.mjs` is kept in the run directory as reproducibility evidence for the generated scripts and snapshots.

## Stopping Point

Stopped after 15 completed player turns: P1 has completed 8 turns, P2 has completed 7, and the active player is P2 at round 8.

No player has won under the 3-unit start-of-turn lead condition. Final unit count is P1 6 vs P2 5. Final center control is P1 4, P2 3, unclaimed 1. P1 leads on units, center control, and saved supply, but P2 still has west/south/southeast footholds plus two raiders available or developing.

## Evidence Quality

Evidence quality: partial-to-full. The replay validates and the board actions were checked beyond the validator, but the starting deck/draft ambiguity should be considered when comparing this run to stricter drafted-start runs.
