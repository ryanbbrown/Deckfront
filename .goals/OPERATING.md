# Goal-loop operating instructions

## File responsibilities

- Read `GOAL.md`, `PLAN.md`, and `EXPERIMENTS.md` from the loop named in the task.
- Run commands from the code root named in that loop's `GOAL.md`.
- `GOAL.md` defines the loop objective, scope, allowed changes, frozen parts, evidence method, and completion criteria.
- `PLAN.md` contains the current phase, next experiment, queue, open decisions, and blockers.
- `EXPERIMENTS.md` is the append-only record of experiment batches and loop decisions.

Do not use `PLAN.md` as history. Move finished work into `EXPERIMENTS.md`, then update `PLAN.md` to show only the current state.

## Start a loop

1. Copy the three file outlines from `.goals/LOOP_TEMPLATE.md` into a new loop folder.
2. Give the loop a sequential id such as `L001`.
3. Complete the goal, scope, evidence, and autonomy sections before the first balance experiment.
4. Treat the objective and allowed scope as fixed after the first experiment starts.

If later work needs a different objective or wider scope, complete the current loop and create another loop. Correct factual errors in place and record the correction in `EXPERIMENTS.md`.

## Run an experiment

An experiment is a batch of runs that tests one named hypothesis. A single game is one run, not one experiment.

1. Name the hypothesis and primary lever.
2. Define the exact change, matchups, seeds, model settings, and run cap.
3. Confirm that every change is allowed by the loop goal.
4. Record the planned batch in `EXPERIMENTS.md`.
5. Apply the smallest change that tests the hypothesis.
6. Run the required tests before game generation.
7. Generate runs through the shared ThinHarness runner.
8. Validate every evidence run.
9. Review strategy representation, legality, retries, and gameplay outcomes.
10. Finish the experiment entry and update `PLAN.md`.

Do not create one-off game generators for evidence runs. Do not replace engine actions with model-authored summaries.

## Store run artifacts

Store runs under `.games/<loop-id>/<experiment-id>/<run-id>/` unless the loop goal specifies another run root.

A complete run must contain the persisted deck and board states, timeline, snapshots, submitted actions, results, logs, rendered context, tool-call records, and submission metrics. The experiment entry must record:

- The exact command and working directory.
- The model and reasoning settings.
- The random seed and turn cap.
- Both player setups and strategy instructions.
- The rules, map, card, or code changes under test.
- Each run path and validation result.

## Validate evidence

Full evidence must pass:

```sh
bun run validate-run -- --strict --strict-deck --strict-win <timeline.json>
```

Use these evidence levels:

- `full`: Strict deck, board, and win validation passes. The run is complete, and no material legality issue is known.
- `partial`: The run remains useful but is incomplete, has a minor issue, or does not represent its assigned strategy well enough.
- `low`: A major limitation distorts the result, but the run can still suggest a follow-up question.
- `invalid`: The run cannot support a gameplay conclusion.

Validation proves legal state transitions. It does not prove good strategy or balanced rules.

## Evaluate a batch

- Apply the loop goal's strategy-representation rules before using a run for balance evidence.
- Compare mirrored player order when the loop goal requires it.
- Separate implementation defects, tool defects, agent mistakes, random variation, and balance signals.
- Score the experiment batch, not each game in isolation.
- Do not name a current best from one run unless the loop goal explicitly permits it.
- Use `.goals/prompts/REVIEW_EVALUATE_AGENT.md` as the only review prompt.

An independent reviewer should read the loop goal and raw run evidence before reading prior experiment conclusions. This order reduces confirmation bias.

## Respect loop scope

Follow the autonomy rules in the named loop's `GOAL.md`. Never change a frozen part to rescue a weak result.

Stop and request user direction before:

- Expanding the objective or allowed changes.
- Changing shared runner or validator behavior during a balance experiment.
- Changing the evidence threshold after seeing results.
- Starting another loop.

## Complete a loop

Complete a loop only when its stated completion criteria are met or the user ends it.

1. Record the final evidence and conclusion in `EXPERIMENTS.md`.
2. Replace the queue in `PLAN.md` with the final state and any deferred work.
3. Leave the completed loop unchanged except for dated factual corrections.
4. Create the next loop from the template when work continues under a new objective.
