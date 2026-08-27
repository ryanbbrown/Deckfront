# Thirty-kingdom strategy-search campaign

## Goal

Run an explicit list of 30 kingdoms through:

1. ordered goldfish ranking and the 20,000-strategy reservoir;
2. the matching 50-strategy initial matrix;
3. threshold-racing Double Oracle;
4. card and damage reporting.

A kingdom starts its next stage as soon as its previous artifact validates. The campaign does not wait for all kingdoms to finish one stage.

No paid campaign starts during implementation. A paid three-kingdom pilot needs a separate launch authorization and cost cap.

## Interface

Add one campaign command with three operations:

```sh
npm run strategy-search:campaign -- plan --manifest PATH
npm run strategy-search:campaign -- status --manifest PATH
npm run strategy-search:campaign -- run --manifest PATH
```

The manifest contains the exact kingdom IDs, four goldfish seeds, retention limits, code and rules identity, execution mode, and campaign cost cap. `plan` performs no paid work. `status` deeply validates saved stages. `run` resumes only missing work.

The first production manifest will list `deep-beam-tuning-001` through `deep-beam-tuning-030`. The command must also accept another explicit kingdom list.

## 1. Support every requested ordered kingdom

Replace the four-kingdom ordered-product allowlist with identity derived from the registered kingdom and its ordered candidate space. Keep strict validation of rules, card order, candidate count, seed set, code version, hashes, and reservoir order.

Separate artifact identity from paid-work authorization. The campaign manifest and launch command supply one exact authorization for one kingdom list and one cost cap.

Verification:

- existing K001, K007, K008, and K009 artifacts still validate;
- a dry K002 source validates without running games;
- an unknown or changed kingdom fails closed.

## 2. Remove initial-matrix orchestration waste

Keep the current initial-matrix artifact semantics. Default to 25-seed chunks, reducing files from 31,875 to 6,375. Submit several independent cells in each `WorkerPairingRunner` batch so four to eight workers stay active. Preserve exact job and result order before writing each current chunk artifact.

Do not reread chunks written by the same clean run before analysis. A resumed run still validates all existing evidence once.

Record total command wall time and worker count in the report.

Verification:

- exact report parity with the current K007 matrix, excluding timing fields;
- interrupted resume reruns only missing chunks;
- measured clean local target: 45–75 seconds.

## 3. Run matrix and PSRO as whole Modal stage jobs

Use the existing project image and shared Modal Volume. Add one whole-stage function for the matrix and one for PSRO. Each stage runs the existing Node controller and resident Rust evaluator inside one Modal container. Do not start a new Modal app for each PSRO look.

Goldfish keeps its current sharded Rust stage. Matrix and PSRO consume validated Volume paths and write atomic stage roots on the same Volume. Only paths and hashes pass between stages.

Verification:

- local and Modal stage digests match on a small saved fixture;
- a complete K007 shadow matches the local semantic checkpoint;
- restarting the campaign reuses each complete stage.

## 4. Add a campaign scheduler

The scheduler maintains a small atomic campaign state file. It enqueues ready kingdoms while respecting:

- the workspace container limit;
- per-stage container and CPU limits;
- a campaign cost cap;
- one active instance of each kingdom stage;
- dependency and hash validation.

A failed kingdom does not stop unrelated kingdoms. The scheduler records the exact failure and can resume it.

Use one image build and one shared Volume. Do not download and upload intermediate artifacts between stages.

## 5. Fix cost accounting

A completed job must release unused worst-case reservation and record measured allocation cost when Modal exposes it. If exact billing is unavailable, keep actual cost unknown and track active reservation separately. Historical completed reservations must not permanently consume the campaign cap.

The campaign status reports active reservation, known actual cost, maximum remaining exposure, container use, and stage counts.

## 6. Validate before the 30-kingdom run

Run all unit, focused integration, TypeScript, Rust, Modal, lint, and build checks. Then request authorization for one paid three-kingdom pilot using K001, K007, and K008.

The pilot must measure:

- end-to-end wall time;
- peak containers and CPUs;
- exact or dashboard-confirmed cost;
- stage resume after interruption;
- semantic parity with existing K007 evidence.

Use the pilot to set the 30-kingdom concurrency and cost cap. Do not estimate the production launch from worst-case ledger reservations.
