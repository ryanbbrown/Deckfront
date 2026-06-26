# Plan

## Current Strategy

Reset the playtest process before treating any new experiment as evidence.

## Next Queue

1. Rebuild validation requirements for full deck and board state fidelity.
2. Align `deck.yaml`, board rules, and run setup before starting new experiments.
3. Run fresh experiments only after the workflow requires real deck-state continuity.

## Current Best

None. Prior generated experiments are archived in `.goals-v1` and should not be treated as validated evidence under the reset process.

## Open Questions

- What exact validation should make a replay qualify as full deck-building evidence?
- Should custom run generators be disallowed entirely, or allowed only for fixtures and approved tooling?
- What is the canonical starting deck rule for the next ruleset baseline?
