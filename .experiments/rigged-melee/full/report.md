# Balance search: Rigged Melee (full)

| Field | Value |
| --- | --- |
| Kingdom | Rigged Melee (`rigged-melee`) |
| Mode | full |
| Run seed | 1 |
| Candidates | 30 |
| Leaders kept | 4 |
| Generations asked for | 32 |
| Generations run | 32 |
| Shared seeds | 8 |
| Turn limit per player | 100 |
| Action cap per turn | 200 |
| Action-search state limit | 20000 |
| Deadline | 240 minutes |
| Started | 2026-08-18T14:39:58.844Z |
| Finished | 2026-08-18T14:42:13.902Z |
| Elapsed | 2.3 minutes |
| Stop reason | generations |
| Matches | 132704 (119712 evolution, 12992 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 982.6 matches/s |
| Calibration (rigged melee) | PASS |

## Calibration

This kingdom re-prices Heavy Blow to 3 money for 6 damage. The search is expected to find it. The
threshold, the kingdom, and its strategies are never tuned to make this pass.

| Check | Value |
| --- | --- |
| Result | PASS |
| Top final leader | sg-01b1ad661d8 |
| Heavy Blow copies the top leader acquired, summed over its matches | 3584 |
| Final leaders that acquired Heavy Blow | 4 of 4 |

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
| 1 | sg-01b1ad661d8 | yes | 0.652 | 896 | 0 |
| 2 | sg-6d4dc6da1ae | no | 0.646 | 896 | 0 |
| 3 | sg-05679db21d8 | yes | 0.645 | 896 | 0 |
| 4 | sg-ae87a9ee1d8 | no | 0.641 | 896 | 0 |
| 5 | sg-12c106f01d1 | no | 0.640 | 896 | 0 |
| 6 | sg-18cc7f8e1cc | yes | 0.638 | 896 | 0 |
| 7 | sg-062220c61bc | no | 0.637 | 896 | 0 |
| 8 | sg-28208dcb1cb | yes | 0.632 | 896 | 0 |
| 9 | sg-a52eccac1ae | no | 0.610 | 896 | 0 |
| 10 | sg-9928f4351dd | no | 0.602 | 896 | 0 |
| 11 | sg-c5a41cc31d0 | no | 0.596 | 896 | 0 |
| 12 | sg-298aafe81c2 | no | 0.575 | 896 | 0 |
| 13 | sg-5bbdef9f1d7 | no | 0.570 | 896 | 0 |
| 14 | sg-4f9149781c1 (melee-rush) | no | 0.566 | 896 | 0 |
| 15 | sg-29eb81ef1cc | no | 0.564 | 896 | 0 |
| 16 | sg-5ce1a2f61c3 | no | 0.554 | 896 | 0 |
| 17 | sg-c5eb69b71b0 | no | 0.538 | 896 | 0 |
| 18 | sg-de77e5881b5 (ranged-standard) | no | 0.535 | 896 | 0 |
| 19 | sg-d5fa29d21b9 | no | 0.530 | 896 | 0 |
| 20 | sg-31a87aa61a2 | no | 0.528 | 896 | 0 |
| 21 | sg-4f1775d51cc | no | 0.517 | 896 | 0 |
| 22 | sg-826921c11c2 | no | 0.492 | 896 | 0 |
| 23 | sg-236861e61a0 | no | 0.439 | 896 | 0 |
| 24 | sg-0fa70b881a9 | no | 0.435 | 896 | 0 |
| 25 | sg-55b773481a7 | no | 0.368 | 896 | 0 |
| 26 | sg-93a898dc1a7 | no | 0.209 | 896 | 0 |
| 27 | sg-b43272151c9 (mage-standard) | no | 0.107 | 896 | 0 |
| 28 | sg-2a1da859176 (treasure-only) | no | 0.018 | 896 | 0 |
| 29 | sg-d3cd7238199 (engine-draw) | no | 0.018 | 896 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | 01b1ad661d8 | 6d4dc6da1ae | 05679db21d8 | ae87a9ee1d8 | 12c106f01d1 | 18cc7f8e1cc | 062220c61bc | 28208dcb1cb | a52eccac1ae | 9928f4351dd | c5a41cc31d0 | 298aafe81c2 | 5bbdef9f1d7 | 4f9149781c1 | 29eb81ef1cc | 5ce1a2f61c3 | c5eb69b71b0 | de77e5881b5 | d5fa29d21b9 | 31a87aa61a2 | 4f1775d51cc | 826921c11c2 | 236861e61a0 | 0fa70b881a9 | 55b773481a7 | 93a898dc1a7 | b43272151c9 | 2a1da859176 | d3cd7238199 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01b1ad661d8 | — | 43.8% | 59.4% | 50.0% | 50.0% | 59.4% | 50.0% | 59.4% | 53.1% | 46.9% | 53.1% | 62.5% | 59.4% | 56.3% | 59.4% | 53.1% | 75.0% | 56.3% | 53.1% | 78.1% | 75.0% | 75.0% | 59.4% | 59.4% | 84.4% | 93.8% | 100.0% | 100.0% | 100.0% |
| 6d4dc6da1ae | 56.3% | — | 56.3% | 50.0% | 50.0% | 56.3% | 56.3% | 56.3% | 68.8% | 71.9% | 87.5% | 62.5% | 56.3% | 59.4% | 56.3% | 56.3% | 56.3% | 53.1% | 87.5% | 59.4% | 50.0% | 50.0% | 53.1% | 53.1% | 71.9% | 81.3% | 93.8% | 100.0% | 100.0% |
| 05679db21d8 | 40.6% | 43.8% | — | 50.0% | 50.0% | 59.4% | 50.0% | 59.4% | 53.1% | 46.9% | 53.1% | 62.5% | 59.4% | 56.3% | 59.4% | 53.1% | 75.0% | 56.3% | 53.1% | 78.1% | 75.0% | 75.0% | 59.4% | 59.4% | 84.4% | 93.8% | 100.0% | 100.0% | 100.0% |
| ae87a9ee1d8 | 50.0% | 50.0% | 50.0% | — | 53.1% | 50.0% | 53.1% | 50.0% | 53.1% | 43.8% | 59.4% | 56.3% | 56.3% | 50.0% | 56.3% | 59.4% | 43.8% | 65.6% | 68.8% | 43.8% | 78.1% | 78.1% | 71.9% | 71.9% | 84.4% | 96.9% | 100.0% | 100.0% | 100.0% |
| 12c106f01d1 | 50.0% | 50.0% | 50.0% | 46.9% | — | 50.0% | 53.1% | 50.0% | 53.1% | 46.9% | 59.4% | 56.3% | 56.3% | 50.0% | 56.3% | 59.4% | 43.8% | 65.6% | 68.8% | 43.8% | 78.1% | 78.1% | 71.9% | 71.9% | 84.4% | 96.9% | 100.0% | 100.0% | 100.0% |
| 18cc7f8e1cc | 40.6% | 43.8% | 40.6% | 50.0% | 50.0% | — | 50.0% | 59.4% | 53.1% | 46.9% | 53.1% | 62.5% | 59.4% | 56.3% | 59.4% | 53.1% | 75.0% | 56.3% | 53.1% | 78.1% | 75.0% | 75.0% | 59.4% | 59.4% | 84.4% | 93.8% | 100.0% | 100.0% | 100.0% |
| 062220c61bc | 50.0% | 43.8% | 50.0% | 46.9% | 46.9% | 50.0% | — | 50.0% | 53.1% | 46.9% | 56.3% | 53.1% | 53.1% | 50.0% | 53.1% | 59.4% | 78.1% | 62.5% | 56.3% | 43.8% | 78.1% | 78.1% | 71.9% | 71.9% | 84.4% | 96.9% | 100.0% | 100.0% | 100.0% |
| 28208dcb1cb | 40.6% | 43.8% | 40.6% | 50.0% | 50.0% | 40.6% | 50.0% | — | 53.1% | 46.9% | 53.1% | 62.5% | 59.4% | 56.3% | 59.4% | 53.1% | 75.0% | 56.3% | 53.1% | 78.1% | 75.0% | 75.0% | 59.4% | 59.4% | 84.4% | 93.8% | 100.0% | 100.0% | 100.0% |
| a52eccac1ae | 46.9% | 31.3% | 46.9% | 46.9% | 46.9% | 46.9% | 46.9% | 46.9% | — | 46.9% | 46.9% | 46.9% | 46.9% | 50.0% | 46.9% | 46.9% | 78.1% | 40.6% | 50.0% | 78.1% | 78.1% | 78.1% | 68.8% | 68.8% | 84.4% | 96.9% | 96.9% | 100.0% | 100.0% |
| 9928f4351dd | 53.1% | 28.1% | 53.1% | 56.3% | 53.1% | 53.1% | 53.1% | 53.1% | 53.1% | — | 43.8% | 53.1% | 50.0% | 59.4% | 50.0% | 40.6% | 65.6% | 46.9% | 56.3% | 65.6% | 65.6% | 65.6% | 46.9% | 46.9% | 71.9% | 100.0% | 100.0% | 100.0% | 100.0% |
| c5a41cc31d0 | 46.9% | 12.5% | 46.9% | 40.6% | 40.6% | 46.9% | 43.8% | 46.9% | 53.1% | 56.3% | — | 53.1% | 68.8% | 56.3% | 68.8% | 53.1% | 59.4% | 21.9% | 75.0% | 65.6% | 56.3% | 56.3% | 68.8% | 68.8% | 68.8% | 100.0% | 93.8% | 100.0% | 100.0% |
| 298aafe81c2 | 37.5% | 37.5% | 37.5% | 43.8% | 43.8% | 37.5% | 46.9% | 37.5% | 53.1% | 46.9% | 46.9% | — | 53.1% | 50.0% | 53.1% | 50.0% | 37.5% | 46.9% | 53.1% | 43.8% | 75.0% | 75.0% | 68.8% | 65.6% | 84.4% | 90.6% | 93.8% | 100.0% | 100.0% |
| 5bbdef9f1d7 | 40.6% | 43.8% | 40.6% | 43.8% | 43.8% | 40.6% | 46.9% | 40.6% | 53.1% | 50.0% | 31.3% | 46.9% | — | 50.0% | 59.4% | 56.3% | 37.5% | 56.3% | 34.4% | 46.9% | 37.5% | 75.0% | 75.0% | 71.9% | 84.4% | 90.6% | 100.0% | 100.0% | 100.0% |
| 4f9149781c1 | 43.8% | 40.6% | 43.8% | 50.0% | 50.0% | 43.8% | 50.0% | 43.8% | 50.0% | 40.6% | 43.8% | 50.0% | 50.0% | — | 50.0% | 53.1% | 46.9% | 50.0% | 46.9% | 46.9% | 46.9% | 46.9% | 59.4% | 59.4% | 78.1% | 100.0% | 100.0% | 100.0% | 100.0% |
| 29eb81ef1cc | 40.6% | 43.8% | 40.6% | 43.8% | 43.8% | 40.6% | 46.9% | 40.6% | 53.1% | 50.0% | 31.3% | 46.9% | 40.6% | 50.0% | — | 56.3% | 37.5% | 56.3% | 34.4% | 46.9% | 37.5% | 75.0% | 75.0% | 71.9% | 84.4% | 90.6% | 100.0% | 100.0% | 100.0% |
| 5ce1a2f61c3 | 46.9% | 43.8% | 46.9% | 40.6% | 40.6% | 46.9% | 40.6% | 46.9% | 53.1% | 59.4% | 46.9% | 50.0% | 43.8% | 46.9% | 43.8% | — | 46.9% | 65.6% | 50.0% | 43.8% | 40.6% | 40.6% | 65.6% | 65.6% | 65.6% | 75.0% | 93.8% | 100.0% | 100.0% |
| c5eb69b71b0 | 25.0% | 43.8% | 25.0% | 56.3% | 56.3% | 25.0% | 21.9% | 25.0% | 21.9% | 34.4% | 40.6% | 62.5% | 62.5% | 53.1% | 62.5% | 53.1% | — | 50.0% | 40.6% | 53.1% | 46.9% | 46.9% | 71.9% | 68.8% | 62.5% | 100.0% | 96.9% | 100.0% | 100.0% |
| de77e5881b5 | 43.8% | 46.9% | 43.8% | 34.4% | 34.4% | 43.8% | 37.5% | 43.8% | 59.4% | 53.1% | 78.1% | 53.1% | 43.8% | 50.0% | 43.8% | 34.4% | 50.0% | — | 93.8% | 59.4% | 40.6% | 40.6% | 34.4% | 34.4% | 59.4% | 50.0% | 90.6% | 100.0% | 100.0% |
| d5fa29d21b9 | 46.9% | 12.5% | 46.9% | 31.3% | 31.3% | 46.9% | 43.8% | 46.9% | 50.0% | 43.8% | 25.0% | 46.9% | 65.6% | 53.1% | 65.6% | 50.0% | 59.4% | 6.3% | — | 59.4% | 50.0% | 50.0% | 59.4% | 59.4% | 65.6% | 96.9% | 71.9% | 100.0% | 100.0% |
| 31a87aa61a2 | 21.9% | 40.6% | 21.9% | 56.3% | 56.3% | 21.9% | 56.3% | 21.9% | 21.9% | 34.4% | 34.4% | 56.3% | 53.1% | 53.1% | 53.1% | 56.3% | 46.9% | 40.6% | 40.6% | — | 46.9% | 46.9% | 68.8% | 68.8% | 62.5% | 100.0% | 96.9% | 100.0% | 100.0% |
| 4f1775d51cc | 25.0% | 50.0% | 25.0% | 21.9% | 21.9% | 25.0% | 21.9% | 25.0% | 21.9% | 34.4% | 43.8% | 25.0% | 62.5% | 53.1% | 62.5% | 59.4% | 53.1% | 59.4% | 50.0% | 53.1% | — | 46.9% | 71.9% | 71.9% | 62.5% | 100.0% | 100.0% | 100.0% | 100.0% |
| 826921c11c2 | 25.0% | 50.0% | 25.0% | 21.9% | 21.9% | 25.0% | 21.9% | 25.0% | 21.9% | 34.4% | 43.8% | 25.0% | 25.0% | 53.1% | 25.0% | 59.4% | 53.1% | 59.4% | 50.0% | 53.1% | 53.1% | — | 71.9% | 71.9% | 62.5% | 100.0% | 100.0% | 100.0% | 100.0% |
| 236861e61a0 | 40.6% | 46.9% | 40.6% | 28.1% | 28.1% | 40.6% | 28.1% | 40.6% | 31.3% | 53.1% | 31.3% | 31.3% | 25.0% | 40.6% | 25.0% | 34.4% | 28.1% | 65.6% | 40.6% | 31.3% | 28.1% | 28.1% | — | 62.5% | 50.0% | 37.5% | 90.6% | 100.0% | 100.0% |
| 0fa70b881a9 | 40.6% | 46.9% | 40.6% | 28.1% | 28.1% | 40.6% | 28.1% | 40.6% | 31.3% | 53.1% | 31.3% | 34.4% | 28.1% | 40.6% | 28.1% | 34.4% | 31.3% | 65.6% | 40.6% | 31.3% | 28.1% | 28.1% | 37.5% | — | 50.0% | 40.6% | 90.6% | 100.0% | 100.0% |
| 55b773481a7 | 15.6% | 28.1% | 15.6% | 15.6% | 15.6% | 15.6% | 15.6% | 15.6% | 15.6% | 28.1% | 31.3% | 15.6% | 15.6% | 21.9% | 15.6% | 34.4% | 37.5% | 40.6% | 34.4% | 37.5% | 37.5% | 37.5% | 50.0% | 50.0% | — | 96.9% | 93.8% | 100.0% | 100.0% |
| 93a898dc1a7 | 6.3% | 18.8% | 6.3% | 3.1% | 3.1% | 6.3% | 3.1% | 6.3% | 3.1% | 0.0% | 0.0% | 9.4% | 9.4% | 0.0% | 9.4% | 25.0% | 0.0% | 50.0% | 3.1% | 0.0% | 0.0% | 0.0% | 62.5% | 59.4% | 3.1% | — | 96.9% | 100.0% | 100.0% |
| b43272151c9 | 0.0% | 6.3% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 3.1% | 0.0% | 6.3% | 6.3% | 0.0% | 0.0% | 0.0% | 6.3% | 3.1% | 9.4% | 28.1% | 3.1% | 0.0% | 0.0% | 9.4% | 9.4% | 6.3% | 3.1% | — | 100.0% | 100.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | — | 50.0% |
| d3cd7238199 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 3584 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| heavyBlow | 4 of 4 | 4.00 |
| footwork | 4 of 4 | 2.69 |
| aim | 3 of 4 | 0.02 |
| leyStep | 1 of 4 | 0.01 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 4 |
| ranged | 0 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-01b1ad661d8: melee
- sg-05679db21d8: melee
- sg-18cc7f8e1cc: melee
- sg-28208dcb1cb: melee

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 131690 |
| Mean turns to win | 6.78 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| heavyBlow | 3425112 | 570852 | 6.00 |
| volley | 1034938 | 234405 | 4.42 |
| arcBolt | 40512 | 13504 | 3.00 |
| drive | 27422 | 10844 | 2.53 |
| fireball | 2330 | 466 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 348641 |
| mana | 46606 |
| other | 0 |
| total | 395247 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 12992 | 63.5% |
| Ochre, swapSides false | 6496 | 47.4% |
| Ochre, swapSides true | 6496 | 50.2% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 4640 | 0 | 0.875 | 53.3 | no |
| 2 | 3712 | 0 | 0.555 | 2.5 | no |
| 3 | 3712 | 0 | 0.656 | 3.5 | no |
| 4 | 3712 | 0 | 0.758 | 3.9 | no |
| 5 | 3712 | 0 | 0.750 | 4.9 | no |
| 6 | 3712 | 0 | 0.625 | 4.0 | no |
| 7 | 3712 | 0 | 0.625 | 3.9 | no |
| 8 | 3712 | 0 | 0.750 | 3.3 | no |
| 9 | 3712 | 0 | 0.750 | 3.5 | no |
| 10 | 3712 | 0 | 0.969 | 2.8 | no |
| 11 | 3712 | 0 | 0.750 | 2.5 | no |
| 12 | 3712 | 0 | 0.563 | 1.3 | no |
| 13 | 3712 | 0 | 0.677 | 2.1 | no |
| 14 | 3712 | 0 | 0.563 | 1.5 | no |
| 15 | 3712 | 0 | 0.604 | 1.7 | no |
| 16 | 3712 | 0 | 0.646 | 2.3 | no |
| 17 | 3712 | 0 | 0.625 | 1.8 | no |
| 18 | 3712 | 0 | 0.625 | 2.1 | no |
| 19 | 3712 | 0 | 0.633 | 1.9 | no |
| 20 | 3712 | 0 | 0.625 | 2.2 | no |
| 21 | 3712 | 0 | 0.656 | 3.0 | no |
| 22 | 3712 | 0 | 0.563 | 1.7 | no |
| 23 | 3712 | 0 | 0.617 | 2.1 | no |
| 24 | 3712 | 0 | 0.539 | 1.5 | no |
| 25 | 3712 | 0 | 0.646 | 1.7 | no |
| 26 | 3712 | 0 | 0.594 | 2.2 | no |
| 27 | 3712 | 0 | 0.594 | 1.8 | no |
| 28 | 3712 | 0 | 0.594 | 1.7 | no |
| 29 | 3712 | 0 | 0.625 | 1.7 | no |
| 30 | 3712 | 0 | 0.646 | 1.6 | no |
| 31 | 3712 | 0 | 0.594 | 1.8 | no |
| 32 | 3712 | 0 | 0.594 | 2.5 | no |

## The top leaders

```
sg-01b1ad661d8
  build: footwork, heavyBlow
  agenda: heavyBlow x4 -> footwork x4 -> leyStep x2 -> aim x8 -> cull x2
  treasure: gold -> silver
  range: Near
  weights: damage 10, preferredRange 16, cardsDrawn 3, moneyGained 3, trashed 0, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -1
  trash: copper
  reclaim: silver -> drive -> gold
  discard: copper -> silver
```

```
sg-6d4dc6da1ae
  build: volley, aim, footwork
  agenda: volley x3 -> footwork x2 -> aim x3
  treasure: silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-05679db21d8
  build: footwork, heavyBlow
  agenda: heavyBlow x4 -> footwork x4 -> aim x8 -> leyStep x2 -> cull x2
  treasure: gold -> silver
  range: Near
  weights: damage 10, preferredRange 16, cardsDrawn 3, moneyGained 3, trashed 0, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -1
  trash: copper
  reclaim: silver -> drive -> gold
  discard: copper -> silver
```
