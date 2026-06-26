# Experiments

Use one entry per experiment.

## E001 - Baseline territory-v1 on sketch-v1

Status: complete
Runs:
- `.games/e001-rush-vs-engine-a`
- `.games/e001-rush-vs-engine-b`
- `.games/e001-center-vs-flank-a`
- `.games/e001-center-vs-flank-b`

Ruleset: `rulesets/territory-v1`
Map: `maps/sketch-v1.json`

Hypothesis:
Baseline territory-v1 should show whether early board pressure, slower deck scaling, central control, and flank/support play are all plausible.

Changed:
None. Baseline ruleset and map.

Result:
Score: 68 / 100.

All four replay bundles validated. Evidence quality was `partial` for every run because the starter board snapshot used damaged units, while the written rules say units start at max HP.

Observed:
- Board tension was strong; supply centers consistently mattered.
- Early pressure looked viable and may be too strong.
- Slower deck-engine scaling did not prove it can stabilize against early pressure.
- Center/flank play was more contested than rush-vs-engine.
- Healing/support and deck-damage timing need clearer rules.

Decision:
Iterate near baseline. Before testing bigger variants, rerun E001-style matchups from a max-HP starter board and clarify support healing, deck damage, and board-phase ordering.

## E002 - Max-HP baseline rerun on sketch-v1

Status: complete
Runs:
- `.games/e002-rush-vs-engine-a`
- `.games/e002-rush-vs-engine-b`
- `.games/e002-center-vs-flank-a`
- `.games/e002-center-vs-flank-b`
- `.games/e002-swarm-vs-upgrade-a`
- `.games/e002-swarm-vs-upgrade-b`

Ruleset: `rulesets/territory-v1`
Map: `maps/sketch-v1.json`

Hypothesis:
Rerunning baseline territory-v1 from a max-HP starter board should show whether the earlier rush strength was mainly caused by damaged starting units, and whether center/flank and quantity/quality unit plans remain viable.

Changed:
Started from `.games/territory-v1-playtest/snapshots/turn-001.before.board.json`, whose units now have max HP. No ruleset or map files changed.

Result:
Score: 75 / 100.

All six replay bundles validated. Evidence quality was mixed: `e002-center-vs-flank-b` was full evidence and the best run; most other runs were partial because of starter-deck inconsistency or unresolved unit-healing timing. `e002-rush-vs-engine-b` was low-quality evidence because same-turn recruit activation materially supported P1's win.

Observed:
- Pacing improved substantially. Runs landed at 12, 13, 15, 16, 14, and 14 completed player turns.
- Max-HP starters created response windows instead of immediate collapse.
- Early pressure remained viable and probably strong.
- P1 led every final board on units, centers, or both.
- Center/flank and swarm/upgrade tensions were promising; slower plans could stabilize but did not prove equal win pressure.
- Supply-center income repeatedly reached 5-2 or similar P1-favored splits, suggesting a possible first-player/map-access pressure point.

Decision:
Iterate near E002, but lock rules/setup before trusting the next comparison. The next batch should standardize the written draft start, delayed recruit activation, printed unit-healing timing, and Storm targeting, then rerun the strongest matchups while watching P1 center-income pressure.

## E003 - Locked baseline on sketch-v1

Status: complete
Runs:
- `.games/e003-rush-vs-engine-a`
- `.games/e003-rush-vs-engine-b`
- `.games/e003-center-vs-flank-a`
- `.games/e003-center-vs-flank-b`
- `.games/e003-swarm-vs-upgrade-a`
- `.games/e003-swarm-vs-upgrade-b`

Ruleset: `rulesets/territory-v1-locked`
Map: `maps/sketch-v1.json`

Hypothesis:
Locking starter draft, recruit activation, printed unit healing, and Storm targeting should make the baseline evidence cleaner and show whether P1 pressure remains after removing E002 timing/setup noise.

Changed:
Created `rulesets/territory-v1-locked` as a locked-interpretation copy of `territory-v1`. It keeps the same cards, units, and map but fixes draft start, delayed recruit activation, printed healing timing/range, attack-bound deck damage, and Storm targeting.

Result:
Score: 73 / 100.

All six replay bundles validated and were scored as full evidence, with a minor residual tactical-check caveat on `e003-swarm-vs-upgrade-a`.

Observed:
- Runs landed at 14, 10, 15, 16, 14, and 14 completed player turns.
- Rush beat engine twice, including one 10-turn result.
- Swarm/economy beat or led upgrade/heal in both runs.
- Center/flank was the healthiest matchup, staying unresolved at 15-16 turns with live flank pressure.
- P1 led every final board, suggesting map/economy or first-player pressure rather than only strategy imbalance.
- Storm targeting is still effectively untested.

Decision:
Run a focused first-player-pressure control before changing map or economy. E004 should keep `territory-v1-locked` and `sketch-v1`, but swap strategy seats in the strongest matchups so proactive pressure starts from P2 and stabilization/flank plans start from P1.

## E004 - Seat-swap control on sketch-v1

Status: complete
Runs:
- `.games/e004-engine-vs-rush-a`
- `.games/e004-engine-vs-rush-b`
- `.games/e004-flank-vs-center-a`
- `.games/e004-flank-vs-center-b`

Ruleset: `rulesets/territory-v1-locked`
Map: `maps/sketch-v1.json`

Hypothesis:
Swapping strategy seats should show whether E003's repeated P1 leads come from P1/map position, from proactive strategy strength, or both.

Changed:
No ruleset or map changes. Strategy assignments were swapped: P1 took engine or flank/control roles, while P2 took rush or center-pressure roles.

Result:
Score: 74 / 100.

All four replay bundles validated. Evidence quality was full for three runs and partial for `e004-flank-vs-center-b` because its notes downgrade the fixed starting deck framing.

Observed:
- P2 rush can strongly pressure P1 engine: `e004-engine-vs-rush-a` ended after 20 turns with P2 ahead 9 units to 5.
- Rush is not deterministic: `e004-engine-vs-rush-b` stayed unresolved at 16 turns, with P1 ahead on units and P2 ahead on centers.
- P1 still led both flank-vs-center runs despite P2 holding the center-pressure strategy.
- The map likely gives P1 too much reliable near-side access: P1 has two distance-2 centers and fast routes into the central cluster.

Decision:
Test a map-access variant next, keeping `territory-v1-locked` unchanged. E005 should reduce P1's immediate east/northeast-to-center acceleration and improve P2's ability to contest a second meaningful lane before P1's supply lead becomes a unit-count clock.

## E005 - Map-access variant on sketch-v2-access

Status: complete
Runs:
- `.games/e005-rush-vs-engine-a`
- `.games/e005-rush-vs-engine-b`
- `.games/e005-center-vs-flank-a`
- `.games/e005-center-vs-flank-b`

Ruleset: `rulesets/territory-v1-locked`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Moving supply centers to reduce P1's immediate east/northeast acceleration and improve P2's second-lane contesting should preserve center/flank tension while reducing reliable P1 supply leads.

Changed:
Created `maps/sketch-v2-access.json`. It moves `center-east` from a P1 distance-2 pickup to a contested mid-east point, moves `center-northwest` closer to the central west lane, and shifts `center-center-south` toward P2's contesting route. Rules and units were unchanged.

Result:
Score: 78 / 100.

All four replay bundles validated. Evidence quality was full for three runs and partial-to-full for `e005-center-vs-flank-b` because its notes flag fixed starting decks as a setup caveat.

Observed:
- Center/flank improved substantially. `e005-center-vs-flank-a` ended with P2 ahead 7 units to 6 and centers tied 3-3, while P1 held stronger upgraded central units and a supply bank.
- `e005-center-vs-flank-b` stayed unresolved at 9 units to 8 and 4 centers to 3 for P1, with P2's flank still active.
- Rush-vs-engine remains concerning. P1 rush led both runs, including a 9-to-5 unit edge in `e005-rush-vs-engine-a`.
- The map-access change helped board tension, but rush damage tempo plus supply-to-body conversion still outruns slower engine/healing payoff.

Decision:
Deepen near E005. Keep `sketch-v2-access` and test an economy/rush-tempo variant next. The cleanest next lever is recruit cost 6, because it slows supply-to-body snowball without changing card text or map pressure.

## E006 - Recruit cost 6 on sketch-v2-access

Status: complete
Runs:
- `.games/e006-rush-vs-engine-a`
- `.games/e006-rush-vs-engine-b`
- `.games/e006-center-vs-flank-a`
- `.games/e006-center-vs-flank-b`

Ruleset: `rulesets/territory-v1-cost6`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Increasing recruit cost from 5 to 6 should slow supply-to-body snowball while preserving the improved board tension from `sketch-v2-access`.

Changed:
Created `rulesets/territory-v1-cost6` from `territory-v1-locked`, changing only recruitment cost and income benchmarks. Cards, units, timing, and map stayed the same as E005.

Result:
Score: 80 / 100.

All four replay bundles validated. Evidence quality was full for three runs and partial for `e006-rush-vs-engine-a`, whose notes downgrade exact tactics because board play is hand-authored.

Observed:
- All four runs reached 16 completed player turns.
- Center/flank stayed healthy: one run ended 7 units to 6, the other tied 8 units to 8.
- Cost 6 created saved-supply tension and delayed first recruits.
- Rush-vs-engine improved in one run, where P2 stayed within one unit through turn 16.
- Rush-vs-engine still produced one pending P1 win at 8 units to 5, driven by stacked deck-damage bursts.

Decision:
Deepen near E006. Keep `sketch-v2-access` and recruit cost 6, then test a deck-damage tempo cap: deck `damage` may add at most 1 extra damage per attacking unit per turn.

## E007 - Damage cap on cost-6 sketch-v2-access

Status: partial
Runs:
- `.games/e007-rush-vs-engine-b`
- `.games/e007-center-vs-flank-a`
- `.games/e007b-center-vs-flank-b`

Planned but not completed:
- `.games/e007-rush-vs-engine-a`
- `.games/e007-center-vs-flank-b`
- `.games/e007b-rush-vs-engine-a` produced only a 0-entry timeline and is not evidence.

Ruleset: `rulesets/territory-v1-cost6-damagecap`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Capping deck-produced damage at 1 extra damage per attacking unit should reduce single-attacker burst kills while preserving attack-bound damage and the E006 board tension.

Changed:
Created `rulesets/territory-v1-cost6-damagecap` from `territory-v1-cost6`, adding the per-attacker deck-damage cap. Map, cards, units, recruit cost, and timing otherwise stayed unchanged.

Result:
Partial score: 82 / 100 as incomplete evidence.

Three replay bundles validated. Two original planned workers failed with rate-limit errors before producing bundles, and one replacement rush worker stalled after producing only a 0-entry timeline.

Observed:
- `e007-rush-vs-engine-b` ended unresolved after 16 turns with units tied 7-7. This directly improves on E006's rush-vs-engine pressure.
- P1 still led centers 5-2 in the completed rush run, so the cap helps combat lethality more than board economy.
- `e007-center-vs-flank-a` stayed close at 7 units to 6 and 4 centers to 3 for P1, with P2 flank pressure live.
- `e007b-center-vs-flank-b` validated with 16 entries and ended unresolved with units tied 8-8, P1 ahead 4-3 on centers, one neutral center, and saved supply at P1 4 / P2 5.
- The second center/flank result supports that the damage cap preserves E006's healthy center/flank pacing, though its notes document that it retargets the completed E006 center/flank B line under the stricter cap.
- `.games/e007-damagecap-audit.md` compares completed E007 rush evidence against E006 rush runs. It supports the same conclusion: the cap makes large P1 damage hands expire unless P1 has multiple legal attackers.
- More independent rush evidence is needed before treating E007 as the new best completed candidate.

Decision:
Repeat/deepen E007 before moving to a new design direction. The damage cap is promising, center/flank preservation is now better supported, but the planned rush repeat is still incomplete.

## E007c - Full-game damage-cap rush repeats

Status: complete
Runs:
- `.games/e007c-rush-vs-engine-a`
- `.games/e007c-rush-vs-engine-b`
- `.games/e007c-rush-vs-engine-c`

Ruleset: `rulesets/territory-v1-cost6-damagecap`
Map: `maps/sketch-v2-access.json`

Hypothesis:
If the E007 damage cap really fixes rush-vs-engine, then independent full-game rush repeats should let engine/healing stabilize to either a win or at least a long unresolved state rather than a delayed rush win.

Changed:
No ruleset or map changes from E007. Changed the playtest method: agents played to a legal winner instead of stopping at the old 16-turn checkpoint.

Result:
Score: 76 / 100.

All three replay bundles validated under the stricter non-empty replay validator.

Observed:
- All three games reached legal winners shortly after the old 16-turn checkpoint.
- `e007c-rush-vs-engine-a` ended after 24 completed turns with P1 rush winning 10-7 on units, P1 ahead 5-2 on centers, and one neutral center.
- `e007c-rush-vs-engine-b` ended after 18 completed turns with P1 rush winning 11-7 on units, P1 ahead 5-2 on centers, and one neutral center.
- `e007c-rush-vs-engine-c` ended after 20 completed turns with P1 rush winning 10-7 on units and controlling all six non-P2 centers for a 6-2 center split.
- The damage cap delays single-attacker burst wins, but P1 can adapt with multiple attackers, reattack support, and the persistent center-income lead.
- The earlier 16-turn unresolved samples were materially misleading; at least two positions that looked unresolved at turn 16 became P1 wins by turns 20 and 24.

Decision:
Do not promote E007 over E006. The damage cap is useful for combat texture, but it does not solve the underlying center-income-to-recruit snowball in rush-vs-engine. The next design iteration should target center economy, win-condition timing, or engine stabilization more directly.

## E008 - Full-game swapped-seat damage-cap rush/control

Status: complete
Runs:
- `.games/e008-engine-vs-rush-a`
- `.games/e008-engine-vs-rush-b`

Ruleset: `rulesets/territory-v1-cost6-damagecap`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Swapping rush to P2 and engine/control to P1 should show whether E007c's rush wins are mainly strategy-driven, seat/map-driven, or both.

Changed:
No ruleset or map changes from E007c. Strategy seats were swapped and agents played to legal winners.

Result:
Score: 77 / 100.

Both replay bundles validated.

Observed:
- `e008-engine-vs-rush-a` ended after 33 completed turns with P2 rush winning 14-11 on units, even though P1 engine/control held a 4-2 center lead and two centers stayed neutral.
- `e008-engine-vs-rush-b` ended after 18 completed turns with P1 engine/control winning 10-7 on units, with P1 ahead 4-3 on centers and one neutral center.
- The split result suggests rush is not automatically dominant from the P2 seat, but proactive pressure remains a real win path.
- Full-game runs now resolve instead of drifting forever, but the winner often comes from unit-count lead after center/recruit tempo rather than a clearly differentiated deck-engine payoff.
- Both runs document the unresolved setup mismatch between rules prose (7 Copper plus draft coin) and `deck.yaml` fixed starter; workers used the rules prose draft setup.

Decision:
Keep the damage cap only as a provisional combat-texture improvement. The next experiment should not be another pure damage tweak. It should test a direct economy/map/win-condition change that reduces center-income snowball or gives slower engine/support plans a concrete way to convert stabilization into a win.

## E009 - One-recruit cap anti-snowball variant

Status: complete
Runs:
- `.games/e009-rush-vs-engine-a`
- `.games/e009-rush-vs-engine-b`
- `.games/e009-rush-vs-engine-c`
- `.games/e009-center-vs-flank-a`
- `.games/e009-engine-vs-rush-a`

Attempted but not evidence:
- `.games/e009-center-vs-flank-b` stalled with a 0-entry timeline and was closed.

Ruleset: `rulesets/territory-v1-cost6-damagecap-recruitcap`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Keeping the damage cap but limiting recruitment to at most one unit per player turn should reduce center-income snowball by preventing saved supply from becoming sudden multi-body swings.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-recruitcap` from `territory-v1-cost6-damagecap`. The only intended rules change is a maximum of one recruited unit per player turn. Saved supply still carries over.

Result:
Score: 70 / 100.

All five completed replay bundles validated. Evidence quality is mixed: replay continuity is valid, but most notes still document the setup mismatch between written draft start and `deck.yaml`.

Observed:
- `e009-rush-vs-engine-a` isolated the intended effect best. The cap prevented the old E007c turn-25 multi-recruit win and pushed P1's rush win to 32 completed turns, but P1 still won 9-6 with a 5-2 center lead and 17 saved supply.
- `e009-rush-vs-engine-b` ended much faster: P1 rush won after 14 completed turns, 8-4 on units and 5-2 on centers.
- `e009-rush-vs-engine-c` also collapsed early: P1 rush won after 16 completed turns, 7-4 on units and 6-2 on centers.
- `e009-center-vs-flank-a` ended after 18 completed turns with P1 central control winning 8-5 on units despite only a 4-3 center lead.
- `e009-engine-vs-rush-a` gave the best engine/control signal: P1 engine/control beat P2 rush 9-6, but only after 40 completed turns.
- The one-recruit cap reduces explosive multi-recruit turns, but it also blocks the trailing player from using saved supply to rebuild after losing forward units.
- Pacing became less reliable: runs ranged from 14 to 40 completed turns, with both early collapse and overlong grind.

Decision:
Do not continue with a pure one-recruit cap. It is useful diagnostic evidence but not a good candidate: it delays one snowball line while worsening comeback elasticity and pacing variance. The next experiment should try a response-window win condition instead, such as requiring a 3-unit lead to survive through the opponent's next full turn, or requiring a larger lead, while leaving recruitment less constrained.

## E010 - Response-window unit-count win

Status: partial
Runs:
- `.games/e010-center-vs-flank-a`
- `.games/e010c-rush-vs-engine-a`
- `.games/e010c-rush-vs-engine-c`

Attempted but not evidence:
- `.games/e010-rush-vs-engine-a`
- `.games/e010-rush-vs-engine-b`
- `.games/e010-rush-vs-engine-c`
- `.games/e010-center-vs-flank-b`
- `.games/e010b-rush-vs-engine-a`
- `.games/e010b-rush-vs-engine-b`
- `.games/e010b-rush-vs-engine-c`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Keeping normal recruitment and the damage cap, but requiring a 3-unit lead to survive the opponent's full response turn, should prevent false-fast unit-count wins while preserving game resolution.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin` from `territory-v1-cost6-damagecap`. The only intended rules change is win timing: a 3-unit lead creates a pending threat first, and the threatened player gets one full turn to reduce the lead below 3 before the win confirms.

Result:
Partial score: 78 / 100.

Three replay bundles validated. Several fresh E010 rush workers stalled at 0-entry initialized timelines and were closed; the rush evidence therefore uses controlled retarget/continuation from validated E007c lines to isolate the win-timing change.

Observed:
- `e010-center-vs-flank-a` ended after 20 completed turns with P1 central control winning 8-5 on units, P1 ahead 4-3 on centers. P2 received a full response turn, killed one P1 unit, and recruited one unit, but the pending 3-unit lead survived.
- `e010c-rush-vs-engine-a` retargeted the validated E007c A line. The old immediate P1 win at turn 25 became a pending threat; P2 received turn 26 but could not recruit or kill enough, so P1 confirmed at turn 27 with an 11-7 unit lead.
- `e010c-rush-vs-engine-c` retargeted the validated E007c C line. The old immediate P1 win at turn 21 became a pending threat; P2 killed one P1 unit but had only 5 supply, one short of a recruit, so P1 confirmed at turn 23 with a 10-6 unit lead.
- The response-window rule works mechanically and improves rule feel: it creates a visible counterplay turn.
- The rule does not solve the underlying resource problem alone. P2's response turns often lacked either enough supply or enough kill pressure to reduce the lead below 3.
- Pacing improved relative to E009's 40-turn grind, but P1 center/rush pressure still converted to confirmed wins.

Decision:
Keep response-window timing as a promising rule-feel improvement, but do not treat E010 as sufficient. The next iteration should combine the response window with a comeback/reaction lever, likely letting the responding player recruit one emergency defender at a discount or making neutral/behind-center income less punishing.

## E011 - Response-window emergency defender

Status: complete
Runs:
- `.games/e011c-rush-vs-engine-a`
- `.games/e011c-rush-vs-engine-c`
- `.games/e011-center-vs-flank-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-emergency`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Adding one discounted emergency defender while responding to a pending unit-count loss should make the E010 response turn more meaningful without returning to E009's broad recruitment throttling.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-emergency` from `territory-v1-cost6-damagecap-responsewin`. The added rule lets the active player recruit one `guardian`, `scout`, or `healer` for 3 supply while responding to an opponent's pending unit-count win threat, if the recruit can help reduce or prevent the pending lead.

Result:
Score: 77 / 100.

All three replay bundles validated. Two rush runs are controlled retarget/branch tests from E010c, which directly isolate the emergency-defender rule at the failed response turn.

Observed:
- `e011c-rush-vs-engine-a` used an emergency scout on P2's response turn, changing the final count from E010's 11-7 to 11-8. P1 still confirmed because the lead remained exactly 3.
- `e011c-rush-vs-engine-c` used an emergency guardian on P2's response turn, changing the final count from E010's 10-6 to 10-7. P1 still confirmed because the lead remained exactly 3.
- `e011-center-vs-flank-a` matched the E010 center/flank line: P2 already had enough supply for a normal recruit, so the emergency discount did not change the response. P1 still confirmed at 8-5.
- The emergency defender improves response feel by making the defender do something with short supply, but one delayed body is too weak once the leader can widen the lead during the pending-threat turn.
- Under the current clearing rule, reducing a lead to exactly 3 still confirms the threat. That makes the emergency defender fail in the exact cases it was meant to help.

Decision:
Do not continue with this exact emergency defender rule. The useful lesson is that response turns need either stronger immediate agency or a different confirmation threshold. Next, test a larger-margin win condition: keep the response-window timing and require a 4-unit lead to confirm. That directly addresses the repeated 3-unit exact-confirm failures without adding more special-case recruitment.

## E012 - Lead-4 response-window win

Status: complete
Runs:
- `.games/e012c-rush-vs-engine-a`
- `.games/e012c-rush-vs-engine-c`
- `.games/e012-center-vs-flank-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4`
Map: `maps/sketch-v2-access.json`

Hypothesis:
Keeping response-window timing but requiring a 4-unit lead to create and confirm a unit-count win should reduce exact-3 confirmations without adding emergency-recruit special cases.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4` from `territory-v1-cost6-damagecap-responsewin`. The only intended rules change is the unit-count threshold: pending and confirmed unit-count wins require a 4-unit lead instead of a 3-unit lead.

Result:
Score: 79 / 100.

All three replay bundles validated. Two rush runs are controlled retarget/continuation tests from E010c to isolate the lead-threshold change.

Observed:
- `e012c-rush-vs-engine-a` delayed the E010c A outcome from 26 to 28 completed turns. Exact 3-unit leads no longer mattered, but P1 created and confirmed a 12-8 lead-4 threat.
- `e012c-rush-vs-engine-c` delayed the E010c C outcome from 22 to 24 completed turns. P1 confirmed 11-6 with a 6-2 center split.
- `e012-center-vs-flank-a` delayed the E010 center/flank A outcome from 20 to 24 completed turns. P1 confirmed 10-5 with a 4-3 center split.
- The rule is cleaner than the emergency defender and avoids exact-3 feel-bad confirmations.
- It still does not solve the main strategic problem: once P1 has positional and center control, the game often proceeds to a larger confirmed unit lead rather than a comeback.
- Pacing is closer than E009's 40-turn branch, but still trends toward P1 pressure wins in the sampled lines.

Decision:
Lead-4 response-window timing is the best win-condition variant so far, but not enough by itself. Stop iterating on win threshold alone. The next experiment should change map/economy pressure directly, especially the reliable 5-2 or 6-2 center splits that leave P2 unable to recruit or answer threats.

## E013 - Contest-map lead-4 response-window variant

Status: complete
Runs:
- `.games/e013-rush-vs-engine-a`
- `.games/e013b-rush-vs-engine-b`
- `.games/e013b-rush-vs-engine-c`
- `.games/e013b-rush-vs-engine-d`
- `.games/e013c-center-vs-flank-a`
- `.games/e013c-swapped-rush-control-a`
- `.games/e013c-upgrade-vs-swarm-a`

Evaluation:
- `.games/e013-evaluation.md`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4`
Map: `maps/sketch-v3-contest.json`

Hypothesis:
Keeping the E012 damage-cap plus lead-4 response-window shell, but moving the east/southeast centers to be more contestable, should reduce P1's recurring 5-2 / 6-2 center locks and give engine/healing plans a more credible stabilization path.

Changed:
Created `maps/sketch-v3-contest.json` from `sketch-v2-access`. The east center moved from `(9,5)` to `(8,6)`, and the southeast center moved from `(9,7)` to `(8,7)`. Rules stayed on the E012 lead-4 response-window shell.

Result:
Score: 80 / 100.

All seven replay bundles validated. The evaluator scored the batch as pacing and arc 17 / 25, strategic diversity 25 / 30, board tension 18 / 20, and combat interest 20 / 25.

Correction after stricter validation:
The 80 / 100 score is superseded and should not be used as a current best score. The original validator only checked replay structure and continuity. After adding snapshot legality checks, only three E013 timelines pass snapshot-level validation:

- `.games/e013b-rush-vs-engine-b`
- `.games/e013c-center-vs-flank-a`
- `.games/e013c-swapped-rush-control-a`

The other E013 timelines contain overlapping units and/or units on blocked hexes. Zero old E013 timelines pass strict validation because they do not include per-turn action logs for movements, recruits, and attacks. E013 remains a promising hypothesis to retest, not a validated candidate.

Observed:
- Rush-vs-engine is no longer one-sided. P2 engine/healing beat P1 rush in three runs after 23, 27, and 31 completed turns, while P1 rush found one clean win after 22 completed turns.
- The lead-4 response window created repeated meaningful threat/answer moments: P1 threats were cleared in `e013-rush-vs-engine-a` and `e013b-rush-vs-engine-b`, while later P2 or P1 threats confirmed only after a full response turn.
- P2 flank/economy beat P1 center-control after 25 completed turns with a 6-2 center split. That suggests `sketch-v3-contest` may over-correct lower/east access in that matchup.
- P2 rush from the swapped seat was dangerous, reaching a five-center high-water mark, but P1 control stabilized and won after 28 completed turns.
- P1 upgrade/support beat P2 swarm/economy after 46 completed turns with a 4-4 center split. Upgrade/support is now viable, but durable support-ball play can drag.
- Board tension was high across the batch: 5-3, 5-2, 6-2, and 4-4 center states all mattered directly to recruit tempo and lead-window pressure.

Decision:
Iterate near E013 rather than discard it. The contest map plus lead-4 response-window shell is tied with E006 by score and has better strategic-diversity evidence, but its pacing is long and the P2 flank route can still create an extreme economy split. E014 should keep the same rules shell and test a small map/economy correction aimed at reducing 6-2 flank spikes and long support grinds.

## E014 - Tempo map correction

Status: complete
Runs:
- `.games/e014a-center-vs-flank-a`
- `.games/e014a-center-vs-flank-b`
- `.games/e014b-rush-vs-engine-a`
- `.games/e014b-rush-vs-engine-b`
- `.games/e014c-swapped-rush-control-a`
- `.games/e014c-upgrade-vs-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4`
Map: `maps/sketch-v4-tempo.json`

Hypothesis:
Keeping E013's lead-4 response-window shell and contestable east center, but moving only the southeast center back toward the P1 side, should preserve rush-vs-engine diversity while reducing P2's lower/east flank economy spike and shortening support-ball games.

Changed:
Created `maps/sketch-v4-tempo.json` from `sketch-v3-contest`. The only map change is `center-southeast`, moved from `(8,7)` back to `(9,7)`. The east center remains at `(8,6)`. Created `.games/e014-tempo-starter.board.json` from the E013 starter with the map id updated to `sketch-v4-tempo`.

Result:
Score: 74 / 100.

All six replay bundles validated. Evidence quality is mixed but useful: several runs use hand-audited deterministic helpers, and `validate-run` checks replay continuity rather than full board legality.

Observed:
- The map-only correction did not reliably fix E013's failure modes.
- Center-vs-flank split badly. `e014a-center-vs-flank-a` softened the spike into a 40-turn unresolved 4-4 center game with no lead-4 threat, while `e014a-center-vs-flank-b` still ended as a P2 flank/economy win after 45 completed turns with a 6-2 center split.
- Rush-vs-engine also split. `e014b-rush-vs-engine-a` revived a P1 rush win after 22 completed turns with P1 ahead 5-3 on centers, while `e014b-rush-vs-engine-b` preserved the E013-style P2 engine/healing win after 31 completed turns with P2 ahead 5-2 and one neutral center.
- Swapped P2 rush/control repeated the E013 pattern: P2 reached a five-center high-water mark, but P1 control/healing stabilized and won after 28 completed turns.
- Upgrade/support vs swarm still dragged: P1 upgrade/support won after 44 completed turns, only slightly shorter than E013's 46-turn version.
- The southeast rollback is too small and too ambiguous: it sometimes softens the lower/east spike, but it also helps P1 rebuild rush pressure and does not solve support-ball pacing.

Decision:
Do not continue with this exact map-only rollback. E013 remains the better candidate direction despite its flaws. The next experiment should keep the E013 shell but change economy/pacing directly, probably by reducing center-income extremes or adding a rule that helps games resolve before 40+ turns without erasing comeback turns.

## E015 - Compressed center income

Status: complete
Runs:
- `.games/e015a-center-vs-flank-a`
- `.games/e015a-center-vs-flank-b`
- `.games/e015a-upgrade-vs-swarm-a`
- `.games/e015a-upgrade-vs-swarm-b`
- `.games/e015b-rush-vs-engine-a`
- `.games/e015b-rush-vs-engine-b`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-compressed`
Map: `maps/sketch-v3-contest.json`

Hypothesis:
Keeping the E013 map and lead-4 response-window shell, but compressing board supply income, should make kills and center swings matter longer without returning to E014's map-seat ambiguity. Lowering 4-center income from 6 to 5 should reduce endless one-body-per-turn replacement in 4-4 support games, while capping 6+ center income should soften 6-2 and 7-1 snowball conversion.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-compressed` from the E013/E014 lead-4 ruleset. Recruitment still costs 6. Income is now table-based: 0-4 centers produce 1-5 income, 5-6 centers produce 6 income, and 7-8 centers produce 7 income. Created `.games/e015-compressed-starter.board.json` from the E013 starter with the compressed ruleset id.

Result:
Score: 66 / 100.

All six replay bundles validated.

Observed:
- Center-vs-flank improved in the narrow income-spike sense. `e015a-center-vs-flank-a` resolved after 32 completed turns with P1 winning at a 4-4 center split, and `e015a-center-vs-flank-b` resolved after 29 turns with P2 winning at a 3-center state rather than a 6-2 runaway. Compressed income made flank wins depend more on combat trades and banked supply than automatic replacement.
- The support-ball problem got worse. Both upgrade/support vs swarm runs took 58 completed turns, longer than E013's 46 and E014's 44. Slower 4-4 income made kills matter, but it also slowed resolution for both sides.
- Rush-vs-engine got worse. Both E015b runs ended as P1 rush wins after 20 completed turns with P1 ahead 5-2 and one neutral center. P2 could kill during response turns but often could not also replace because two-center compressed income left too little supply.
- The income table reduced overflow, but it reduced comeback elasticity too much. It solved one conversion problem by creating another.

Decision:
Do not continue with compressed income. It is useful diagnostic evidence: income compression can soften center spikes, but lowering baseline replacement makes defensive response turns too weak and stretches support mirrors. The next experiment should keep normal E013 income and attack pacing through victory pressure or combat durability instead of reducing replacement economy.

## E016 - Center-control response-window win

Status: complete
Runs:
- `.games/e016a-center-vs-flank-a`
- `.games/e016a-center-vs-flank-b`
- `.games/e016a-upgrade-vs-swarm-a`
- `.games/e016a-upgrade-vs-swarm-b`
- `.games/e016b-rush-vs-engine-a`
- `.games/e016b-rush-vs-engine-b`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-centercontrol`
Map: `maps/sketch-v3-contest.json`

Hypothesis:
Keeping E013's normal income and lead-4 unit response window, but adding a confirmed 5-center control win for players who are not behind on living units, should shorten long board-control games without reducing defensive replacement income. The unit-parity requirement should stop pure empty-flank center spikes from winning if the center controller is losing the unit fight.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-centercontrol` from the E013 lead-4 ruleset. Added a second response-window win: at the start of a turn, a player with at least 5 controlled supply centers and at least as many living units as the opponent records a pending center-control threat; if the opponent cannot reduce center control below 5 or move ahead on units before the next start-of-turn check, the threat confirms. Created `.games/e016-centercontrol-starter.board.json` from the E013 starter with the new ruleset id.

Result:
Score: 72 / 100.

All six replay bundles validated.

Observed:
- The new center-control clock can shorten long games. Upgrade/support vs swarm dropped from E013/E014/E015's 44-58 turn support-ball pattern to a 23-turn P2 center-control win in one run, with two earlier P2 center threats cleared by P1 response turns.
- The threshold is too permissive. A second upgrade/support vs swarm run ended after only 11 completed turns with P2 winning at a 6-2 center split and units tied 6-6.
- Center-vs-flank became swingy. One run still dragged to 46 turns and ended by unit count at a 4-4 center split, while the repeat ended after 19 turns with P2 confirming center control at 5 centers and a one-unit lead.
- Rush-vs-engine was worse than E013. P1 won both rush safeguards by center-control after 28 and 18 completed turns. The 28-turn run was more acceptable because P2 had strong unit parity and a response turn; the 18-turn run suggests the center-control clock can overreward P1's early five-center shapes.
- Response-window handling felt good when threats were repeatedly cleared, but the condition "5 centers plus unit parity" does not distinguish sustained strategic control from a short high-water flank/rush state.

Decision:
Do not keep this exact center-control rule. The design lesson is useful: alternate victory pressure can shorten support-ball games without changing income, but the center-control threshold must be harder to satisfy. E017 should tighten the center-control condition rather than abandon the idea entirely.

## E017 - Tight center-control response-window win

Status: complete
Runs:
- `.games/e017a-center-vs-flank-a`
- `.games/e017a-center-vs-flank-b`
- `.games/e017a-upgrade-vs-swarm-a`
- `.games/e017a-upgrade-vs-swarm-b`
- `.games/e017b-rush-vs-engine-a`
- `.games/e017b-rush-vs-engine-b`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-centercontrol-tight`
Map: `maps/sketch-v3-contest.json`

Hypothesis:
Keeping E016's alternate center-control pressure but requiring turn 17 or later and at least a 2-unit lead should preserve the useful pacing pressure while filtering out the E016 early high-water wins. This should block the 11-turn 6-2 tied-units swarm win, the 19-turn one-unit flank win, and the 18-turn rush high-water win unless the advantaged player also converts board control into a real unit lead.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-centercontrol-tight` from E016. A center-control threat now requires at least 16 completed player turns already recorded, at least 5 controlled centers, and at least a 2-unit living-unit lead. Created `.games/e017-centercontrol-tight-starter.board.json` from the E013 starter with the new ruleset id.

Result:
Score: 70 / 100.

All six replay bundles validated.

Observed:
- Tightening helped the specific E016 over-fast flank problem. `e017a-center-vs-flank-a` blocked the early high-water threat and produced a later P2 center-control win after 27 completed turns with P2 ahead 12-8 on units and 5-3 on centers.
- Center-vs-flank remained inconsistent. The repeat dragged to 44 completed turns and ended by P1 unit-count lead at a 4-4 center split.
- Upgrade/support pacing was not fixed. One run took 64 completed turns and another took 36; neither confirmed by center control. Tightening removed the useful 23-turn E016 support/swarm pressure and mostly returned the support-ball problem.
- Rush-vs-engine still failed the safeguard. P1 won both runs by tight center-control after 20 and 18 completed turns, with 5-3 center splits and at least a 2-unit lead. The turn gate and 2-unit requirement did not stop P1 rush conversion.
- E017 is a better diagnostic than E016 but not a better candidate. It shows that center-control pressure needs either a different threshold or a different target than simple 5 centers.

Decision:
Stop iterating on 5-center-control wins for now. The branch either confirms too cheaply for rush/flank or, when tightened, fails to solve support pacing. Next experiment should target combat/support durability directly, especially guardian/healer/druid attrition loops, while returning to the E013 rules shell as the baseline.

## E018 - No printed unit healing

Status: complete
Runs:

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`
Map: `maps/sketch-v3-contest.json`

Hypothesis:
Keeping the E013 shell but removing repeatable printed unit healing should shorten support-ball attrition games without changing economy or adding alternate win pressure. Deck healing, Potion/Healer cards, and `upgradeHealth` still provide deck-building support payoffs, but druid/healer unit bodies no longer heal every board phase.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-no-printheal` from E013. Druids and healers have printed `heal` treated as 0; deck-produced healing and `upgradeHealth` healing remain unchanged. Created `.games/e018-no-printheal-starter.board.json` from the E013 starter with the new ruleset id.

Result:
Not run yet.

Decision:
Run upgrade/support vs swarm first, then rush-vs-engine and center-vs-flank. Watch whether removing printed healing deletes support viability or simply shortens the long attrition loop.

## E019 - Strict E013 retest

Status: complete
Runs:
- Round 1:
  - `.games/e019r1-rush-engine-a`
  - `.games/e019r1-center-flank-a`
  - `.games/e019r1-upgrade-swarm-a`
- Round 2:
  - `.games/e019r2-rush-engine-a`
  - `.games/e019r2-center-flank-a`
  - `.games/e019r2-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4`
Map: `maps/sketch-v3-contest.json`

Hypothesis:
The E013 shell may still be promising, but the old evidence is not trustworthy enough. Strict action-logged playthroughs should show whether E013's apparent strategy diversity survives legal movement, recruitment, occupancy, blocked-hex, attack-range, deck-damage, and response-window enforcement.

Changed:
No ruleset or map change from E013. This experiment changes the evidence standard: every run must include `actions.movements`, `actions.recruits`, and `actions.attacks`, and must pass `bun run validate-run -- --strict <timeline.json>`.

Result:
Score: 60 / 100 as a balanced candidate, but high confidence as legal refutation evidence.

All six replay bundles passed local strict validation.

- `.games/e019r1-rush-engine-a`: P2 engine/control beat P1 rush after 43 completed player turns, confirming at P2 turn 44 with 9 units to 5. Final centers were P1 2, P2 4, neutral 2.
- `.games/e019r1-center-flank-a`: P2 flank/economy beat P1 center-control after 33 completed player turns, confirming at P2 turn 34 with 15 units to 10. Final centers were P1 3, P2 4, neutral 1.
- `.games/e019r1-upgrade-swarm-a`: P2 swarm/economy beat P1 upgrade/support after 37 completed player turns, confirming at P2 turn 38 with 12 units to 7. Final centers were P1 2, P2 6, neutral 0.
- `.games/e019r2-rush-engine-a`: P2 engine/control beat sharper P1 rush after 55 completed player turns, confirming at P2 turn 56 with 7 units to 3. Final centers were P1 2, P2 3, neutral 3.
- `.games/e019r2-center-flank-a`: P2 flank/economy beat improved P1 center-control after 33 completed player turns, confirming at P2 turn 34 with 15 units to 11. Final centers were P1 3, P2 4, neutral 1.
- `.games/e019r2-upgrade-swarm-a`: P2 swarm/economy beat higher-throughput P1 upgrade/support after 53 completed player turns, confirming at P2 turn 54 with 15 units to 11. Final centers were P1 2, P2 6, neutral 0.

Observed:
- Strict action-logged evidence preserves part of the E013 hypothesis: P2 can legally stabilize or pressure through the contest map without overlapping units, blocked hexes, off-range guardian attacks, or same-turn recruit attacks.
- The balance result is now decisive enough to stop the E013 retest early: P2 won all six strict games across two rounds.
- Pacing remains long: 33, 37, 43, 55, 33, and 53 completed player turns. Two round-2 games crossed 50 completed turns.
- The old P2 flank concern remains real under strict validation, but the mechanism changed from a suspect 6-2 blowout to legal lower/east lane pressure and better supply conversion.
- The repeated lower/east package points at `center-center-south` on `sketch-v3-contest`: it was placed at `(5,7)`, which is P1 distance 9 and P2 distance 4 from home, while adjacent/east centers were neutral or only mildly P1-favored.
- Deck execution in these generated runs is summarized enough for board-counter accounting, but still not a full deterministic Dominion-style card-sequence audit. Treat them as strong board-legality evidence, not complete deck-engine proof.

Decision:
Stop the five-round E013 retest early. E013 is legally playable but refuted as a balanced candidate under strict play. Do not add cards yet. Branch to E020 with a map-only correction that recenters `center-center-south` from `(5,7)` to `(7,5)`, reducing P2's lower/east economy package while preserving the E013 rules shell.

## E020 - Strict recentered contest map

Status: complete
Runs:
- `.games/e020r1-rush-engine-a`
- `.games/e020r1-center-flank-a`
- `.games/e020r1-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Moving `center-center-south` from `(5,7)` to `(7,5)` should reduce P2's repeated lower/east economy conversion without reverting to the earlier P1 rush/map-access problem. The changed center becomes neutral by home distance: P1 distance 6 and P2 distance 6, instead of P1 distance 9 and P2 distance 4.

Changed:
Created `maps/sketch-v5-recenter.json` from `sketch-v3-contest`. The only map balance change is `center-center-south` from `(5,7)` to `(7,5)`. Created `.games/e020-recenter-starter.board.json` from the E013 starter with the new map id.

Result:
Score: 62 / 100.

All three replay bundles passed local strict validation.

- `.games/e020r1-rush-engine-a`: P1 rush/tempo beat P2 engine/healing after 34 completed player turns, confirming at P1 turn 35 with 7 units to 3. Final centers were P1 3, P2 1, neutral 4.
- `.games/e020r1-center-flank-a`: P2 flank/economy beat P1 center-control after 33 completed player turns, confirming at P2 turn 34 with 15 units to 11. Final centers were P1 4, P2 3, neutral 1.
- `.games/e020r1-upgrade-swarm-a`: P2 swarm/economy beat P1 upgrade/support after 119 completed player turns, confirming at P2 turn 120 with 23 units to 17. Final centers were P1 2, P2 6, neutral 0.

Observed:
- Recentered `center-center-south` did change the center/flank economy shape. In the center/flank run, P1 ended ahead on centers 4-3 instead of repeating E019's P2 4-3 edge, but P2 still converted flank pressure into a 15-11 unit-count win.
- Rush/engine overcorrected back toward P1. The P1 rush win was slower than old early P1 rush collapses, but P2 engine/healing did not stabilize.
- Upgrade/support pacing failed badly. The 119-turn run is longer than the previous support-ball concern by a wide margin, and P2 still eventually reached a 6-2 center split.
- E020 is legal evidence that one-center recentering can affect center ownership, but it does not solve the core candidate problem.

Decision:
Do not continue E020 as the candidate. Keep the recentered map as a useful component, but branch to a combat/support pacing change next. E021 should combine `sketch-v5-recenter` with no printed unit healing so druids/healers no longer create repeatable board-phase attrition loops.

## E021 - Strict recentered no printed healing

Status: complete
Runs:
- `.games/e021r1-rush-engine-a`
- `.games/e021r1-center-flank-a`
- `.games/e021r1-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Combining E020's recentered map with no printed unit healing should shorten the 119-turn upgrade/support grind while preserving deck-produced healing and `upgradeHealth` as deck-building payoffs. This should make support decks rely on actual deck investments instead of repeatable druid/healer board actions.

Changed:
Created `.games/e021-recenter-no-printheal-starter.board.json` from the E020 starter, retargeted to `territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`. Corrected that ruleset's `units.json` so druid and healer `heal` values are 0, matching the written no-printed-healing rules.

Result:
Score: 58 / 100.

All three replay bundles passed local strict validation.

- `.games/e021r1-rush-engine-a`: P1 rush/tempo beat P2 engine/healing after 28 completed player turns, confirming at P1 turn 29 with 8 units to 3. Final centers were P1 2, P2 1, neutral 5.
- `.games/e021r1-center-flank-a`: P2 flank/economy beat P1 center-control after 33 completed player turns, confirming at P2 turn 34 with 15 units to 11. Final centers were P1 4, P2 3, neutral 1.
- `.games/e021r1-upgrade-swarm-a`: P2 swarm/economy beat P1 upgrade/support after 89 completed player turns, confirming at P2 turn 90 with 16 units to 11. Final centers were P1 2, P2 6, neutral 0.

Observed:
- Removing printed unit healing shortened the upgrade/support grind from E020's 119 turns to 89 turns, but 89 turns is still far outside the target range.
- The rush/engine line got worse: P1 confirmed in 28 turns instead of E020's 34, showing that printed healing was part of P2's stabilization budget.
- Center/flank was effectively unchanged because that line did not rely on printed unit healing.
- The repeated P2 6-2 center result in upgrade/swarm shows that no-printheal does not solve the underlying economy/position conversion.

Decision:
Do not continue E021. No-printheal is a useful diagnostic but not a candidate: it trims support attrition without enough pacing gain and weakens engine stabilization against rush. The next improvement needs a more direct game-resolution or center-conversion lever, not another small support-healing tweak.

Postscript:
After the support-action validator correction, future strict validation also requires `actions.heals` and `actions.upgrades`. E019-E021 runs that use healing or permanent upgrades without those logs no longer qualify as current full strict evidence, even if they passed strict validation when generated. Treat them as useful board-legality and balance-shape evidence, not final full evidence under the current validator.

## E022 - Strict high-movement diagnostic

Status: complete
Runs:
- `.games/e022r1-rush-engine-a`
- `.games/e022r1-center-flank-a`
- `.games/e022r1-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Substantially increasing every unit's movement may reduce home-base clumping, increase center churn, and prevent support/economy games from turning into long replacement grinds. The risk is that high movement may make rush/flank pressure too decisive by letting attackers reach centers and fragile units too easily.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove` from the E013 lead-4 shell. Cards, economy, damage cap, printed healing, and lead-4 response-window timing are unchanged. Unit movement changes are: guardian 1 -> 2, raider 2 -> 4, marksman 1 -> 2, scout 3 -> 5, druid 1 -> 2, healer 1 -> 2. Created `.games/e022-highmove-starter.board.json` from the E020 recentered starter with the high-movement ruleset id.

Result:
Score: 64 / 100.

All three replay bundles passed local strict validation under the current action-log standard, including `actions.heals` and `actions.upgrades`.

- `.games/e022r1-rush-engine-a`: P2 engine/healing beat P1 rush/tempo after 33 completed player turns, confirming at P2 turn 34 with 7 units to 2. Final centers were P1 1, P2 3, neutral 4.
- `.games/e022r1-center-flank-a`: P1 center-control beat P2 flank/economy after 30 completed player turns, confirming at P1 turn 31 with 9 units to 4. Final centers were P1 3, P2 4, neutral 1.
- `.games/e022r1-upgrade-swarm-a`: P2 swarm/economy beat P1 upgrade/support after 81 completed player turns, confirming at P2 turn 82 with 14 units to 10. Final centers were P1 3, P2 5, neutral 0.

Observed:
- High movement did create more board churn. Notes from the center/flank run specifically report faster center contact and more recapture attempts, and the final center split can diverge from the unit-count winner.
- Rush/engine improved relative to E020/E021: P2 could use mobility to reposition and stabilize, flipping that matchup back to a P2 win after 33 turns.
- Center/flank also changed winner, with P1 winning on units despite P2 holding a 4-3 center edge. That suggests mobility can separate center ownership from unit-count conversion more than the low-movement shell.
- The support/swarm pacing problem remains. High movement reduced the support/swarm line from E021's 89 turns to 81, but 81 is still far over the hard concern threshold and still ended from P2 economy/swarm conversion.
- As a diagnostic, high movement is useful. As a candidate, it does not solve the core pacing problem.

Decision:
Do not continue E022 unchanged. Keep high movement as a possible ingredient because it increases churn and can help engine/control reposition, but the next branch needs a direct resolution or anti-replacement-grind lever. Candidate directions: a center-conversion rule that makes center leads resolve faster without cheap early wins, a unit cap/maintenance pressure that prevents 80-turn board flooding, or a different win condition that rewards sustained territory plus unit parity without repeating E016/E017's cheap 5-center failures.

## E023 - Strict high-movement late center-majority

Status: complete
Runs:
- `.games/e023r1-rush-engine-a`
- `.games/e023r1-center-flank-a`
- `.games/e023r1-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-centermid`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Adding a late center-majority response-window win to the high-movement shell should shorten long support/economy replacement grinds by letting sustained 5-center control resolve the game. The 24-completed-turn gate should block the cheap early high-water center wins that made E016/E017 poor candidates.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-centermid` from E022. Cards, economy, damage cap, printed healing, high movement, and lead-4 unit-count response-window timing are unchanged. New rule: after at least 24 completed player turns, a player starting their turn with 5+ controlled centers and not behind on living units creates a pending center-majority threat; if the opponent cannot reduce them below 5 centers or move ahead on living units before that player's next start-of-turn check, the threat confirms.

Result:
Score: 66 / 100.

All three replay bundles passed local strict validation under the current action-log standard, including `actions.heals` and `actions.upgrades`.

- `.games/e023r1-rush-engine-a`: P2 engine/healing beat P1 rush/tempo after 33 completed player turns, confirming by unit-count at P2 turn 34 with 7 units to 2. Final centers were P1 1, P2 3, neutral 4. No center-majority confirmation occurred.
- `.games/e023r1-center-flank-a`: P1 center-control beat P2 flank/economy after 30 completed player turns, confirming by unit-count at P1 turn 31 with 9 units to 4. Final centers were P1 3, P2 4, neutral 1. No center-majority confirmation occurred.
- `.games/e023r1-upgrade-swarm-a`: P2 swarm/economy beat P1 upgrade/support after 71 completed player turns, confirming by late center-majority at P2 turn 72. P2 created the threat at start turn 70 with 6 centers and 12 units vs P1's 11. Final centers were P1 2, P2 6, neutral 0.

Observed:
- The new rule works mechanically and can be cleared: P1 created a pending center-majority threat in the support/swarm run at start turn 29 with 5 centers and units tied 6-6, but P2 cleared it before turn 31 by reducing P1 to 3 centers.
- The new rule can also resolve a long grind earlier than pure unit-count pressure: support/swarm dropped from E022's 81 turns to 71 turns.
- The improvement is not enough. 71 turns is still far beyond the hard concern threshold, and the result still came from a P2 6-2 center state.
- Rush/engine and center/flank were effectively unchanged from E022 and resolved by unit count before center-majority mattered.
- E023 is useful evidence that late territorial threats are a valid resolution tool, but the threshold or timing is still too conservative to solve pacing.

Decision:
Do not continue E023 unchanged. If iterating in this direction, make the territorial resolution pressure stronger or earlier while preserving counterplay: possible next levers are a lower turn gate, requiring 5 centers plus only no more than 1 unit behind, or a center-majority threat that creates a board penalty before outright winning. Avoid returning to E016/E017's cheap early 5-center wins.

## E024 - Strict high-movement six-center dominance

Status: complete
Runs:
- `.games/e024r1-rush-engine-a`
- `.games/e024r1-center-flank-a`
- `.games/e024r1-upgrade-swarm-a`
- `.games/e024r2-rush-engine-a`
- `.games/e024r2-center-flank-a`
- `.games/e024r2-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Replacing E023's 5-center/unit-parity threat with a later six-center dominance threat should create stronger resolution pressure in long economy/support games while avoiding cheap early 5-center wins. Because 6 centers is a high territorial threshold, the rule can allow the controller to be slightly behind on units without making the win feel arbitrary.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6` from E023. Cards, economy, damage cap, printed healing, high movement, and lead-4 unit-count response-window timing are unchanged. New territorial rule: after at least 18 completed player turns, a player starting their turn with 6+ controlled centers and not behind by 3 or more living units creates a pending six-center dominance threat; if the opponent cannot reduce them below 6 centers or move at least 3 units ahead before that player's next start-of-turn check, the threat confirms. Created `.games/e024-highmove-center6-starter.board.json`.

Result:
Score: 84 / 100.

All six replay bundles passed local strict validation under the current action-log standard, including `actions.heals` and `actions.upgrades`.

- `.games/e024r1-rush-engine-a`: P2 engine/healing beat P1 rush/tempo after 33 completed player turns, confirming by unit-count at P2 turn 34 with 7 units to 2. Final centers were P1 1, P2 3, neutral 4. No six-center dominance threat confirmed.
- `.games/e024r1-center-flank-a`: P1 center-control beat P2 flank/economy after 30 completed player turns, confirming by unit-count at P1 turn 31 with 9 units to 4. Final centers were P1 3, P2 4, neutral 1. No six-center dominance threat confirmed.
- `.games/e024r1-upgrade-swarm-a`: P2 swarm/economy beat P1 upgrade/support after 37 completed player turns, confirming by six-center dominance at P2 turn 38. P2 created the pending threat at start turn 36 with 6 centers and 6 units vs P1's 7. Final centers were P1 2, P2 6, neutral 0.
- `.games/e024r2-rush-engine-a`: P2 engine/healing beat a sharper P1 rush/tempo line after 33 completed player turns, confirming by unit-count at P2 turn 34 with 6 units to 2. Final centers were P1 1, P2 3, neutral 4. No six-center dominance threat confirmed.
- `.games/e024r2-center-flank-a`: P2 flank/economy beat P1 center-control after 31 completed player turns, confirming by unit-count at P2 turn 32 with 10 units to 6. Final centers were P1 3, P2 5, neutral 0. No six-center dominance threat confirmed.
- `.games/e024r2-upgrade-swarm-a`: P1 upgrade/support beat P2 swarm/economy after 24 completed player turns, confirming by unit-count at P1 turn 25 with 7 units to 3. Final centers were P1 6, P2 2, neutral 0. No six-center dominance threat confirmed.

Observed:
- E024 is the first recent branch to repeatedly bring the support/swarm failure below 50 completed turns: E020 119, E021 89, E022 81, E023 71, E024 37 and 24.
- The six-center threshold did not distort rush/engine or center/flank across the six-run sample. Those games resolved by unit-count in 30, 31, or 33 turns before six-center dominance mattered.
- The new rule creates strong territorial resolution pressure. P2 won support/swarm while down two units, because P1 could not flip a center or move three units ahead during the response turn.
- Round 2 lowered that caveat: the upgrade/support vs swarm matchup resolved by unit-count in 24 turns, with P1 winning while holding 6 centers and a 7-3 unit lead.
- Winners across the six strict runs were P1 twice and P2 four times. That is not perfectly symmetric, but it is much healthier than E019's six legal P2 wins and all games finished in a usable 24-37 turn band.
- High movement plus six-center dominance is meaningfully better than high movement alone for long-game pacing and is now the current best strict candidate.

Decision:
Keep E024 as the current best strict candidate, but test one small comparison before locking it in: E024b should require six-center dominance to be prevented or cleared when the opponent is at least 2 units ahead instead of at least 3. That directly tests the only serious rule-feel caveat while preserving the movement, map, economy, and card shell.

## E024b - Strict high-movement six-center tight deficit

Status: complete
Runs:
- `.games/e024b-r1-rush-engine-a`
- `.games/e024b-r1-center-flank-a`
- `.games/e024b-r1-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6-tight`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Tightening E024's six-center dominance condition so it is prevented or cleared when the opponent is at least 2 living units ahead should improve rule feel in the round-1 support/swarm edge case while preserving E024's sub-50-turn pacing and avoiding cheap early center wins.

Changed:
Created `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6-tight` from E024 and changed only the late six-center dominance unit-deficit threshold: the controller must not be behind by 2 or more living units, and the opponent can clear the threat by moving at least 2 units ahead. Cards, economy, damage cap, printed healing, high movement, lead-4 unit-count response-window timing, map, and starter units are unchanged. Created `.games/e024b-highmove-center6-tight-starter.board.json`.

Result:
Score: 82 / 100.

All three replay bundles passed local strict validation under the current action-log standard, including `actions.heals` and `actions.upgrades`.

- `.games/e024b-r1-rush-engine-a`: P2 engine/healing beat P1 rush/tempo after 33 completed player turns, confirming by unit-count at P2 turn 34 with 6 units to 2. Final centers were P1 1, P2 3, neutral 4. No six-center dominance threat occurred.
- `.games/e024b-r1-center-flank-a`: P2 flank/economy beat P1 center-control after 31 completed player turns, confirming by unit-count at P2 turn 32 with 10 units to 6. Final centers were P1 3, P2 5, neutral 0. No six-center dominance threat occurred.
- `.games/e024b-r1-upgrade-swarm-a`: P1 upgrade/support beat P2 swarm/economy after 24 completed player turns, confirming by unit-count at P1 turn 25 with 7 units to 3. Final centers were P1 6, P2 2, neutral 0. No six-center dominance threat occurred.

Observed:
- E024b produced the same broad outcomes as E024 round 2: 33-turn P2 rush/engine stabilization, 31-turn P2 center/flank win, and 24-turn P1 upgrade/support win.
- The stricter six-center deficit threshold caused no downside in these generic matchup repeats.
- The comparison did not actually exercise the changed rule. All three games resolved by unit-count before any six-center dominance threat was created.
- E024b therefore remains plausible as a conservative version of E024, but this round does not prove it preserves E024's round-1 six-center pacing fix because the six-center clock never mattered.

Decision:
Do not replace E024 with E024b on this evidence alone. The next useful comparison should be a targeted six-center stress run, ideally starting from or reproducing the E024 round-1 support/swarm territory-pressure shape, to check whether the 2-unit deficit clear condition blocks the questionable down-two territorial win without sending support/swarm back above 50 turns.

## E024b-R2 - Targeted six-center stress

Status: in progress
Runs:
- `.games/e024b-r2-sixcenter-stress-a`
- `.games/e024b-r2-sixcenter-stress-b`
- `.games/e024b-r2-sixcenter-stress-c`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6-tight`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
Generic E024b repeats did not trigger six-center dominance, so a targeted upgrade/support vs swarm/economy stress round should test the actual changed rule. If E024b is better than E024, it should block or clear the questionable six-center win when the controller is down 2 units while still resolving support/swarm below 50 turns.

Changed:
No ruleset changes from E024b. Changed only playtest intent: workers should deliberately stress six-center creation and clearing while preserving legal, adversarial play to a winner.

Result:
Score: 70 / 100.

All three replay bundles passed local strict validation under the current action-log standard, including `actions.heals` and `actions.upgrades`.

- `.games/e024b-r2-sixcenter-stress-a`: P2 swarm/economy beat P1 upgrade/support after 67 completed player turns, confirming by six-center dominance at P2 turn 68. Final units were P1 12, P2 11. Final centers were P1 2, P2 6, neutral 0.
- `.games/e024b-r2-sixcenter-stress-b`: P2 swarm/economy beat P1 upgrade/support after 67 completed player turns, confirming by six-center dominance at P2 turn 68. Final units were P1 12, P2 11. Final centers were P1 2, P2 6, neutral 0.
- `.games/e024b-r2-sixcenter-stress-c`: P2 swarm/economy beat P1 upgrade/support after 67 completed player turns, confirming by six-center dominance at P2 turn 68. Final units were P1 12, P2 11. Final centers were P1 2, P2 6, neutral 0.

Observed:
- The three targeted workers converged on the same stress branch, so this is best treated as a reproduced branch result rather than three independent strategic samples.
- E024b directly fixes E024's down-two caveat: P2 created a six-center threat at start turn 36 with 6 centers and units P2 6 vs P1 7, but P1 moved to an 8-6 unit lead and cleared the threat before turn 38.
- The pacing cost is severe. The same stress branch did not resolve until P2 created another six-center threat at start turn 66 with 6 centers and units P2 11 vs P1 12, then confirmed at start turn 68.
- Final confirmation while down one unit feels better than E024's down-two confirmation, but the 67-turn duration fails the support/swarm pacing target and partially reintroduces the long replacement-grind problem E024 was meant to solve.
- E024b is therefore a useful diagnostic and a cleaner-feeling rule, but it is not currently better than E024 as a candidate.

Decision:
Do not replace E024 with E024b. Keep E024 as the current best strict candidate despite its down-two six-center caveat, because E024b shows that tightening the threshold to 2 units can push the stressed support/swarm lane back above 50 turns. If the caveat remains unacceptable, the next variant should look for a different counterplay lever than simply clearing at a 2-unit deficit.

## E025 - E024 strict-win confirmation

Status: in progress
Runs:
- `.games/e025-r1-rush-engine-a`
- `.games/e025-r1-center-flank-a`
- `.games/e025-r1-upgrade-swarm-a`

Ruleset: `rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6`
Map: `maps/sketch-v5-recenter.json`

Hypothesis:
E024 is the current best strict candidate, but its existing evidence predates structured `winEvents` and `terminalWinEvents`. A fresh three-matchup confirmation round should show whether E024 still holds up under `bun run validate-run -- --strict --strict-win`.

Changed:
No ruleset, map, card, unit, or starter changes. This is an evidence-quality rerun using the E024 ruleset and `.games/e024-highmove-center6-starter.board.json`, with stricter replay logging.

Result:
Pending.

Decision:
Pending strict-win playthrough evidence.

## Template

```md
## E000 - Title

Status:
Run:
Ruleset:
Map:

Hypothesis:

Changed:

Result:

Decision:
```
