# Territory V0 Rules

This is the initial rules contract for LLM playtests and simulation agents. It is expected to change after playtesting.

## Source Files

- Map: `maps/sketch-v1.json`
- Sample run state: `.games/territory-v1-playtest/board.json`
- Units: `rulesets/territory-v1/units.json`
- Deck config: `rulesets/territory-v1/deck.yaml`

The current sketch map has 8 supply centers.

## Turn Structure

Each player turn has a deck phase and a board phase.

1. Resolve the active player's deck choices using the CLI.
2. Use the deck-produced board counters for this turn.
3. Resolve board movement, combat, capture, and recruitment.
4. Save the resulting board state and advance to the next player.

Deck counters such as `damage`, `heal`, `bonusHp`, `bonusAttack`, `reattack`, and `stormTargets` are turn resources. They do not persist unless a future ruleset explicitly says they do.

## Win Condition

A player wins at the beginning of their turn if they have at least 3 more living units than their opponent.

Examples:

- 6 units vs 3 units: win.
- 5 units vs 2 units: win.
- 5 units vs 3 units: no win.

The check happens before income, movement, combat, capture, or recruitment. This gives the opponent one full turn to respond after a player creates a 3-unit lead.

If both players somehow satisfy a win condition at the same start-of-turn check, the active player wins.

## Units And Starting HP

Units start at their max HP from `rulesets/territory-v1/units.json`.

Current unit definitions:

| Unit | Role | Attack | HP | Movement | Range | Heal |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| guardian | melee | 4 | 16 | 1 | - | - |
| raider | melee | 6 | 8 | 2 | - | - |
| marksman | ranged | 4 | 8 | 1 | 2 | - |
| scout | ranged | 2 | 8 | 3 | 2 | - |
| druid | mage | 4 | 10 | 1 | - | 1 |
| healer | mage | 1 | 4 | 1 | 2 | 1 |

All recruitable units cost the same amount. The v0 balance goal is that units are situational alternatives, not a costed tech ladder.

## Income And Recruitment

Each player has a persistent board resource called supply.

At the start of a player's board phase, that player gains:

```text
2 + number of supply centers controlled by that player
```

Recruitment costs 5 supply per unit.

Players may recruit any number of units per turn if they can pay for them and have legal spawn spaces.

Recruited units enter on empty hexes in that player's home base. If there are no empty home-base hexes, that player cannot recruit until a home-base hex is empty.

Deck money is separate from board supply. Deck money buys cards; board supply recruits units.

Until board snapshots have a first-class supply field, playtest agents should track each player's saved supply in timeline entries or run notes rather than adding unsupported fields to board JSON.

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
| guardian | 1 |
| raider | 2 |
| marksman | 1 |
| scout | 3 |
| druid | 1 |
| healer | 1 |

Movement uses axial hex adjacency on the active map.

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

## Deck Counter Mapping

Deck counters modify the board phase for the current active player.

Suggested v0 interpretation:

| Counter | Board meaning |
| --- | --- |
| `damage` | Extra damage that may be assigned to legal attacks this turn. |
| `heal` | Healing that may be assigned to friendly units, up to max HP. |
| `bonusHp` | Temporary or persistent HP bonus, pending playtest decision. Prefer persistent only if written into board state. |
| `bonusAttack` | Add this much attack to one friendly unit this turn. |
| `reattack` | Allow one friendly unit to make one additional attack this turn. |
| `stormTargets` | If paired with damage, allow that damage to affect two connected occupied enemy hexes. |

If a counter's exact use is ambiguous during a playtest, the agent should choose the least expansive interpretation and record the decision in the timeline reasoning.

## Current Income Benchmarks

The current map has 8 supply centers.

With income equal to `2 + controlled supply centers` and recruits costing 5 supply:

| Center split | Income A | Income B | Recruit pace |
| --- | ---: | ---: | --- |
| 4 / 4 | 6 | 6 | Each player can recruit 1 unit per turn, with 1 supply saved. |
| 5 / 3 | 7 | 5 | Leader saves faster; both can recruit at least 1 unit per turn. |
| 6 / 2 | 8 | 4 | Leader approaches 2 units per turn; behind player needs savings. |
| 7 / 1 | 9 | 3 | Leader nearly reaches 2 units per turn; behind player slows. |
| 8 / 0 | 10 | 2 | Leader can recruit 2 units per turn. |

## Open Balance Questions

These are intentional v0 unknowns to evaluate through simulation:

- Whether the 3-unit lead should be checked only at start of turn or also after opponent elimination.
- Whether unrestricted multi-unit recruitment makes supply control too decisive.
- Whether `bonusHp` should be temporary or persistent.
- Whether deck `damage` should require an attacking unit or be assignable as direct spell damage.
- Whether the current asymmetric starter map gives P1 too much early supply access.
