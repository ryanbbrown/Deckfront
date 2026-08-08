# Goal-loop review and evaluation guide

Review one completed experiment batch. Judge evidence quality before drawing a balance conclusion.

## Read first

- `.goals/OPERATING.md`.
- The named loop's `GOAL.md`.
- The exact code and configuration under test.
- The batch's raw run directories.

Do not read prior conclusions in the loop's `EXPERIMENTS.md` before the independent review. Read them later only when comparison is required.

## Validate each run

Run this command from the code root named in the loop goal:

```sh
bun run validate-run -- --strict --strict-deck --strict-win <timeline.json>
```

Confirm that the shared ThinHarness runner produced the run. Inspect the timeline, deck and board states, snapshots, actions, results, rendered context, tool calls, and submission metrics.

Check that:

- Deck actions came from the deck engine.
- Every action card resolved before copper trash and purchase choices.
- Purchases used the actual money available after the trash choice.
- Board upgrades used legal symbols and costs.
- Unit activations, attacks, movement, damage, and removals are reproducible.
- The recorded winner follows elimination or the turn-cap tiebreak.
- Retries do not hide a prompt, schema, runner, or validator defect.

## Judge the evidence

Use the evidence levels in `.goals/OPERATING.md`. Apply the loop goal's strategy-representation test before using a run for balance conclusions.

Separate these causes:

- Implementation or validation defect.
- Tool or prompt defect.
- Agent tactical mistake.
- Strategy mismatch.
- Random variation.
- Rules or balance signal.

A legal run can still provide weak balance evidence. A player must represent its assigned strategy before its result measures that strategy.

## Evaluate the batch

- Evaluate the named hypothesis and primary lever only.
- Compare mirrored seats and controls when the loop goal requires them.
- Cite specific turns and run paths for important claims.
- Do not infer a dominant strategy from one game.
- State when the sample is too small or too noisy.
- Recommend another batch, a nearby change, confirmation, or loop completion.

## Output

Write one concise evaluation with:

- Run validity and evidence levels.
- Strategy-representation results.
- Primary metrics and outcomes.
- Tactical and deck-building observations.
- Answer to the experiment hypothesis.
- Recommended decision and next experiment.
