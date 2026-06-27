# E003 Swarm vs Upgrade B Notes

## Strategy

- P1 followed the swarm/economy assignment: trashed Copper when it did not block the money plan, bought Gold repeatedly from the strong draft start, and recruited scouts/raiders/marksmen to keep board coverage high.
- P1 prioritized supply centers over compact formation play. By turn 14, P1 controlled 5 centers and had 9 living units.
- P2 followed the upgrade/heal quality assignment: Training, Armory, and Potion were sequenced through the CLI whenever drawn, with permanent upgrades concentrated on P2-marksman-1 and P2-guardian-1.
- P2 avoided Copper buys and recruited guardians/marksmen/healer support rather than matching P1 scout volume.

## Rules Calls

- Starting decks were initialized before the first save with CLI `--starting-deck`.
- P1 used the full 12 draft coin: 7 Copper plus Gold, Silver, Zap.
- P2 used 10 draft coin and left 2 unspent: 7 Copper plus Armory, Training.
- Start-of-turn unit-lead win checks were evaluated for the active player. No start-of-turn check reached a 3-unit lead.
- Recruited units were treated as delayed: no same-turn movement, attacks, healing, captures, or reattacks.
- Deck damage was only attached to legal attacks by ready friendly units, never used as direct global spell damage.
- Deck upgrades were permanent board-state changes on specific living units.
- Potion deck healing and printed unit healing were capped at max HP and could not revive removed units.

## Ambiguities

- P2 could often choose whether Armory/Training upgrades should stack on the already-upgraded marksman or the guardian. I concentrated later upgrades on the guardian because the assigned strategy emphasized durable elite anchors.
- Potion plus printed healing created several allocation choices. I used the least expansive interpretation: each healing source healed one living friendly unit within normal constraints, capped by max HP.
- The board line uses the same broad lane fight as the prior swarm-vs-upgrade matchup, but E003's locked starting decks materially changed P2 upgrade timing and final unit stats.

## Stopping Point

Stopped after 14 completed player turns, at the start of P1 round 8.

- Winner: none.
- Board leader: P1.
- Units: P1 9, P2 8.
- Centers: P1 5, P2 2, neutral 1.
- Saved supply: P1 5, P2 2.
- Key tactical state: P2 has a heavily upgraded guardian at 20/26 HP with 7 attack and an upgraded marksman at 8/10 HP with 6 attack, but P1 has broader center control and more bodies.

## Evidence Quality

Evidence quality: full. `bun run validate-run -- .games/e003-swarm-vs-upgrade-b/timeline.json` passed with 14 entries. Deck turns were executed through the CLI, and every completed player turn has before/after deck and board snapshots. The main residual uncertainty is healing/upgrade allocation, which is recorded above.
