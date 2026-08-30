# Strategy search process

This document explains how strategy search produces card-balance evidence for each supplied kingdom. It describes what each stage does, not how the work is divided across computers.

# Process overview

For each kingdom:

1. Use Goldfish scoring to reduce every legal strategy to a 20,000-strategy reservoir.
2. Use head-to-head games to build a matrix for the best 50 strategies.
3. Search the reservoir for strategies that can beat the current equilibrium.
4. Add confirmed responses to the matrix and repeat the search.
5. Stop after two consecutive searches find no confirmed response.
6. Save and validate the evidence for local balance analysis.

# 1. Build the Goldfish reservoir

A strategy number from 0 to 12,972,959 identifies one five-card shopping list. The number maps directly to the ordered card permutation and one of 54 quantity vectors. Files store the number. They do not store a hash, display ID, or shopping list.

Run the full local step with:

```sh
npm run goldfish:reservoir -- balance-tuning-005 10 .data/goldfish/balance-tuning-005
```

Rust runs the full Goldfish process:

1. Play every strategy with shuffle 4,100,000 against stationary, chaser, and kiter dummy opponents.
2. Rank all strategies and write the best 500,000 to `top-500000.hgf`.
3. Play those 500,000 strategies with shuffles 4,100,001 through 4,100,003 against all three dummy opponents.
4. Add each profile's results from all four shuffles.
5. Rank the totals and write the best 20,000 to `reservoir.hgf`.

Each game stops at 50 damage or 30 turns. An unfinished game counts as 31 turns. A turn stops after 200 actions.

The ranking compares these values in order:

1. more completions against the weakest profile;
2. more completions in total;
3. fewer penalized turns against the slowest profile;
4. fewer penalized turns in total;
5. more damage total against the weakest profile;
6. more damage total in total;
7. more money spent;
8. lower strategy number.

Every result file starts with a 64-byte little-endian header. The header records the file kind, row size, range, row count, shuffle seeds, rule fingerprint, and a CRC-32 checksum of the row bytes. Stage-two files and `reservoir.hgf` also record the checksum of their source `top-500000.hgf`. A result row is 64 bytes. A reservoir row is 124 bytes and keeps both the shuffle-1 and shuffle-2-to-4 results.

Rust verifies ranges, checksums, row counts, strategy numbers, source links, uniqueness, and best-first order. On the Goldfish-only Modal route, intermediate range files stay on the container's local disk and are removed with the container; only the two final files reach the Volume. Command reports are separate JSON files with elapsed time, scoring time, read time, write time, reduction time, and byte counts. Timings do not change result bytes.

The reservoir is the candidate set for competitive search. A high Goldfish rank does not prove that a strategy is competitively strong. Later stages test strategies in head-to-head games.

# 2. Build the initial game matrix

A game matrix records how each selected strategy performs against every other selected strategy.

1. Take the top 50 strategies from the reservoir.
2. Play the 1,225 off-diagonal unordered pairs. Set each diagonal payoff score to 50%.
3. For each pair, use 125 fixed shuffle seeds. Play twice per seed so that each strategy goes first once.
4. Record pair scores, purchases, and played-card family damage for each off-diagonal pairing.
5. Play each strategy against itself with the same 125 seeds and both player positions. Record 500 player sides per strategy in `self-play-v1.hst`. These games supply telemetry only and do not change the fixed 50% payoff diagonal.
6. Use the first 75 seeds to calculate the initial equilibrium.
7. Keep seeds 76–100 as a depth check and seeds 101–125 as independent evidence for later analysis.

The versioned HST file binds its rows to the reservoir CRC, the three HGM row CRCs, the Matrix generation, and the rule fingerprint. It stores first-player and second-player purchase and family-damage counts separately. Each position has 250 player sides. A report adds both position totals and divides by 500.

The equilibrium is a weighted lottery over strategies. Its weights describe how often each strategy should be selected when no strategy in the current matrix has an advantage over the lottery.

# 3. Search for responses with PSRO

One Rust process runs the complete policy-space response oracle (PSRO) loop for one kingdom. It loads the reservoir, matrix strategies, pair scores, purchase evidence, and equilibrium once. Rust keeps each scientific look in memory and uses one Rayon thread pool. Python can start the process and collect its output, but Python does not choose seeds, opponents, candidates, admissions, or the stopping point.

## Allocate opponents

Each race builds one schedule at its maximum depth. At schedule position `k`, Rust chooses the positive-weight matrix strategy with the largest value of:

```text
normalized weight × k - assignments so far
```

A tie goes to the lower strategy number. Every later look uses a prefix of the same schedule and plays only its new suffix. Screening, confirmation, and queue retests use separate schedules and fresh deterministic seeds.

Each shuffle produces two games with the seats swapped. The candidate receives 2 points for a win, 1 for a draw, and 0 for a loss in each game. One shuffle therefore produces one score byte from 0 to 4.

## Screen the reservoir

1. Freeze the current matrix and equilibrium.
2. Exclude matrix strategies, then visit the other reservoir strategies in Goldfish rank order.
3. Play cumulative depths 8, 16, 32, 64, 128, 256, and 512.
4. Reject a candidate when its confidence upper bound is at or below 51%.
5. Send a candidate to confirmation when its confidence lower bound is above 51%.
6. Record a candidate as unresolved when neither rule applies after 512 shuffles.

The whole screen finishes before confirmation starts. This fixes the confirmation family size.

## Confirm possible responses

1. Use fresh shuffles at cumulative depths 400, 800, 1,600, 3,200, and 6,400.
2. Give each family member alpha `0.05 / family size`.
3. Confirm a candidate when its confidence lower bound is above 51%.
4. Reject a candidate when its confidence upper bound is at or below 51%.
5. Record any candidate still open after 6,400 shuffles as unresolved.

Rust uses the fixed betting mixture, 21 bisection steps, and `libm` logarithm and exponential functions. These rules keep decisions and evidence bytes stable across supported local and Linux machines.

## Admit one response at a time

Rust orders confirmed responses by higher lower bound, higher mean, higher upper bound, better Goldfish rank, and lower strategy number. It admits only the first response.

For each admission, Rust plays all 125 matrix shuffles against every current matrix strategy, stores both purchase and family-damage evidence, adds the new row and column, rebuilds percentages from shuffles 1 through 75, and runs the same maximum-support solver as the initial matrix step. Rust also adds one same-strategy HST row for the admitted strategy. This telemetry does not enter the payoff or solver. Rust then retests the remaining queue against the new equilibrium with fresh confirmation schedules. The process repeats until the queue is empty.

An admission resets the clean-search count. The process then starts another full reservoir search.

## Stop after two clean searches

A search is clean when it produces no confirmed response. Unresolved results at a fixed cap stay in the evidence and do not block a clean result. A missing, partial, corrupt, or failed look is incomplete and cannot count as clean. The process stops after two consecutive clean searches. Elapsed time never changes a decision.

## Evidence and restart

Each completed look writes one binary suffix file. Rows contain only the candidates that entered that look. A checkpoint records the next transition, current matrix, current families and queue, and immutable file references. Admission files hold the exact pair scores and telemetry needed to rebuild the expanded matrix.

Writes use a temporary file, file sync, byte read-back against the in-memory buffer, rename, directory sync, and then a checkpoint update. They do not decode the temporary payload. On restart, Rust removes partial temporary files, adopts a valid renamed look that is ahead of its checkpoint, reconstructs score prefixes from committed looks, and continues with the first unfinished suffix. A corrupt final file stops the run instead of being overwritten.

`decisions.hpd` records every final decision, admission, equilibrium snapshot, search result, and the two-clean-search stop. A fresh default `psro` run writes it from live records and applies a structural completion check without semantic final replay. A resume from a complete checkpoint rebuilds the decisions and compares the existing file with the rebuilt payload. Deliberate `psro-verify` independently replays decisions and races, verifies look evidence, checks the scientific file set and final references, and verifies expanded Matrix files. Scientific files contain no paths, host data, thread counts, timestamps, or timings.

# Save and validate the evidence

When done, save enough evidence to reproduce and inspect every scientific decision:

- the top 500,000 Goldfish results;
- the final 20,000-strategy reservoir;
- all game-matrix results;
- the equilibrium after each matrix change;
- screening and confirmation games, seeds, scores, and decisions;
- admitted responses;
- the final stopping result;
- gameplay evidence used for card-balance analysis.

Validate these files before the campaign is complete. Download the validated evidence, then produce balance reports and comparisons locally. Reporting does not change the strategy search or its completion result.

For a completed evidence set that predates HST, run `npm run strategy-search:self-play-backfill` locally. The command structurally checks headers, CRCs, source links, checkpoint completion, final Matrix order, and HST evidence. It creates only missing same-strategy telemetry and retains every valid HST. It does not replay Goldfish ranking, Matrix solving, PSRO screening, decisions, or races. Deep verification is a separate, deliberate `psro-verify` run.