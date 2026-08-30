# Fixed-reservoir PSRO results

## Run

- Kingdom: `deep-beam-tuning-009`, draft off
- Raw pool per run: 500,000 unrestricted policies
- Reservoir per run: 18,000 movement-aware goldfish leaders and 2,000 random-tail policies
- Pool seeds: 1 and 2; both used evaluation seed 7,100,009
- Pool runtimes: 5m 56s and 5m 30s
- PSRO runtimes: 1m 31s and 1m 3s

## Result

- The reservoirs shared 930 of 20,000 policies, or 4.65%.
- Pool 1 converged after three full scans. It admitted eight policies and ended with 58 matrix strategies.
- Pool 2 converged after four full scans. It admitted nine policies and ended with 59 matrix strategies.
- Pool 1 scored 47.2% against Pool 2, with a 95% interval of 46.0%–48.4%.
- Pool 2 scored 52.7% against Pool 1, with a 95% interval of 51.5%–54.0%.
- Pool 1's complete reservoir found no response to Pool 2: 47.0%, interval 44.5%–49.4%.
- Pool 2's complete reservoir found a strong response to Pool 1: 59.0%, interval 56.4%–61.5%.

The Pool 2 response was its goldfish rank 39 plan:

`Sharpen ×3 → Strike ×4 → Step ×1 → Gold ×3 → Scour ×∞`

This policy had 32.8% weight in Pool 2's final lottery and scored 56.6% by itself against Pool 1 during cross-play. Pool 1 never generated this canonical policy among its 500,000 raw policies. The fixed reservoir therefore localizes this failure to initial proposal coverage rather than PSRO evaluation or admission.

Acquisition-based support labels remained different. Pool 1 was 89.1% Melee and 10.9% Ranged. Pool 2 was 60.7% Melee + Ranged, 32.8% Melee, and 6.6% Ranged.

## Decision

The fixed reservoir makes runs reproducible and makes missing coverage easy to diagnose, but two 500,000-policy pools still do not produce consistent restricted games. Do not treat two clean scans as global convergence. The next comparison should test whether one shared reservoir gives stable PSRO results under different evaluation seeds, separately from whether different reservoirs cover the same competitive regions.

Ignored evidence: `.experiments/fixed-reservoir-psro-v1/`.
