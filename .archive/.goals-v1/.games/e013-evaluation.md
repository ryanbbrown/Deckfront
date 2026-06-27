# E013 Contest Map Batch Evaluation

## Score

Ruleset/map score: 80 / 100

- Pacing and arc: 17 / 25
- Strategic diversity: 25 / 30
- Board tension: 18 / 20
- Combat interest: 20 / 25

## Run Validity Summary

All seven timelines validate with `bun run validate-run -- <timeline>`. Validation confirms replay bundle continuity and snapshot/schema integrity, not full tactical legality. I found no self-reported material legality issue in notes or timelines. Pending lead-4 threats are tracked in notes/timeline reasoning because the board schema has no pending-threat field.

- `.games/e013-rush-vs-engine-a`: full evidence. 23 completed player turns; P2 confirmed lead-4 at start of turn 24. P1 created and lost an earlier pending threat; final board P1 6 / P2 10 units, centers 2 / 5 / 1 neutral.
- `.games/e013b-rush-vs-engine-b`: full evidence. 31 completed player turns; P2 confirmed at start of turn 32. P1 reached a serious midgame 10-5 unit posture, but P2 cleared it and later won; final units 7 / 12, centers 2 / 5 / 1 neutral.
- `.games/e013b-rush-vs-engine-c`: full to partial evidence. 27 completed player turns; P2 confirmed at start of turn 28. Replay validates, but `deck.json` lacks the newer config wrapper while notes/timeline record the operative fixed setup; final units 7 / 12, centers 3 / 5.
- `.games/e013b-rush-vs-engine-d`: full evidence. 22 completed player turns; P1 confirmed at start of turn 23. Cleanest successful P1 rush line; final units 10 / 6, centers 5 / 3.
- `.games/e013c-center-vs-flank-a`: full evidence. 25 completed player turns; P2 confirmed at start of turn 26. Center-control won local fights but lost the income race; final units 4 / 8, centers 2 / 6.
- `.games/e013c-swapped-rush-control-a`: full evidence. 28 completed player turns; P1 confirmed at start of turn 29. P2 rush from the swapped seat was dangerous but faded after losing mobile attackers; final units 11 / 6, centers 4 / 3 / 1 neutral.
- `.games/e013c-upgrade-vs-swarm-a`: full evidence, with pacing concern. 46 completed player turns; P1 confirmed at start of turn 47. Deterministic hand-audited simulator run; final units 11 / 6, centers 4 / 4.

## Category Evidence

Pacing and arc is solid but too long. Six runs conclude between 22 and 31 completed player turns, which is playable but above the rubric's preferred 12-16 range. The upgrade/support vs swarm run reaches 46 turns, showing the system can still bog down when durable upgraded fronts meet broad recruitment. The upside is that openings are not inert: early center races, first threats, response turns, and late confirmations are all distinct.

Strategic diversity is the strongest result. P2 engine/healing beats P1 rush in A/B/C, but P1 rush wins D. P2 flank/economy beats P1 center-control, P1 control beats swapped P2 rush, and P1 upgrade/support beats swarm/economy. No single plan is proven dominant from this batch. The caveat is that guardian/healer/druid durability appears to be the common stabilizing backbone, while raiders and scouts matter most as early pressure and capture tools.

Board tension is high. The contest map consistently pulls players into the east, southeast, center, and lower-center clusters. Supply splits directly shape recruit tempo: P2's 5-center recoveries in A/B/C, P1's 5-3 rush win in D, P2's 6-2 flank win in center-vs-flank, and the 4-4 upgrade/swarm finish all matter. The map improves P2 agency, though center-vs-flank suggests the lower/east route may over-reward P2 flank economy in some matchups.

Combat interest is meaningfully improved by the damage cap and response-window win. Focus fire, capped deck damage, healing, Storm targeting, Training, Armory, and Second Wind all matter without making one action automatically decisive. The best moments are response turns where a player must recruit, kill, or preserve enough bodies to clear a pending lead. The main weakness is attritional support-ball play: upgraded guardians, druids, and healers can create long grinds, especially in the 46-turn run.

## Main Lessons

- `sketch-v3-contest` is a real improvement for contestability: P1 rush can threaten and sometimes win, but P2 has enough reachable counterplay to survive and reverse.
- The lead-4 response window produces good tactical pressure. Runs repeatedly show a pending threat, a concrete response turn, and a meaningful confirm or clear.
- The map is not fully symmetric in practice. P2 can rush from the swapped seat, but P1's control side still converts engine/support into a late win; meanwhile P2 flank economy can overpower P1 center-control.
- Recruit tempo from 5+ centers is still the main snowball vector. It creates good board stakes, but 6-2 and prolonged 5-3 economies can overwhelm local tactical success.
- Upgrade/support is viable, but may be too slow or too durable when paired with equalized 4-4 center control.

## Recommended Next Experiment

Iterate near E013 rather than discard it. Run a focused E014 on pacing and flank balance: keep the lead-4 response win and damage cap, keep the contest-map idea, but test a small map or economy adjustment that reduces long support grinds and softens extreme flank income conversion. The highest-value matchups are repeated P1 center-control vs P2 flank/economy, swapped P2 rush vs P1 control, and upgrade/support vs swarm with an explicit turn-limit concern.
