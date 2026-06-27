# E007c Rush vs Engine C Notes

## Strategy

- P1 followed the assigned rush/tempo plan with an alternate branch: Storm and Bandage were drafted early, then Second Wind was bought to test whether extra attacks help capped deck damage more than another raw damage card.
- P1 board play pressed northeast, east, center, and northwest, trying to keep several ready attackers near contested centers.
- P2 followed the engine/heal/control plan with Village/Peddler economy, Potion/Healer stabilization, and guardian/druid recruits to deny clean focus-fire assignments.

## Rules Calls

- Fixed starting decks used 7 Copper plus 11-cost draft packages: P1 drafted Storm, Zap, and Bandage; P2 drafted Peddler, Village, and Silver. No draft coin carried over.
- Recruited units were treated as delayed. The JSON schema has no readiness flag, so delayed activation is documented in timeline reasoning.
- Deck damage was attached only to legal attacks by ready units. Each attacking unit received at most 1 extra deck-produced damage for the whole turn; unassigned damage expired.
- Second Wind reattack was treated as the same attacking unit for the damage cap.
- Storm targeting was resolved with the least expansive interpretation: it needed a legal original attack target, connected occupied enemy hexes, and still obeyed the per-attacker damage cap.
- The continuation honored the checkpoint deck hands already present in `deck.json`; P2's turn 18 hand was five Coppers, so P2 bought Healer but produced no deck healing that turn.

## Ambiguities

- The rules prose describes 7 Copper plus up to 12 draft coin, while deck.yaml contains a fixed starter deck. This run used the rules prose draft setup so P1/P2 could follow the assigned divergent strategies from turn 1.
- Movement and attack legality were resolved manually from the odd-column map rules; validation checks replay continuity but does not independently verify tactical legality.

## Stopping Point

- Continued beyond the 16-turn checkpoint and stopped after 20 completed player turns.
- P1 wins at the beginning of P1 round 11, before turn 21 board actions, with a 10-7 living-unit lead.
- Final supply centers: P1 6, P2 2, neutral 0.
- Final saved supply: P1 1, P2 1.
- Result: P1 win. P1 converted the 5-2 center lead into faster recruitment, killed P2-druid-1 and P2-scout-1, then survived P2's response turn with the required 3-unit lead intact.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity and useful for the damage-cap question, with the tactical-legality caveat above.
- Main observation: P1 could improve capped damage by adding attackers and reattack support, and the center-income lead eventually beat P2's healing screen once P2 could no longer recruit fast enough to keep unit counts tied.
