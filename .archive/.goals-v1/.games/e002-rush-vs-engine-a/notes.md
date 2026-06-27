# E002 Rush vs Engine A Notes

## Strategy

- P1 followed the rush assignment: trashed weak cards aggressively, bought Blast over economy, recruited scouts/raiders, and pushed northeast/east into center and southeast.
- P2 followed the engine/stabilization assignment: bought Village, Silver, Peddler, Gold, then Healer once the rush pressure became immediate; board recruits prioritized guardians after the first expansion.
- Expected tension showed up: max-HP starters prevented the immediate collapse seen in E001-style damaged starts, but repeated P1 Blast/Zap turns still forced P2 to spend board supply defensively.

## Rules Calls

- Deck damage was treated as extra damage assigned through legal unit attacks, not global direct damage.
- Recruited units were placed during the board phase but did not move or attack until a later turn.
- Supply income was counted from centers controlled at the start of the active player's board phase; captures affected later turns.
- Control persisted after units left or died on a center.
- Start-of-turn unit-count win was checked only for the active player.

## Ambiguities

- Board phase ordering for recruitment relative to movement/combat remains underspecified; this run used conservative delayed activation for recruits.
- Unit healing timing remains underspecified. The run used deck healing only where recorded and did not rely on druid/healer unit healing for a kill or survival breakpoint.
- Deck starting-deck drafting from the board rules is still not represented by the CLI; this run used the `territory-v1/deck.yaml` starting deck through the CLI, matching prior baseline replay practice.

## Stopping Point

- Stopped after 12 completed player turns.
- No winner had resolved. Final active player is P1 at round 7.
- Final living units: P1 7, P2 5. P1 leads but does not have a 3-unit start-of-turn win.
- Final supply centers: P1 controls 5, P2 controls 2, northwest remains neutral.

## Evidence Quality

- Evidence quality: full for replay structure; partial-to-full for rules evidence because board legality is manually adjudicated and the rules still have phase-order/healing ambiguities.
- `bun run validate-run -- .games/e002-rush-vs-engine-a/timeline.json` passes.
