# Balance search: Current Duel (smoke)

| Field | Value |
| --- | --- |
| Kingdom | Current Duel (`current-duel`) |
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
| Started | 2026-08-18T14:06:25.185Z |
| Finished | 2026-08-18T14:06:55.445Z |
| Elapsed | 0.5 minutes |
| Stop reason | generations |
| Matches | 8280 (6460 evolution, 1820 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 273.6 matches/s |

## Seeding

This kingdom sells only part of what 4 of the five fixed baselines were built around, so those seeds enter generation 1 cut down. Generation-1 scores here carry less signal than later generations, which are measured against evolved leaders.

| Baseline | Build cards lost | Agenda entries lost | Left with no agenda |
| --- | --- | --- | --- |
| melee-rush | 1 | 1 | no |
| ranged-standard | 0 | 1 | no |
| mage-standard | 3 | 4 | yes |
| engine-draw | 1 | 2 | no |

`mage-standard` seeded with no agenda at all, so it began the run with nothing to buy.

## Final ranking

Mean score per completed game in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Completed | Aborted |
| --- | --- | --- | --- | --- | --- |
| 1 | sg-de77e5881b5 (ranged-standard) | no | 0.727 | 260 | 0 |
| 2 | sg-2bb2839e1ae | no | 0.673 | 260 | 0 |
| 3 | sg-55bd59341b5 | no | 0.673 | 260 | 0 |
| 4 | sg-a3917d4b1ad | no | 0.658 | 260 | 0 |
| 5 | sg-626bc3261cd | no | 0.646 | 260 | 0 |
| 6 | sg-02e3125b19f | no | 0.615 | 260 | 0 |
| 7 | sg-1ec060fa19e | no | 0.615 | 260 | 0 |
| 8 | sg-4f9dae421cc | yes | 0.608 | 260 | 0 |
| 9 | sg-a40f61e319f | yes | 0.581 | 260 | 0 |
| 10 | sg-229699321b3 | yes | 0.577 | 260 | 0 |
| 11 | sg-724154e11b1 (melee-rush) | no | 0.396 | 260 | 0 |
| 12 | sg-2a1da859176 (treasure-only) | no | 0.077 | 260 | 0 |
| 13 | sg-6c25d960181 (mage-standard) | no | 0.077 | 260 | 0 |
| 14 | sg-6f878dab1a3 (engine-draw) | no | 0.077 | 260 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | de77e5881b5 | 2bb2839e1ae | 55bd59341b5 | a3917d4b1ad | 626bc3261cd | 02e3125b19f | 1ec060fa19e | 4f9dae421cc | a40f61e319f | 229699321b3 | 724154e11b1 | 2a1da859176 | 6c25d960181 | 6f878dab1a3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| de77e5881b5 | — | 60.0% | 65.0% | 60.0% | 60.0% | 75.0% | 60.0% | 60.0% | 60.0% | 55.0% | 90.0% | 100.0% | 100.0% | 100.0% |
| 2bb2839e1ae | 40.0% | — | 45.0% | 60.0% | 60.0% | 45.0% | 60.0% | 60.0% | 60.0% | 55.0% | 90.0% | 100.0% | 100.0% | 100.0% |
| 55bd59341b5 | 35.0% | 55.0% | — | 55.0% | 55.0% | 60.0% | 55.0% | 55.0% | 55.0% | 55.0% | 95.0% | 100.0% | 100.0% | 100.0% |
| a3917d4b1ad | 40.0% | 40.0% | 45.0% | — | 60.0% | 45.0% | 60.0% | 60.0% | 60.0% | 55.0% | 90.0% | 100.0% | 100.0% | 100.0% |
| 626bc3261cd | 40.0% | 40.0% | 45.0% | 40.0% | — | 50.0% | 65.0% | 60.0% | 60.0% | 50.0% | 90.0% | 100.0% | 100.0% | 100.0% |
| 02e3125b19f | 25.0% | 55.0% | 40.0% | 55.0% | 50.0% | — | 55.0% | 55.0% | 55.0% | 55.0% | 55.0% | 100.0% | 100.0% | 100.0% |
| 1ec060fa19e | 40.0% | 40.0% | 45.0% | 40.0% | 35.0% | 45.0% | — | 60.0% | 60.0% | 55.0% | 80.0% | 100.0% | 100.0% | 100.0% |
| 4f9dae421cc | 40.0% | 40.0% | 45.0% | 40.0% | 40.0% | 45.0% | 40.0% | — | 60.0% | 50.0% | 90.0% | 100.0% | 100.0% | 100.0% |
| a40f61e319f | 40.0% | 40.0% | 45.0% | 40.0% | 40.0% | 45.0% | 40.0% | 40.0% | — | 50.0% | 75.0% | 100.0% | 100.0% | 100.0% |
| 229699321b3 | 45.0% | 45.0% | 45.0% | 45.0% | 50.0% | 45.0% | 45.0% | 50.0% | 50.0% | — | 30.0% | 100.0% | 100.0% | 100.0% |
| 724154e11b1 | 10.0% | 10.0% | 5.0% | 10.0% | 10.0% | 45.0% | 20.0% | 10.0% | 25.0% | 70.0% | — | 100.0% | 100.0% | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 50.0% | 50.0% |
| 6c25d960181 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | — | 50.0% |
| 6f878dab1a3 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | 50.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 780 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| aim | 3 of 3 | 2.89 |
| volley | 3 of 3 | 2.43 |
| footwork | 3 of 3 | 1.14 |
| silver | 3 of 3 | 0.19 |
| flurry | 1 of 3 | 0.01 |
| gold | 2 of 3 | 0.01 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 3 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-4f9dae421cc: ranged
- sg-a40f61e319f: ranged
- sg-229699321b3: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 7567 |
| Mean turns to win | 8.42 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 227895 | 48196 | 4.73 |
| drive | 14642 | 3881 | 3.77 |
| flurry | 717 | 325 | 2.21 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 9717 |
| mana | 0 |
| other | 0 |
| total | 9717 |
| setup (not in total) | 111 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 1820 | 58.6% |
| Ochre, swapSides false | 910 | 53.6% |
| Ochre, swapSides true | 910 | 41.6% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.975 | 24.4 | no |
| 2 | 1140 | 0 | 0.700 | 1.0 | no |
| 3 | 1140 | 0 | 0.650 | 1.0 | no |
| 4 | 1140 | 0 | 0.650 | 0.9 | no |
| 5 | 1140 | 0 | 0.700 | 0.9 | no |

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
sg-2bb2839e1ae
  build: volley, aim, footwork
  agenda: volley x3 -> aim x3 -> footwork x2
  treasure: silver
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
