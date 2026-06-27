# E002 Rush vs Engine B Notes

## Setup

- Ruleset: `territory-v1`.
- Map: `sketch-v1`.
- Board seed copied from `.games/territory-v1-playtest/snapshots/turn-001.before.board.json`.
- Deck seed: `202602` with the `territory-v1` default starting deck.
- P1 followed early damage/tempo buys and avoided Copper.
- P2 followed slower economy/engine buys and avoided Copper.

## Strategy

- P1 rushed east, northeast, center-north, center-center, and later southeast with scouts/raiders.
- P1 prioritized unit-count pressure over long engine pieces, buying cheap damage and tactical payload.
- P2 preserved units behind guardians and druids while buying Village/Peddler/Silver style economy.
- P2 stabilized the first rush wave by killing the damaged raider on turn 010.

## Rules Calls And Ambiguities

- Deck damage was interpreted conservatively as attack support, not free direct spell damage without a legal board attack.
- Recruits were allowed to act during the board phase in which they entered. The rules mention recruitment after capture in the high-level turn sequence but the recruitment section does not explicitly forbid same-turn movement, so this should be reviewed.
- Druid printed heal was not used as automatic healing because timing and targeting are not specified.
- A P2 produced damage point on turn 008 was used only as support on an existing legal scout attack.

## Stopping Point

- Stopped after 13 completed player turns.
- P1 leads 9 living units to 6 at the beginning of P2 turn 014, satisfying the 3-unit lead win condition.
- P1 controls four centers at the stop: east, northeast, center-north, and southeast. P2 controls west-south, center-center, and center-south.

## Evidence Quality

- Evidence quality: full for replay-bundle structure after validation.
- Strategic evidence caveat: same-turn recruit movement/action is material and should be checked by review. If that interpretation is rejected, downgrade this run to partial.
