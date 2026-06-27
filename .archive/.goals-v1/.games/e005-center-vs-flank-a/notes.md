# E005 Center vs Flank A Notes

## Strategy Assignment

- P1 deck: balanced economy into tactical damage/upgrades. Buy priority followed Silver, Peddler, Blast, and Training when legal; Copper was avoided.
- P1 board: contest central supply centers with a compact guardian/marksman core. Scouts were used only for safe flips or tempo captures, and upgraded units were kept protected where possible.
- P1 unit priority: guardian/marksman core, with scouts treated as expendable capture tools.
- P2 deck: healing/control and opportunistic pressure. Buy priority followed Potion, Healer, Village, Peddler, Storm, and Silver when coherent; Copper was avoided.
- P2 board: use the west/center-south and southeast lanes to pull P1 away from the center.
- P2 unit priority: scouts for flank captures, healer/druid support where healing was useful, and raiders to punish isolated units.

## Rules Calls

- Used the exact fixed starting decks from the prompt rather than the default ruleset starting deck or a 12-coin draft.
- Used CLI deck snapshots for every completed player turn. Board snapshots were generated after applying the board phase.
- Applied start-of-turn unit-lead checks before income or board actions. No player reached a legal 3-unit lead win check during the recorded turns.
- Applied board-phase order as income, movement/captures, permanent upgrades, attacks, healing, then delayed recruits.
- Recruits were not moved, used for captures, attacks, healing, or reattacks on the turn they entered.
- Deck damage was only applied as bonus damage on legal ready-unit attacks. It was not treated as direct global damage.
- Printed healing and deck healing were capped at max HP and did not revive removed units.
- Movement used odd-column flat-top offsets and avoided blocked map hexes, including the sketch-v2-access block at `3,5`.

## Ambiguities

- The prompt's exact starting decks intentionally override the locked ruleset's normal draft language. I treated this as scenario setup, not a rules error.
- Unused deck heal was allowed to expire when no friendly damaged unit made tactical sense to heal.
- The replay generator validates movement distance, occupied endpoints, home-base recruits, supply spend, and attack range, but it still relies on the timeline reasoning for tactical intent and counter assignment.

## Stopping Point

Stopped after 16 completed player turns, with both players having taken eight turns.

- Next active player: P1, round 9.
- Unit count: P1 has 6 living units; P2 has 7.
- Center control: P1 controls center-center-north, center-center, and center-northeast. P2 controls center-west-south, center-center-south, and center-southeast. Center-northwest and center-east are uncontrolled.
- Saved board supply: P1 has 12; P2 has 2.
- Board leader: slight P2 unit-count edge after reloading the flank, but P1 has stronger upgraded central units and more saved supply.
- No winner yet. The position remains strategically live and tests the expected center/flank tension.

## Evidence Quality

Evidence quality: full.

The bundle validates with `bun run validate-run -- .games/e005-center-vs-flank-a/timeline.json`, has before/after deck and board snapshots for each completed turn, records fixed-deck setup, and notes the material rules calls. No known legality issue remains after correcting a blocked-hex staging move and an over-budget recruit during generation.
