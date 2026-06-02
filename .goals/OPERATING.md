# Operating Instructions

## Standards

- Keep ruleset changes in a new `rulesets/<id>/` folder.
- Keep map changes in a new `maps/<id>.json` file.
- Keep each experiment run in `.games/<experiment-id>-<slug>/`.
- Every completed run should have `deck.json`, `board.json`, `timeline.json`, and `snapshots/`.
- Validate replay bundles before treating a run as complete.
- Record ambiguous rules calls in the run notes.
- Playtest agents must read `.goals/prompts/PLAYTEST_AGENT.md`.
- Review/evaluation agents must read `.goals/prompts/REVIEW_EVALUATE_AGENT.md`.
- Do not conclude from a single playthrough unless explicitly directed.

## Workflow

- Read `.goals/GOAL.md`, `.goals/OPERATING.md`, `.goals/PLAN.md`, `.goals/EXPERIMENTS.md`, and `.goals/PROGRESS.md` before starting.
- The main agent acts as orchestrator.
- Use subagents for playthroughs, review, and evaluation when useful.
- For each ruleset experiment, run 2-3 distinct strategy matchups.
- For each strategy matchup, run 2 parallel playthrough agents with the same prompt.
- Tell each playthrough agent to read `.goals/prompts/PLAYTEST_AGENT.md` directly.
- The orchestrator prompt should add only run-specific paths, ruleset/map ids, and P1/P2 strategy assignments.
- Each strategy assignment must specify P1 and P2 deck strategy, board strategy, and unit priorities.
- Use one combined review/evaluation agent to review all runs in an experiment batch and produce one ruleset/map score.
- Update `.goals/PLAN.md` as the next queue changes.
- Add one structured entry to `.goals/EXPERIMENTS.md` per experiment.
- Append durable decisions and direction changes to `.goals/PROGRESS.md`.

## Subagent Context

Playthrough agents should read:

- `.goals/prompts/PLAYTEST_AGENT.md`
- `.goals/GOAL.md`
- `.goals/OPERATING.md`
- The active `rulesets/<id>/board-rules.md`
- The active `rulesets/<id>/deck.yaml`
- The active `maps/<id>.json`

Review/evaluation agents should read:

- `.goals/prompts/REVIEW_EVALUATE_AGENT.md`
- `.goals/GOAL.md`
- `.goals/OPERATING.md`
- The active `rulesets/<id>/board-rules.md`
- The active `rulesets/<id>/deck.yaml`
- The active `maps/<id>.json`
- The batch's run directories, including `timeline.json`, `board.json`, `deck.json`, `notes.md` if present, and snapshots

Do not give review/evaluation agents `.goals/EXPERIMENTS.md` or `.goals/PROGRESS.md` by default. Prior conclusions can bias scoring; provide them only when explicitly asking for comparison.

## Experimentation Style

Experiments may change important rules, not just numbers. Agents may test changes to win conditions, movement timing, attack rules, recruitment, supply income, card effects, unit roles, or map structure.

Keep experiments interpretable:

- Large conceptual changes should usually be tested alone or with only minimal supporting changes.
- Small tuning changes can be grouped when they target the same hypothesis.
- Do not make massive unrelated changes in one experiment.
- Do not only make tiny local tweaks if the current design seems stuck.
- If an experiment works, iterate near it.
- If it fails, record the lesson and try a different direction.

## Evaluation Flow

- Playthrough agents produce game evidence.
- One review/evaluation agent checks legality, replay coherence, issue severity, and scoring.
- Slightly flawed runs may still be useful evidence if the issue is minor and documented.
- Runs with major or invalid issues should receive little or no scoring weight.
- The review/evaluation agent should cite specific runs as evidence for each score category.
- The orchestrator records the score in `.goals/EXPERIMENTS.md`, summarizes durable lessons in `.goals/PROGRESS.md`, and updates `.goals/PLAN.md`.

## Updating Goal Files

Agents should normally treat `.goals/` files as stable instructions.

They may update goal files when an experiment reveals a durable improvement to the process, scoring, prompts, or workflow. Changes to `.goals/GOAL.md` or `.goals/OPERATING.md` should be recorded in `.goals/PROGRESS.md`.

Do not rewrite goal files casually during ordinary experiments.
