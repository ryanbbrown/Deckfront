# Random PSRO results

## Run

- Used the same 10 deterministic kingdoms, with independent seeds 35001 and 35002 for each kingdom.
- Each response round sampled 20,000 stopless purchase plans, raced them, and confirmed finalists on 400 fresh seed blocks.
- A run stopped after two consecutive batches found no confirmed response. A separate 20,000-plan attack then tested the final lottery.
- All 20 runs converged. The resumable 20-unit suite took 52 minutes.

## Results

- The Kingdom 001 sense check passed. No strategy from either old lottery had a confidence-interval lower bound above 50% against the new lottery.
- The new Kingdom 001 lottery scored 78.0% against the old Mage lottery and 53.7% against the old Melee lottery.
- Only 4 of 10 kingdoms passed the 47%–53% lottery cross-play gate between independent runs: 001, 004, 007, and 010.
- Only 2 of 10 kingdoms had no support strategy from either run that confirmed as an exploit against the other run: 001 and 010.
- The independent 20,000-plan attack passed in 19 of 20 runs. Kingdom 007 seed 35002 failed with a 63.1% confidence-interval lower bound.
- No kingdom had exact canonical support overlap between its two runs. Different plans can still be equivalent, so cross-play is the more important result.
- Across the 20 selected lotteries, exclusive strategy shares were: Melee + Ranged 29.9%, Melee 27.1%, Ranged 22.7%, three-family 5.8%, Mage 5.5%, Ranged + Mage 4.5%, Melee + Mage 3.4%, and Engine 1.3%.

## Conclusion

Broad random search improved Kingdom 001 and produced useful strategies quickly, but it did not produce consistent lotteries across independent runs. Two clean random batches are not strong enough evidence of closure. The random generator is useful, but this stopping and admission loop is not yet a reliable final strategy-discovery method.

Detailed artifacts: `.experiments/random-psro-consistency/random-psro-v3/report/`.
