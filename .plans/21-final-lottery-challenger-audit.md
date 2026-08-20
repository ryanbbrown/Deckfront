# Final-lottery challenger audit

## Goal

Test whether a reported final lottery is still beaten by a strategy that the PSRO run did not discover.
Run the first audit on 10 tuning kingdoms: `balance-tuning-005` plus nine kingdoms selected by a fixed random seed.

## Scope

- Add a reusable audit command. Do not change cards, game rules, PSRO, or the saved full-run artifacts.
- Select the sample deterministically and keep the held-back validation split out of this first audit.
- For each kingdom, load and validate the existing schema-4 artifact and its material final lottery.
- Generate 3,000 unique fresh random legal strategies from an audit-specific seed namespace.
- Screen every strategy against one shared five-block lottery schedule.
- Confirm the strongest 20 strategies against a separate shared 25-block lottery schedule.
- A lottery fails when the best confirmed challenger has mean score at least 52% and its bootstrap 95% lower bound is above 50%.
- Record the best challenger even when the lottery passes.
- Write ignored JSON and Markdown results under `.experiments/balance-audit/`. Include the selected kingdoms, seeds, candidate counts, scores, confidence intervals, draw rates, match counts, elapsed time, and winning strategy plans.

## Design constraints

- Screening and confirmation seeds must be disjoint from each other and from the original run namespaces.
- All candidates in one kingdom use the same opponent schedule in each phase.
- Results must be deterministic for fixed artifacts and audit seed.
- A missing, stale, aborted, or incomplete source artifact must fail the audit for that kingdom. It must not produce a pass.
- The command must resume completed valid kingdom audits and support rerunning one named kingdom.
- Keep the implementation inside one audit module with a small CLI wrapper.

## Tests

- The deterministic sample contains `balance-tuning-005`, has 10 distinct tuning kingdoms, and is stable across processes.
- The audit rejects invalid source artifacts and overlapping seed namespaces.
- Screening keeps the configured number of candidates, and confirmation uses independent seeds.
- Admission uses the confirmed mean and bootstrap interval, not screening score.
- A known challenger fixture fails a lottery; a non-challenger fixture passes it.
- The JSON and Markdown output are byte-identical for the same fixed inputs and injected time.
- Resume skips only complete audit artifacts with the expected protocol.

## Verification

- Run focused audit tests, typecheck, lint, simulator build, full tests, and `git diff --check`.
- Run the real 10-kingdom audit.
- Independently replay the reported best challenger for `balance-tuning-005` against its material lottery and confirm its score from the saved source matrix and audit seeds.
- Report how many of the 10 lotteries pass or fail and whether the stronger search finds a valid counter to `balance-tuning-005`.
