# Ordered unique-card goldfish benchmark

Implement a reproducible benchmark that streams an indexable space of five-rung strategies for one registered deep-beam kingdom. The empty starting build has no fallback. Each strategy buys five distinct, deterministically sorted market card IDs in one ordered permutation. Copper is excluded. Kingdom 009 has `P(14,5) = 240,240` ordered skeletons.

Use a provisional quantity baseline, not a product decision: rungs one through three range from 1 through 4, rungs four and five are fixed at 3, and total planned quantity is at most 15. This produces 54 vectors and `240,240 × 54 = 12,972,960` Kingdom 009 candidates.

The CLI defaults to `deep-beam-tuning-009`, 100,000 candidates, 10 workers, one shared shuffle, 30 turns, and 200 actions per turn. It scores stationary, chaser, and kiter profiles through the movement-aware goldfish worker. A fixed coprime-stride traversal samples the complete candidate index ring instead of a lexicographic prefix. JSON output records the stride inputs and resolved values, counts, checksums, seeds, timing, throughput, and machine configuration.

Verification: focused pure-behavior tests, TypeScript typecheck, ESLint, and `git diff --check`. Do not run the default 100,000-candidate benchmark.
