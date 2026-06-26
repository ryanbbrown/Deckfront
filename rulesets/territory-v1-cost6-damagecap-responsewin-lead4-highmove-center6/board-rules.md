# Territory V1 Cost 6 Damage Cap Response Win Lead 4 High Movement Center 6 Rules

This is a high-movement anti-grind variant of `territory-v1-cost6-damagecap-responsewin-lead4` for E024 playtests. It keeps the same cards, timing, recruit cost 6, normal income, deck-damage cap, high movement values, and lead-4 response-window unit-count win condition. It adds a late six-center dominance response-window win to test whether strong sustained territory control can resolve long replacement grinds without returning to cheap early five-center wins.

## Source Files

- Map: `maps/sketch-v5-recenter.json`
- Sample run state: `.games/territory-v1-playtest/board.json`
- Units: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6/units.json`
- Deck config: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6/deck.yaml`

The current sketch map has 8 supply centers.

## Turn Structure

Each player turn has a deck phase and a board phase.

1. At the beginning of the active player's turn, check whether that player wins by a confirmed unit-count lead or confirmed late six-center dominance threat, as defined in Win Condition.
2. Optionally trash one card from the active player's hand before using cards this turn.
3. Resolve the active player's deck choices using the CLI.
4. Use the deck-produced board counters for this turn.
5. Resolve the board phase in this order:
   - Gain supply income.
   - Move existing ready units and resolve supply-center captures.
   - Apply deck-produced permanent upgrades.
   - Resolve attacks and deck-produced attack counters.
   - Resolve deck-produced healing and printed unit healing.
   - Recruit units into empty home-base hexes.
6. Save the resulting board state and advance to the next player.

Deck counters such as `damage`, `heal`, `upgradeHealth`, `upgradeDamage`, `reattack`, and `stormTargets` are turn resources. They do not persist unless a future ruleset explicitly says they do.

Units recruited this turn are not ready. They cannot move, attack, heal, capture supply centers, or be selected for `reattack` until their controller's next board phase.

## Deck Start

At the start of each turn, the active player may trash one card from hand before playing actions or moving to the buy phase. The trashed card goes to the shared deck trash and cannot be played, spent, discarded, or otherwise used that turn.

The initial deck is fixed for this high-movement six-center variant: each player starts with 7 Coppers plus up to 12 coin to draft additional starting cards before turn 1. Unspent draft coin carries over as one-time deck money on that player's first turn.

Do not force the initial draft to spend exactly 12 coin. It is acceptable to leave coin unspent if that produces a more coherent opening deck because the unspent coin remains available on the player's first deck turn. If a playtest uses a different initial draft budget or a fixed starting deck, record that in the run notes and downgrade that run's evidence quality.

## Win Conditions

A player wins at the beginning of their turn if they have a confirmed 4-unit lead or a confirmed late six-center dominance threat.

### Unit-Count Lead

Unit-count lead confirmation works as a response window:

1. At the beginning of a player's turn, count living units.
2. If the active player has at least 4 more living units than the opponent and already had that same pending lead after the opponent's previous completed turn, the active player wins immediately.
3. If the active player has at least 4 more living units but the lead is not already pending, record a pending unit-count win threat for that player and continue the turn normally.
4. The opponent then gets a full turn to reduce the lead below 4.
5. If the lead is reduced below 4 before the threatened player's next start-of-turn check, the pending threat is cleared.

The board schema has no field for pending win threats. During playtests, record pending threats in the relevant `timeline.json` reasoning and in `notes.md`.

Examples:

- P1 starts a turn at 7 units vs 3 units with no pending threat: P1 records a pending win threat, but does not win yet.
- P2 then recruits or kills enough to make the count 7 vs 4: the pending P1 threat is cleared.
- P1 later starts a turn at 8 units vs 4 units, after P2 failed to reduce the prior pending lead: P1 wins.
- 6 units vs 3 units never creates a pending threat because the lead is only 3.

The check happens before income, movement, combat, capture, or recruitment. This gives the opponent one full turn to respond after a player creates a 4-unit lead.

If both players somehow satisfy a win condition at the same start-of-turn check, the active player wins.

### Late Six-Center Dominance

Late six-center dominance confirmation also works as a response window:

1. At the beginning of a player's turn, after at least 18 completed player turns have already been recorded, count controlled supply centers and living units.
2. If the active player controls at least 6 of the 8 supply centers and is not behind by 3 or more living units, record a pending six-center dominance threat for that player if one is not already pending.
3. If the active player already had that same pending six-center dominance threat after the opponent's previous completed turn, and still controls at least 6 centers while not behind by 3 or more living units, the active player wins immediately.
4. The opponent gets a full turn to clear the threat by reducing the threatened player's control below 6 centers or moving at least 3 living units ahead.
5. If either clear condition is met before the threatened player's next start-of-turn check, the pending six-center dominance threat is cleared.

Examples:

- P2 starts turn 21 controlling 6 centers while down 9 units to 10 and no pending six-center dominance threat: P2 records a pending threat, then continues the turn.
- P1 then flips one center so P2 controls only 5 centers: the pending P2 six-center dominance threat is cleared.
- P2 later starts a turn still controlling 6 centers and not behind by 3 or more units after P1 failed to clear the prior pending threat: P2 wins.
- Before 18 completed player turns, 6 centers never creates a six-center dominance threat. Early high-water center spikes must convert through normal play.

## Units And Starting HP

Each player starts with four units of their choosing before turn 1. Place those units on the four hexes of that player's home base, with at most one unit per hex.

Units start at their max HP and use the high-movement values from `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6/units.json`.

Current unit definitions:

| Unit | Role | Attack | HP | Movement | Range | Heal |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| guardian | melee | 4 | 16 | 2 | - | - |
| raider | melee | 6 | 8 | 4 | - | - |
| marksman | ranged | 4 | 8 | 2 | 2 | - |
| scout | ranged | 2 | 8 | 5 | 2 | - |
| druid | mage | 4 | 10 | 2 | - | 1 |
| healer | mage | 1 | 4 | 2 | 2 | 1 |

All recruitable units cost the same amount. The v0 balance goal is that units are situational alternatives, not a costed tech ladder.

## Income And Recruitment

Each player has a persistent board resource called supply.

At the start of a player's board phase, that player gains:

```text
2 + number of supply centers controlled by that player
```

Recruitment costs 6 supply per unit.

Players may recruit any number of units per turn if they can pay for them and have legal spawn spaces.

Recruited units enter on empty hexes in that player's home base. If there are no empty home-base hexes, that player cannot recruit until a home-base hex is empty.

Recruited units are delayed as defined in Turn Structure. They enter at the end of the board phase and cannot act or capture until the next friendly board phase.

Deck money is separate from board supply. Deck money buys cards; board supply recruits units.

Track each player's saved board supply in board state under `supply`.

## Supply Centers

A supply center is controlled by the last player to end a unit's board movement on that center.

Control persists after the unit leaves.

An enemy unit can flip a controlled supply center by ending movement on it.

Supply centers affect income only. They are not the direct win condition in v0.

## Movement

Each unit may move once per board phase, up to its movement value.

Current movement values:

| Unit | Movement |
| --- | ---: |
| guardian | 2 |
| raider | 4 |
| marksman | 2 |
| scout | 5 |
| druid | 2 |
| healer | 2 |

Movement uses the active map's coordinate system. `maps/sketch-v5-recenter.json` uses flat-top, odd-column offset coordinates:

- `col` increases from west to east.
- `row` increases from north to south.
- Odd-numbered columns are shifted half a hex south.

Direction offsets depend on whether the moving unit starts in an even or odd column:

| Direction | Even column change | Odd column change |
| --- | --- | --- |
| north | `col + 0, row - 1` | `col + 0, row - 1` |
| northeast | `col + 1, row - 1` | `col + 1, row + 0` |
| southeast | `col + 1, row + 0` | `col + 1, row + 1` |
| south | `col + 0, row + 1` | `col + 0, row + 1` |
| southwest | `col - 1, row + 0` | `col - 1, row + 1` |
| northwest | `col - 1, row - 1` | `col - 1, row + 0` |

For multi-hex movement, count the shortest legal path through adjacent map hexes. Do not count paths through blocked hexes or occupied enemy hexes.

Rules:

- A unit may move fewer hexes than its movement value.
- A unit may stay in place.
- Only one unit may occupy a hex.
- A unit cannot move through an occupied enemy hex.
- A unit cannot end movement on an occupied hex.
- No terrain or zone-of-control rules exist in v0.

## Combat

Each unit may attack once during its player's board phase.

Melee units attack adjacent enemy units.

Units with a `range` value may attack enemy units within that many hexes.

An attack deals damage equal to the attacker's attack value. Units at 0 HP are removed from the board.

A unit may move and then attack in the same board phase.

Recruited units cannot move, attack, heal, capture, or reattack during the board phase in which they enter.

## Printed Unit Healing

Units with a `heal` value may heal instead of attacking. A healing unit may move before healing.

Rules:

- Printed unit healing happens after attacks.
- A unit may either attack or use printed healing, not both.
- A unit may heal itself or one living friendly unit.
- If the healer unit has a `range` value, it may heal within that range.
- If the healer unit has no `range` value, it may heal itself or an adjacent friendly unit.
- Printed healing restores HP equal to the unit's `heal` value, capped at the target's `maxHp`.
- Printed healing cannot revive removed units.

## Deck Counter Mapping

Deck counters modify the board phase for the current active player.

Suggested v0 interpretation:

| Counter | Board meaning |
| --- | --- |
| `damage` | Extra damage that may be assigned to legal attacks this turn, capped at 1 extra deck damage per attacking unit. |
| `heal` | Healing that may be assigned to friendly units, up to max HP. |
| `upgradeHealth` | Permanently increase one living friendly unit's `maxHp` by this amount. Also heal that unit by the same amount. |
| `upgradeDamage` | Permanently increase one living friendly unit's `attack` by this amount. |
| `reattack` | Allow one friendly unit to make one additional attack this turn. |
| `stormTargets` | If paired with damage, allow deck-produced damage to be split across up to that many connected occupied enemy hexes. |

If a counter's exact use is ambiguous during a playtest, the agent should choose the least expansive interpretation and record the decision in the timeline reasoning.

Deck `damage` must be attached to legal attacks made by ready friendly units. It is not global direct damage.

Damage cap:

- Each attacking unit may receive at most 1 extra deck-produced damage this turn.
- A unit's `reattack` attack counts as the same attacking unit for this cap.
- Unassigned deck damage expires at end of turn.
- This cap limits only deck-produced `damage`; it does not limit the unit's printed attack value or permanent `upgradeDamage`.

Storm targeting:

- Storm requires at least one legal attack target.
- The original legal attack target counts as one storm target.
- Additional storm targets must be occupied enemy hexes connected to the original target by adjacency.
- Total assigned deck damage cannot exceed the deck-produced `damage` amount.
- Each chosen storm target must receive at least 1 deck damage.
- Storm still obeys the damage cap: each attacking unit may assign at most 1 total deck-produced damage across all storm targets.
- Base unit attack damage applies only to the original legal attack target.

## Current Income Benchmarks

The current map has 8 supply centers.

With income equal to `2 + controlled supply centers` and recruits costing 6 supply:

| Center split | Income A | Income B | Recruit pace |
| --- | ---: | ---: | --- |
| 4 / 4 | 6 | 6 | Each player can recruit 1 unit per turn with no surplus. |
| 5 / 3 | 7 | 5 | Leader saves slowly; behind player recruits every other turn without savings. |
| 6 / 2 | 8 | 4 | Leader gets a steady surplus; behind player needs savings. |
| 7 / 1 | 9 | 3 | Leader approaches 3 recruits every 2 turns; behind player slows sharply. |
| 8 / 0 | 10 | 2 | Leader recruits most turns with surplus; behind player needs multiple turns. |

## Open Balance Questions

These are intentional v0 unknowns to evaluate through simulation:

- Whether the 3-unit lead should be checked only at start of turn or also after opponent elimination.
- Whether unrestricted multi-unit recruitment makes supply control too decisive.
- Whether initial deck drafting should use 7 Coppers and 12 coin or 6 Coppers and 15 coin.
- Whether deck `damage` should require an attacking unit or be assignable as direct spell damage.
- Whether the current asymmetric starter map gives P1 too much early supply access.
