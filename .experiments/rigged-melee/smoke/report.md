# Balance search: Rigged Melee (smoke)

| Field | Value |
| --- | --- |
| Kingdom | Rigged Melee (`rigged-melee`) |
| Mode | smoke |
| Run seed | 1 |
| Candidates | 20 |
| Leaders kept | 3 |
| Generations asked for | 5 |
| Generations run | 5 |
| Shared seeds | 5 |
| Turn limit per player | 100 |
| Action cap per turn | 200 |
| Action-search state limit | 20000 |
| Deadline | 30 minutes |
| Started | 2026-08-18T14:39:16.031Z |
| Finished | 2026-08-18T14:39:53.534Z |
| Elapsed | 0.6 minutes |
| Stop reason | generations |
| Matches | 7560 (6460 evolution, 1100 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 201.6 matches/s |
| Calibration (rigged melee) | FAIL |

## Calibration

This kingdom re-prices Heavy Blow to 3 money for 6 damage. The search is expected to find it. The
threshold, the kingdom, and its strategies are never tuned to make this pass.

| Check | Value |
| --- | --- |
| Result | FAIL |
| Top final leader | sg-bd7d52941b6 |
| Heavy Blow copies the top leader acquired, summed over its matches | 0 |
| Final leaders that acquired Heavy Blow | 0 of 3 |

## Seeding

This kingdom sells only part of what 4 of the five fixed baselines were built around, so those seeds enter generation 1 cut down. Generation-1 scores here carry less signal than later generations, which are measured against evolved leaders.

| Baseline | Build cards lost | Agenda entries lost | Left with no agenda |
| --- | --- | --- | --- |
| melee-rush | 0 | 1 | no |
| ranged-standard | 0 | 1 | no |
| mage-standard | 0 | 1 | no |
| engine-draw | 1 | 3 | no |

## Final ranking

Mean score per completed game in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Completed | Aborted |
| --- | --- | --- | --- | --- | --- |
| 1 | sg-bd7d52941b6 | yes | 0.750 | 200 | 0 |
| 2 | sg-95e0bd431b6 | yes | 0.730 | 200 | 0 |
| 3 | sg-d1c893491b5 | yes | 0.710 | 200 | 0 |
| 4 | sg-4f9149781c1 (melee-rush) | no | 0.680 | 200 | 0 |
| 5 | sg-ff358d161ce | no | 0.570 | 200 | 0 |
| 6 | sg-27cbf07b1b5 | no | 0.565 | 200 | 0 |
| 7 | sg-6653f7d21cd | no | 0.555 | 200 | 0 |
| 8 | sg-de77e5881b5 (ranged-standard) | no | 0.550 | 200 | 0 |
| 9 | sg-b43272151c9 (mage-standard) | no | 0.290 | 200 | 0 |
| 10 | sg-2a1da859176 (treasure-only) | no | 0.050 | 200 | 0 |
| 11 | sg-d3cd7238199 (engine-draw) | no | 0.050 | 200 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | bd7d52941b6 | 95e0bd431b6 | d1c893491b5 | 4f9149781c1 | ff358d161ce | 27cbf07b1b5 | 6653f7d21cd | de77e5881b5 | b43272151c9 | 2a1da859176 | d3cd7238199 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bd7d52941b6 | — | 60.0% | 60.0% | 35.0% | 80.0% | 85.0% | 80.0% | 65.0% | 85.0% | 100.0% | 100.0% |
| 95e0bd431b6 | 40.0% | — | 60.0% | 35.0% | 80.0% | 85.0% | 80.0% | 65.0% | 85.0% | 100.0% | 100.0% |
| d1c893491b5 | 40.0% | 40.0% | — | 35.0% | 80.0% | 85.0% | 80.0% | 65.0% | 85.0% | 100.0% | 100.0% |
| 4f9149781c1 | 65.0% | 65.0% | 65.0% | — | 50.0% | 35.0% | 50.0% | 50.0% | 100.0% | 100.0% | 100.0% |
| ff358d161ce | 20.0% | 20.0% | 20.0% | 50.0% | — | 45.0% | 60.0% | 65.0% | 90.0% | 100.0% | 100.0% |
| 27cbf07b1b5 | 15.0% | 15.0% | 15.0% | 65.0% | 55.0% | — | 55.0% | 55.0% | 90.0% | 100.0% | 100.0% |
| 6653f7d21cd | 20.0% | 20.0% | 20.0% | 50.0% | 40.0% | 45.0% | — | 70.0% | 90.0% | 100.0% | 100.0% |
| de77e5881b5 | 35.0% | 35.0% | 35.0% | 50.0% | 35.0% | 45.0% | 30.0% | — | 85.0% | 100.0% | 100.0% |
| b43272151c9 | 15.0% | 15.0% | 15.0% | 0.0% | 10.0% | 10.0% | 10.0% | 15.0% | — | 100.0% | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 50.0% |
| d3cd7238199 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 600 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| aim | 3 of 3 | 2.90 |
| volley | 3 of 3 | 2.38 |
| footwork | 3 of 3 | 1.26 |
| silver | 3 of 3 | 0.05 |
| gold | 2 of 3 | 0.00 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 3 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-bd7d52941b6: ranged
- sg-95e0bd431b6: ranged
- sg-d1c893491b5: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 7257 |
| Mean turns to win | 8.79 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 187921 | 41109 | 4.57 |
| heavyBlow | 23898 | 3983 | 6.00 |
| arcBolt | 14016 | 4672 | 3.00 |
| drive | 3508 | 1373 | 2.55 |
| fireball | 730 | 146 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 7057 |
| mana | 5328 |
| other | 0 |
| total | 12385 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 1100 | 58.9% |
| Ochre, swapSides false | 550 | 52.9% |
| Ochre, swapSides true | 550 | 54.4% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.875 | 32.2 | no |
| 2 | 1140 | 0 | 0.583 | 0.8 | no |
| 3 | 1140 | 0 | 0.717 | 1.2 | no |
| 4 | 1140 | 0 | 0.700 | 1.1 | no |
| 5 | 1140 | 0 | 0.725 | 1.1 | no |

## The top leaders

```
sg-bd7d52941b6
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> footwork x2
  treasure: gold -> silver
  range: Near
  weights: damage 10, preferredRange 3, cardsDrawn 1, moneyGained 3, trashed 2, reclaimed 0, discarded 1, unspentMana -5, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-95e0bd431b6
  build: volley, aim, footwork
  agenda: volley x4 -> aim x3 -> footwork x2
  treasure: gold -> silver
  range: Near
  weights: damage 10, preferredRange 3, cardsDrawn 1, moneyGained 3, trashed 2, reclaimed 0, discarded 1, unspentMana -5, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-d1c893491b5
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> footwork x2
  treasure: gold -> silver
  range: Near
  weights: damage 9, preferredRange 3, cardsDrawn 1, moneyGained 3, trashed 2, reclaimed 4, discarded 1, unspentMana -5, opponentOutOfAttackRange -1
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```
