# E023r1 Center-Flank A

Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-highmove-centermid`

Map: `sketch-v5-recenter`

Starter: `.games/e023-highmove-centermid-starter.board.json`

## Strategy Assignment

P1 played center-control with economy support, using high-movement scouts/raiders for recaptures and guardians/marksmen for central holding.

P2 played flank/economy, emphasizing scouts and raiders to attack lower/east lanes, flip centers, and turn center income into repeated recruitment.

## Result

Winner: P1 by confirmed unit-count response-window win after 30 completed player turns.

Final living units: P1 9, P2 4. Final center split: P1 3, P2 4, neutral 1.

## Legality

Every timeline entry includes strict action logs for movements, recruits, attacks, heals, and upgrades. This run intentionally uses no healing or permanent upgrades; those arrays are present and empty when unused.

The late center-majority rule was checked at each start-of-turn gate after 24 completed player turns. Pending, cleared, and confirmed center-majority threats are recorded in the win log when they occur.

## Win Log

- Start turn 29: P1 creates pending lead-4 threat at 8-3.
- Start turn 31: P1 confirms lead-4 response-window win at 9-4.

## Observation

High movement produced fast center contact and repeated recapture attempts. The late center-majority branch mattered only if a player sustained 5+ centers while not behind on units after the 24-turn gate; otherwise the normal lead-4 unit-count response window remained the resolving pressure.
