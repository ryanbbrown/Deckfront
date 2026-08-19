# Balance search: Three-Way Engine (full)

| Field | Value |
| --- | --- |
| Kingdom | Three-Way Engine (`three-way-engine`) |
| Mode | full |
| Run seed | 1 |
| Candidates | 100 |
| Leaders kept | 5 |
| Generations asked for | 32 |
| Generations run | 32 |
| Shared seeds | 25 |
| Turn limit per player | 30 |
| Action cap per turn | 200 |
| Action-search state limit | 20000 |
| Workers | 10 |
| Deadline | 420 minutes |
| Started | 2026-08-19T03:12:13.846Z |
| Finished | 2026-08-19T03:27:22.602Z |
| Elapsed | 15.1 minutes |
| Stop reason | generations |
| Matches | 1280568 (1264260 evolution, 16308 tournament) |
| Aborted matches | 7 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 1409.1 matches/s |

## Final ranking

Mean of the per-opponent pairing means in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Pairings | Completed | Aborted |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | sg-eebe771282 (ranged) | no | 0.675 | 19 | 1644 | 0 |
| 2 | sg-00eef3b896 | yes | 0.623 | 19 | 1732 | 0 |
| 3 | sg-02fcfe8c94 | yes | 0.617 | 19 | 1732 | 0 |
| 4 | sg-03d33ae794 | yes | 0.611 | 19 | 1732 | 0 |
| 5 | sg-03f5f79a94 | yes | 0.604 | 19 | 1732 | 0 |
| 6 | sg-0454603494 | yes | 0.599 | 19 | 1732 | 0 |
| 7 | sg-3c49f6f16b | no | 0.579 | 19 | 1728 | 0 |
| 8 | sg-866ed2d079 | no | 0.575 | 19 | 1720 | 0 |
| 9 | sg-88dfbc0393 | no | 0.559 | 19 | 1768 | 0 |
| 10 | sg-845caef394 | no | 0.553 | 19 | 1768 | 0 |
| 11 | sg-3db30ce392 | no | 0.551 | 19 | 1524 | 0 |
| 12 | sg-30f2502293 | no | 0.545 | 19 | 1768 | 0 |
| 13 | sg-42166e747b | no | 0.539 | 19 | 1796 | 0 |
| 14 | sg-5431750c6a (money) | no | 0.524 | 19 | 1724 | 0 |
| 15 | sg-c1e479ed8b (melee) | no | 0.490 | 19 | 1748 | 0 |
| 16 | sg-641410777a | no | 0.444 | 19 | 1652 | 0 |
| 17 | sg-2e680cbc7f | no | 0.413 | 19 | 1592 | 0 |
| 18 | sg-1bfbb8dd75 | no | 0.288 | 19 | 1504 | 0 |
| 19 | sg-acc2720e94 (engine) | no | 0.159 | 19 | 1056 | 0 |
| 20 | sg-d0bd852e81 (mage) | no | 0.053 | 19 | 964 | 0 |

## Pairing stops

A pairing stops only after a complete four-orientation seed block. Source: all submitted pairings.

| Reason | Pairings |
| --- | --- |
| significant | 7462 |
| maximum | 8568 |

| Seed blocks played | Pairings |
| --- | --- |
| 12 | 4045 |
| 13 | 798 |
| 14 | 528 |
| 15 | 334 |
| 16 | 268 |
| 17 | 205 |
| 18 | 145 |
| 19 | 155 |
| 20 | 360 |
| 21 | 125 |
| 22 | 112 |
| 23 | 279 |
| 24 | 108 |
| 25 | 8568 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | eebe771282 | 00eef3b896 | 02fcfe8c94 | 03d33ae794 | 03f5f79a94 | 0454603494 | 3c49f6f16b | 866ed2d079 | 88dfbc0393 | 845caef394 | 3db30ce392 | 30f2502293 | 42166e747b | 5431750c6a | c1e479ed8b | 641410777a | 2e680cbc7f | 1bfbb8dd75 | acc2720e94 | d0bd852e81 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eebe771282 | — | 60.0% | 60.0% | 59.0% | 60.0% | 59.0% | 64.0% | 63.0% | 69.8% | 69.8% | 25.0% | 70.8% | 62.0% | 83.9% | 62.0% | 65.0% | 68.0% | 93.8% | 86.5% | 100.0% |
| 00eef3b896 | 40.0% | — | 56.0% | 56.0% | 56.0% | 56.0% | 58.0% | 60.0% | 56.0% | 56.0% | 50.0% | 56.0% | 63.0% | 42.0% | 65.0% | 71.6% | 73.5% | 80.3% | 92.3% | 95.8% |
| 02fcfe8c94 | 40.0% | 44.0% | — | 56.0% | 56.0% | 56.0% | 58.0% | 60.0% | 56.0% | 56.0% | 51.0% | 56.0% | 63.0% | 41.0% | 65.0% | 71.6% | 73.5% | 80.3% | 92.3% | 95.8% |
| 03d33ae794 | 41.0% | 44.0% | 44.0% | — | 56.0% | 56.0% | 58.0% | 60.0% | 56.0% | 56.0% | 51.0% | 56.0% | 63.0% | 42.0% | 65.0% | 71.6% | 73.5% | 80.3% | 92.3% | 95.8% |
| 03f5f79a94 | 40.0% | 44.0% | 44.0% | 44.0% | — | 56.0% | 58.0% | 60.0% | 56.0% | 56.0% | 51.0% | 56.0% | 63.0% | 42.0% | 65.0% | 71.6% | 73.5% | 80.3% | 92.3% | 95.8% |
| 0454603494 | 41.0% | 44.0% | 44.0% | 44.0% | 44.0% | — | 58.0% | 60.0% | 56.0% | 56.0% | 51.0% | 56.0% | 63.0% | 42.0% | 65.0% | 71.6% | 73.5% | 80.3% | 92.3% | 95.8% |
| 3c49f6f16b | 36.0% | 42.0% | 42.0% | 42.0% | 42.0% | 42.0% | — | 44.0% | 57.0% | 57.0% | 71.9% | 57.0% | 47.0% | 53.0% | 62.0% | 65.0% | 72.4% | 76.1% | 93.8% | 97.9% |
| 866ed2d079 | 37.0% | 40.0% | 40.0% | 40.0% | 40.0% | 40.0% | 56.0% | — | 55.0% | 55.0% | 71.9% | 55.0% | 46.0% | 54.0% | 64.0% | 67.0% | 67.0% | 76.8% | 92.3% | 95.8% |
| 88dfbc0393 | 30.2% | 44.0% | 44.0% | 44.0% | 44.0% | 44.0% | 43.0% | 45.0% | — | 56.0% | 56.0% | 56.0% | 50.0% | 43.0% | 66.0% | 66.7% | 67.0% | 75.0% | 92.3% | 95.8% |
| 845caef394 | 30.2% | 44.0% | 44.0% | 44.0% | 44.0% | 44.0% | 43.0% | 45.0% | 44.0% | — | 56.0% | 56.0% | 50.0% | 43.0% | 66.0% | 66.7% | 67.0% | 75.0% | 92.3% | 95.8% |
| 3db30ce392 | 75.0% | 50.0% | 49.0% | 49.0% | 49.0% | 49.0% | 28.1% | 28.1% | 44.0% | 44.0% | — | 44.0% | 33.0% | 100.0% | 9.6% | 51.0% | 54.0% | 91.7% | 97.9% | 100.0% |
| 30f2502293 | 29.2% | 44.0% | 44.0% | 44.0% | 44.0% | 44.0% | 43.0% | 45.0% | 44.0% | 44.0% | 56.0% | — | 50.0% | 41.0% | 66.0% | 66.7% | 67.0% | 75.0% | 92.3% | 95.8% |
| 42166e747b | 38.0% | 37.0% | 37.0% | 37.0% | 37.0% | 37.0% | 53.0% | 54.0% | 50.0% | 50.0% | 67.0% | 50.0% | — | 52.0% | 56.0% | 58.0% | 63.0% | 58.0% | 95.8% | 93.8% |
| 5431750c6a | 16.1% | 58.0% | 59.0% | 58.0% | 58.0% | 58.0% | 47.0% | 46.0% | 57.0% | 57.0% | 0.0% | 59.0% | 48.0% | — | 27.0% | 57.0% | 59.0% | 90.3% | 46.0% | 95.8% |
| c1e479ed8b | 38.0% | 35.0% | 35.0% | 35.0% | 35.0% | 35.0% | 38.0% | 36.0% | 34.0% | 34.0% | 90.4% | 34.0% | 44.0% | 73.0% | — | 47.0% | 60.0% | 34.0% | 100.0% | 93.8% |
| 641410777a | 35.0% | 28.4% | 28.4% | 28.4% | 28.4% | 28.4% | 35.0% | 33.0% | 33.3% | 33.3% | 49.0% | 33.3% | 42.0% | 43.0% | 53.0% | — | 53.0% | 73.4% | 91.7% | 93.8% |
| 2e680cbc7f | 32.0% | 26.5% | 26.5% | 26.5% | 26.5% | 26.5% | 27.6% | 33.0% | 33.0% | 33.0% | 46.0% | 33.0% | 37.0% | 41.0% | 40.0% | 47.0% | — | 71.3% | 87.5% | 91.7% |
| 1bfbb8dd75 | 6.3% | 19.7% | 19.7% | 19.7% | 19.7% | 19.7% | 23.9% | 23.2% | 25.0% | 25.0% | 8.3% | 25.0% | 42.0% | 9.7% | 66.0% | 26.6% | 28.7% | — | 64.0% | 75.0% |
| acc2720e94 | 13.5% | 7.7% | 7.7% | 7.7% | 7.7% | 7.7% | 6.3% | 7.7% | 7.7% | 7.7% | 2.1% | 7.7% | 4.2% | 54.0% | 0.0% | 8.3% | 12.5% | 36.0% | — | 95.8% |
| d0bd852e81 | 0.0% | 4.2% | 4.2% | 4.2% | 4.2% | 4.2% | 2.1% | 4.2% | 4.2% | 4.2% | 0.0% | 4.2% | 6.3% | 4.2% | 6.3% | 6.3% | 8.3% | 25.0% | 4.2% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 8660 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| heavyBlow | 5 of 5 | 3.74 |
| muster | 5 of 5 | 2.01 |
| reclaim | 5 of 5 | 1.54 |
| footwork | 5 of 5 | 1.00 |
| silver | 5 of 5 | 0.14 |
| prism | 1 of 5 | 0.00 |
| fireball | 1 of 5 | 0.00 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 5 |
| ranged | 0 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-00eef3b896: melee
- sg-02fcfe8c94: melee
- sg-03d33ae794: melee
- sg-03f5f79a94: melee
- sg-0454603494: melee

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 1280557 |
| Mean turns to win | 11.82 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| heavyBlow | 65199160 | 16299790 | 4.00 |
| steadyShot | 4096020 | 1365340 | 3.00 |
| fireball | 218780 | 43756 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 2396525 |
| mana | 138391 |
| other | 0 |
| total | 2534916 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 16308 | 63.9% |
| Ochre, swapSides false | 8154 | 48.4% |
| Ochre, swapSides true | 8154 | 48.1% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 32940 | 0 | 0.831 | 35.4 | no |
| 2 | 39132 | 0 | 0.561 | 24.8 | no |
| 3 | 36356 | 0 | 0.637 | 25.9 | no |
| 4 | 39476 | 0 | 0.674 | 26.0 | no |
| 5 | 42116 | 0 | 0.660 | 36.3 | no |
| 6 | 40784 | 0 | 0.546 | 34.3 | no |
| 7 | 38596 | 0 | 0.654 | 26.6 | no |
| 8 | 39452 | 0 | 0.645 | 28.9 | no |
| 9 | 39920 | 1 | 0.627 | 33.7 | no |
| 10 | 38616 | 0 | 0.590 | 27.2 | no |
| 11 | 38204 | 0 | 0.590 | 29.2 | no |
| 12 | 37688 | 5 | 0.596 | 28.5 | no |
| 13 | 37900 | 0 | 0.595 | 28.9 | no |
| 14 | 41644 | 0 | 0.565 | 26.7 | no |
| 15 | 37512 | 1 | 0.563 | 27.5 | no |
| 16 | 39580 | 0 | 0.560 | 25.8 | no |
| 17 | 40540 | 0 | 0.560 | 24.8 | no |
| 18 | 40648 | 0 | 0.560 | 26.5 | no |
| 19 | 40284 | 0 | 0.560 | 30.6 | no |
| 20 | 40112 | 0 | 0.563 | 27.9 | no |
| 21 | 39832 | 0 | 0.560 | 25.8 | no |
| 22 | 41648 | 0 | 0.560 | 26.5 | no |
| 23 | 39824 | 0 | 0.560 | 25.9 | no |
| 24 | 40752 | 0 | 0.560 | 27.7 | no |
| 25 | 40456 | 0 | 0.560 | 28.5 | no |
| 26 | 38980 | 0 | 0.560 | 26.3 | no |
| 27 | 39440 | 0 | 0.560 | 27.2 | no |
| 28 | 40120 | 0 | 0.560 | 27.8 | no |
| 29 | 42604 | 0 | 0.560 | 29.4 | no |
| 30 | 38780 | 0 | 0.560 | 25.7 | no |
| 31 | 41520 | 0 | 0.560 | 26.7 | no |
| 32 | 38804 | 0 | 0.560 | 25.8 | no |

## The top leaders

```
sg-eebe771282
  build: footwork, steadyShot, steadyShot
  agenda: steadyShot x4 -> footwork x2
  repeat: footwork
```

```
sg-00eef3b896
  build: muster, muster
  agenda: heavyBlow x4 -> footwork x1 -> reclaim x2 -> fireball x1 -> silver x1
  repeat: silver
```

```
sg-02fcfe8c94
  build: muster, muster
  agenda: heavyBlow x4 -> footwork x1 -> reclaim x2 -> prism x4 -> silver x4
  repeat: reclaim
```
