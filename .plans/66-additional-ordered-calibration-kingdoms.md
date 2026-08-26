# Additional ordered calibration kingdoms

## Implemented scope

The ordered five-rung grammar and the staged ordered product accept one supported kingdom. The default remains `deep-beam-tuning-009`, so its artifact version, authorization, candidate provenance, command defaults, and validators stay unchanged.

| Kingdom | Artifact version and one-use authorization | Candidate provenance | First 500 traversal candidates | Current rules fingerprint |
|---|---|---|---|---|
| `deep-beam-tuning-001` | `k001-ordered-product-calibration-v1`; `k001-ordered-product-calibration-v2` | `8a4759823fa` | `fe10624e178e8` | `af4833e2d36` |
| `deep-beam-tuning-007` | `k007-ordered-product-calibration-v1`; `k007-ordered-product-calibration-v2` | `1573ad7d3fa` | `65257033178f5` | `80fc3d23dce` |
| `deep-beam-tuning-008` | `k008-ordered-product-calibration-v1`; `k008-ordered-product-calibration-v2` | `6561f88940b` | `fea778e71849c` | `c7681650d3f` |
| `deep-beam-tuning-009` | `k009-ordered-product-correction-v1`; same authorization | `5ce8adb2409` | `fa0328fb18315` | `6fb50a6edb4` |

Each kingdom has 14 sorted non-Copper purchase IDs, 240,240 ordered five-card skeletons, 54 quantity vectors, and 12,972,960 candidates. The seeds remain 4,100,000 through 4,100,003. Stage one retains 500,000 candidates. The final reservoir contains the first 20,000 candidates in combined four-seed score order.

The Modal launcher includes the kingdom in run identity, checkpoints, summaries, validation, and the native shard request. A launch must use the one-use authorization for the selected kingdom. The existing $25 ledger cap, three-full-run limit, $5 run cap, retry count, timeout accounting, thread limit, and 192-physical-core limit remain active.

## Local validation and launch authorization

No full local scoring ran. Exact TypeScript-to-Rust conformance passes for 32 ordered candidates, four seeds, and three movement profiles in each supported kingdom. The existing 1,000-candidate Kingdom 009 check and all-mechanics check also pass.

Before the fix, Kingdom 007 differed on 30 of 128 candidate-seed pairs and Kingdom 008 differed on 42 of 128. Rust incorrectly reused range-aware printed damage when Prism and Regroup valued retained hands. The TypeScript valuation is range-independent and includes the current Opening Strike and Rally state. A small general Rust valuation fix removed those differences. The Rust movement tie-break now also matches the symmetric TypeScript rule.

The final paired-game rules fingerprints are pinned above. The refreshed v2 authorizations approve one full launch each for Kingdoms 001, 007, and 008. Kingdom 009 keeps its existing contract and is not authorized for a new run.

With 52 stage-one shards, 2 stage-two shards, 2 CPUs and 4 GiB per shard, 95 containers, a 420-second shard timeout, and two retries, each launch reserves $2.88503333. Three launches reserve $8.65510000. The unchanged launcher rejects more than $5 per run, more than $25 cumulative reserved spend, more than 192 physical cores, more than two retries, and reuse of an authorization.
