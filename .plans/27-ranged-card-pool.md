# Ranged card pool

## Outcome

The random market has one simple ranged attack and one new ranged movement attack. Shot no longer duplicates Steady Shot. Aim does not change in this work.

## Card rules

- Remove Shot from the game data and every exhaustive card registry.
- Steady Shot costs 3 and deals 2 damage at Near or Far range.
- Add Repelling Shot as a variable Ranged card that costs 3.
- Repelling Shot can be played at Near or Far range. It deals 1 damage, then tries to increase the distance between the fighters by moving the opponent one space. If the opponent cannot move farther away, it moves the active fighter one space farther away. If neither move is legal, neither fighter moves.
- Repelling Shot is a ranged attack and a Tactical Action. Aimed does not affect it because Aim keeps its current Volley-only rule.

## Implementation

- Implement the rule in the immutable game engine and the compact simulation kernel.
- Include Repelling Shot in action availability, simulation evaluation, telemetry, reporting families, random markets, and generated balance kingdoms.
- Remove obsolete Shot tests and replace them with Repelling Shot tests for opponent movement, fallback movement, no legal movement, range gating, damage, and compact-kernel parity.
- Regenerate the 100-kingdom manifest without running any experiments. The eligible card pool must exactly match all variable market cards.
- Keep the existing historical 18-card report unchanged.

## Verification

- Focused card, kernel, random-market, balance-suite, and report tests pass.
- Full tests, typecheck, lint, simulator build, production build, and diff check pass.
- The simulator protocol or rules fingerprint changes so old balance artifacts cannot be accepted as current.
- After review fixes pass, start fresh runs for the 80 tuning kingdoms. Run two kingdoms at once with four pairing workers each. The run must continue independently while report presentation work happens.
