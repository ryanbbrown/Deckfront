# Fixed-reservoir PSRO seed variance results

## Run

Kingdom 009 fixed reservoirs for pool seeds 1, 3, and 4 each ran under PSRO evaluation seeds 7,100,009, 7,200,009, and 7,300,009. The existing 7,100,009 artifacts were reused. All nine runs reported convergence after two clean scans.

Runtime was 42.6–90.9 seconds, with a 68.8-second mean.

## Result

Final support identity and weights changed materially under a fixed reservoir:

- Mean pairwise total-variation distance between evidence-seed lotteries was 57.4%.
- Material-support identity Jaccard similarity was 0–0.50.
- Admission counts were 8/8/10 in pool 1, 8/9/8 in pool 3, and 0/0/3 in pool 4.
- Only two admissions were common to all three evidence seeds in pools 1 and 3. Pool 4 had none.

Exact acquisition-based family and card rates require fresh support mirror games, which were not part of these artifacts. An off-diagonal matrix-telemetry proxy reproduced the existing full-report Ranged shares within 0.87 percentage point for the three baseline runs. Its within-reservoir Ranged ranges were:

- Pool 1: 10.6%–23.2%, a 12.6-point range.
- Pool 3: 13.4%–18.8%, a 5.4-point range.
- Pool 4: 0.3%–2.5%, a 2.2-point range.

At each fixed evaluation seed, the between-reservoir Ranged range was 16.2–20.7 points. Reservoir contents therefore caused more family variation overall, but PSRO evidence seeds caused material variation, especially in pool 1.

## Known attackers

Pool 3's `sg-391da704db` fresh attack scored 61.8%, with a 58.6%–65.1% interval, against the 7,100,009 final lottery.

- Evaluation seed 7,100,009 never made it a finalist.
- Evaluation seed 7,200,009 confirmed it at 50.4%, with an interval crossing 50%, and did not admit it.
- Evaluation seed 7,300,009 admitted it in round 0 at 70.5%, with a 68.2%–72.9% interval.

Pool 3's second known attacker, `sg-2e83709eda`, was not made a finalist by any of the three PSRO seeds despite its fresh 57.8% attack against the 7,100,009 lottery.

All nine runs therefore converged under the stochastic protocol, but the protocol did not reliably establish closure against a fixed reservoir.

## Decision

Do not average three independent PSRO lotteries and call the result closed. Three evaluation seeds still missed a known retained attacker.

Before production, test a stronger competitive race on the saved pool-3 reservoir across the same three evaluation seeds. The race should either use more early evidence or union finalists from independent early races before 400-block confirmation. After solving the resulting game, run independent complete-reservoir attacks against the unchanged final lottery and resume PSRO after any admitted attack.

Evaluation replication cannot fix proposal coverage. Multiple proposal reservoirs or an explicit merged-reservoir design remain necessary for that separate source of variation.

Ignored evidence: `.experiments/fixed-reservoir-psro-evaluation-variance-v1/deep-beam-tuning-009/`.
