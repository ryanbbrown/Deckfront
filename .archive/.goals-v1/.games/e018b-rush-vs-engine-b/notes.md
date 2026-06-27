# E018b Rush vs Engine B Notes

## Setup

- Run directory: `.games/e018b-rush-vs-engine-b/`.
- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e018-no-printheal-starter.board.json`.
- Deck setup followed `deck.yaml`: 5 Copper, 1 Zap, 1 Bandage, 3 Rest per player.

## Result

- Winner: P1.
- Completed player turns: 30, plus turn 31 start-check confirmation.
- Win type: confirmed lead-4 response-window unit-count win.
- Final count: P1 11 living units, P2 7 living units.
- Final centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 2, P2 0.

## Lead-4 Threat Handling

- P1 repeatedly reached four-unit end-turn leads, but P2 cleared them before P1 start checks through recruits and focused kills.
- Turn 29 / P1 start: P1 began 10 units to P2's 6 and recorded a pending lead-4 threat.
- Turn 30 / P2 response: P2 killed P1-scout-3 and recruited P2-guardian-9, but the final count was still P1 11 to P2 7.
- Turn 31 / P1 start: P1 confirmed the pending threat before taking any deck or board actions.

## Support And Healing Observations

- No printed unit healing was used. Druids and healers were treated only as bodies/attackers where present.
- Deck healing mattered. Bandage, Potion, Healer, and upgrade-health support repeatedly preserved P2 guardians or bought time.
- The absence of printed healing made damaged support bodies more punishable: P1 killed the upgraded druid on turn 13 and several guardians once deck healing was not immediately available.
- P2 still stabilized multiple rush spikes through deck healing and guardian recruitment, but could not keep up once P1 held a 5-2 center split and converted supply into double recruits.

## Evidence Quality

- Evidence quality: full for replay continuity and high-level strategic outcome.
- Tactical legality was assisted by the run-local helper, which checked movement distance, blocked/occupied hexes, attack range, deck-damage caps, deck healing totals, upgrade totals, and recruit costs/spawn hexes.
- The project validator checks replay schema/snapshots/continuity, not complete tactical legality.

## Rules Calls

- Pending lead-4 state has no board-schema field, so it is recorded in timeline reasoning and this notes file.
- Deck damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit.
- Excess deck damage expired.
- Storm target splash was not used; when Storm was played, only ordinary capped attack-bound deck damage was assigned.
