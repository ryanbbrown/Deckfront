# Balance search: Three-Way Open (smoke)

| Field | Value |
| --- | --- |
| Kingdom | Three-Way Open (`three-way-open`) |
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
| Started | 2026-08-18T14:06:55.667Z |
| Finished | 2026-08-18T14:07:35.331Z |
| Elapsed | 0.7 minutes |
| Stop reason | generations |
| Matches | 7780 (6460 evolution, 1320 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 196.1 matches/s |

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
| 1 | sg-de77e5881b5 (ranged-standard) | no | 0.718 | 220 | 0 |
| 2 | sg-55bd59341b5 | no | 0.686 | 220 | 0 |
| 3 | sg-0b70313b1ce | no | 0.650 | 220 | 0 |
| 4 | sg-74d194931c0 | no | 0.641 | 220 | 0 |
| 5 | sg-293a3b381ab | no | 0.636 | 220 | 0 |
| 6 | sg-6993982a1ce | yes | 0.636 | 220 | 0 |
| 7 | sg-67006f711dc | yes | 0.632 | 220 | 0 |
| 8 | sg-531064f51cd | yes | 0.586 | 220 | 0 |
| 9 | sg-4f9149781c1 (melee-rush) | no | 0.468 | 220 | 0 |
| 10 | sg-b43272151c9 (mage-standard) | no | 0.255 | 220 | 0 |
| 11 | sg-2a1da859176 (treasure-only) | no | 0.045 | 220 | 0 |
| 12 | sg-d3cd7238199 (engine-draw) | no | 0.045 | 220 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | de77e5881b5 | 55bd59341b5 | 0b70313b1ce | 74d194931c0 | 293a3b381ab | 6993982a1ce | 67006f711dc | 531064f51cd | 4f9149781c1 | b43272151c9 | 2a1da859176 | d3cd7238199 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| de77e5881b5 | — | 65.0% | 60.0% | 65.0% | 70.0% | 60.0% | 55.0% | 70.0% | 60.0% | 85.0% | 100.0% | 100.0% |
| 55bd59341b5 | 35.0% | — | 55.0% | 60.0% | 65.0% | 55.0% | 50.0% | 60.0% | 85.0% | 90.0% | 100.0% | 100.0% |
| 0b70313b1ce | 40.0% | 45.0% | — | 45.0% | 45.0% | 65.0% | 55.0% | 60.0% | 70.0% | 90.0% | 100.0% | 100.0% |
| 74d194931c0 | 35.0% | 40.0% | 55.0% | — | 40.0% | 55.0% | 50.0% | 60.0% | 80.0% | 90.0% | 100.0% | 100.0% |
| 293a3b381ab | 30.0% | 35.0% | 55.0% | 60.0% | — | 55.0% | 50.0% | 55.0% | 70.0% | 90.0% | 100.0% | 100.0% |
| 6993982a1ce | 40.0% | 45.0% | 35.0% | 45.0% | 45.0% | — | 55.0% | 70.0% | 70.0% | 95.0% | 100.0% | 100.0% |
| 67006f711dc | 45.0% | 50.0% | 45.0% | 50.0% | 50.0% | 45.0% | — | 40.0% | 75.0% | 95.0% | 100.0% | 100.0% |
| 531064f51cd | 30.0% | 40.0% | 40.0% | 40.0% | 45.0% | 30.0% | 60.0% | — | 70.0% | 90.0% | 100.0% | 100.0% |
| 4f9149781c1 | 40.0% | 15.0% | 30.0% | 20.0% | 30.0% | 30.0% | 25.0% | 30.0% | — | 95.0% | 100.0% | 100.0% |
| b43272151c9 | 15.0% | 10.0% | 10.0% | 10.0% | 10.0% | 5.0% | 5.0% | 10.0% | 5.0% | — | 100.0% | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 50.0% |
| d3cd7238199 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 660 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| volley | 3 of 3 | 2.45 |
| footwork | 3 of 3 | 1.89 |
| aim | 3 of 3 | 1.66 |
| channel | 3 of 3 | 0.77 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 3 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-6993982a1ce: ranged
- sg-67006f711dc: ranged
- sg-531064f51cd: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 7477 |
| Mean turns to win | 9.25 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 200453 | 43878 | 4.57 |
| arcBolt | 14289 | 4763 | 3.00 |
| heavyBlow | 13312 | 3328 | 4.00 |
| drive | 10068 | 3396 | 2.96 |
| fireball | 750 | 150 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 7221 |
| mana | 5533 |
| other | 0 |
| total | 12754 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 1320 | 60.2% |
| Ochre, swapSides false | 660 | 56.8% |
| Ochre, swapSides true | 660 | 47.7% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.863 | 33.5 | no |
| 2 | 1140 | 0 | 0.700 | 1.0 | no |
| 3 | 1140 | 0 | 0.733 | 1.3 | no |
| 4 | 1140 | 0 | 0.733 | 1.3 | no |
| 5 | 1140 | 0 | 0.767 | 1.2 | no |

## The top leaders

```
sg-de77e5881b5
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> footwork x2
  treasure: gold -> silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-55bd59341b5
  build: volley, aim, footwork
  agenda: volley x3 -> footwork x2 -> aim x3
  treasure: gold -> silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-0b70313b1ce
  build: volley, aim, footwork
  agenda: volley x3 -> footwork x2 -> channel x4 -> aim x3
  treasure: copper -> gold -> silver
  range: Close
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```
