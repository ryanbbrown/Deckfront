# Balance search: Range-Rich Mixed (smoke)

| Field | Value |
| --- | --- |
| Kingdom | Range-Rich Mixed (`range-rich-mixed`) |
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
| Started | 2026-08-18T14:38:55.040Z |
| Finished | 2026-08-18T14:39:15.814Z |
| Elapsed | 0.3 minutes |
| Stop reason | generations |
| Matches | 7560 (6460 evolution, 1100 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 363.9 matches/s |

## Seeding

This kingdom sells only part of what 3 of the five fixed baselines were built around, so those seeds enter generation 1 cut down. Generation-1 scores here carry less signal than later generations, which are measured against evolved leaders.

| Baseline | Build cards lost | Agenda entries lost | Left with no agenda |
| --- | --- | --- | --- |
| melee-rush | 0 | 1 | no |
| mage-standard | 1 | 2 | no |
| engine-draw | 2 | 2 | no |

## Final ranking

Mean score per completed game in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Completed | Aborted |
| --- | --- | --- | --- | --- | --- |
| 1 | sg-d6bc15ca1ce | yes | 0.730 | 200 | 0 |
| 2 | sg-453afb601dc | yes | 0.710 | 200 | 0 |
| 3 | sg-b209a9671cd | yes | 0.690 | 200 | 0 |
| 4 | sg-6bc2046a1c6 (ranged-standard) | no | 0.640 | 200 | 0 |
| 5 | sg-4f9149781c1 (melee-rush) | no | 0.610 | 200 | 0 |
| 6 | sg-cf74e2b71dd | no | 0.610 | 200 | 0 |
| 7 | sg-6922803a1bc | no | 0.605 | 200 | 0 |
| 8 | sg-1a37c7dc1d3 | no | 0.595 | 200 | 0 |
| 9 | sg-4b80192019e (engine-draw) | no | 0.185 | 200 | 0 |
| 10 | sg-d28eba9a1b0 (mage-standard) | no | 0.125 | 200 | 0 |
| 11 | sg-2a1da859176 (treasure-only) | no | 0.000 | 200 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | d6bc15ca1ce | 453afb601dc | b209a9671cd | 6bc2046a1c6 | 4f9149781c1 | cf74e2b71dd | 6922803a1bc | 1a37c7dc1d3 | 4b80192019e | d28eba9a1b0 | 2a1da859176 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d6bc15ca1ce | — | 60.0% | 60.0% | 65.0% | 35.0% | 60.0% | 75.0% | 75.0% | 100.0% | 100.0% | 100.0% |
| 453afb601dc | 40.0% | — | 60.0% | 65.0% | 35.0% | 60.0% | 75.0% | 75.0% | 100.0% | 100.0% | 100.0% |
| b209a9671cd | 40.0% | 40.0% | — | 65.0% | 35.0% | 60.0% | 75.0% | 75.0% | 100.0% | 100.0% | 100.0% |
| 6bc2046a1c6 | 35.0% | 35.0% | 35.0% | — | 60.0% | 55.0% | 60.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| 4f9149781c1 | 65.0% | 65.0% | 65.0% | 40.0% | — | 45.0% | 20.0% | 20.0% | 95.0% | 95.0% | 100.0% |
| cf74e2b71dd | 40.0% | 40.0% | 40.0% | 45.0% | 55.0% | — | 45.0% | 45.0% | 100.0% | 100.0% | 100.0% |
| 6922803a1bc | 25.0% | 25.0% | 25.0% | 40.0% | 80.0% | 55.0% | — | 55.0% | 100.0% | 100.0% | 100.0% |
| 1a37c7dc1d3 | 25.0% | 25.0% | 25.0% | 40.0% | 80.0% | 55.0% | 45.0% | — | 100.0% | 100.0% | 100.0% |
| 4b80192019e | 0.0% | 0.0% | 0.0% | 0.0% | 5.0% | 0.0% | 0.0% | 0.0% | — | 80.0% | 100.0% |
| d28eba9a1b0 | 0.0% | 0.0% | 0.0% | 0.0% | 5.0% | 0.0% | 0.0% | 0.0% | 20.0% | — | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 600 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| aim | 3 of 3 | 2.94 |
| volley | 3 of 3 | 2.33 |
| footwork | 3 of 3 | 1.00 |
| arcBolt | 2 of 3 | 0.25 |
| channel | 1 of 3 | 0.12 |
| steadyShot | 2 of 3 | 0.01 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 3 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-d6bc15ca1ce: ranged
- sg-453afb601dc: ranged
- sg-b209a9671cd: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 7476 |
| Mean turns to win | 9.38 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 180884 | 38771 | 4.67 |
| steadyShot | 20649 | 6883 | 3.00 |
| arcBolt | 14232 | 4744 | 3.00 |
| heavyBlow | 13288 | 3322 | 4.00 |
| drive | 11344 | 3737 | 3.04 |
| quickShot | 1728 | 1728 | 1.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 7634 |
| mana | 4355 |
| other | 0 |
| total | 11989 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 1100 | 61.7% |
| Ochre, swapSides false | 550 | 52.9% |
| Ochre, swapSides true | 550 | 47.6% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.900 | 15.9 | no |
| 2 | 1140 | 0 | 0.667 | 0.9 | no |
| 3 | 1140 | 0 | 0.633 | 1.0 | no |
| 4 | 1140 | 0 | 0.683 | 1.1 | no |
| 5 | 1140 | 0 | 0.675 | 0.9 | no |

## The top leaders

```
sg-d6bc15ca1ce
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> arcBolt x2 -> steadyShot x2 -> footwork x2
  treasure: silver
  range: Near
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-453afb601dc
  build: volley, aim, footwork
  agenda: volley x6 -> aim x3 -> channel x4 -> arcBolt x2 -> steadyShot x2 -> footwork x2
  treasure: silver
  range: Near
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -3, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-b209a9671cd
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> arcBolt x2 -> steadyShot x2 -> footwork x2
  treasure: silver
  range: Near
  weights: damage 9, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 6, discarded 1, unspentMana -1, opponentOutOfAttackRange -1
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```
