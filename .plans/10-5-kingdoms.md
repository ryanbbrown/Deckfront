# Step 5: the five kingdoms and calibration checks

Implements step 5 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on steps 2 and 4.

## Objective

The five approved kingdoms exist as committed data, and the rigged-melee calibration check runs as code.

## Kingdoms

Cull, Copper, Silver, and Gold are available in every kingdom and are not listed as piles. Step, Strike, and Shot are in no initial kingdom. Every action pile holds ten cards.

| Id | Name | Health | Piles |
| --- | --- | ---: | --- |
| `current-duel` | Current duel | 20 | Footwork, Muster, Feint, Drive, Flurry, Aim, Volley, Adapt |
| `three-way-open` | Three-way open | 20 | Footwork, Stipend, Drive, Heavy Blow, Aim, Volley, Channel, Ley Step, Arc Bolt, Fireball |
| `three-way-engine` | Three-way engine | 30 | Footwork, Muster, Stipend, Reclaim, Adapt, Heavy Blow, Steady Shot, Channel, Prism, Fireball |
| `range-rich-mixed` | Range-rich mixed | 20 | Footwork, Adapt, Quick Shot, Steady Shot, Aim, Volley, Drive, Heavy Blow, Channel, Arc Bolt |
| `rigged-melee` | Rigged melee | 20 | Same piles as `three-way-open`, with Heavy Blow overridden to cost 3 and damage 6 |

`current-duel` has eight piles. The rest have ten. This is intended: `current-duel` keeps the current duel market.

`rigged-melee` is a calibration fixture. Its Heavy Blow override is not a proposed card value.

## Expectations

Only rigged melee is a hard check. The others are findings.

- Current duel: explore revised melee against ranged play.
- Three-way open: no outcome is assumed.
- Three-way engine: test whether longer games reward deck improvement and combinations.
- Range-rich mixed: expect ranged cards to appear most often. This is a broad expectation, not a fixed win-rate requirement.

## Rigged melee calibration check

The check passes when either condition is true:

- the top strategy in the final round-robin buys at least one Heavy Blow;
- at least 80 percent of the final leaders buy at least one Heavy Blow.

Implement it as a function over a tournament result, so the experiment run reports pass or fail with its numbers. It must read the leaders' actual purchases, not their agendas: an agenda entry that was never affordable is not a purchase.

If the check fails after the repair cap in `GOAL.md`, record it as a blocker with its numbers in `PROGRESS.md` and stop. Do not tune the threshold, the kingdom, or the strategies to make it pass.

## Files expected to change

| File | Change |
| --- | --- |
| `src/game-data/kingdoms.json` | The five kingdoms. |
| `src/sim/calibration.ts` | New. The rigged-melee check over a tournament result. |
| `test/sim/kingdoms.test.ts` | New. |

## Checks

1. Each kingdom loads, has the listed piles at ten cards each, and offers Cull and three treasures.
2. `current-duel` has eight piles; the others have ten.
3. `three-way-engine` starts both fighters at 30 health.
4. `rigged-melee` sells Heavy Blow for 3, deals 6 damage with it, and leaves the canonical definition at cost 5 and damage 4.
5. `rigged-melee` and `three-way-open` have identical piles.
6. Step, Strike, and Shot are in no kingdom.
7. The calibration check passes a synthetic tournament whose top strategy bought Heavy Blow, passes one where 80 percent of leaders bought it, and fails one where neither holds.
8. The calibration check reads purchases, not agendas: a leader whose agenda names Heavy Blow but who never bought one does not count.

## Completion criterion

The five kingdoms exist as committed data with the approved values, the calibration check runs over a tournament result, the checks pass, and the four verification commands pass.
