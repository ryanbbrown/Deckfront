# Balance search process

## Phase 1: Run three separate searches

The program runs this phase three times. Each search starts from a different random set of strategies. The program finishes one search before it starts the next search.

Each of the three searches follows these steps:

1. Create eight random strategies.

2. Have all eight strategies play against each other. Each pair plays 100 games. The games evenly swap who goes first, player color, and starting side.

3. Use the results to create a lottery from the eight strategies. The lottery assigns a percentage to each strategy so that the complete lottery is as difficult as possible for one new strategy to beat.

4. Create 100 new strategies:

   - 70 are small changes to strategies that already exist in this search.
   - 30 are completely random.

5. Test every new strategy for 100 games against the same lottery. All 100 new strategies face the same exact sequence of strategies selected from the lottery. Corresponding games use the same shuffled decks and starting conditions.

6. Take the new strategy with the best result and test it for another 100 games against the same lottery. Select a new exact sequence of strategies from the lottery, and use new shuffled decks and starting conditions.

7. Check the second result:

   - If the strategy scores at least 52%, and the statistical calculation says its true score is above 50% with 95% confidence, add it to this search.
   - Have the added strategy play every strategy already in this search.
   - Give the added strategy a new row and column in the matrix. The matrix is the table of head-to-head results for the eight starting strategies and every new strategy that passed step 7.
   - Recalculate the lottery.
   - Return to step 4.

If the strategy does not pass step 7, return to step 4 without adding it.

A successful addition resets the consecutive-failure count to zero. Stop this search after four consecutive failures. Also stop after 12 total passes through steps 4–7, even if the search has not reached four consecutive failures.

## Phase 2: Combine the three searches

1. Combine every strategy found by the three searches.

2. Remove exact duplicates.

3. Have every pair that has not yet played complete 100 games.

4. Use all recorded results to calculate one combined lottery.

5. Create 100 new strategies:

   - 70 are small changes to strategies in the combined set.
   - 30 are completely random.

6. Test every new strategy for 100 games against the same combined lottery. Use the same exact sequence of selected strategies, shuffled decks, and starting conditions for all 100 new strategies.

7. Take the best new strategy and test it for another 100 games against the same lottery. Use a new exact sequence of selected strategies, shuffled decks, and starting conditions.

8. Check the second result:

   - If the strategy clearly scores above 50%, add it to the combined matrix.
   - Have it play every strategy already in the combined set.
   - Record its new row and column, then recalculate the lottery.
   - Return to step 5.

If the strategy does not pass step 8, return to step 5 without adding it. A successful addition resets the consecutive-failure count. Stop Phase 2 after two consecutive failures or after eight total passes through steps 5–8.

## Phase 3: Run a much larger final search

Phase 3 checks whether Phases 1 and 2 missed a strong strategy. It does not try to create diversity for its own sake. It searches more widely because all 3,000 strategies are random instead of being based mainly on strategies already found.

1. Create 3,000 completely random strategies. Do not make small changes to existing strategies.

2. Test each new strategy for 20 games against the final lottery from Phase 2. All 3,000 strategies face the same exact sequence of selected strategies, shuffled decks, and starting conditions.

3. Select the 20 strategies with the best results.

4. Test each of those 20 strategies for another 100 games against the same lottery. Use a new exact sequence of selected strategies, shuffled decks, and starting conditions.

5. Check the second results:

   - If no strategy clearly scores above 50%, finish the search and produce the balance report.
   - If one or more strategies clearly score above 50%, select the best one.
   - Add that strategy to the combined matrix from Phase 2.
   - Have it play every strategy in the combined set.
   - Record its new row and column, then recalculate the lottery.
   - Return to Phase 2, step 5 with a fresh allowance of eight passes and zero consecutive failures.

After Phase 2 stops again, repeat Phase 3 with 3,000 new random strategies and new game conditions. Continue this loop until Phase 3 cannot find a strategy that clearly beats the lottery.
