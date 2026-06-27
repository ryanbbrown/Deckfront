# E004 Engine vs Rush B Notes

## Setup

- Run: `.games/e004-engine-vs-rush-b`
- Ruleset: `territory-v1-locked`
- Map: `sketch-v1`
- Starter board: `.games/e003-locked-starter.board.json`
- Completed player turns: 16
- Starting decks were fixed exactly from the control prompt:
  - P1 engine/stabilization: `copper,copper,copper,copper,copper,copper,copper,village,peddler,silver`
  - P2 rush/tempo: `copper,copper,copper,copper,copper,copper,copper,blast,blast,zap`

## Strategy

- P1 played the slower economy/engine seat. The deck plan trashed Copper when practical, bought Village/Peddler/Silver/Gold lines, and avoided Copper. Board play prioritized preserving units, taking safe near and central centers, then recruiting guardians, a druid, a healer, and marksmen behind the line.
- P2 played the rush/tempo seat from second position. The deck plan bought Blast/Zap and avoided Copper. Board play rushed the south/east lanes with scouts, then used raiders and marksman support to convert legal attack windows into tempo.
- Expected tension tested: whether the rush plan still beats engine when rush is P2 and engine is P1.

## Rules Calls

- Delayed recruit activation was enforced. Recruited units were only moved or used on later friendly turns.
- Deck `damage` was attached only to legal attacks by ready units. Unused damage was not treated as direct global damage.
- When a turn listed `bonus: "all"` in the run-local generator, it assigned all currently available deck damage to that legal attack.
- Supply income was gained before movement/captures each board phase.
- Supply control persisted after units moved away or died.
- The start-of-turn 3-unit-lead win check did not resolve by the stopping point. Final board is P1 to act in round 9 with P1 at 9 units and P2 at 7 units.

## Stopping Point

Stopped after 16 completed player turns. The game is unresolved but has clear pressure evidence:

- P1 leads material, 9 units to 7.
- P2 leads supply centers, 4 controlled centers to P1's 3, with `center-northwest` still neutral.
- P1's guardian wall survived the rush's highest-damage turns and removed both P2's first raider and support marksman.
- P2's rush still mattered: it killed P1's starting scout and raider, flipped southeast/center pressure, and kept a center-control edge despite moving second.

## Ambiguities And Caveats

- The fixed starting decks match the prompt and each uses 11 non-Copper draft coin value, leaving 1 unspent from the locked 12-coin draft framing.
- Deck damage became very bursty once P2 chained multiple Zap/Blast plays. This was legal under the CLI action economy, but the run should be reviewed for whether that amount of attack-attached damage feels too swingy.
- P1 bought many Golds after the engine came online because the priority list favored payload. That matched the economy/engine assignment but may under-test stabilizing healing buys.
- Board movement was generated and checked by the run-local script against map hexes, blocked hexes, occupancy, and movement range. The official replay validator checks snapshot continuity and active-player metadata, not full tactical legality.

## Evidence Quality

Evidence quality: full.

The replay bundle validates, has before/after deck and board snapshots for every completed player turn, and records the main rules calls. Remaining caveats are balance/design interpretation issues rather than known legality breaks.
