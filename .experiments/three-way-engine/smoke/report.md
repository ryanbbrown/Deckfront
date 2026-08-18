# Balance search: Three-Way Engine (smoke)

| Field | Value |
| --- | --- |
| Kingdom | Three-Way Engine (`three-way-engine`) |
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
| Started | 2026-08-18T14:07:35.547Z |
| Finished | 2026-08-18T14:08:32.979Z |
| Elapsed | 1.0 minutes |
| Stop reason | generations |
| Matches | 8860 (6460 evolution, 2400 tournament) |
| Aborted matches | 0 |
| Action-search overflow rate | 0.0% |
| Tournament complete | yes |
| Throughput | 154.3 matches/s |

## Seeding

This kingdom sells only part of what 3 of the five fixed baselines were built around, so those seeds enter generation 1 cut down. Generation-1 scores here carry less signal than later generations, which are measured against evolved leaders.

| Baseline | Build cards lost | Agenda entries lost | Left with no agenda |
| --- | --- | --- | --- |
| melee-rush | 1 | 2 | no |
| ranged-standard | 2 | 2 | no |
| mage-standard | 2 | 1 | no |

## Final ranking

Mean score per completed game in the final round robin. Source: tournament.

| Rank | Strategy | Final leader | Score | Completed | Aborted |
| --- | --- | --- | --- | --- | --- |
| 1 | sg-e92664c91ab | yes | 0.830 | 300 | 0 |
| 2 | sg-bab82d4c1ad | yes | 0.823 | 300 | 0 |
| 3 | sg-c3f8537f196 | yes | 0.783 | 300 | 0 |
| 4 | sg-f40da58a19c | no | 0.780 | 300 | 0 |
| 5 | sg-2994b51719e | no | 0.773 | 300 | 0 |
| 6 | sg-9f6e4ed719c | no | 0.773 | 300 | 0 |
| 7 | sg-9d63d5301a9 | no | 0.573 | 300 | 0 |
| 8 | sg-735f4a351bb | no | 0.537 | 300 | 0 |
| 9 | sg-7a19bc071b2 | no | 0.523 | 300 | 0 |
| 10 | sg-ff8ce6821ae | no | 0.477 | 300 | 0 |
| 11 | sg-b172dd6c1ad (melee-rush) | no | 0.377 | 300 | 0 |
| 12 | sg-9331bbcd1ad | no | 0.303 | 300 | 0 |
| 13 | sg-c5d164741a0 (ranged-standard) | no | 0.183 | 300 | 0 |
| 14 | sg-916651c51cc (engine-draw) | no | 0.173 | 300 | 0 |
| 15 | sg-c5f8f1c01b3 (mage-standard) | no | 0.083 | 300 | 0 |
| 16 | sg-2a1da859176 (treasure-only) | no | 0.007 | 300 | 0 |

## Pairwise win rate

Row against column, counting a draw as half a win, over the games that completed. `·` is a pair the deadline left unplayed. Source: tournament.

|  | e92664c91ab | bab82d4c1ad | c3f8537f196 | f40da58a19c | 2994b51719e | 9f6e4ed719c | 9d63d5301a9 | 735f4a351bb | 7a19bc071b2 | ff8ce6821ae | b172dd6c1ad | 9331bbcd1ad | c5d164741a0 | 916651c51cc | c5f8f1c01b3 | 2a1da859176 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| e92664c91ab | — | 50.0% | 55.0% | 65.0% | 65.0% | 65.0% | 95.0% | 95.0% | 95.0% | 90.0% | 70.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| bab82d4c1ad | 50.0% | — | 60.0% | 55.0% | 60.0% | 55.0% | 90.0% | 95.0% | 95.0% | 85.0% | 90.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| c3f8537f196 | 45.0% | 40.0% | — | 65.0% | 65.0% | 65.0% | 95.0% | 90.0% | 100.0% | 60.0% | 50.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| f40da58a19c | 35.0% | 45.0% | 35.0% | — | 55.0% | 55.0% | 75.0% | 90.0% | 90.0% | 95.0% | 95.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 2994b51719e | 35.0% | 40.0% | 35.0% | 45.0% | — | 55.0% | 75.0% | 95.0% | 90.0% | 95.0% | 95.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 9f6e4ed719c | 35.0% | 45.0% | 35.0% | 45.0% | 45.0% | — | 75.0% | 95.0% | 90.0% | 100.0% | 95.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 9d63d5301a9 | 5.0% | 10.0% | 5.0% | 25.0% | 25.0% | 25.0% | — | 70.0% | 60.0% | 70.0% | 75.0% | 90.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 735f4a351bb | 5.0% | 5.0% | 10.0% | 10.0% | 5.0% | 5.0% | 30.0% | — | 60.0% | 90.0% | 95.0% | 90.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 7a19bc071b2 | 5.0% | 5.0% | 0.0% | 10.0% | 10.0% | 10.0% | 40.0% | 40.0% | — | 90.0% | 80.0% | 95.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| ff8ce6821ae | 10.0% | 15.0% | 40.0% | 5.0% | 5.0% | 0.0% | 30.0% | 10.0% | 10.0% | — | 100.0% | 90.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| b172dd6c1ad | 30.0% | 10.0% | 50.0% | 5.0% | 5.0% | 5.0% | 25.0% | 5.0% | 20.0% | 0.0% | — | 80.0% | 35.0% | 95.0% | 100.0% | 100.0% |
| 9331bbcd1ad | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 10.0% | 10.0% | 5.0% | 10.0% | 20.0% | — | 100.0% | 100.0% | 100.0% | 100.0% |
| c5d164741a0 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 65.0% | 0.0% | — | 35.0% | 75.0% | 100.0% |
| 916651c51cc | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 5.0% | 0.0% | 65.0% | — | 90.0% | 100.0% |
| c5f8f1c01b3 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 25.0% | 10.0% | — | 90.0% |
| 2a1da859176 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 10.0% | — |

## Cards the leaders acquired

Acquisition is the starting build plus purchases, over 900 leader games in the tournament. Source: tournament.

| Card | Leaders | Copies per game |
| --- | --- | --- |
| steadyShot | 3 of 3 | 4.11 |
| footwork | 3 of 3 | 1.68 |
| silver | 3 of 3 | 0.65 |
| cull | 1 of 3 | 0.33 |
| muster | 1 of 3 | 0.33 |
| gold | 1 of 3 | 0.03 |

## Family representation

A leader belongs to the family holding more than half its acquired attack cards; anything else with an attack is mixed, and a leader with no attack is `none`. Aim and Feint are not counted, because neither deals damage.

| Family | Leaders |
| --- | --- |
| melee | 0 |
| ranged | 3 |
| mage | 0 |
| mixed | 0 |
| none | 0 |

- sg-e92664c91ab: ranged
- sg-bab82d4c1ad: ranged
- sg-c3f8537f196: ranged

## Turns to win and damage

Every match in the run, evolution and tournament together. Source: all matches.

| Measure | Value |
| --- | --- |
| Games with a winner | 8716 |
| Mean turns to win | 16.58 |

| Card | Damage | Plays | Damage per play |
| --- | --- | --- | --- |
| steadyShot | 321726 | 107242 | 3.00 |
| heavyBlow | 65196 | 16299 | 4.00 |
| fireball | 19570 | 3914 | 5.00 |

## Dead draws

A dead draw is a card in hand that could not be played. `setup` counts legal-but-unsupported plays — a Volley with no Aim, a Flurry with no Tactical Action — and is **not** part of `total`, unlike the other causes. `other` is `total` minus `range` and `mana`. Source: all matches.

| Cause | Count |
| --- | --- |
| range | 18132 |
| mana | 9054 |
| other | 0 |
| total | 27186 |
| setup (not in total) | 0 |

## First-player and arena-side advantage

Leader against leader is the fair comparison, so both come from the tournament. Arena-side advantage is ochre's win rate with `swapSides: false` against `swapSides: true`; ochre starts at position 2 when false and position 3 when true.

| Measure | Games | Win rate |
| --- | --- | --- |
| Player who moved first | 2400 | 55.3% |
| Ochre, swapSides false | 1200 | 49.5% |
| Ochre, swapSides true | 1200 | 49.3% |

## Generations

| Generation | Matches | Aborted | Best score | Seconds | Partial |
| --- | --- | --- | --- | --- | --- |
| 1 | 1900 | 0 | 0.950 | 30.7 | no |
| 2 | 1140 | 0 | 0.825 | 1.8 | no |
| 3 | 1140 | 0 | 0.833 | 1.9 | no |
| 4 | 1140 | 0 | 0.850 | 5.4 | no |
| 5 | 1140 | 0 | 0.800 | 8.0 | no |

## The top leaders

```
sg-e92664c91ab
  build: steadyShot, muster
  agenda: steadyShot x4 -> footwork x2
  treasure: gold -> silver
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-bab82d4c1ad
  build: cull
  agenda: steadyShot x5 -> heavyBlow x1 -> footwork x2
  treasure: gold -> silver
  range: Close
  weights: damage 9, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 6, discarded 1, unspentMana -1, opponentOutOfAttackRange -1
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```

```
sg-c3f8537f196
  build: none
  agenda: steadyShot x6 -> footwork x2
  treasure: silver -> gold
  range: Far
  weights: damage 10, preferredRange 3, cardsDrawn 2, moneyGained 1, trashed 2, reclaimed 2, discarded 1, unspentMana -1, opponentOutOfAttackRange -4
  trash: copper
  reclaim: gold -> silver
  discard: copper -> silver
```
