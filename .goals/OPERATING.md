# Operating Instructions

## Core Standards

- The current experiment code path is `experiments/E001-current-best/code`.
- Keep experiment evidence in `experiments/E001-current-best/runs/<run-id>/`.
- Run playthroughs through the shared ThinHarness runner, not custom per-experiment generators.
- Do not create custom run-generation scripts for evidence runs unless the user explicitly approves that specific script and it uses shared validation-grade APIs.
- Every evidence run should include `deck.json`, `board.json`, `timeline.json`, `snapshots/`, `actions/`, `results/`, `logs/`, and rendered context.
- Every completed timeline entry must include per-turn `actions` so strict validation can audit movement, recruitment, attacks, healing, and permanent upgrades.
- Win bookkeeping should be produced by shared code, not by model-authored prose. Runs that end on a start-of-next-turn confirmation must use root-level `terminalWinEvents`.
- Validate replay bundles with `bun run validate-run -- --strict --strict-deck --strict-win <timeline.json>` before treating a run as full evidence.
- Non-strict validation is only a structural audit and cannot prove gameplay legality.
- Record ambiguity, interruptions, model/tool retry counts, and known evidence limitations in the experiment entry.
- Do not conclude from a single playthrough unless explicitly directed.

## Workflow

- Read `.goals/GOAL.md`, `.goals/OPERATING.md`, `.goals/PLAN.md`, `.goals/EXPERIMENTS.md`, and `.goals/PROGRESS.md` before starting.
- The main agent acts as orchestrator.
- Start each experiment by stating a hypothesis and the specific lever being changed.
- If rules affect legality, scoring, setup, map structure, unit stats, card effects, income, recruitment, or win conditions, encode them in shared code/config/assets before running evidence.
- Keep prose prompts/rules synchronized with code-backed behavior. Prose-only rules are design notes, not evidence-grade rules.
- Use the codebase ThinHarness prompts for playtesting agents, especially `experiments/E001-current-best/code/agent-context/prompts/thinharness-player.system.md`.
- Run ThinHarness with explicit model, effort, timeout, retry, and max request/tool-call settings.
- For each experiment batch, run distinct strategy matchups when the question is strategic rather than purely mechanical.
- Each strategy assignment must specify P1 and P2 deck strategy, board strategy, unit priorities, and the tension the matchup is meant to test.
- Play to a legal winner whenever practical. Turn-count caps are checkpoints or budget limits, not default endpoints.
- Use a review/evaluation subagent with isolated context for batch scoring when useful.
- Add one structured entry to `.goals/EXPERIMENTS.md` per experiment.
- Append durable decisions and direction changes to `.goals/PROGRESS.md`.
- Edit `.goals/PLAN.md` in place so it always reflects the current active plan. Do not use it as history.

## Experiment Levers

Every experiment should name at least one primary lever:

- Center locations, count, clustering, and distance from home bases.
- Starting troop count, placement, symmetry, and unit mix.
- Recruitment cost, income curve, center income, recruit limits, and home-base constraints.
- Unit roles, movement, HP, attack, range, healing, cost, and availability.
- Card pool composition, costs, draw, actions, trashing, damage, healing, upgrades, and board-counter generation.
- Win conditions, thresholds, response windows, center dominance, and unit-lead pressure.
- Map topology, lanes, chokepoints, flank routes, neutral buffers, and contested middle space.

Do not only make tiny numeric tuning changes if the current design is stuck. Across a run of experiments, deliberately alternate between structural variants and tuning variants.

## Subagent Context

Review/evaluation agents should read:

- `.goals/prompts/REVIEW_EVALUATE_AGENT.md`
- `.goals/GOAL.md`
- `.goals/OPERATING.md`
- Relevant codebase prompts and rules context under `experiments/E001-current-best/code/agent-context/`
- The relevant code/config/assets changed for the experiment
- The batch's run directories, including `timeline.json`, `board.json`, `deck.json`, `run.yaml`, `runner-state.json`, `timings.jsonl`, logs, snapshots, and rendered context

Do not give review/evaluation agents `.goals/EXPERIMENTS.md` or `.goals/PROGRESS.md` by default. Prior conclusions can bias scoring; provide them only when explicitly asking for comparison.

## Experimentation Style

Keep experiments interpretable:

- Large conceptual changes should usually be tested alone or with only minimal supporting changes.
- Small tuning changes can be grouped when they target the same hypothesis.
- Do not make massive unrelated changes in one experiment.
- Do not only make tiny local tweaks if the current design seems stuck.
- If an experiment works, iterate near it.
- If it fails, record the lesson and try a different direction.

## Evaluation Flow

- ThinHarness playthroughs produce game evidence.
- Full-game evidence is preferred. If a playthrough reaches 40 completed player turns without a winner, it may stop as unresolved only if it documents why the game appears stalled or why no plausible forced progress remains.
- One review/evaluation agent checks legality, replay coherence, model/tool retry behavior, issue severity, and scoring.
- Slightly flawed runs may still be useful evidence if the issue is minor and documented.
- Runs with major or invalid issues should receive little or no scoring weight.
- The review/evaluation agent should cite specific runs as evidence for each score category.
- The orchestrator records the score in `.goals/EXPERIMENTS.md`, summarizes durable lessons in `.goals/PROGRESS.md`, and updates `.goals/PLAN.md`.

## Evidence Levels

- `full`: strict board/deck/win validation passes, artifacts are complete, and no material legality issue is known.
- `partial`: validation passes or mostly passes, but the run is interrupted, strategically incomplete, has minor issues, or covers only part of the intended matchup.
- `low`: the run has major limitations but may still suggest a design direction.
- `invalid`: the run cannot be trusted as gameplay evidence.

## Updating Goal Files

Agents should normally treat `.goals/` files as stable instructions.

They may update goal files when an experiment reveals a durable improvement to the process, scoring, prompts, or workflow. Changes to `.goals/GOAL.md` or `.goals/OPERATING.md` should be recorded in `.goals/PROGRESS.md`.

Do not rewrite goal files casually during ordinary experiments.
