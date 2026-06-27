# Plan

## Current Strategy

Keep E024 as the current best strict candidate after E024b fixed the unit-deficit caveat mechanically but failed the pacing stress test.

The replay validator now checks snapshot legality, has a strict mode requiring explicit movement, recruit, attack, heal, and upgrade action logs, and has a strict-win mode requiring explicit `winEvents` for response-window threat creation, clearing, and confirmation. Old E013 evidence is downgraded: only three E013 runs pass snapshot-level validation, and zero pass strict validation because old timelines lack action logs.

E019 produced six strict legal E013-shell retests, all P2 wins. That validates that P2 agency on `sketch-v3-contest` is real under legal play, but it refutes E013 as the current best balanced candidate because the result is one-sided and often long. E020's recentered map restored mixed winners but produced a 119-turn upgrade/support vs swarm game. E021 removed printed unit healing and shortened that line only to 89 turns while worsening rush/engine. E022 high movement increased churn and produced mixed winners, but upgrade/support vs swarm still took 81 turns. E023 added a late center-majority response-window win and shortened that line to 71 turns, but that was still too long. E024 strengthened territorial pressure with a six-center dominance clock and produced six strict wins between 24 and 37 turns, with no under-20 cheap center wins. E024b tightened the six-center deficit threshold and repeated three strict generic matchups, but all three resolved by unit-count before six-center dominance mattered. Targeted E024b stress runs then reproduced the six-center branch and showed the stricter 2-unit clear condition blocks the down-two win but stretches support/swarm back to 67 turns.

Next playthrough evidence must pass `bun run validate-run -- --strict --strict-win <timeline.json>`.

## Next Queue

1. E025 - Run a fresh three-matchup E024 confirmation round under the new `winEvents` and `terminalWinEvents` logging standard.
2. Validate every E025 run locally with `bun run validate-run -- --strict --strict-win <timeline.json>`.
3. Treat E024 as the current best strict ruleset for summaries and viewer recommendations only if E025 passes the stricter gate.
4. If the down-two six-center win is unacceptable, test a different counterplay lever than E024b's 2-unit clear threshold, because that threshold regressed the stressed support/swarm lane to 67 turns.
5. Do not add cards yet; the current best shell is about movement, map, win timing, and validation quality.

## Current Best

Current best is E024, with caveats. It has six current-strict runs, mixed winners, no under-20 cheap wins, and support/swarm resolved in 37 and 24 turns instead of the prior 71-119 turn failures. E024b proved the down-two six-center win can be blocked, but its targeted stress branch took 67 turns, so E024b is not currently better. The live design tradeoff is whether E024's faster resolution is worth allowing a 6-center controller to win while down two units.

## Open Questions

- Should a unit-count win require holding the lead across a full opponent response turn?
- Is the current start-of-turn win check too brittle once a player loses forward units?
- Which map/economy change most directly prevents recurring 5-2 and 6-2 center splits?
- Should the current best shell become damage cap plus lead-4 response-window timing?
- How can `sketch-v3-contest` keep P2 defensive agency without making P2 flank/economy too strong?
- Can slower deck-building or upgrade/support plans become true win threats rather than only stabilizing responses?
- How can upgrade/support stay viable without producing 46-turn support-ball games?
- Which guardian/healer/druid or support-card tuning shortens attrition loops without deleting slower engine/support viability?
- Should setup be normalized so `deck.yaml` matches the written 7-Copper plus draft-coin start?
- Does recentering `center-center-south` reduce P2's lower/east economy package without reviving P1 rush snowball?
- Does strict validation consistently push games into 30-50+ turn resolutions, or was that specific to E013's P2/economy lean?
- Does removing printed druid/healer healing shorten support-ball games while preserving deck-based healing and upgrade payoffs?
- Does much higher movement reduce home-base clumping and long replacement grinds, or does it simply make rush/flank pressure more decisive?
- Can a six-center response-window threat resolve long games without feeling arbitrary when the controller is behind on units?
