# E004 Engine vs Rush A

## Strategy

P1 followed the assigned slower economy/engine plan from the P1 seat. The deck opened Village/Peddler into repeated Gold buys, then pivoted into Healer buys once P2 started converting deck damage into kills. P1 avoided Copper buys and trashed Copper on later turns when the buy target stayed intact.

P1 board play preserved units where possible, took northeast/east first from the starting seat, then pushed west/south into center-north and center. Guardians were recruited repeatedly as screens, with druids added for stabilization. Printed and deck healing often arrived after P2 had already killed the target, so healing had lower practical value than expected.

P2 followed the assigned rush/tempo plan from the P2 seat. The deck bought mostly Blast/Zap and avoided Copper. P2 used scouts/raiders to pressure west-south, center-south, and then center, while protecting the marksman enough for it to add finishing damage. P2 obeyed delayed recruit activation.

## Rules Calls

- Recruited units were delayed and did not move, attack, heal, capture, or reattack until their controller's next board phase.
- Supply income was gained before movement, and supply control persisted after units left centers.
- Deck damage was attached only to legal attacks by ready friendly units. Unused damage expired.
- Movement happened before attacks, so units killed during combat did not allow same-turn center flips unless the center had already been entered during movement.
- Printed druid healing and deck-produced healing happened after attacks and could not revive killed units.
- Optional start-of-turn trashing was used for P1 Copper cleanup when it did not block the intended buy.

## Ambiguities

No material ambiguity beyond the locked rules was needed. The replay schema still does not encode delayed readiness, so delayed-recruit compliance is recorded in timeline reasoning and here.

## Stopping Point

Stopped after 20 completed player turns. No formal win had resolved because the final state is the beginning of P1 round 11, and P2's unit-lead win would only be checked at the beginning of P2's own turn.

Final board state:

- P1: 5 living units, 4 saved supply, controls center-north, northeast, and east.
- P2: 9 living units, 0 saved supply, controls west-south, center, and center-south.
- Neutral: northwest and southeast.

P2 is the clear leader. P2 ended turn 20 with a 9-to-5 unit lead after a 12-damage deck turn, so P1 would need to recruit and remove units on turn 21 to prevent a P2 start-of-turn win on turn 22.

## Evidence Quality

Evidence quality: full. The replay validates, has 20 completed player turns, uses CLI-generated deck snapshots for every turn, records before/after board snapshots, and logs the main timing and rules calls.
