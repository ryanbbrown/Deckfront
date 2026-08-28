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

Rust verifies ranges, checksums, row counts, strategy numbers, source links, uniqueness, and best-first order. The controller deletes range files only after both final files pass verification. Command reports are separate JSON files with elapsed time, scoring time, read time, write time, reduction time, and byte counts. Timings do not change result bytes.

The reservoir is the candidate set for competitive search. A high Goldfish rank does not prove that a strategy is competitively strong. Later stages test strategies in head-to-head games.

# 2. Build the initial game matrix

A game matrix records how each selected strategy performs against every other selected strategy.

1. Take the top 50 strategies from the reservoir.
2. Play every pair of strategies, including each strategy against itself.
3. For each pair, use 125 fixed shuffle seeds. Play twice per seed so that each strategy goes first once.
4. Record the results and gameplay evidence for each pairing.
5. Use the first 75 seeds to calculate the initial equilibrium.
6. Keep seeds 76–100 as a depth check and seeds 101–125 as independent evidence for later analysis.

The equilibrium is a weighted lottery over strategies. Its weights describe how often each strategy should be selected when no strategy in the current matrix has an advantage over the lottery.

# 3. Search for responses with PSRO

Policy-space response oracles (PSRO) repeatedly search for strategies that can beat the current equilibrium. A response is a reservoir strategy that appears to beat the equilibrium by more than the 51% threshold.

Each search follows three steps: screening, confirmation, and admission.

## Screen the reservoir

1. Exclude strategies that are already in the matrix.
2. Play every remaining reservoir strategy against the current equilibrium.
3. Start with 8 shuffle seeds and increase the evidence through 16, 32, 64, 128, 256, and 512 seeds when the result is still uncertain.
4. Reject a strategy when the evidence shows that it does not exceed the 51% threshold.
5. Send a strategy to confirmation when the evidence shows that it exceeds the threshold.
6. Mark a strategy as unresolved when the maximum screening evidence is not enough to make either decision.

Each shuffle seed produces two games with opposite first players. The search follows the equilibrium weights as closely as the available number of games allows.

## Confirm possible responses

1. Test every possible response again with fresh shuffle seeds.
2. Increase confirmation evidence through 400, 800, 1,600, 3,200, and 6,400 seeds while the result is unresolved.
3. Fix the confirmation family to every possible response from the completed screen.
4. Give each family member an error rate of `0.05 / family size`. Queue retests use the same fixed-family rule and fresh seeds.
5. Confirm only when the anytime confidence lower bound is strictly greater than 51%.
6. Reject when the confidence upper bound is at or below 51%.
7. Leave a strategy unresolved when the 6,400-seed result meets neither boundary.

Fresh confirmation prevents screening results from also serving as final proof.

## Admit a confirmed response

1. Order confirmed responses by confidence lower bound, mean score, confidence upper bound, Goldfish rank, and deterministic strategy identity.
2. Admit the strongest response to the matrix.
3. Play the admitted strategy against every strategy already in the matrix.
4. Add the new results as a row and column in the matrix.
5. Calculate a new equilibrium from the expanded matrix.
6. Retest the other confirmed responses against the new equilibrium.
7. Run another full reservoir search after the confirmed queue is empty.

Only one response is admitted at a time because each admission can change the equilibrium and make other responses irrelevant.

## Stop after two clean searches

A search is clean when it finds no confirmed response.

1. Count the first clean search.
2. Search the same reservoir again against the same matrix and equilibrium.
3. Finish when the second consecutive search is also clean.
4. Reset the clean-search count whenever a response is admitted.

Two clean searches are evidence that the saved 20,000-strategy reservoir contains no response that this process can confirm against the final equilibrium. They do not prove that no response exists outside the reservoir or that the game has only one equilibrium.

A completed search is clean when it has no confirmed response. Candidates can remain unresolved at the screening, confirmation, or queue-retest cap. The evidence keeps each unresolved decision, but uncertainty does not make the search incomplete and does not block a clean-search count. Missing, corrupt, failed, or interrupted work is incomplete. The runtime records elapsed time but does not change a scientific result because of elapsed time alone.

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