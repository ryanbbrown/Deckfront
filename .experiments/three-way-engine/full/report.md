> Historical performance evidence from the pre-shared-pilot model at implementation commit `e1754fd`; the strategy fields and results below are not current.

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
| Deadline | 150 minutes |
| Started | 2026-08-18T18:05:38.629Z |
| Finished | 2026-08-18T18:09:34.583Z |
| Elapsed | 3.9 minutes |
| Stop reason | generations |
| Matches | 1328128 (1299276 evolution, 28852 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 5628.8 matches/s |

## Final ranking

Mean of the per-opponent pairing means in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Pairings | Completed | Aborted |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | sg-975208621cd | no | 0.707 | 28 | 2224 | 0 |
| 2 | sg-043a5c661e5 | no | 0.704 | 28 | 2192 | 0 |
| 3 | sg-4a8addae1ce | no | 0.704 | 28 | 2192 | 0 |
| 4 | sg-18d1e1cb1fc | no | 0.703 | 28 | 2192 | 0 |
| 5 | sg-3aa424e31ca | no | 0.691 | 28 | 2320 | 0 |
| 6 | sg-6f7d7ad41da | no | 0.684 | 28 | 2248 | 0 |
| 7 | sg-4aecbfe51ca | no | 0.684 | 28 | 2212 | 0 |
| 8 | sg-f09c7d2c1be | yes | 0.665 | 28 | 2368 | 0 |
| 9 | sg-5f1e44c61c5 (melee) | no | 0.653 | 28 | 2088 | 0 |
| 10 | sg-dd26216f1b3 | yes | 0.626 | 28 | 2284 | 0 |
| 11 | sg-3145e3021b5 | no | 0.617 | 28 | 2244 | 0 |
| 12 | sg-a1452ff11ba | no | 0.585 | 28 | 2220 | 0 |
| 13 | sg-aea53b731ae | yes | 0.579 | 28 | 2244 | 0 |
| 14 | sg-ec113c751ae | yes | 0.564 | 28 | 2268 | 0 |
| 15 | sg-4e45f32e1ba (ranged) | no | 0.536 | 28 | 2072 | 0 |
| 16 | sg-b21392121ac | no | 0.535 | 28 | 2136 | 0 |
| 17 | sg-65f05ba21bd | no | 0.526 | 28 | 1852 | 0 |
| 18 | sg-ed58528219f | no | 0.523 | 28 | 1840 | 0 |
| 19 | sg-bb168a221a6 | yes | 0.482 | 28 | 2160 | 0 |
| 20 | sg-389bd22c1a4 | no | 0.466 | 28 | 2060 | 0 |
| 21 | sg-6810742c1ce | no | 0.416 | 28 | 1720 | 0 |
| 22 | sg-6f0cd9231bc | no | 0.388 | 28 | 1708 | 0 |
| 23 | sg-a306d4ec1ce | no | 0.335 | 28 | 1676 | 0 |
| 24 | sg-eb07c2441a3 | no | 0.299 | 28 | 1700 | 0 |
| 25 | sg-1ae75b6b1cd (engine) | no | 0.247 | 28 | 1584 | 0 |
| 26 | sg-beaff9161b8 | no | 0.215 | 28 | 1484 | 0 |
| 27 | sg-95d34bd21a0 (money) | no | 0.186 | 28 | 1532 | 0 |
| 28 | sg-5c21cee018b | no | 0.140 | 28 | 1536 | 0 |
| 29 | sg-25c1bf0d1ba (mage) | no | 0.042 | 28 | 1348 | 0 |

## Pairing stops

A pairing stops only after a complete four-orientation seed block. Source: all submitted pairings.

| Reason | Pairings |
| --- | --- |
| significant | 6794 |
| maximum | 9452 |

| Seed blocks played | Pairings |
| --- | --- |
| 12 | 3418 |
| 13 | 723 |
| 14 | 670 |
| 15 | 491 |
| 16 | 253 |
| 17 | 254 |
| 18 | 193 |
| 19 | 199 |
| 20 | 132 |
| 21 | 146 |
| 22 | 112 |
| 23 | 91 |
| 24 | 112 |
| 25 | 9452 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | 975208621cd | 043a5c661e5 | 4a8addae1ce | 18d1e1cb1fc | 3aa424e31ca | 6f7d7ad41da | 4aecbfe51ca | f09c7d2c1be | 5f1e44c61c5 | dd26216f1b3 | 3145e3021b5 | a1452ff11ba | aea53b731ae | ec113c751ae | 4e45f32e1ba | b21392121ac | 65f05ba21bd | ed58528219f | bb168a221a6 | 389bd22c1a4 | 6810742c1ce | 6f0cd9231bc | a306d4ec1ce | eb07c2441a3 | 1ae75b6b1cd | beaff9161b8 | 95d34bd21a0 | 5c21cee018b | 25c1bf0d1ba |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 975208621cd | — | 67.0% | 67.0% | 68.0% | 62.0% | 51.0% | 56.0% | 56.0% | 43.0% | 78.8% | 69.7% | 71.4% | 82.7% | 86.5% | 45.0% | 71.9% | 95.8% | 95.8% | 91.7% | 67.0% | 36.0% | 97.9% | 31.0% | 81.3% | 97.9% | 56.0% | 91.7% | 63.0% | 97.9% |
| 043a5c661e5 | 33.0% | — | 50.0% | 51.0% | 52.0% | 45.0% | 56.0% | 53.0% | 25.0% | 59.0% | 64.0% | 67.0% | 59.0% | 63.0% | 80.0% | 72.6% | 78.6% | 78.3% | 56.0% | 54.0% | 90.4% | 95.8% | 97.9% | 97.9% | 97.9% | 100.0% | 97.9% | 97.9% | 100.0% |
| 4a8addae1ce | 33.0% | 50.0% | — | 51.0% | 51.0% | 45.0% | 56.0% | 52.0% | 25.0% | 59.0% | 64.0% | 67.0% | 59.0% | 63.0% | 80.0% | 72.6% | 78.6% | 78.3% | 56.0% | 54.0% | 90.4% | 95.8% | 97.9% | 97.9% | 97.9% | 100.0% | 97.9% | 97.9% | 100.0% |
| 18d1e1cb1fc | 32.0% | 49.0% | 49.0% | — | 51.0% | 46.0% | 55.0% | 52.0% | 22.9% | 59.0% | 62.0% | 68.0% | 59.0% | 63.0% | 80.0% | 72.6% | 78.6% | 78.3% | 56.0% | 54.0% | 92.3% | 95.8% | 97.9% | 100.0% | 97.9% | 100.0% | 97.9% | 97.9% | 100.0% |
| 3aa424e31ca | 38.0% | 48.0% | 49.0% | 49.0% | — | 50.0% | 50.0% | 57.0% | 44.0% | 57.0% | 62.0% | 65.0% | 65.0% | 70.0% | 65.2% | 68.0% | 72.7% | 72.7% | 61.0% | 59.0% | 82.7% | 88.5% | 97.9% | 91.7% | 95.8% | 100.0% | 95.8% | 78.3% | 100.0% |
| 6f7d7ad41da | 49.0% | 55.0% | 55.0% | 54.0% | 50.0% | — | 48.0% | 54.0% | 46.0% | 63.0% | 75.0% | 61.0% | 75.0% | 73.5% | 44.0% | 69.4% | 91.7% | 91.7% | 82.7% | 72.7% | 52.0% | 94.2% | 51.0% | 75.0% | 97.9% | 75.0% | 91.7% | 68.0% | 100.0% |
| 4aecbfe51ca | 44.0% | 44.0% | 44.0% | 45.0% | 50.0% | 52.0% | — | 52.0% | 50.0% | 59.0% | 53.0% | 76.6% | 66.0% | 66.0% | 80.0% | 69.4% | 33.7% | 41.0% | 69.0% | 75.0% | 90.4% | 70.8% | 97.9% | 95.8% | 93.8% | 100.0% | 95.8% | 100.0% | 100.0% |
| f09c7d2c1be | 44.0% | 47.0% | 48.0% | 48.0% | 43.0% | 46.0% | 48.0% | — | 36.0% | 48.0% | 57.0% | 65.0% | 66.0% | 65.0% | 63.0% | 71.0% | 75.0% | 70.0% | 61.0% | 55.0% | 76.7% | 87.5% | 89.6% | 89.6% | 93.8% | 100.0% | 95.8% | 76.5% | 96.2% |
| 5f1e44c61c5 | 57.0% | 75.0% | 75.0% | 77.1% | 56.0% | 54.0% | 50.0% | 64.0% | — | 75.0% | 72.0% | 76.6% | 82.1% | 80.6% | 27.8% | 49.0% | 100.0% | 100.0% | 93.8% | 70.2% | 17.3% | 100.0% | 4.2% | 46.0% | 100.0% | 10.7% | 85.7% | 28.1% | 100.0% |
| dd26216f1b3 | 21.3% | 41.0% | 41.0% | 41.0% | 43.0% | 37.0% | 41.0% | 52.0% | 25.0% | — | 44.0% | 61.0% | 55.0% | 55.0% | 66.0% | 62.0% | 67.0% | 67.0% | 41.0% | 50.0% | 83.3% | 78.1% | 95.8% | 93.8% | 97.9% | 100.0% | 95.8% | 97.9% | 100.0% |
| 3145e3021b5 | 30.3% | 36.0% | 36.0% | 38.0% | 38.0% | 25.0% | 47.0% | 43.0% | 28.0% | 56.0% | — | 55.0% | 58.0% | 59.0% | 75.0% | 78.3% | 37.0% | 37.0% | 41.0% | 61.0% | 90.4% | 68.0% | 97.9% | 100.0% | 95.8% | 100.0% | 95.8% | 100.0% | 100.0% |
| a1452ff11ba | 28.6% | 33.0% | 33.0% | 32.0% | 35.0% | 39.0% | 23.4% | 35.0% | 23.4% | 39.0% | 45.0% | — | 44.0% | 44.0% | 56.0% | 51.0% | 68.0% | 71.4% | 59.0% | 73.4% | 80.8% | 83.9% | 84.6% | 80.4% | 92.3% | 97.9% | 95.8% | 91.7% | 97.9% |
| aea53b731ae | 17.3% | 41.0% | 41.0% | 41.0% | 35.0% | 25.0% | 34.0% | 34.0% | 17.9% | 45.0% | 42.0% | 56.0% | — | 56.0% | 62.0% | 48.0% | 61.0% | 60.0% | 34.0% | 43.0% | 82.1% | 75.0% | 91.7% | 88.5% | 93.8% | 100.0% | 95.8% | 100.0% | 100.0% |
| ec113c751ae | 13.5% | 37.0% | 37.0% | 37.0% | 30.0% | 26.5% | 34.0% | 35.0% | 19.4% | 45.0% | 41.0% | 56.0% | 44.0% | — | 60.0% | 53.0% | 59.0% | 61.0% | 32.0% | 45.0% | 76.8% | 75.0% | 91.7% | 85.7% | 93.8% | 100.0% | 95.8% | 93.8% | 100.0% |
| 4e45f32e1ba | 55.0% | 20.0% | 20.0% | 20.0% | 34.8% | 56.0% | 20.0% | 37.0% | 72.2% | 34.0% | 25.0% | 44.0% | 38.0% | 40.0% | — | 40.0% | 23.2% | 23.2% | 51.0% | 77.5% | 79.7% | 37.0% | 89.6% | 91.7% | 78.6% | 100.0% | 92.3% | 100.0% | 100.0% |
| b21392121ac | 28.1% | 27.4% | 27.4% | 27.4% | 32.0% | 30.6% | 30.6% | 29.0% | 51.0% | 38.0% | 21.7% | 49.0% | 52.0% | 47.0% | 60.0% | — | 23.2% | 23.2% | 49.0% | 76.7% | 83.9% | 39.0% | 96.2% | 90.4% | 78.3% | 100.0% | 87.5% | 100.0% | 100.0% |
| 65f05ba21bd | 4.2% | 21.4% | 21.4% | 21.4% | 27.3% | 8.3% | 66.3% | 25.0% | 0.0% | 33.0% | 63.0% | 32.0% | 39.0% | 41.0% | 76.8% | 76.8% | — | 57.0% | 0.0% | 0.0% | 100.0% | 72.1% | 97.9% | 95.8% | 95.8% | 100.0% | 95.8% | 100.0% | 100.0% |
| ed58528219f | 4.2% | 21.7% | 21.7% | 21.7% | 27.3% | 8.3% | 59.0% | 30.0% | 0.0% | 33.0% | 63.0% | 28.6% | 40.0% | 39.0% | 76.8% | 76.8% | 43.0% | — | 0.0% | 0.0% | 100.0% | 78.8% | 97.9% | 100.0% | 97.9% | 100.0% | 95.8% | 100.0% | 100.0% |
| bb168a221a6 | 8.3% | 44.0% | 44.0% | 44.0% | 39.0% | 17.3% | 31.0% | 39.0% | 6.3% | 59.0% | 59.0% | 41.0% | 66.0% | 68.0% | 49.0% | 51.0% | 100.0% | 100.0% | — | 11.8% | 26.0% | 100.0% | 9.6% | 34.0% | 100.0% | 16.1% | 93.8% | 0.0% | 93.8% |
| 389bd22c1a4 | 33.0% | 46.0% | 46.0% | 46.0% | 41.0% | 27.3% | 25.0% | 45.0% | 29.8% | 50.0% | 39.0% | 26.6% | 57.0% | 55.0% | 22.5% | 23.3% | 100.0% | 100.0% | 88.2% | — | 4.2% | 100.0% | 0.0% | 8.3% | 100.0% | 0.0% | 75.0% | 17.9% | 100.0% |
| 6810742c1ce | 64.0% | 9.6% | 9.6% | 7.7% | 17.3% | 48.0% | 9.6% | 23.3% | 82.7% | 16.7% | 9.6% | 19.2% | 17.9% | 23.2% | 20.3% | 16.1% | 0.0% | 0.0% | 74.0% | 95.8% | — | 23.4% | 71.0% | 71.9% | 53.0% | 97.9% | 83.3% | 100.0% | 100.0% |
| 6f0cd9231bc | 2.1% | 4.2% | 4.2% | 4.2% | 11.5% | 5.8% | 29.2% | 12.5% | 0.0% | 21.9% | 32.0% | 16.1% | 25.0% | 25.0% | 63.0% | 61.0% | 27.9% | 21.2% | 0.0% | 0.0% | 76.6% | — | 92.3% | 92.3% | 71.0% | 97.9% | 89.6% | 100.0% | 100.0% |
| a306d4ec1ce | 69.0% | 2.1% | 2.1% | 2.1% | 2.1% | 49.0% | 2.1% | 10.4% | 95.8% | 4.2% | 2.1% | 15.4% | 8.3% | 8.3% | 10.4% | 3.8% | 2.1% | 2.1% | 90.4% | 100.0% | 29.0% | 7.7% | — | 37.0% | 31.0% | 88.5% | 64.0% | 100.0% | 100.0% |
| eb07c2441a3 | 18.8% | 2.1% | 2.1% | 0.0% | 8.3% | 25.0% | 4.2% | 10.4% | 54.0% | 6.3% | 0.0% | 19.6% | 11.5% | 14.3% | 8.3% | 9.6% | 4.2% | 0.0% | 66.0% | 91.7% | 28.1% | 7.7% | 63.0% | — | 34.0% | 82.1% | 67.0% | 100.0% | 100.0% |
| 1ae75b6b1cd | 2.1% | 2.1% | 2.1% | 2.1% | 4.2% | 2.1% | 6.3% | 6.3% | 0.0% | 2.1% | 4.2% | 7.7% | 6.3% | 6.3% | 21.4% | 21.7% | 4.2% | 2.1% | 0.0% | 0.0% | 47.0% | 29.0% | 69.0% | 66.0% | — | 100.0% | 76.8% | 100.0% | 100.0% |
| beaff9161b8 | 44.0% | 0.0% | 0.0% | 0.0% | 0.0% | 25.0% | 0.0% | 0.0% | 89.3% | 0.0% | 0.0% | 2.1% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 83.9% | 100.0% | 2.1% | 2.1% | 11.5% | 17.9% | 0.0% | — | 30.2% | 100.0% | 93.8% |
| 95d34bd21a0 | 8.3% | 2.1% | 2.1% | 2.1% | 4.2% | 8.3% | 4.2% | 4.2% | 14.3% | 4.2% | 4.2% | 4.2% | 4.2% | 4.2% | 7.7% | 12.5% | 4.2% | 4.2% | 6.3% | 25.0% | 16.7% | 10.4% | 36.0% | 33.0% | 23.2% | 69.8% | — | 100.0% | 100.0% |
| 5c21cee018b | 37.0% | 2.1% | 2.1% | 2.1% | 21.7% | 32.0% | 0.0% | 23.5% | 71.9% | 2.1% | 0.0% | 8.3% | 0.0% | 6.3% | 0.0% | 0.0% | 0.0% | 0.0% | 100.0% | 82.1% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 2.1% |
| 25c1bf0d1ba | 2.1% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 3.8% | 0.0% | 0.0% | 0.0% | 2.1% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 6.3% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 6.3% | 0.0% | 97.9% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 11324 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| steadyShot | 4 of 5 | 3.24 |
| footwork | 5 of 5 | 3.14 |
| heavyBlow | 1 of 5 | 0.38 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 1 |
| ranged | 4 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-f09c7d2c1be: ranged
- sg-dd26216f1b3: ranged
- sg-aea53b731ae: ranged
- sg-ec113c751ae: ranged
- sg-bb168a221a6: melee

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 1322522 |
| Mean turns to win | 11.93 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| steadyShot | 61189962 | 20396654 | 3.00 |
| heavyBlow | 8077376 | 2019344 | 4.00 |
| fireball | 188285 | 37657 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 2943650 |
| mana | 261200 |
| other | 0 |
| total | 3204850 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 28852 | 64.2% |
| Ochre, swapSides false | 14426 | 48.1% |
| Ochre, swapSides true | 14426 | 50.8% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 30472 | 0 | 0.858 | 10.5 | no |
| 2 | 37948 | 0 | 0.618 | 7.3 | no |
| 3 | 39020 | 0 | 0.704 | 5.0 | no |
| 4 | 42032 | 0 | 0.812 | 3.8 | no |
| 5 | 33932 | 0 | 1.000 | 3.0 | no |
| 6 | 36268 | 0 | 0.805 | 6.7 | no |
| 7 | 37592 | 0 | 0.971 | 7.0 | no |
| 8 | 37844 | 0 | 0.879 | 21.3 | no |
| 9 | 33400 | 0 | 0.942 | 16.6 | no |
| 10 | 39156 | 0 | 0.721 | 6.6 | no |
| 11 | 35748 | 0 | 0.756 | 5.5 | no |
| 12 | 41272 | 0 | 0.655 | 8.9 | no |
| 13 | 39916 | 0 | 0.511 | 4.7 | no |
| 14 | 40388 | 0 | 0.529 | 4.6 | no |
| 15 | 42336 | 0 | 0.494 | 5.8 | no |
| 16 | 42780 | 0 | 0.510 | 5.0 | no |
| 17 | 42308 | 0 | 0.510 | 5.1 | no |
| 18 | 44368 | 0 | 0.510 | 5.3 | no |
| 19 | 45200 | 0 | 0.508 | 5.2 | no |
| 20 | 44344 | 0 | 0.508 | 5.0 | no |
| 21 | 43840 | 0 | 0.500 | 5.1 | no |
| 22 | 44744 | 0 | 0.502 | 5.1 | no |
| 23 | 45060 | 0 | 0.500 | 5.4 | no |
| 24 | 43184 | 0 | 0.502 | 5.3 | no |
| 25 | 43868 | 0 | 0.502 | 5.2 | no |
| 26 | 43260 | 0 | 0.510 | 5.0 | no |
| 27 | 45368 | 0 | 0.546 | 5.8 | no |
| 28 | 43860 | 0 | 0.627 | 6.7 | no |
| 29 | 43104 | 0 | 0.699 | 14.2 | no |
| 30 | 41076 | 0 | 0.659 | 16.7 | no |
| 31 | 35568 | 0 | 0.807 | 9.1 | no |
| 32 | 40020 | 0 | 0.740 | 4.1 | no |

## The top leaders

```
sg-975208621cd
  build: footwork, steadyShot
  agenda: heavyBlow x2 -> footwork x3 -> steadyShot x4 -> adapt x1
  treasure: gold -> copper
  range: Close
  weights: damage 9, preferredRange 11, cardsDrawn 8, moneyGained 0, trashed -1, reclaimed -2, discarded 5, unspentMana 3, opponentOutOfAttackRange -4
  trash: channel -> copper
  reclaim: gold -> silver
  discard: copper
```

```
sg-043a5c661e5
  build: steadyShot, steadyShot, steadyShot
  agenda: steadyShot x4 -> footwork x3 -> heavyBlow x2 -> adapt x1
  treasure: copper -> gold
  range: Close
  weights: damage 9, preferredRange 11, cardsDrawn 8, moneyGained 0, trashed -1, reclaimed -2, discarded 5, unspentMana 3, opponentOutOfAttackRange -4
  trash: channel -> copper
  reclaim: gold -> silver
  discard: silver -> copper
```

```
sg-4a8addae1ce
  build: steadyShot, steadyShot, steadyShot
  agenda: steadyShot x4 -> footwork x3 -> adapt x1
  treasure: copper -> gold
  range: Close
  weights: damage 4, preferredRange 11, cardsDrawn 2, moneyGained 0, trashed -1, reclaimed -2, discarded 5, unspentMana 3, opponentOutOfAttackRange -4
  trash: channel -> copper
  reclaim: silver
  discard: copper -> silver
```
