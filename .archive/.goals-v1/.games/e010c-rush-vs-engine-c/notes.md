# E010c Rush vs Engine C Response-Window Notes

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
- E010 retargets the validated E007c line to `territory-v1-cost6-damagecap-responsewin`. Normal recruitment, damage cap, deck state, map, and unit rules were kept unchanged; only the unit-count win timing changed.
- The old E007c final position at the beginning of P1 round 11 was treated as a pending P1 unit-count win threat, not an immediate win.

## Ambiguities

- The rules prose describes 7 Copper plus up to 12 draft coin, while deck.yaml contains a fixed starter deck. This run used the rules prose draft setup so P1/P2 could follow the assigned divergent strategies from turn 1.
- Movement and attack legality were resolved manually from the odd-column map rules; validation checks replay continuity but does not independently verify tactical legality.
- On turn 21, P1 assigned capped deck damage only through legal ready attackers. Exact overkill allocation on P2-scout-2 is not material to the final response-window result; the run records the least expansive tactical effect needed for the state: P2-scout-2 removed and P2-guardian-1 damaged to 6 HP.

## Stopping Point

- Source comparison: `.games/e007c-rush-vs-engine-c/` validated at 20 entries, ending with P1 10 units / P2 7 units, P1 6 centers / P2 2 centers, and an immediate start-turn P1 win under the old timing.
- Under E010 response-window timing, P1's 10-7 lead at the beginning of P1 round 11 created a pending P1 threat instead of ending the game.
- P1 completed turn 21, killed P2-scout-2, recruited delayed P1-raider-7, and widened the pending threat to 11-6.
- P2 then received the required full response turn. P2 killed P1-raider-1 but had only 5 saved supply after income, so no recruit was legal at cost 6. The response ended at P1 10 units / P2 6 units.
- P1 wins at the beginning of P1 round 12, before any turn-23 actions, because the pending 3-unit lead survived P2's full response turn.
- Continued beyond the 16-turn checkpoint and stopped after 22 completed player turns.
- Final supply centers: P1 6, P2 2, neutral 0.
- Final saved supply: P1 3, P2 5.
- Result: P1 confirmed win. The response-window rule changed the prior stopping point by forcing two more completed player turns, but it did not let P2 clear the threat.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity and useful for the damage-cap question, with the tactical-legality caveat above.
- Main observation: P1 could improve capped damage by adding attackers and reattack support, and the center-income lead eventually beat P2's healing screen once P2 could no longer recruit fast enough to keep unit counts tied.
