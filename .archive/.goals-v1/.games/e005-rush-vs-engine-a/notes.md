# E005 Rush vs Engine A

## Strategy

P1 used the assigned rush/tempo plan from the top-right seat. The deck prioritized Blast and Zap, then Silver when available, and never bought Copper. Board play pushed raiders and scouts through the northeast/east approach into center pressure while keeping the original marksman behind the first wave when possible.

P2 used the assigned slower engine/stabilization plan from the bottom-left seat. The deck prioritized Peddler, Village, Silver, and Gold, never bought Copper, and relied on printed druid/healer style stabilization rather than early attack cards. Board play emphasized west-south and center-south access, with guardians and druids recruited as screens.

Expected tension: whether sketch-v2-access slows P1's rush acceleration enough for P2's economy/engine to stay viable.

## Rules Calls

- Recruited units were delayed: they entered at the end of the recruiting board phase and did not move, attack, heal, capture, or reattack that phase.
- Supply income was gained before movement. Supply control persisted after units left a center.
- Deck damage was attached only to legal attacks by ready friendly units. Unused deck damage expired.
- Movement used flat-top odd-column offsets from the locked rules and avoided blocked or occupied hexes.
- Printed healing happened after attacks and only from units that did not attack that turn.

## Ambiguities

- The replay schema has no ready/exhausted field, so delayed recruit compliance is represented in the generation policy, timeline reasoning, and this note.
- "Stay in place" was not used to claim a supply center; centers were only flipped by movement ending on the center.

## Stopping Point

Stopped after 15 completed player turns. Final board state:

- P1: 9 living units, 0 saved supply, controls center-center-south, center-northeast, center-east, center-southeast.
- P2: 5 living units, 4 saved supply, controls center-west-south.
- Neutral: center-northwest, center-center-north, center-center.

P1 has a start-of-turn win threat on the next P1 turn.

## Evidence Quality

Evidence quality: full if validation passes. The replay uses CLI-compatible deck snapshots for every completed turn, before/after board snapshots, a locked map/ruleset, and documented timing calls.

## Turn Log

- turn-001: P1 played Zap, produced 5 money and 1 damage, bought Blast; gained 2 supply; flipped center-northeast; moved raider-1 to 8,1, scout-1 to 12,4, marksman-1 to 10,1, guardian-1 to 11,2.
- turn-002: P2 played no actions, produced 5 money and 0 damage, bought Peddler; gained 2 supply; flipped center-west-south; moved scout-1 to 3,7, scout-2 to 2,8, druid-1 to 2,7.
- turn-003: P1 played Blast/Blast/Blast, produced 2 money and 6 damage, bought nothing; gained 3 supply; flipped center-east; moved scout-1 to 9,5, marksman-1 to 9,1, guardian-1 to 11,3; recruited scout-2.
- turn-004: P2 played Village/Peddler, produced 7 money and 0 damage, bought Gold; gained 3 supply; flipped center-center-south; moved marksman-1 to 1,7, scout-2 to 5,7; recruited guardian-1.
- turn-005: P1 played Zap, produced 5 money and 1 damage, bought Blast; gained 4 supply; moved scout-1 to 6,7, scout-2 to 10,4, guardian-1 to 11,4; scout-1 hit scout-2 for 3 (1 deck).
- turn-006: P2 played Peddler/Peddler, produced 8 money and 0 damage, bought Gold; gained 4 supply; flipped center-west-south; moved guardian-1 to 1,8, marksman-1 to 2,8, scout-1 to 4,7, druid-1 to 3,7; scout-1 hit scout-1 for 2; scout-2 hit scout-1 for 2.
- turn-007: P1 played Zap/Blast/Blast, produced 3 money and 5 damage, bought Zap; gained 4 supply; flipped center-east; moved scout-2 to 9,5, guardian-1 to 10,5; scout-1 hit scout-2 for 5 (3 deck); scout-2 died; recruited raider-2.
- turn-008: P2 played Village, produced 7 money and 0 damage, bought Gold; gained 4 supply; flipped center-center-south; moved scout-1 to 5,7; scout-1 hit scout-1 for 2; recruited guardian-2.
- turn-009: P1 played Blast, produced 4 money and 2 damage, bought Blast; gained 4 supply; flipped center-east; moved raider-2 to 9,0, scout-2 to 6,6, guardian-1 to 9,5; scout-1 hit scout-1 for 4 (2 deck); scout-2 hit scout-1 for 2; recruited scout-3.
- turn-010: P2 played Peddler/Peddler, produced 10 money and 0 damage, bought Gold; gained 4 supply; moved guardian-2 to 1,7; scout-1 hit scout-1 for 2; scout-1 died; recruited druid-2.
- turn-011: P1 played Blast, produced 4 money and 2 damage, bought Blast; gained 4 supply; moved scout-3 to 10,4; scout-2 hit scout-1 for 4 (2 deck); scout-1 died; recruited scout-4.
- turn-012: P2 played Peddler, produced 11 money and 0 damage, bought Gold; gained 4 supply; moved guardian-2 to 2,7, druid-2 to 1,7; recruited druid-3.
- turn-013: P1 played Zap/Blast/Blast, produced 3 money and 5 damage, bought Zap; gained 4 supply; flipped center-center-south; moved scout-2 to 5,7, scout-3 to 10,5, scout-4 to 10,4; scout-2 hit druid-1 for 4 (2 deck); recruited marksman-2.
- turn-014: P2 played Village/Peddler, produced 10 money and 0 damage, bought Gold; gained 3 supply; moved marksman-1 to 3,8, druid-1 to 4,7, druid-2 to 2,8, druid-3 to 1,7; marksman-1 hit scout-2 for 4; druid-1 healed druid-1 for 1.
- turn-015: P1 played Zap/Blast/Blast/Blast/Blast, produced 1 money and 9 damage, bought nothing; gained 5 supply; flipped center-southeast; moved scout-3 to 9,7, scout-4 to 10,5; scout-2 hit druid-1 for 7 (5 deck); druid-1 died; recruited raider-3.
