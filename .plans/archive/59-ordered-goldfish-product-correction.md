> Archived: Goldfish process replaced by .plans/77-rust-goldfish-reservoir.md; Matrix and PSRO runtime rules live in .plans/76-global-matrix-psro-runtime.md.

# Correct Kingdom 009 ordered goldfish product

## Scope

Complete only this pipeline:

1. Modal scores all 12,972,960 ordered Kingdom 009 candidates and retains the best configured stage-one candidates.
2. Modal scores those retained candidates on three more deterministic shuffles and writes one durable ranked artifact.
3. A separate command validates that artifact and builds the deterministic reservoir.

Do not run PSRO, consistency experiments, lottery comparisons, or the seeded-random product generator. Do not read, stage, change, revert, or clean `.plans/34-strategy-search-results.md`.

## Corrective run configuration

- Candidate space: the existing ordered five-rung Kingdom 009 space and coprime traversal, with 12,972,960 unique canonical candidates.
- Scorer: the native Rust movement-aware scorer, run only on Modal for the full campaign.
- Profiles: stationary, chaser, and kiter.
- Turn and action limits: 30 turns and 200 actions per turn.
- Stage one seed: 4,100,000.
- Stage one retained count: 500,000.
- Additional seeds: 4,100,001, 4,100,002, and 4,100,003.
- Reservoir count: 20,000.
- Final selection: the best combined four-seed goldfish scores only. There is no random or seeded tail.

The CLI must expose the retained and reservoir counts. These values describe this run and are not permanent product constants.

## Deterministic contract

- Candidate generation stays in the ordered TypeScript generator. Modal is the first scoring step. No local full-space scoring command may exist.
- Every record carries its traversal position, display ID, canonical strategy data, compact per-profile score evidence, and derived ranking key.
- Stage-one, additional-seed, and combined ranking use the existing movement-aware field order. Ties use UTF-16 display ID, UTF-16 canonical strategy, then traversal position.
- Shards retain at most the configured global bound plus any explicit collision allowance needed by the current identity policy. The global merge is exact and independent of completion order.
- The final ranked artifact contains the full retained stage-one cohort, combined score evidence, deterministic ranks, configuration, scorer and rule versions, candidate-space provenance, shard ranges, and shard digests. Its serializer has fixed field order and a final newline. Runtime timing and container identity stay in a separate run summary so retries produce identical ranked bytes.
- The artifact and reservoir each have a SHA-256 sidecar. A validator recomputes strategy identity, score keys, order, membership, provenance digests, and artifact bytes before reservoir construction.
- The reservoir is reconstructible from the ranked artifact alone and contains exactly the first 20,000 valid combined-score entries.

## Modal execution and resume

- Persist stage-one shards, stage-two shards, the ranked artifact, and the run summary in `hexdeck-native-strategy-results` under a deterministic run ID.
- Write checkpoints through a temporary file and atomic rename. Validate schema, configuration, build and rule versions, seeds, range, count, retained records, and content digest before reuse or merge.
- A corrupt, partial, stale, or mismatched checkpoint must rerun. Retry a failed shard at most twice. A resumed launch must use the existing ledger reservation and must not start duplicate valid work.
- Preserve the current ledger and its $25 cumulative cap. Add the explicit one-use authorization `k009-ordered-product-correction-v1` for this user-approved full-space campaign. Reject another new campaign with that authorization.
- Use current rates of $0.0473 per CPU core-hour and $0.008 per GiB-hour. Before launch, include every allowed retry in the worst-case cost and reject more than $5, more than 192 physical cores or 384 vCPUs, GPUs, or Sandboxes.
- Stop every Modal app after result collection.

## Acceptance checks

- Small real-scoring fixtures prove one-process and uneven sharded runs have identical output bytes, ordering, score keys, top-K membership, strategy content, and digests, including ties and an empty or uneven final shard.
- Resume and retry tests prove valid checkpoints are reused once, while corrupt, partial, stale, or mismatched checkpoints rerun and cannot enter a merge.
- Mutation tests prove the ranked artifact and reservoir validators reject changed configuration, strategy content, score evidence, rank, membership, provenance, or digest.
- Focused tests, full tests, `npm run verify:native`, `npm run modal:test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:sim`, and `git diff --check` pass.
- The real Modal run scores 12,972,960 candidates in stage one, scores 500,000 candidates on the three additional seeds, writes and validates the durable ranked artifact, and builds and validates the 20,000-strategy reservoir.
- Record the exact launch configuration, worst-case cost, measured cost, stable Modal and local artifact locations, SHA-256 and content digests, and stopped-app state in a concise results record. Add the minimum README commands to launch or resume, fetch and validate, and build the reservoir.
