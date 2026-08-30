> Archived: superseded by `.plans/76-global-matrix-psro-runtime.md`.

# PSRO performance architecture

## Goal

Replace threshold-racing score evaluation with a compact, exact Rust path while keeping the TypeScript controller and every statistical and simulation rule unchanged.

## Implementation order

1. Add a score-only TypeScript contract that stores each two-orientation block as one quarter-point byte, played count, and compact abort data. Do not allocate telemetry or full pairing results on this path.
2. Extend the existing Rust goldfish crate with an exact two-player competitive kernel that reuses its compiled cards, strategy plans, RNG, shuffle, tactical rules, and preallocated zones.
3. Add a deterministic JSON-lines score protocol. Freeze TypeScript/Rust fixtures for both orientations, RNG-sensitive play, mechanics, caps, draws, aborts, and candidate/block order.
4. Run the existing `anytimeConfidenceBounds` function in worker threads by candidate. Keep each candidate's JavaScript operation order unchanged and require byte-equal serial and parallel results.
5. Add adaptive candidate-by-schedule shards to the existing Modal CPU controller. Save one validated compact artifact per look shard, resume from valid artifacts, preserve result order, and keep the existing timeout and cost limits.
6. Benchmark the local exact path only after parity passes. Do not run paid Modal work.

## Validation

- Focused compact-contract, Rust parity, protocol-order, confidence, shard-order, retry, and resume tests.
- Relevant and full TypeScript tests, typecheck, lint, and build.
- Rust format, clippy, tests, and release build.
- Modal unit tests only.
- Git diff check and a representative local TypeScript-versus-Rust benchmark when exact parity passes.
