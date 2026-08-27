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
- The schema-4 top-500,000 artifact is a streamed fixed-frame binary file. Each 64-byte record stores only traversal position and primitive profile metrics. Record order supplies stage-one rank. Strategy JSON, canonical strategy, display ID, and ranking keys are reconstructed from traversal position when needed.
- Work: 38,918,880 goldfish profile trials.

### Stage 2

- Split the retained top 500,000 into four-CPU jobs sized for 15 to 60 seconds. Each job reads only its fixed-width range.
- Score each retained strategy once with the other three fixed seeds and all three movement profiles. Native scorer request frames contain at most 4,096 strategies and 8 MiB.
- Combine all four seeds in one deterministic reducer.
- Keep the best 20,000 strategies in ranked order. The schema-4 reservoir stores only traversal position and the two sets of primitive profile metrics.
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

A local production-shape benchmark evaluated all 318,750 games in 96.375 seconds with four workers and 92.723 seconds with eight workers. Eight workers improved wall time by only 3.8%, so the runtime selects four Matrix workers as the smallest shape within 10% of the fastest measured result.

## 3. Search for responses

Start with the P75 equilibrium over the initial 50 strategies. Every candidate plays a deterministic schedule that follows the current lottery weights as closely as integer seed counts allow. Opponents are not sampled independently at random.

The material-response threshold is 51%.

A local K007 benchmark used the production 30-turn limit for 1,000 candidates and eight blocks. It took 1.935 seconds with four workers and 1.760 seconds with eight workers. The runtime therefore selects the faster eight-worker PSRO shape when capacity permits. PSRO Volume checkpoints are committed in batches of 20 checkpoint events instead of after every candidate chunk.

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
- exactly three allowlist-backed source-copy layers: Node manifests, Rust build inputs, and final application sources;
- one explicit versioned deployment boundary that streams image-build progress, checks the runtime import closure, and runs a one-candidate canary through the exact remote Goldfish worker lifecycle before the acceptance clock;
- one dependency-free control app that prepares execution state after readiness and serves bounded read-only status;
- one lightweight runtime that calls the deployed controller and accepts startup only after a fenced submitted or completed task;
- one shared Modal Volume;
- one global queue for Goldfish jobs from every ready kingdom;
- one whole Matrix stage and one whole PSRO stage per ready kingdom;
- per-task leases, controller fences, launch-scoped temporary files, and serialized publication receipts. Workers validate temporary artifacts before publication. The publisher checks the validation digest, lease, fence, path, and bytes, then performs the atomic rename.

A per-kingdom evidence ID uses the scientific source digest and final-format inputs. The deployment digest also covers the scheduler, controller, publisher, and status code. A runtime-only change creates a new deployment and campaign execution ID but keeps the same evidence ID, so valid completed kingdom evidence remains reusable while failed operational state cannot cross deployments. Capacity and runtime topology are not scientific identity.

Matrix schema 4 stores cells, seed ordinals, telemetry, and equilibrium inputs in fixed semantic order. Runtime Matrix chunks do not enter final identity. PSRO schema 3 removes candidate chunk ranges, chunk hashes, paths, workers, and timings before final serialization.

Worker start and finish events determine running CPU intervals. Submitted CPUs are reported separately, so Modal queue time cannot appear as running CPU use. Status reports every job state, the common last error, and whether the controller lease is live. Every unused running-CPU interval has one reason, including Modal queue delay, Modal rejection, retry backoff, reserved downstream work, minimum useful job size, insufficient ready work, or the final tail.

## Cost and failure policy

Modal image build time is preflight time, not campaign runtime. A clean `npm ci` and Rust release build can take minutes. Source files are grouped into three image layers instead of one layer per file, so one invalidated group does not create more than 100 serialized build steps. Image-layer construction runs only in the local deployment process. A deployed container imports the function module from `/root` but reads its built allowlist and executable source from `/workspace`. The timed campaign starts only after the versioned compute app is deployed and its exact source identity passes a live readiness call.

The command reports a cost estimate and actual Modal compute cost. It does not use the historical reservation ledger and does not claim to check an external workspace budget.

A timeout or invalid artifact fails the run. A `terminal-incomplete` PSRO result is not complete. A job gets at most three retryable worker or launch failures. Deterministic module, package, syntax, source-image, and runtime-asset startup failures stop immediately and cancel the active sibling wave. Polling treats only the built-in timeout used by the installed Modal `FunctionCall.get(timeout=0)` contract as pending. Failures retain the exception type, nonempty diagnostic, `repr`, traceback, and FunctionCall link. Admission recovery does not consume this retry limit. There is no paused-campaign import, source repair, or manual ambiguous-launch recovery.

The paid acceptance run is one explicitly authorized K007 request at 400 through 800 CPUs. It is not a code default. A paid multi-kingdom run needs separate approval.
