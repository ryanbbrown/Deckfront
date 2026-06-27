# E024b R1 Center-Flank A

Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6-tight`

Map: `sketch-v5-recenter`

Starter: `.games/e024b-highmove-center6-tight-starter.board.json`

## Strategy Assignment

P1 played center-control with economy support and enough combat buys to punish center contests. Board priorities were high-movement recaptures, reduced home-base congestion, and guardians/marksmen holding central lanes.

P2 played a sharper flank/economy line than round 1, emphasizing money, storm/blast turns, repeated recruitment, and faster scout/raider lane pressure. Board priorities were lower/east lane flips first, then center-south and northwest probes when P1 over-rotated.

## Result

Winner: P2 by confirmed unit-count response-window win after 31 completed player turns.

Final living units: P1 6, P2 10. Final center split: P1 3, P2 5, neutral 0.

## Legality

Every timeline entry includes strict action logs for movements, recruits, attacks, heals, and upgrades. This run intentionally uses no healing or permanent upgrades; those arrays are present and empty when unused.

The late six-center dominance rule was checked only at start-of-turn after at least 18 completed player turns had already been recorded. In E024b, a six-center threat is prevented or cleared when the opponent is at least 2 living units ahead. Pending, cleared, and confirmed six-center threats are recorded in the win log when they occur.

## Win Log

- Start turn 30: P2 creates pending lead-4 threat at units P1 6 / P2 10.
- Start turn 32: P2 confirms lead-4 response-window win at units P1 6 / P2 10.

## Observation

High movement again produced fast center contact and repeated recapture attempts. This run tests whether the tighter E024b six-center deficit threshold changes the center-control versus flank/economy line without producing a cheap center win.
