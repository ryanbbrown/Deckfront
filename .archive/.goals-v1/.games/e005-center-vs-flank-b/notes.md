# E005 Center vs Flank B Notes

## Setup

- Ruleset: `territory-v1-locked`
- Map: `sketch-v2-access`
- Initial board: `.games/e005-access-starter.board.json`
- Deck seed: `5`
- Starting decks were initialized through the deck CLI before the first turn snapshot:
  - P1 center/upgrade-damage: `copper,copper,copper,copper,copper,copper,copper,silver,training,blast`
  - P2 flank/control: `copper,copper,copper,copper,copper,copper,copper,village,potion,peddler`
- Setup caveat: these are fixed assigned starting decks rather than the locked ruleset's 7 Copper plus draft-coin procedure.

## Strategy

- P1 followed balanced economy into tactical damage/upgrades. Buys were Silver, Blast, Peddler, and no Copper. Board play prioritized the guardian/marksman core and used the first scout only for supported east pressure.
- P2 followed healing/control with flank pressure. Buys leaned heavily Potion after the Village/Peddler opener; no Copper was bought. Board play used scouts to take west-south, center-south, center, and southeast lanes, with raiders punishing isolated P1 units.
- Expected tension appeared: P1 still reached a 4-center position, but P2 held 3 southern/flank centers and forced P1 to split the upgraded formation instead of safely snowballing the center.

## Rules Calls

- Locked timing was used: start-of-turn win check, optional trash, deck phase, supply income, movement/captures, upgrades, attacks, healing, then delayed recruitment.
- Recruits did not move, attack, heal, capture, or receive upgrades on the turn they entered.
- Deck damage was only attached to legal attacks by ready units. Produced damage that could not be legally assigned was left unused.
- Permanent P1 Training upgrades were tracked in board state:
  - `P1-guardian-1`: attack 4 to 5 on turn 3, then 5 to 6 on turn 13.
  - `P1-marksman-1`: attack 4 to 5 on turn 5.
  - `P1-guardian-2`: attack 4 to 5 on turn 9.
- P2 used printed support healing as the intended control identity. Healing was capped at max HP and never revived removed units.

## Ambiguities

- The official validator checks replay continuity/schema, not full movement/range legality. I checked the final board for duplicate occupied hexes and none were present.
- P2's deck produced more healing than could materially matter because many targets were full or dead. Timeline reasoning records the useful printed healing moments, but this run may still understate/overstate the control deck depending on future healing targeting conventions.
- Fixed starting decks were assigned by the prompt, but they differ from the locked draft-start framing. I would weight this as partial evidence on setup balance, while still useful for the center/flank map-access question.

## Stopping Point

- Stopped after 16 completed player turns with no winner.
- Final board: P1 leads 9 living units to 8 and controls 4 centers. P2 controls 3 centers; `center-northwest` remains neutral.
- No start-of-turn unit-count win has resolved. At the next check on P1 round 9, P1's unit lead is only 1, below the required 3.
- P1 is the leader, but P2's southern package remains active: `P2-scout-3`, `P2-scout-4`, `P2-raider-2`, `P2-raider-3`, `P2-druid-1`, and two healers keep the flank relevant.

## Evidence Quality

- Partial. The replay bundle validates and known interpretive calls are recorded, but the fixed assigned starting decks are a setup caveat under `territory-v1-locked`.
- Validation command: `bun run validate-run -- .games/e005-center-vs-flank-b/timeline.json`
- Validation result: `Valid replay bundle: E005 Center vs Flank B (16 entries)`
