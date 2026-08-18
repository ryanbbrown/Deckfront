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
| Started | 2026-08-18T14:08:33.201Z |
| Finished | 2026-08-18T14:08:55.067Z |
| Elapsed | 0.4 minutes |
| Stop reason | generations |
| Matches | 8280 (6460 evolution, 1820 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 378.7 matches/s |

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
| 1 | sg-6bc2046a1c6 (ranged-standard) | no | 0.688 | 260 | 0 |
| 2 | sg-6922803a1bc | no | 0.677 | 260 | 0 |
| 3 | sg-3c6722e81c6 | no | 0.673 | 260 | 0 |
| 4 | sg-1a37c7dc1d3 | no | 0.650 | 260 | 0 |
| 5 | sg-4bc02f9c1bf | no | 0.638 | 260 | 0 |
| 6 | sg-cf74e2b71dd | no | 0.627 | 260 | 0 |
| 7 | sg-0705a9b11cd | no | 0.604 | 260 | 0 |
| 8 | sg-d6bc15ca1ce | yes | 0.565 | 260 | 0 |
| 9 | sg-4f9149781c1 (melee-rush) | no | 0.554 | 260 | 0 |
| 10 | sg-453afb601dc | yes | 0.550 | 260 | 0 |
| 11 | sg-b209a9671cd | yes | 0.535 | 260 | 0 |
| 12 | sg-4b80192019e (engine-draw) | no | 0.142 | 260 | 0 |
| 13 | sg-d28eba9a1b0 (mage-standard) | no | 0.096 | 260 | 0 |
| 14 | sg-2a1da859176 (treasure-only) | no | 0.000 | 260 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | 6bc2046a1c6 | 6922803a1bc | 3c6722e81c6 | 1a37c7dc1d3 | 4bc02f9c1bf | cf74e2b71dd | 0705a9b11cd | d6bc15ca1ce | 4f9149781c1 | 453afb601dc | b209a9671cd | 4b80192019e | d28eba9a1b0 | 2a1da859176 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6bc2046a1c6 | — | 60.0% | 60.0% | 60.0% | 60.0% | 55.0% | 60.0% | 60.0% | 60.0% | 60.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| 6922803a1bc | 40.0% | — | 40.0% | 55.0% | 60.0% | 55.0% | 60.0% | 65.0% | 75.0% | 65.0% | 65.0% | 100.0% | 100.0% | 100.0% |
| 3c6722e81c6 | 40.0% | 60.0% | — | 60.0% | 60.0% | 55.0% | 60.0% | 60.0% | 60.0% | 60.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| 1a37c7dc1d3 | 40.0% | 45.0% | 40.0% | — | 40.0% | 55.0% | 65.0% | 65.0% | 65.0% | 65.0% | 65.0% | 100.0% | 100.0% | 100.0% |
| 4bc02f9c1bf | 40.0% | 40.0% | 40.0% | 60.0% | — | 55.0% | 60.0% | 60.0% | 55.0% | 60.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| cf74e2b71dd | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | — | 45.0% | 65.0% | 50.0% | 65.0% | 65.0% | 100.0% | 100.0% | 100.0% |
| 0705a9b11cd | 40.0% | 40.0% | 40.0% | 35.0% | 40.0% | 55.0% | — | 60.0% | 55.0% | 60.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| d6bc15ca1ce | 40.0% | 35.0% | 40.0% | 35.0% | 40.0% | 35.0% | 40.0% | — | 50.0% | 60.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| 4f9149781c1 | 40.0% | 25.0% | 40.0% | 35.0% | 45.0% | 50.0% | 45.0% | 50.0% | — | 50.0% | 50.0% | 95.0% | 95.0% | 100.0% |
| 453afb601dc | 40.0% | 35.0% | 40.0% | 35.0% | 40.0% | 35.0% | 40.0% | 40.0% | 50.0% | — | 60.0% | 100.0% | 100.0% | 100.0% |
| b209a9671cd | 40.0% | 35.0% | 40.0% | 35.0% | 40.0% | 35.0% | 40.0% | 40.0% | 50.0% | 40.0% | — | 100.0% | 100.0% | 100.0% |
| 4b80192019e | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 5.0% | 0.0% | 0.0% | — | 80.0% | 100.0% |
| d28eba9a1b0 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 5.0% | 0.0% | 0.0% | 20.0% | — | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 780 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| aim | 3 of 3 | 2.83 |
| volley | 3 of 3 | 2.42 |
| footwork | 3 of 3 | 1.01 |
| arcBolt | 2 of 3 | 0.25 |
| channel | 1 of 3 | 0.13 |
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
| Games with a winner | 8196 |
| Mean turns to win | 9.18 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 203362 | 43416 | 4.68 |
| steadyShot | 21477 | 7159 | 3.00 |
| arcBolt | 14787 | 4929 | 3.00 |
| heavyBlow | 13536 | 3384 | 4.00 |
| drive | 11588 | 3832 | 3.02 |
| quickShot | 1728 | 1728 | 1.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 7937 |
| mana | 4540 |
| other | 0 |
| total | 12477 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 1820 | 60.7% |
| Ochre, swapSides false | 910 | 58.0% |
| Ochre, swapSides true | 910 | 44.7% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.900 | 16.3 | no |
| 2 | 1140 | 0 | 0.667 | 0.9 | no |
| 3 | 1140 | 0 | 0.633 | 1.1 | no |
| 4 | 1140 | 0 | 0.683 | 1.1 | no |
| 5 | 1140 | 0 | 0.675 | 1.0 | no |

## The top leaders

```
sg-6bc2046a1c6
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> steadyShot x2 -> footwork x2
  treasure: gold -> silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-6922803a1bc
  build: volley, aim, footwork
  agenda: volley x3 -> steadyShot x2 -> footwork x2
  treasure: gold -> silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-3c6722e81c6
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> footwork x2 -> steadyShot x2
  treasure: gold -> silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```
