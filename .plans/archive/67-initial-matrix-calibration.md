> Superseded by `.plans/68-initial-matrix-calibration-correction.md`. Do not use this plan for decisions.

# Initial-matrix calibration harness

## Current state

- Pairing uses one shared shuffle seed for exactly two games, with fixed seats and alternating first player. `playPairing` already records per-strategy acquisitions and plan-position purchases, but a multi-seed call aggregates telemetry across its seeds.
- `PayoffMatrix` covers every unordered non-diagonal pair and stores seed payoff blocks. Its protocol identity includes rules, kingdom, limits, draft state, and seed order. It is not suitable for arbitrary telemetry prefixes because its telemetry is cell-aggregate.
- Full PSRO has a dedicated 200-seed nested matrix with 25-seed batches and strict hashes. Its fixed depths and Kingdom 009 seed namespace are part of that protocol and must stay unchanged.
- The ordered-product validator deeply validates ranked split parts, hashes, order, evidence, and the exact reservoir prefix. Ordered products support Kingdoms 001, 007, 008, and 009.

## Implementation

1. Add a separate initial-matrix calibration module and protocol version. Derive one deterministic seed list from the protocol version, kingdom, and both ordered source hashes. Keep one seed record per unordered pair so payoff and acquisition prefixes need no replay.
2. Validate the explicit supported kingdom, current native rule fingerprint, ranked and reservoir SHA-256 sidecars, complete ranked artifact, exact ordered 20,000-entry reservoir, source linkage, top-50 identities, protocol, and every saved chunk before simulation. Existing invalid or stale evidence stops; it is never replaced.
3. Save atomic per-pair seed chunks. Each simulation job uses one seed, disables draft and early stopping, and must return exactly two non-aborted games plus valid full telemetry. Resume only missing chunks after deep validation of all existing evidence.
4. Build arbitrary requested training-prefix matrices and one disjoint held-out suffix from the saved seed records. Report exact games, simulation and solver times, each prefix equilibrium, held-out restricted exploitability, direct strength against the held-out restricted equilibrium, actual-acquisition classifier labels and archetype shares, and equilibrium-weighted acquisition summaries. State that diagonal/self-play telemetry is unavailable.
5. Add a reusable CLI command with explicit artifact paths, output directory, maximum seed count, chunk size, training prefixes, held-out start, and worker count. Update README.
6. Add focused tests for the two-game invariant, exact nested prefix reuse, report analysis, corrupt resume rejection, and stale source identity. Run focused tests, native/artifact checks that do not score full matrices, then full tests, typecheck, lint, build, and diff checks. Do not run a 50-strategy matrix or change the full-PSRO protocol.
