# Additional ordered calibration kingdoms

## Implemented scope

The ordered five-rung grammar and the staged ordered product accept one supported kingdom. The default remains `deep-beam-tuning-009`, so its artifact version, authorization, candidate provenance, command defaults, and validators stay unchanged.

| Kingdom | Artifact version and one-use authorization | Candidate provenance | First 500 traversal candidates | Current rules fingerprint |
|---|---|---|---|---|
| `deep-beam-tuning-001` | `k001-ordered-product-calibration-v1` | `8a4759823fa` | `fe10624e178e8` | `d2b18864d32` |
| `deep-beam-tuning-007` | `k007-ordered-product-calibration-v1` | `1573ad7d3fa` | `65257033178f5` | `2c433de5dca` |
| `deep-beam-tuning-008` | `k008-ordered-product-calibration-v1` | `6561f88940b` | `fea778e71849c` | `f59f0182d3b` |
| `deep-beam-tuning-009` | `k009-ordered-product-correction-v1` | `5ce8adb2409` | `fa0328fb18315` | `b5115138db0` |

Each kingdom has 14 sorted non-Copper purchase IDs, 240,240 ordered five-card skeletons, 54 quantity vectors, and 12,972,960 candidates. The seeds remain 4,100,000 through 4,100,003. Stage one retains 500,000 candidates. The final reservoir contains the first 20,000 candidates in combined four-seed score order.

The Modal launcher includes the kingdom in run identity, checkpoints, summaries, validation, and the native shard request. A launch must use the one-use authorization for the selected kingdom. The existing $25 ledger cap, three-full-run limit, $5 run cap, retry count, timeout accounting, thread limit, and 192-physical-core limit remain active.

## Local validation and launch block

No full local scoring or Modal scoring ran.

The TypeScript and Rust scorers returned exact four-seed evidence for 32 ordered candidates from Kingdoms 001 and 009. The same check found differences for all 32 sampled candidates in Kingdoms 007 and 008 on each seed from 4,100,000 through 4,100,003. The differences affect damage, spending, and completion timing. Do not launch any calibration campaign until the movement tie-break is decided, the rules fingerprint is final, and native conformance is exact for Kingdoms 007 and 008.

With 52 stage-one shards, 2 stage-two shards, 2 CPUs and 4 GiB per shard, 95 containers, a 420-second shard timeout, and two retries, each future launch reserves $2.88503333. Three launches reserve $8.65510000. The current local ledger has $5.52603411 reserved, so all three would bring the ledger to $14.18113411, below the unchanged $25 cap.
