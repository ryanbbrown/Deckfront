# E006 Center vs Flank A Notes

## Strategy Assignment

- P1 deck: balanced economy into tactical damage/upgrades. Buys followed Blast, Training, Silver, and Peddler priorities when legal; Copper was avoided.
- P1 board: contest central supply centers with a compact guardian/marksman core under `sketch-v2-access`, with delayed recruits and recruit cost 6.
- P1 unit priority: guardian/marksman core, scouts only for safe flips or necessary flank responses, and protection for upgraded guardians/marksmen.
- P2 deck: healing/control and opportunistic pressure. Buys followed Potion, Healer, Village, Peddler, Storm, and Silver when coherent; Copper was avoided.
- P2 board: use west/center-south and southeast/east lanes to force P1 to split away from the center.
- P2 unit priority: scouts for flank captures, druid/healer support using printed or deck healing when useful, and raiders to punish isolated units.

## Rules Calls

- Initialized the board with the exact requested command and starter board: `.games/e006-cost6-starter.board.json`.
- Initialized the deck state with the exact fixed starting decks from the prompt rather than the default ruleset starter deck.
- Used CLI deck snapshots for every completed player turn. The generator wrote before/after deck and board snapshots for all turns.
- Applied start-of-turn unit-lead checks before income or board actions. No active player satisfied the 3-unit lead check during the recorded turns.
- Applied board-phase order as income, movement/captures, permanent upgrades, attacks, healing, then delayed recruits.
- Recruits cost 6 supply. The cost change delayed both players' first recruits compared with E005: P1 first recruited on turn 5, and P2 first recruited on turn 6.
- Recruits were not moved, used for captures, attacks, healing, or reattacks on the turn they entered.
- Deck damage was only assigned as bonus damage on legal ready-unit attacks. It was not treated as direct global damage.
- Permanent damage upgrades were only applied on turns that produced `upgradeDamage`.
- Healing was capped at max HP and did not revive removed units.
- Movement used odd-column flat-top offsets and avoided blocked map hexes.

## Ambiguities

- The prompt's exact starting decks intentionally override the ruleset's normal draft language. I treated this as scenario setup, not a run error.
- Unused deck damage, healing, and upgrade counters were allowed to expire when no legal or strategically coherent assignment was used.
- The replay generator validates movement distance, occupied endpoints, home-base recruits, cost-6 supply spend, attack range, and deck counter budgets for damage bonuses, healing, and upgrades. Tactical intent still lives in the timeline reasoning.

## Stopping Point

Stopped after 16 completed player turns, with both players having taken eight turns.

- Next active player: P1, round 9.
- Winner: none yet.
- Unit count: P1 has 7 living units; P2 has 6.
- Center control: P1 controls center-center-north, center-center, center-northeast, and center-east. P2 controls center-west-south, center-center-south, and center-southeast. Center-northwest is uncontrolled.
- Saved board supply: P1 has 2; P2 has 4.
- Board leader: P1, by one unit, one center, and next-turn initiative. P2 still has a live raider near the east lane and support units on the southern flank.
- Design signal: recruit cost 6 preserved the E005 center/flank split while slowing the supply-to-body snowball. The delayed recruits gave P2 time to keep flank pressure active, but P1 still ended ahead through upgraded central bodies and east recapture.

## Evidence Quality

Evidence quality: full.

The bundle validates with `bun run validate-run -- .games/e006-center-vs-flank-a/timeline.json`, includes before/after deck and board snapshots for every completed turn, records the fixed-deck setup caveat, and documents the material rules calls. No known legality issue remains after rerunning with cost-6 recruit checks and deck-counter budget checks enabled in the generator.
