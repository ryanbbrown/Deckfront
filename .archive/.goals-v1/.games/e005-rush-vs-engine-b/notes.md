# E005 Rush vs Engine B Notes

## Setup

- Run: `.games/e005-rush-vs-engine-b`
- Ruleset: `territory-v1-locked`
- Map: `sketch-v2-access`
- Starter board: `.games/e005-access-starter.board.json`
- Completed player turns: 16
- Starting decks were fixed exactly from the prompt:
  - P1 rush/tempo: `copper,copper,copper,copper,copper,copper,copper,blast,blast,zap`
  - P2 engine/stabilization: `copper,copper,copper,copper,copper,copper,copper,village,peddler,silver`

## Strategy

- P1 played early damage and tempo. The deck plan trashed Copper when practical, bought Blast/Zap and occasional Silver-like payload options when available, and avoided Copper. Board play rushed northeast, center-east, center, center-north, and northwest with scouts/raiders while keeping the marksman behind the line when practical.
- P2 played slower economy and stabilization. The deck plan trashed Copper when practical, bought Village/Peddler/Silver/Gold lines, and avoided Copper. Board play used the improved west and center-south access to contest supply, then recruited guardians, druids, and a healer to keep enough material alive.
- Expected tension tested: whether `sketch-v2-access` slows P1's rush acceleration enough for the P2 engine/stabilization plan to stay viable.

## Rules Calls

- Delayed recruit activation was enforced. Recruited units entered on home-base hexes and did not move, attack, heal, capture, or reattack until later friendly turns.
- Supply income was gained before movement and captures each board phase.
- Supply control persisted after units moved away or died.
- Deck `damage` was attached only to legal attacks by ready friendly units. Several large P1 damage turns left damage unused or constrained by range/position rather than becoming global direct damage.
- Printed healing was not forced when no useful legal heal existed. P2 recruited healers/druids for stabilization, but most late-game value came from guardian screens because damaged targets were often out of heal position.
- The run-local generator checked movement range, blocked hexes, occupancy, attack range, recruit cost/home hexes, and counter spend. The official validator checks snapshot continuity and active-player metadata.

## Stopping Point

Stopped after 16 completed player turns. The game is unresolved.

- Final state is P1 to act in round 9.
- Unit count: P1 9, P2 7. P1 does not satisfy the start-of-turn 3-unit-lead win check.
- Supply centers: P1 controls 5, P2 controls 2, and `center-southeast` remains neutral.
- Saved supply: P1 6, P2 4.
- P1 leads materially and positionally, but P2 stabilized enough that the next start-of-turn win check does not resolve the game.

## Ambiguities And Caveats

- The fixed starting decks match the prompt and each uses 11 non-Copper draft coin value, leaving 1 unspent from the locked 12-coin draft framing.
- P2's engine deck repeatedly bought Gold once it had enough money. That matched the economy/payload plan, but it under-tested Peddler/Village density after the first Village buy.
- P1's burst turns produced high deck damage, especially turns 3, 7, 11, and 15. Because damage required legal attacks, positioning still constrained those bursts; this run is useful evidence that attack attachment matters.
- P2's west/center-south access mattered: it let P2 claim west-south and center-south early, preserve a guardian screen, and prevent the P1 unit lead from reaching 3 by the stopping point.

## Evidence Quality

Evidence quality: full.

The replay bundle validates, includes before/after deck and board snapshots for every completed player turn, and records the main rules calls. Remaining caveats are balance/design interpretation issues rather than known legality breaks.
