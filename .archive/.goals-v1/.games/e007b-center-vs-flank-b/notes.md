# E007b Center vs Flank B Notes

## Strategy Assignment

- P1 deck: central pressure/control with economy and tactical tempo. P1 bought Peddler, Training, Silver, and Blast; no Copper buys.
- P1 board: compact guardian/marksman core contested the north and central supply centers. Scouts were used for safe flips and one center skirmish while upgraded guardians protected the middle.
- P2 deck: flank/economy/support with healing/control tools. P2 bought Peddler, Healer, Village, Silver, and Storm; no Copper buys.
- P2 board: west, center-south, and southeast lanes pulled P1 away from a clean center lock. Scouts held flank centers while druid/healer support preserved wounded units.

## Rules Calls

- Recruits cost 6 supply and were delayed. The higher cost materially changed turns 11 and 16: planned extra recruits were not affordable and were omitted.
- Deck `damage` was only used when attached to legal attacks. Some produced Blast/Storm damage was left unused instead of being treated as direct damage.
- Applied the E007 damage cap: each attacking unit could carry at most 1 deck-produced damage during the turn. Excess Blast/Storm damage expired.
- Training upgrades were stacked on `P1-guardian-1`, raising it to 12 attack by the stopping point. This was treated as legal because the rules do not limit repeated permanent upgrades on one living unit.
- Printed healing used range 1 for druids and range 2 for healers. Several heals were only recorded when the unit was in legal range.
- The starting decks used the ruleset's 7-Copper plus 12-coin draft interpretation: P1 drafted Blast, Silver, and Training; P2 drafted Potion, Village, and Peddler.

## Provenance

- This bundle uses the completed E006 center-vs-flank B deterministic replay as the mechanical line, then retargets all run-local board states to `territory-v1-cost6-damagecap`.
- The source line already avoided direct spell damage and left unused deck damage unassigned. Under E007, those turns are interpreted through the stricter cap: no attacker receives more than 1 deck-produced damage, and unused damage expires.
- No tracked source, ruleset, map, or goal files were changed.

## Stopping Point

- Stopped after 16 completed player turns with no start-of-turn unit-count win.
- Final unit count: P1 8, P2 8.
- Final supply control: P1 controls 4 centers (`center-center-north`, `center-center`, `center-northeast`, `center-east`); P2 controls 3 centers (`center-west-south`, `center-center-south`, `center-southeast`); `center-northwest` remains neutral.
- Final saved supply: P1 4, P2 5. P2 is one supply short of another recruit, which is direct evidence for the cost-6 slowdown.
- Leader: P1 by center control and central positioning, but the game is unresolved because P2 still has live southeast and center-south flank pressure.

## Ambiguities

- Storm was drawn on turn 16 but its damage was not used. The least expansive interpretation was to require a legal attack and useful connected targets; no storm split was forced.
- Because this is a retargeted B replay, the evidence is strongest for validating whether the damage-cap interpretation preserves an existing healthy center/flank line, not for discovering a fully independent tactical branch.

## Evidence Quality

Evidence quality: full for bundle validity and center/flank pacing evidence; provenance should be considered when comparing independence against E006 B.

Rationale: validation passes with 16 entries, every completed turn has before/after deck and board snapshots, and the replay documents movement, range, supply cost, recruit timing, healing range, attached deck damage, and damage-cap handling.
