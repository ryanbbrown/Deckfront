# Step 8: profile complete experiments

Implements step 8 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 7.

Step 9, a native-language port, is outside this goal. `GOAL.md` keeps TypeScript as the reference implementation.

## Objective

Measure where a complete experiment spends its time, then remove avoidable cloning and event recording. Profile before optimising.

## Method

1. Run one smoke experiment with `--prof`, or with `node --cpu-prof` through `tsx`, and record the top costs.
2. Record measured throughput: matches per second, action-search nodes per decision, and the maximum node count seen.
3. Only then change code, in the order the design document gives: avoidable cloning first, then event recording.

Record the measurements in `PROGRESS.md` before and after each change. A change without a before-and-after number does not belong in this step.

## Expected costs

Two are known from reading the code, and the profile must confirm them before either is changed.

- **Cloning.** `applyAction` calls `structuredClone` on the whole state for every action, and the action search applies many actions for each decision. `GameState.events` grows for the whole game, so each clone gets more expensive as the game runs. This makes a single game quadratic in its action count.
- **Event recording.** The search only needs the resulting state's score, not a readable history. Events are needed for telemetry in the real match, but not inside the search.

## Likely changes

Decide from the profile, not from this list:

- an event-recording mode that the search turns off, keeping it on for the real match;
- capping or draining `events` per turn once telemetry has consumed the slice;
- a cheaper clone for the search that copies only the mutable zones.

Any change here must keep results identical. Prove it: run a fixed set of seeded matches before and after and compare complete `MatchResult` values.

## Checks

1. A recorded before-and-after profile for each change.
2. A fixed set of seeded matches produces identical `MatchResult` values before and after every change in this step.
3. The measured throughput is recorded in `PROGRESS.md` and used to size the full run.

## Completion criterion

Throughput is measured and recorded, any optimisation is justified by a profile and proven result-identical, and the four verification commands pass.
