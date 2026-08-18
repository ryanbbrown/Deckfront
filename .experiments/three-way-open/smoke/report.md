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
| Started | 2026-08-18T14:37:25.348Z |
| Finished | 2026-08-18T14:38:04.205Z |
| Elapsed | 0.6 minutes |
| Stop reason | generations |
| Matches | 7360 (6460 evolution, 900 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 189.4 matches/s |

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
| 1 | sg-67006f711dc | yes | 0.822 | 180 | 0 |
| 2 | sg-531064f51cd | yes | 0.744 | 180 | 0 |
| 3 | sg-6993982a1ce | yes | 0.700 | 180 | 0 |
| 4 | sg-de77e5881b5 (ranged-standard) | no | 0.628 | 180 | 0 |
| 5 | sg-55bd59341b5 | no | 0.600 | 180 | 0 |
| 6 | sg-0b70313b1ce | no | 0.594 | 180 | 0 |
| 7 | sg-4f9149781c1 (melee-rush) | no | 0.511 | 180 | 0 |
| 8 | sg-b43272151c9 (mage-standard) | no | 0.289 | 180 | 0 |
| 9 | sg-2a1da859176 (treasure-only) | no | 0.056 | 180 | 0 |
| 10 | sg-d3cd7238199 (engine-draw) | no | 0.056 | 180 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | 67006f711dc | 531064f51cd | 6993982a1ce | de77e5881b5 | 55bd59341b5 | 0b70313b1ce | 4f9149781c1 | b43272151c9 | 2a1da859176 | d3cd7238199 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 67006f711dc | — | 80.0% | 70.0% | 70.0% | 80.0% | 80.0% | 65.0% | 95.0% | 100.0% | 100.0% |
| 531064f51cd | 20.0% | — | 70.0% | 70.0% | 70.0% | 70.0% | 80.0% | 90.0% | 100.0% | 100.0% |
| 6993982a1ce | 30.0% | 30.0% | — | 65.0% | 75.0% | 70.0% | 65.0% | 95.0% | 100.0% | 100.0% |
| de77e5881b5 | 30.0% | 30.0% | 35.0% | — | 65.0% | 60.0% | 60.0% | 85.0% | 100.0% | 100.0% |
| 55bd59341b5 | 20.0% | 30.0% | 25.0% | 35.0% | — | 55.0% | 85.0% | 90.0% | 100.0% | 100.0% |
| 0b70313b1ce | 20.0% | 30.0% | 30.0% | 40.0% | 45.0% | — | 80.0% | 90.0% | 100.0% | 100.0% |
| 4f9149781c1 | 35.0% | 20.0% | 35.0% | 40.0% | 15.0% | 20.0% | — | 95.0% | 100.0% | 100.0% |
| b43272151c9 | 5.0% | 10.0% | 5.0% | 15.0% | 10.0% | 10.0% | 5.0% | — | 100.0% | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 50.0% |
| d3cd7238199 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 540 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| volley | 3 of 3 | 2.39 |
| footwork | 3 of 3 | 1.94 |
| aim | 3 of 3 | 1.67 |
| channel | 3 of 3 | 0.79 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 3 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-67006f711dc: ranged
- sg-531064f51cd: ranged
- sg-6993982a1ce: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 7057 |
| Mean turns to win | 9.35 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 187484 | 41100 | 4.56 |
| arcBolt | 13965 | 4655 | 3.00 |
| heavyBlow | 13088 | 3272 | 4.00 |
| drive | 9918 | 3338 | 2.97 |
| fireball | 740 | 148 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 6982 |
| mana | 5456 |
| other | 0 |
| total | 12438 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 900 | 59.0% |
| Ochre, swapSides false | 450 | 52.0% |
| Ochre, swapSides true | 450 | 50.4% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.863 | 33.3 | no |
| 2 | 1140 | 0 | 0.700 | 1.0 | no |
| 3 | 1140 | 0 | 0.733 | 1.3 | no |
| 4 | 1140 | 0 | 0.733 | 1.2 | no |
| 5 | 1140 | 0 | 0.767 | 1.2 | no |

## The top leaders

```
sg-67006f711dc
  build: volley, aim, footwork
  agenda: volley x3 -> aim x2 -> footwork x2 -> channel x4 -> fireball x1
  treasure: copper -> gold -> silver
  range: Near
  weights: damage 10, preferredRange 6, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-531064f51cd
  build: volley, aim, footwork
  agenda: volley x3 -> footwork x2 -> channel x4 -> aim x3
  treasure: copper -> gold -> silver
  range: Near
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-6993982a1ce
  build: volley, aim, footwork
  agenda: volley x3 -> aim x2 -> footwork x2 -> channel x4
  treasure: copper -> gold -> silver
  range: Close
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```
