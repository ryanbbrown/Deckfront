# E006 Rush vs Engine B Notes

## Strategy Assignment

- P1 deck: rush/tempo with Blast and Zap buys, no Copper buys.
- P1 board: nearest-center rush into center-east, center, center-north, and northwest pressure while respecting delayed recruit activation and recruit cost 6.
- P1 units: scouts and raiders took pressure lanes and center flips; marksmen stayed behind the line where practical.
- P2 deck: slower economy/engine with Village, Peddler, Gold, and Silver priorities, no Copper buys.
- P2 board: preserve units, contest west/center-south, and stabilize with guardians and druids under cost 6.
- P2 units: guardians formed the screen, druids backed the screen, marksman stayed behind the front until pressured.

## Rules Calls

- Starting decks used the exact prompt lists. Each player spent 11 of the available 12 draft coin; the unspent coin was not carried forward.
- Recruits cost 6 supply. This materially delayed first recruits: P1 could not recruit on turn 3 with 5 supply, and P2 could not recruit on turn 4 with 5 supply.
- Recruited units were delayed. No recruited unit moved, attacked, healed, captured, or reattacked during the same board phase it entered.
- Deck damage was treated as attack-attached only. Generated damage with no useful legal attack was left unused rather than treated as direct spell damage.
- Printed healing was available but not used because P2's druids were mostly needed as body/screen support and had no high-value adjacent/ranged heal target that changed the position.

## Ambiguities

- No new ambiguity required a nonstandard ruling. The main interpretation-sensitive point was unused deck damage; the run used the least expansive attack-bound interpretation from the rules.
- The scripted replay generator in this run performs local movement, occupancy, attack range, supply, recruit-cost, and counter-spend checks, but the project validator still checks bundle structure and snapshot continuity rather than full game legality.

## Stopping Point

- Stopped after 16 completed player turns, at P1 round 9 to act.
- No start-of-turn unit-count win had resolved. Final unit count was P1 8, P2 7.
- P1 led board control 5 centers to 2, with center-southeast neutral. Both players had 5 saved supply.
- P1 had the stronger position through center control and multiple ready pressure units, but P2's guardian/druid screen kept the game from becoming an immediate unit-count win.

## Evidence Quality

- Evidence quality: full, pending validator success.
- The replay uses CLI deck snapshots for every completed turn and before/after board snapshots for every completed turn.
- The run is useful for the E006 question: cost 6 slowed supply-to-body conversion enough that P2 stayed within one unit through turn 16, but P1 still held a large center-income lead.
