> Archived: Goldfish process replaced by .plans/77-rust-goldfish-reservoir.md; Matrix and PSRO runtime rules live in .plans/76-global-matrix-psro-runtime.md.

# Ordered Kingdom 009 goldfish product correction results

## Result

The corrective deterministic product pipeline completed. Modal was the first and only full-space scoring step. No local full-space rescore, PSRO, consistency experiment, or lottery comparison ran.

- Implementation: `e760135dba6f6ee6f0d2d8747b64692e9f57e8b6`
- Modal run: `native-e760135dba6f-5625a0ff0bf6048653f9`
- Rule fingerprint: `b5115138db0`
- Scorer: `native-goldfish-v1`
- Candidate generator: `ordered-typescript-five-rung-v1`
- Candidate-space digest: `5ce8adb2409`
- Stage one: 12,972,960 candidates, seed 4,100,000, 52 shards
- Stage-one retained cohort: 500,000
- Additional Modal seeds: 4,100,001, 4,100,002, and 4,100,003
- Stage two: 500,000 candidates, 2 shards
- Final reservoir: the best 20,000 combined four-seed scores, with no random tail

## Durable artifacts

Modal Volume `hexdeck-native-strategy-results`:

- `native-e760135dba6f-5625a0ff0bf6048653f9/ranked.json`
- `native-e760135dba6f-5625a0ff0bf6048653f9/ranked.json.part-0000.jsonl` through `ranked.json.part-0049.jsonl`
- `native-e760135dba6f-5625a0ff0bf6048653f9/ranked.json.sha256`
- `native-e760135dba6f-5625a0ff0bf6048653f9/run-summary.json`

Validated local copies:

- `.experiments/ordered-goldfish-product/native-e760135dba6f-5625a0ff0bf6048653f9/ranked.json`
- `.experiments/ordered-goldfish-product/native-e760135dba6f-5625a0ff0bf6048653f9/reservoir.json`
- `.experiments/ordered-goldfish-product/native-e760135dba6f-5625a0ff0bf6048653f9/all-sha256.txt`

Digests:

- Ranked manifest SHA-256: `b80ba7d8294c5aa2a8c5554e323ffb92bbc3a58205f1207fc7e82da1d9155d9b`
- Ranked artifact size, manifest plus 50 parts: 1,207,059,793 bytes
- Reservoir SHA-256: `a8aa42593aae19337a2ffeda284d77217a79e1eac0d85181a5f6060490a20b9e`
- Reservoir size: 88,603,984 bytes
- Stage-one provenance digest: `0123be88fa6`
- Stage-two provenance digest: `ed4078b48e`
- Stage-one ordered membership digest: `9a878a67e1f5884a22535f1b69bc9ef341dbbd5d9881c7fbfc6984fa6b8f69cd`
- Stage-two candidate digests: `3fbd4f632f4dbc5`, `9dee9dec2f7d16c`
- Stage-two score digests: `64a408243af18b5`, `c0c921753b2421d`

The local validator checked all 500,000 ranked records and all part SHA-256 values. It then built and validated the exact 20,000-record ranked-prefix reservoir from the durable artifact without scoring.

## Cost and operation

Modal rates at launch were $0.0473 per physical core-hour and $0.008 per GiB-hour. No GPU or Sandbox ran. The launch cap was 191 physical cores and the calculated full retry reservation was $2.88503333. The failed format attempt plus the completed streamed continuation cost $1.06535625 gross, below the authorized $5 cap.

The first artifact format exceeded the Node string limit after scoring. The continuation stored deterministic JSON Lines parts and reused persisted shard evidence. Two further controller resumes exposed newly committed Modal Volume snapshots; they reused validated scoring checkpoints and did not reserve another campaign. All four campaign apps finished stopped with zero tasks. The local cost ledger records the first run as superseded and the streamed run as complete.

## Verification

Passed:

- Focused ordered-product, ordered-benchmark, and native-search tests: 29 tests
- Full Vitest suite: 54 files, 582 tests
- `npm run verify:native`
- `npm run modal:test`: 13 tests
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run build:sim`
- `git diff --check`
- Ranked artifact validation
- Reservoir construction and validation

Review counts were `p0 i0`; no review panel ran. `.plans/34-strategy-search-results.md` stayed unstaged and byte-identical at SHA-256 `b21d3ffb01444758463b267d0b909a99c37b53215ca035d202614556ea13deff`.
