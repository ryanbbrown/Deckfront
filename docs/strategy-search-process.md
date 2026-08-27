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

Goldfish scoring is a fast first filter. It measures each strategy against three movement profiles: stationary, chaser, and kiter. It does not measure how well the strategy performs against the other strategies.

1. Generate and score all 12,972,960 legal strategies with the first fixed shuffle seed against all three movement profiles.
2. Take the best 500,000 unique strategies and save them with their results.
3. Score each of the saved 500,000 strategies with three more fixed shuffle seeds against the same movement profiles.
4. Combine the results from all four shuffle seeds.
5. Take the best 20,000 unique strategies and save them with their results as the reservoir.

The reservoir is the candidate set for the competitive search. A high Goldfish rank does not prove that a strategy is competitively strong. The later stages test that through head-to-head games.

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
2. Increase confirmation evidence through 400, 800, 1,600, 3,200, and 6,400 seeds when needed. (when needed to get 95% CI above 51%?)
3. Account for the number of possible responses being tested in the same search. (what is this? statistical thing to account for false positives given testing a lot of items?)
4. Confirm only strategies whose adjusted evidence remains above the 51% threshold.
5. Leave strategies unresolved when the maximum confirmation evidence is not enough to confirm them.

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

An interrupted or inconclusive search is incomplete. A time limit, failed task, or manual stop must not count as a clean search.

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