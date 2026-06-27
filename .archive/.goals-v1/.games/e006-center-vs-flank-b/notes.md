# E006 Center vs Flank B Notes

## Strategy Assignment

- P1 deck: balanced economy into tactical damage/upgrades. P1 bought Peddler, Training, Silver, and Blast; no Copper buys.
- P1 board: compact guardian/marksman core contested the north and central supply centers. Scouts were used only for early safe flips and one center skirmish.
- P2 deck: healing/control with opportunistic damage. P2 bought Peddler, Healer, Village, Silver, and Storm; no Copper buys.
- P2 board: west, center-south, and southeast lanes pulled P1 away from a clean center lock. Scouts held flank centers while druid/healer support preserved wounded units.

## Rules Calls

- Recruits cost 6 supply and were delayed. The higher cost materially changed turns 11 and 16: planned extra recruits were not affordable and were omitted.
- Deck `damage` was only used when attached to legal attacks. Some produced Blast/Storm damage was left unused instead of being treated as direct damage.
- Training upgrades were stacked on `P1-guardian-1`, raising it to 12 attack by the stopping point. This was treated as legal because the rules do not limit repeated permanent upgrades on one living unit.
- Printed healing used range 1 for druids and range 2 for healers. Several heals were only recorded when the unit was in legal range.
- The starting decks matched the requested exact lists and both spend the 12-card draft budget exactly.

## Stopping Point

- Stopped after 16 completed player turns with no start-of-turn unit-count win.
- Final unit count: P1 8, P2 8.
- Final supply control: P1 controls 4 centers (`center-center-north`, `center-center`, `center-northeast`, `center-east`); P2 controls 3 centers (`center-west-south`, `center-center-south`, `center-southeast`); `center-northwest` remains neutral.
- Final saved supply: P1 4, P2 5. P2 is one supply short of another recruit, which is direct evidence for the cost-6 slowdown.
- Leader: P1 by center control and central positioning, but the game is unresolved because P2 still has live southeast and center-south flank pressure.

## Ambiguities

- Storm was drawn on turn 16 but its damage was not used. The least expansive interpretation was to require a legal attack and useful connected targets; no storm split was forced.
- The run used a deterministic scoped helper around the existing deck engine to create snapshots and check movement/range/supply assertions. The initial deck state was created through the CLI.

## Evidence Quality

Evidence quality: full.

Rationale: `bun run validate-run -- .games/e006-center-vs-flank-b/timeline.json` passed with 16 entries, every completed turn has before/after deck and board snapshots, and the helper asserted movement distance, attack range, supply cost, recruit timing, and printed healing range while generating the board sequence.
