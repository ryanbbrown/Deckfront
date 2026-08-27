# Strategy search process

This document defines the current process for producing card-balance evidence from a user-supplied list of kingdoms.

## Goal

For each kingdom:

1. Generate every legal strategy in the current ordered grammar.
2. Reduce the full set to a 20,000-strategy reservoir.
3. Build an initial 50-strategy game matrix.
4. Add responses until the search produces two clean scans.
5. Preserve and download the complete raw evidence for local analysis.

The paid campaign ends after the PSRO artifacts validate. Analytics and balance reports run locally and do not gate campaign completion.

The result supports practical balance estimates. Two clean scans are empirical closure inside the saved 20,000-strategy reservoir. They are not proof that no response exists outside the reservoir or that the exact game has one unique equilibrium.

## 1. Build the goldfish reservoir

The ordered grammar contains exactly 12,972,960 strategies for each supported campaign kingdom. Candidate generation and ranking are deterministic for fixed rules, code, kingdom, and seeds.

Goldfish ranking uses three movement profiles: stationary, chaser, and kiter.

### Stage 1

- Score all 12,972,960 strategies with the first fixed seed and all three movement profiles.
- Each runtime job writes every score in its contiguous range once to a sorted 96-byte binary record.
- One reducer reads each compact record once, checks exact range coverage, and keeps the best 500,000 unique strategies.
- The schema-3 top-500,000 artifact contains first-seed evidence and stage-one rank. It does not contain provisional four-seed ranks.
- Work: 38,918,880 goldfish profile trials.

### Stage 2

- Read the retained top 500,000 once in one measured 10-CPU job.
- Score each retained strategy once with the other three fixed seeds and all three movement profiles.
- Combine all four seeds in one deterministic reducer.
- Keep the best 20,000 strategies in ranked order.
- Work: 4,500,000 additional goldfish profile trials.

The four seeds are `4,100,000` through `4,100,003` for every kingdom. Runtime range size, CPU count, task count, completion order, retries, and Modal call IDs do not change final bytes.

Total: 43,418,880 goldfish profile trials per kingdom.

The 500,000 and 20,000 limits are part of the current process. One goldfish run is used for the first balance pass. Repeat goldfish work only when a kingdom or card has material uncertainty.

Different goldfish seeds can change ranks and the initial top 50. This does not always remove important strategies from the 20,000-strategy reservoir. In K007, the same Volley and Drive response existed in both compared reservoirs, at ranks 1,426 and 15,581. Its different PSRO outcome came from the initial lottery and response order, not reservoir exclusion.

## 2. Build the initial 50-strategy matrix

Use reservoir ranks 1–50. Evaluate all upper-triangle pairs, including diagonal self-play telemetry, with 125 shuffle seeds. One shuffle seed means two games with opposite first players.

- Off-diagonal: 1,225 pairs × 125 seeds × 2 games = 306,250 games.
- Diagonal telemetry: 50 strategies × 125 seeds × 2 games = 12,500 games.
- Total: 318,750 games per kingdom.

The matrix uses:

- ordinals 1–75 for the initial P75 equilibrium used by PSRO;
- ordinals 1–100 as a saved depth diagnostic;
- ordinals 101–125 for held-out lottery-versus-itself acquisition evidence.

The clean K007 build took 2 minutes 54 seconds in the current TypeScript implementation. Simulation calls took 102.6 seconds. Most remaining time came from tiny checkpoint files and orchestration. Balanced worker batches and larger checkpoints should reduce this stage to 45–75 seconds locally. Full-telemetry Rust can be considered later if repeated work justifies a 25–50 second target.

## 3. Search for responses

Start with the P75 equilibrium over the initial 50 strategies. Every candidate plays a deterministic schedule that follows the current lottery weights as closely as integer seed counts allow. Opponents are not sampled independently at random.

The material-response threshold is 51%.

### Screening

Evaluate every inactive reservoir strategy at cumulative depths:

- 8 seeds;
- 16 seeds;
- 32 seeds;
- 64 seeds;
- 128 seeds;
- 256 seeds;
- 512 seeds.

Each seed costs two games. At each depth:

- reject a candidate when its confidence interval is at or below 51%;
- send a candidate to confirmation when its confidence interval is above 51%;
- double the evidence for unresolved candidates;
- leave candidates unresolved after 512 seeds instead of stopping the run.

This is threshold racing, not ordinary Successive Halving. The current implementation does not discard the bottom half by rank.

### Fresh confirmation

Re-evaluate provisional responses on fresh seeds. Confirmation uses cumulative looks of:

- 400 seeds;
- 800 seeds;
- 1,600 seeds;
- 3,200 seeds;
- 6,400 seeds.

Confirmation applies a 5% Bonferroni family error budget across all provisional candidates from that scan. A candidate is confirmed only when its adjusted confidence interval is above 51%. Candidates still unresolved after 6,400 seeds remain unresolved and do not stop the run.

### Admission

Order confirmed candidates by:

1. highest confidence lower bound;
2. highest mean score;
3. highest confidence upper bound;
4. best goldfish rank;
5. deterministic strategy identity.

Admit one strategy at a time. Add its missing row and column with 75 matrix seeds, then solve the expanded matrix.

Adding one strategy to a matrix of size `M` costs:

`M × 75 seeds × 2 games`.

Retest the remaining confirmed queue against the new lottery before running another full-reservoir scan. This preserves useful confirmation evidence while checking whether the admitted strategy suppressed the other responses.

## 4. Stop after two clean scans

A scan is clean when it produces no confirmed response. Reset the clean-scan count after every admission. Stop after two clean scans against the same matrix with no admission between them.

Operational limits must never produce a false complete result. If a timeout, container limit, manual stop, or optional safety limit interrupts a kingdom, mark it `incomplete`, preserve all evidence, and resume only the missing work.

Current K007 evidence:

| Reservoir and run | Admissions | Final matrix | Games | Result |
|---|---:|---:|---:|---|
| Original, run 1 | 3 | 53 | 15,738,470 | two clean scans |
| Original, run 2 | 1 | 51 | 13,572,588 | two clean scans |
| Original, run 3 | 3 | 53 | 16,520,710 | two clean scans |
| Goldfish replication 1, run 1 | 1 | 51 | 13,718,988 | two clean scans |

The optimized local Rust K007 replication run took 3 minutes 34 seconds.

## Raw data and local analytics

The Modal campaign preserves and downloads the raw evidence needed for arbitrary local analysis:

- strategy tables and equilibrium weights;
- complete matrix cells;
- schedules and seeds;
- screening and confirmation scores;
- acquisitions and plays by card;
- damage and dead draws by card;
- turns and orientation telemetry;
- source identities and evidence hashes.

Balance reports, archetype labels, card summaries, plots, and comparisons run locally. They are not Modal stages and do not affect campaign status.

Local analysis can calculate expected acquisitions, plays, damage, dead-draw rates, damage-family shares, equilibrium ranges, and variation across kingdoms. Optional fresh reporting panels also run locally. The current diagnostic uses three panels of 2,000 seeds each, but the campaign does not require that panel count.

K007 showed stable Footwork, Reclaim, Volley, and Silver acquisition rates across four compared results. Drive changed from zero copies in three results to 0.91 copies and about 25% of damage in one result. This is material uncertainty for Drive, but it does not invalidate the stable evidence for the other cards.

## Scalable campaign execution

The request has only `kingdomIds` and `maxActiveCpus`. The command derives seeds, protocols, resource shapes, job ranges, timeouts, and paths.

```text
Goldfish → initial matrix → PSRO → download and deep validation
```

The runtime uses:

- one compute image built from the exact executable allowlist in `strategy-search-image-files.json`;
- one dependency-free control image used only for bounded read-only status;
- one shared Modal Volume;
- one global queue for Goldfish jobs from every ready kingdom;
- one whole Matrix stage and one whole PSRO stage per ready kingdom;
- per-task leases, controller fences, launch-scoped temporary files, and serialized publication receipts.

A per-kingdom evidence ID contains only scientific and final-format inputs. A campaign execution ID contains the ordered evidence IDs. Capacity and runtime topology are not scientific identity. A later request reuses a complete matching kingdom directly.

Matrix schema 4 stores cells, seed ordinals, telemetry, and equilibrium inputs in fixed semantic order. Runtime Matrix chunks do not enter final identity. PSRO schema 3 removes candidate chunk ranges, chunk hashes, paths, workers, and timings before final serialization.

Every unused CPU interval has exactly one reason: Modal rejection, retry backoff, reserved downstream work, minimum useful job size, insufficient ready work, or the final tail.

## Cost and failure policy

The command reports a cost estimate and actual Modal compute cost. It does not use the historical reservation ledger and does not claim to check an external workspace budget.

A timeout or invalid artifact fails the run. A `terminal-incomplete` PSRO result is not complete. Retries rerun one atomic job after its lease expires. There is no paused-campaign import, source repair, or manual ambiguous-launch recovery.

The paid acceptance run is one explicitly authorized K007 request at 400 through 800 CPUs. It is not a code default. A paid multi-kingdom run needs separate approval.
