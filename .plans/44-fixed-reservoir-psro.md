# Fixed-reservoir PSRO pilot

## Goal

Test whether one movement-aware goldfish reservoir makes Kingdom 009 strategy discovery reproducible and easier to diagnose.

## Run

- Generate 500,000 unrestricted policies for each of pool seeds 1 and 2.
- Keep 18,000 movement-aware goldfish leaders and 2,000 deterministic random-tail policies.
- Use the same goldfish and competitive evidence seeds for both pools.
- Start each matrix with the top 50 goldfish policies.
- On every response round, scan every non-admitted reservoir policy against the current lottery, confirm the global eight finalists, and admit every response whose 95% confidence-interval lower bound exceeds 50%.
- Require two complete clean scans on fresh evidence. A response in the second scan resumes PSRO.
- Compare final lotteries, supports, family shares, and each full reservoir against the other lottery.

## Limits

Convergence applies only to the fixed 20,000-policy reservoir. A final outside-reservoir attack is still required before this can replace unrestricted strategy discovery.
