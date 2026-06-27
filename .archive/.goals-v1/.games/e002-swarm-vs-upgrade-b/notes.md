# E002 Swarm vs Upgrade B Notes

## Strategy Execution

- P1 followed the swarm/economy assignment: early center grabs, repeated board recruiting, Peddler/Gold deck buys, and no Copper buys. P1 recruited scouts, raiders, and marksmen to keep board coverage high.
- P2 followed the upgrade/heal quality assignment where the draw allowed it: Armory, Potion, Silver, and a second Armory were bought; upgrades and healing were assigned to guardians, marksmen, and damaged forward units. P2 did not buy Copper.
- P1 controlled more centers for most of the run and converted that into a larger roster. P2 stayed tactically alive through healing and a guardian max-HP upgrade, but could not retake enough income.

## Rules Calls And Ambiguities

- Used the configured `rulesets/territory-v1/deck.yaml` starter deck with CLI seed 1, matching the existing baseline sample convention. The draft-start text in `board-rules.md` was not used; this is a baseline rerun from the provided max-HP board snapshot.
- Deck damage was only assigned through legal unit attacks, not as direct spell damage.
- Deck healing was assigned to one friendly living unit up to max HP.
- Unit healing used the least expansive interpretation: a druid/healer heals 1 friendly unit within its own range, instead of attacking.
- Board phase order used here: start-of-board income, movement and capture, upgrades/healing, attacks, recruitment, then advance active player.
- Start-of-turn unit-lead win checks were evaluated for the active player. No player had a 3-unit lead at the start of their own turn during the recorded 14 turns.

## Stopping Point

Stopped after 14 completed player turns, at the start of P1 round 8. The game was unresolved:

- Units: P1 9, P2 8.
- Centers: P1 5, P2 2, neutral 1.
- Saved supply: P1 5, P2 2.
- Board leader: P1, due to center control and broader unit coverage.
- Tactical state: P2 still has an upgraded guardian and multiple support/ranged bodies, but several units are damaged and P1 has enough income to keep recruiting.

## Evidence Quality

Evidence quality: full. `bun run validate-run -- .games/e002-swarm-vs-upgrade-b/timeline.json` passed with 14 entries. Deck phases were executed through the CLI and every completed player turn has before/after deck and board snapshots. The main residual uncertainty is rules interpretation, especially unit healing timing/range and the configured starter deck versus the draft-start rule text; both are recorded above.
