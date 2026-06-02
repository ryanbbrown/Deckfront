# Goal

Find rule, map, and play patterns that make Deckfront feel like a compelling two-player deck-building territory game.

## Current Objective

Run repeated playtest experiments until stopped by budget or user direction.

## Completion Criteria

Do not stop just because an experiment scores well, even if it reaches 100.

Continue experimenting until stopped by the user, context limits, usage limits, or an explicit goal-status instruction. High-scoring experiments are candidates to deepen, stress test, and compare against alternatives.

When a candidate scores well:

- Run more strategy matchups against it.
- Try nearby variants.
- Add more card or unit options if useful.
- Check whether the design stays balanced as options expand.
- Look for other high-scoring designs rather than assuming the first one is best.

## Desired Dynamics

- Early board pressure should be viable.
- Slower deck-engine scaling should be viable.
- Unit choices should create real tradeoffs.
- Games should usually last long enough to develop, but not drag.

## Success Criteria

Use the rubric below to score ruleset/map experiments. A single playthrough is evidence; the score belongs to the experiment batch.

## Scoring Rubric

Ruleset Score: 100

### Pacing And Arc: 25

- Games usually reach a satisfying conclusion.
- Early, mid, and late phases are distinguishable.
- Early advantage matters but does not decide the game immediately.
- Comebacks or stabilizing responses are possible.
- Reference range: 9-20 completed player turns, with 12-16 as the current best guess.
- Hard concern: under 8 turns is probably too short; over 50 is probably too long.
- Note: this range is a human estimate, not a law.

### Strategic Diversity: 30

- Multiple deck strategies are viable.
- Multiple unit plans are viable.
- Players can pursue meaningfully different strategies and both remain plausible.
- There is no obvious single dominant buy/recruit path.
- The game rewards adapting to board state, not just following a fixed script.

### Board Tension: 20

- Supply centers, positioning, and territory matter.
- Players are pulled into conflict rather than safely building in isolation.
- The board creates meaningful tradeoffs: pressure vs safety, expansion vs defense, center vs flank.
- Control can shift without feeling random or arbitrary.

### Combat Interest: 25

- Combat rewards planning, positioning, timing, and card/unit synergy.
- Smart play produces better outcomes than simple back-and-forth trades.
- Attacks create follow-up consequences.
- Different unit types create different tactical problems.
- Cards can change combat decisions without making them automatic or degenerate.

## Evidence Quality

Runs should be weighted by evidence quality:

- `full`: replay validates, no material legality issues, and rules ambiguities are logged.
- `partial`: minor mistakes exist, but the run still conveys useful information.
- `low`: major issues likely distort the result.
- `invalid`: cannot be trusted as evidence.

Do not automatically discard a run for a small mistake. Record the issue and reduce its weight if appropriate.
