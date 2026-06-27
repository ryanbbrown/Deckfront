# E013b Rush vs Engine C Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e013-contest-starter.board.json`.
- Deck setup followed the operative `deck.yaml` card list and turn resources. The rules prose still mentions an older 7-Copper plus draft-coin baseline, so this run records the fixed deck-file setup as the setup caveat.
- P1 strategy: early damage/tempo with Zap, Blast, Storm, Training, Second Wind, and a few money turns to sustain buys.
- P2 strategy: Village/Peddler/Silver/Gold economy, plus Healer/Potion/Armory/Storm support once the southeast/east front became contested.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 25. P1 created several end-of-turn board leads, but none was a four-unit active-player lead at a start-of-turn check.
- Turn 26 / P2 start: P2 began at 11 living units to P1's 7, creating a pending P2 lead-4 threat.
- Turn 27 / P1 response: P1 recruited Marksman-5 but failed to kill a P2 unit, ending at P1 7 to P2 12.
- Winner: P2 confirms the pending lead-4 threat at the beginning of turn 28 / round 14, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 27.
- Winner: P2 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 7, P2 12.
- Final supply centers: P1 3, P2 5, neutral 0.
- Final saved supply: P1 0, P2 1.

## Map And Strategy Takeaways

- P1 did achieve the intended early pressure posture and repeatedly held four to five centers, but the shifted east/southeast centers gave P2 enough contact points to contest without abandoning center-south.
- P2 did not stabilize immediately. The game turned only after P2 combined healing, Armory upgrades, Storm splash, and stored supply for multi-body response turns around turns 18-24.
- This independent repeat supports the same broad E013 signal as run A: the contest map can let engine/healing survive the P1 rush, though the rush still creates dangerous midgame clocks.

## Rules Calls And Ambiguities

- Pending lead-4 state has no board-schema field; it is recorded in `timeline.json` reasoning and these notes.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm used the least expansive interpretation: one legal original target plus one adjacent occupied enemy storm target, with base attack damage only on the original target.
- Tactical movement, targeting, supply, and combat were hand-authored and hand-audited; `validate-run` verifies replay schema, snapshot existence, and continuity, not complete tactical legality.

## Evidence Quality

- Evidence quality: full for replay continuity and high-level strategic outcome; tactical legality remains hand-audited rather than machine-verified.
