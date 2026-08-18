# Balance search: Current Duel (full)

| Field | Value |
| --- | --- |
| Kingdom | Current Duel (`current-duel`) |
| Mode | full |
| Run seed | 1 |
| Candidates | 100 |
| Leaders kept | 5 |
| Generations asked for | 32 |
| Generations run | 32 |
| Shared seeds | 25 |
| Turn limit per player | 100 |
| Action cap per turn | 200 |
| Action-search state limit | 20000 |
| Deadline | 150 minutes |
| Started | 2026-08-18T14:47:44.991Z |
| Finished | 2026-08-18T15:17:55.383Z |
| Elapsed | 30.2 minutes |
| Stop reason | generations |
| Matches | 1599300 (1584000 evolution, 15300 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 883.4 matches/s |

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
| 1 | sg-002ca7f21be | yes | 0.625 | 1700 | 0 |
| 2 | sg-00a241641b0 | yes | 0.619 | 1700 | 0 |
| 3 | sg-042f5f2d1ad | yes | 0.613 | 1700 | 0 |
| 4 | sg-0889c5881b6 | yes | 0.607 | 1700 | 0 |
| 5 | sg-0967f9d01be | yes | 0.601 | 1700 | 0 |
| 6 | sg-530490cf1b6 | no | 0.592 | 1700 | 0 |
| 7 | sg-24b747301b6 | no | 0.591 | 1700 | 0 |
| 8 | sg-dfef26fc1ab | no | 0.591 | 1700 | 0 |
| 9 | sg-3f19c9f51b4 | no | 0.587 | 1700 | 0 |
| 10 | sg-877756f91b4 | no | 0.579 | 1700 | 0 |
| 11 | sg-de77e5881b5 (ranged-standard) | no | 0.577 | 1700 | 0 |
| 12 | sg-68007ac51ab | no | 0.572 | 1700 | 0 |
| 13 | sg-2da98e931b7 | no | 0.571 | 1700 | 0 |
| 14 | sg-11b5590e1b7 | no | 0.565 | 1700 | 0 |
| 15 | sg-724154e11b1 (melee-rush) | no | 0.534 | 1700 | 0 |
| 16 | sg-2a1da859176 (treasure-only) | no | 0.059 | 1700 | 0 |
| 17 | sg-6c25d960181 (mage-standard) | no | 0.059 | 1700 | 0 |
| 18 | sg-6f878dab1a3 (engine-draw) | no | 0.059 | 1700 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | 002ca7f21be | 00a241641b0 | 042f5f2d1ad | 0889c5881b6 | 0967f9d01be | 530490cf1b6 | 24b747301b6 | dfef26fc1ab | 3f19c9f51b4 | 877756f91b4 | de77e5881b5 | 68007ac51ab | 2da98e931b7 | 11b5590e1b7 | 724154e11b1 | 2a1da859176 | 6c25d960181 | 6f878dab1a3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 002ca7f21be | — | 55.0% | 55.0% | 55.0% | 55.0% | 54.0% | 54.0% | 55.0% | 55.0% | 55.0% | 56.0% | 55.0% | 55.0% | 55.0% | 48.0% | 100.0% | 100.0% | 100.0% |
| 00a241641b0 | 45.0% | — | 55.0% | 55.0% | 55.0% | 54.0% | 54.0% | 55.0% | 55.0% | 55.0% | 56.0% | 55.0% | 55.0% | 55.0% | 48.0% | 100.0% | 100.0% | 100.0% |
| 042f5f2d1ad | 45.0% | 45.0% | — | 55.0% | 55.0% | 54.0% | 54.0% | 55.0% | 55.0% | 55.0% | 56.0% | 55.0% | 55.0% | 55.0% | 48.0% | 100.0% | 100.0% | 100.0% |
| 0889c5881b6 | 45.0% | 45.0% | 45.0% | — | 55.0% | 54.0% | 54.0% | 55.0% | 55.0% | 55.0% | 56.0% | 55.0% | 55.0% | 55.0% | 48.0% | 100.0% | 100.0% | 100.0% |
| 0967f9d01be | 45.0% | 45.0% | 45.0% | 45.0% | — | 54.0% | 54.0% | 55.0% | 55.0% | 55.0% | 56.0% | 55.0% | 55.0% | 55.0% | 48.0% | 100.0% | 100.0% | 100.0% |
| 530490cf1b6 | 46.0% | 46.0% | 46.0% | 46.0% | 46.0% | — | 51.0% | 47.0% | 47.0% | 47.0% | 56.0% | 53.0% | 48.0% | 48.0% | 79.0% | 100.0% | 100.0% | 100.0% |
| 24b747301b6 | 46.0% | 46.0% | 46.0% | 46.0% | 46.0% | 49.0% | — | 47.0% | 47.0% | 47.0% | 56.0% | 53.0% | 48.0% | 48.0% | 79.0% | 100.0% | 100.0% | 100.0% |
| dfef26fc1ab | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | 53.0% | 53.0% | — | 53.0% | 53.0% | 53.0% | 54.0% | 53.0% | 53.0% | 54.0% | 100.0% | 100.0% | 100.0% |
| 3f19c9f51b4 | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | 53.0% | 53.0% | 47.0% | — | 53.0% | 53.0% | 54.0% | 53.0% | 53.0% | 54.0% | 100.0% | 100.0% | 100.0% |
| 877756f91b4 | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | 53.0% | 53.0% | 47.0% | 47.0% | — | 53.0% | 46.0% | 53.0% | 53.0% | 54.0% | 100.0% | 100.0% | 100.0% |
| de77e5881b5 | 44.0% | 44.0% | 44.0% | 44.0% | 44.0% | 44.0% | 44.0% | 47.0% | 47.0% | 47.0% | — | 53.0% | 49.0% | 49.0% | 81.0% | 100.0% | 100.0% | 100.0% |
| 68007ac51ab | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | 47.0% | 47.0% | 46.0% | 46.0% | 54.0% | 47.0% | — | 53.0% | 53.0% | 55.0% | 100.0% | 100.0% | 100.0% |
| 2da98e931b7 | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | 52.0% | 52.0% | 47.0% | 47.0% | 47.0% | 51.0% | 47.0% | — | 55.0% | 48.0% | 100.0% | 100.0% | 100.0% |
| 11b5590e1b7 | 45.0% | 45.0% | 45.0% | 45.0% | 45.0% | 52.0% | 52.0% | 47.0% | 47.0% | 47.0% | 51.0% | 47.0% | 45.0% | — | 48.0% | 100.0% | 100.0% | 100.0% |
| 724154e11b1 | 52.0% | 52.0% | 52.0% | 52.0% | 52.0% | 21.0% | 21.0% | 46.0% | 46.0% | 46.0% | 19.0% | 45.0% | 52.0% | 52.0% | — | 100.0% | 100.0% | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 50.0% | 50.0% |
| 6c25d960181 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | — | 50.0% |
| 6f878dab1a3 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | 50.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 8500 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| volley | 5 of 5 | 2.43 |
| aim | 5 of 5 | 2.00 |
| footwork | 5 of 5 | 1.86 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 5 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-002ca7f21be: ranged
- sg-00a241641b0: ranged
- sg-042f5f2d1ad: ranged
- sg-0889c5881b6: ranged
- sg-0967f9d01be: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 1583533 |
| Mean turns to win | 8.17 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| volley | 52580441 | 12220424 | 4.30 |
| drive | 857084 | 274253 | 3.13 |
| flurry | 347746 | 150644 | 2.31 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 1304894 |
| mana | 0 |
| other | 0 |
| total | 1304894 |
| setup (not in total) | 30570 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 15300 | 62.2% |
| Ochre, swapSides false | 7650 | 55.6% |
| Ochre, swapSides true | 7650 | 50.0% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 49500 | 0 | 0.953 | 261.2 | no |
| 2 | 49500 | 0 | 0.593 | 47.5 | no |
| 3 | 49500 | 0 | 0.520 | 41.8 | no |
| 4 | 49500 | 0 | 0.530 | 54.3 | no |
| 5 | 49500 | 0 | 0.530 | 85.8 | no |
| 6 | 49500 | 0 | 0.532 | 42.1 | no |
| 7 | 49500 | 0 | 0.540 | 49.0 | no |
| 8 | 49500 | 0 | 0.540 | 42.3 | no |
| 9 | 49500 | 0 | 0.540 | 54.4 | no |
| 10 | 49500 | 0 | 0.542 | 57.0 | no |
| 11 | 49500 | 0 | 0.550 | 50.7 | no |
| 12 | 49500 | 0 | 0.550 | 47.6 | no |
| 13 | 49500 | 0 | 0.550 | 51.3 | no |
| 14 | 49500 | 0 | 0.550 | 47.6 | no |
| 15 | 49500 | 0 | 0.550 | 47.3 | no |
| 16 | 49500 | 0 | 0.550 | 46.7 | no |
| 17 | 49500 | 0 | 0.550 | 46.9 | no |
| 18 | 49500 | 0 | 0.550 | 46.7 | no |
| 19 | 49500 | 0 | 0.550 | 48.2 | no |
| 20 | 49500 | 0 | 0.550 | 46.3 | no |
| 21 | 49500 | 0 | 0.552 | 48.4 | no |
| 22 | 49500 | 0 | 0.552 | 46.4 | no |
| 23 | 49500 | 0 | 0.550 | 45.7 | no |
| 24 | 49500 | 0 | 0.550 | 56.3 | no |
| 25 | 49500 | 0 | 0.550 | 46.8 | no |
| 26 | 49500 | 0 | 0.550 | 49.4 | no |
| 27 | 49500 | 0 | 0.550 | 48.2 | no |
| 28 | 49500 | 0 | 0.552 | 47.8 | no |
| 29 | 49500 | 0 | 0.550 | 48.9 | no |
| 30 | 49500 | 0 | 0.550 | 47.0 | no |
| 31 | 49500 | 0 | 0.550 | 44.7 | no |
| 32 | 49500 | 0 | 0.550 | 51.0 | no |

## The top leaders

```
sg-002ca7f21be
  build: aim, volley, aim
  agenda: aim x0 -> volley x4 -> footwork x2
  treasure: copper
  range: Near
  weights: damage 10, preferredRange 12, cardsDrawn 5, moneyGained 1, trashed 3, reclaimed 0, discarded 1, unspentMana 0, opponentOutOfAttackRange -8
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver -> flurry -> footwork
```

```
sg-00a241641b0
  build: aim, volley, aim
  agenda: volley x4 -> aim x1 -> footwork x2
  treasure: none
  range: Near
  weights: damage 11, preferredRange 12, cardsDrawn 2, moneyGained 1, trashed 1, reclaimed -1, discarded -6, unspentMana 0, opponentOutOfAttackRange -10
  trash: copper
  reclaim: gold
  discard: copper -> silver -> flurry -> footwork
```

```
sg-042f5f2d1ad
  build: aim, volley, aim
  agenda: volley x7 -> footwork x2
  treasure: none
  range: Near
  weights: damage 10, preferredRange 14, cardsDrawn 2, moneyGained 1, trashed 1, reclaimed -1, discarded 1, unspentMana 0, opponentOutOfAttackRange -8
  trash: flurry -> copper
  reclaim: gold -> silver
  discard: footwork -> flurry -> copper
```
