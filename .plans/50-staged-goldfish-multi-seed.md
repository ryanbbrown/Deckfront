# Staged goldfish K009 multi-seed run

## Goal

Measure staged-pipeline timing and consistency on the agreed Kingdom 009 seeds 1–3, then include seeds 4–5 because the saved baseline shows high variance.

## Run

- Run pool seeds 1–5 sequentially against each seed's exact fixed-reservoir baseline. Keep evaluation seed 7,100,009 and goldfish seeds 5,200,000–5,200,003 fixed.
- Store every seed in its own ignored artifact directory. Validate checkpoints before reuse and preserve the completed seed-5 evidence.
- Keep deterministic acquisition, lottery, bootstrap, and cross-attack seed namespaces separate across pool seeds. Keep the two cross-attack directions separate within each seed.
- Launch all missing work with `npm run staged-goldfish:suite`. Check all units with `npm run staged-goldfish:suite:status` or one unit with `npm run staged-goldfish:ab:status -- --seed <1-5>`.
- Compare timing, retention, overlap, PSRO structure, usage, held-out cross-play, and fixed-reservoir cross-attacks across the completed reports before deciding whether to adopt staged scoring.

## Verification

Run focused staged tests, typecheck, lint, and `git diff --check` before the experiment. Do not start the expensive suite during implementation.
