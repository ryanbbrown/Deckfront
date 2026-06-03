# Progress

## 2026-06-02

- Created initial long-running goal tracking files.
- Tracking files live under `.goals/`.
- Root plan is edited in place; experiment records and progress notes accumulate over time.
- Added a separate playtest-agent guide for deck-building basics and strategy prompts.
- Decided each ruleset experiment should use multiple strategy matchups and duplicate playthrough agents before drawing conclusions.
- Moved subagent prompts under `.goals/prompts/`.
- Combined review and evaluation into one subagent role.
- Replaced strict hard gates with evidence-quality weighting so minor playthrough mistakes can still inform scoring.
- Ran E001 baseline batch with four playthroughs: two rush-vs-engine and two center-vs-flank.
- All four E001 replay bundles validated.
- E001 scored 68 / 100, with every run classified as partial evidence because the starter board used damaged units despite rules saying units start at max HP.
- Durable lesson: board tension is promising, early pressure may be too strong, slower deck-engine scaling is unproven, and support healing/deck damage timing need clarification.
- Next direction: rerun baseline from a max-HP starter board before drawing balance conclusions or testing larger variants.
