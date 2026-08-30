# Strategy discovery ladder

## Goal

Discovery must produce strategies that cannot be strongly exploited by an independent search on fixed ten-card kingdoms. The payoff matrix is training data, not the acceptance test.

## Phase 0: independent baseline

Run `scripts/baseline_exploitability.ts` on the fixed kingdom seeds before changing discovery. Preserve `.data/baseline-before.*`. The script runs full PSRO, then searches independently for a strategy that beats the highest-weight result.

## Phase 1: executable strategy

A strategy has a fixed ladder of exactly ten discriminated slots:

- `inactive` is an inert placeholder.
- `buy` names a card and a finite desired count or the infinite-count sentinel.
- `stop` ends buying when current money meets its threshold.

The Buy phase scans from top to bottom. It skips inactive, filled, unavailable, and currently unaffordable buy slots. An affordable unmet buy slot fires. An infinite slot can occur anywhere and never fills. A reached stop slot fires only when current money is at least its threshold. Counts remain lifetime acquisitions. There are no cost bands and no separate agenda or repeat field. Production and the compact kernel execute the same rules.

## Phase 2: discovery

For each supported and diversity parent, generate the complete one-build-change and one-slot-change neighborhood. Slot changes cover activation, deactivation, buy card and count, stop threshold, kind changes, and adjacent swaps. Add a separately budgeted random tail for changes that need more than one coordinate.

Race candidates deterministically on successive disjoint seed sets. Confirm the race winner on a held-out namespace. Parent selection includes strategies that add uncovered card families, so support weight on one strategy does not collapse all local proposals onto one family.

The response `count` is the random-tail budget. Exhaustive local candidates are additional. Telemetry reports the exact local count, random count, total requested under this policy, duplicates, and shortfalls.

## Phase 3: benchmark gate

The first broad Cartesian benchmark was rejected: it timed out after one hour without finishing its first kingdom. `scripts/sweep.ts` now uses a staged independent search that screens simple floors before it adds finite and stop slots.

The fast smoke test on the kingdom that exposed the original failure passes in 1.3 seconds. Four generated-and-raced responses used 754–769 candidates each. The final response scored 0.9200 against the original incumbent over 400 held-out matches. The previous exhaustive-sweep winner scored 0.1875 against the final response over another 400 held-out matches.

A complete full-mode run on that kingdom took 14.3 seconds for PSRO and 19.9 seconds for the 1,657,008-match independent staged sweep, 34.2 seconds total. Discovery evaluated 706,344 matches and returned 47 strategies. The best independent challenger scored 0.5575 with a 95% interval of [0.5100, 0.6050]. The old system's measured exploitability on the same kingdom was 0.7875. This is a large improvement and stays under the 60-second per-kingdom target, though the result is still marginally exploitable.

Before broad balance work, repeat this full gate on a small new-card kingdom set. Mean and worst exploitability must remain close to 0.5. If they do not, stop and diagnose generation and selection.

## Ranged-chain tactical and beam follow-up

The saved game `.data/games/56cd495e-02e5-40ab-991c-c0f1692ba806.json` is the recent 50-health ranged-chain playtest. Its human purchases were Precision Shot 1, Regroup 1, Footwork 1, Peppering Shot 2, Regroup 2, Peppering Shot 5, Regroup 3, Longshot 1, and Regroup 5. A ten-slot reconstruction ends with Peppering Shot infinite.

A shared pending-discard projection now preserves the best planned purchase first, then retains the highest-value resulting hand. It treats only one unplayed Scrap as useful. The reconstructed strategy improved from the earlier 0.153 score to 0.4075 over 1,600 matches, with a 95% interval of [0.3600, 0.4600], but it still lost clearly. This proves that generic discard selection was a large blocker but not the only blocker. Do not add card-specific action rules from this result.

The draft-off beam can now race up to all ten active slots, or a lower `--max-slots` limit, and stops after two stages without a 0.002 score improvement. Finite counts 1 through 5 let it construct the exact shape of longer alternating ladders. A 7-slot, width-32, one-iteration run took 78.294 seconds and stopped after depth 4. It found one Regroup finalist but no alternating Regroup/Peppering ladder. Its top response scored 0.9861 against the beam's initial floor mixture, but only 0.1300 against the saved trained strategy over an independent 1,600-match check. The beam target and one-iteration admission process therefore remain a blocker; do not infer strength from the floor-mixture confirmation.

## Deferred card work

New cards, higher health, draft removal, live-deck counting, broader trash choices, setup/combo policy, cost bands, turn-limit tuning, and discovery-budget retuning happen after this gate. Re-run the independent benchmark after those rules and policies change.
