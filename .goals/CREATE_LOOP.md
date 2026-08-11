# Create a goal loop

Use this file once when the task is to create a loop. Use `.goals/OPERATING.md` when the task is to run or resume a loop.

## Create the loop folder

1. Find the highest loop id under `.goals/loops/`.
2. Create `.goals/loops/<next-id>-<short-name>/` with the next sequential id.
3. Add `GOAL.md`, `PLAN.md`, and `EXPERIMENTS.md` from the templates in this file.
4. Replace every bracketed field before the first experiment.
5. Resolve each decision that could change the first experiment.
6. Confirm that the goal, allowed changes, evidence, completion criteria, and autonomy rules are explicit.

Loop creation is complete when another agent can run the loop from its three files and `.goals/OPERATING.md` without prior conversation context.

## `GOAL.md`

```md
# [Loop id]: [Loop name]

Code root: .
Run root: .games/[loop-id]

## Objective

[One measurable outcome for this loop.]

## Why this loop exists

[The known problem or uncertainty.]

## In scope

- [Questions this loop can test.]

## Allowed changes

- [Files, values, or systems the loop can change.]

## Frozen parts

- [Parts that must remain constant.]

## Experiment method

- [Required matchups, controls, seeds, and strategy checks.]

## Evidence and metrics

- [Primary and supporting measures.]

## Completion criteria

- [Evidence required to complete the loop.]

## Autonomy

- [Changes the loop can make without another approval.]
- [Changes that require user direction.]
```

## `PLAN.md`

```md
# Plan

## Current phase

[Definition, baseline, exploration, confirmation, or complete.]

## Next experiment

[The next hypothesis and batch, or "Not defined".]

## Queue

1. [Next action.]

## Open decisions

- [A decision that blocks or changes the next experiment.]

## Blockers

- None.
```

## `EXPERIMENTS.md`

```md
# Experiments

No experiments recorded.

## Entry format

### E001: [Title]

- Status: planned | running | complete | stopped
- Hypothesis:
- Primary lever:
- Exact changes:
- Frozen controls:
- Model and settings:
- Strategy matchups:
- Seeds:
- Run cap:
- Run paths:
- Tests:
- Validation:
- Strategy representation:
- Evidence level:
- Results:
- Decision:
- Next step:
```
