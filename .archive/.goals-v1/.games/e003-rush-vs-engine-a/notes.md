# E003 Rush vs Engine A

## Strategy

P1 followed the assigned rush plan: early Blast/Zap buys, fast northeast/east expansion, then central pressure with scouts, raiders, and guardian contact. P2 followed the engine plan: Village/Peddler into repeated Gold buys, guardians as screens, and Healer buys once P1 started converting deck damage into kills.

## Rules Calls

- Recruited units were treated as delayed and did not move, attack, heal, capture, or reattack until their controller's next board phase.
- Deck damage was attached only to legal attacks by ready friendly units. Unused damage was allowed to expire.
- Printed druid healing was used instead of attacking on turn 6.
- Supply income was gained before movement, and supply control persisted after units left centers.

## Ambiguities

No material ambiguity was needed beyond the locked rules. The replay does not encode delayed readiness in board JSON because the current schema has no readiness field; delayed-recruit compliance is recorded in the timeline reasoning and notes.

## Stopping Point

Stopped after 14 completed player turns. After P2 turn 14, P1 has 8 living units and P2 has 5. Under the locked rule, P1 wins at the beginning of P1 turn 15 with a 3-unit lead.

## Evidence Quality

Evidence quality: full. The replay validates, uses CLI-generated deck snapshots for each completed player turn, records before/after board snapshots, and logs the main timing/rules calls.
