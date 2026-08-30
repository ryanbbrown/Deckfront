# Card balance smoke

## Objective

Apply the agreed card changes and run a fresh, isolated eight-kingdom strategy-search smoke. Keep the completed 30-kingdom evidence unchanged.

## Card changes

Update the TypeScript rules, generated native kingdom data, Rust behavior, fingerprints, and tests together:

- Focus: gain 1 mana; the first Focus played by that player each turn also draws 1 card.
- Starfire: keep cost 6 and mana cost 3; increase damage from 12 to 15.
- Overload: increase damage from 2 to 3 per mana spent that turn.
- Rally: reduce cost from 4 to 3; increase base damage from 1 to 2 and additional damage per earlier Rally from 1 to 2.
- Bull Rush: increase damage from 5 to 7.
- Volley: reduce cost from 5 to 4; increase Near damage from 1 to 2; keep Far damage 4.
- Longshot: reduce cost from 4 to 3.
- Repelling Shot: increase cost from 3 to 4.

Do not change Feint, Aim, strategy generation, Goldfish ranking rules, Matrix seeds, equilibrium solving, PSRO thresholds, stopping rules, or evidence formats.

## Smoke scope

Use these existing kingdoms in this exact order:

1. `balance-tuning-005`
2. `balance-tuning-010`
3. `balance-tuning-013`
4. `balance-tuning-021`
5. `balance-tuning-033`
6. `balance-tuning-053`
7. `balance-tuning-082`
8. `balance-tuning-090`

Run fresh evidence under a new ignored data root. Never overwrite or reuse `.data/strategy-search-30` scientific files.

## Confirmed queue cap

The smoke uses a maximum confirmed queue of 100 candidates. After a full-reservoir screen and confirmation, keep the strongest 100 in the existing deterministic order, admit the strongest, and retest no more than the other 99. Candidates outside this retained queue are deferred, not rejected. When the retained queue resolves, start a fresh full-reservoir screen.

Keep all confidence thresholds, race depths, one-at-a-time admission, equilibrium solving, and the two-clean-full-search stop unchanged. Apply the cap in execution, checkpoint restart, and independent verification and replay. Record the cap in the existing checkpoint header so an uncapped checkpoint cannot be adopted without changing the evidence structure.

Delete only this smoke's eight PSRO directories before the capped rerun. Retain its completed Goldfish and Matrix evidence. Run all eight PSRO searches with two threads each and no more than seven processes at once.

## Implementation

1. Apply the card rules in all three engines. Add only the focused fast confirmed-queue state-machine test needed for the cap.
2. Regenerate and validate the native kingdom payload and rule fingerprint through the existing project commands.
3. Keep the current Goldfish-only Modal route. Create an exact request for 16 cores per score Function and 512 maximum active CPUs: up to 32 score containers at once. Use the existing two-reducer cap. Set a scientific wall limit that covers all eight kingdoms and a maximum authorized cost of $100.
4. Run `plan`, capture its exact authorization token and cost bound, then run the paid Goldfish-only route. Download and verify all eight Goldfish outputs.
5. Consolidate each kingdom into a new root with `goldfish`, `matrix`, `psro`, and `logs` directories. Run Matrix locally, then run the capped PSRO searches with the confirmed concurrency and thread limits.
6. Require native verification of each final Goldfish, Matrix, and PSRO evidence set. HST same-strategy telemetry must exist for every final strategy.
7. Produce a deterministic comparison artifact and HTML report for the exact eight kingdoms. Compare the new evidence with the matching kingdoms in `rust-balance-analysis-v2.json`. Report equilibrium-weighted archetype shares, changed-card acquisition, family damage, support/effective sizes, and before/after differences. Label this as a directional smoke, not final balance evidence.

## Acceptance

- All agreed card rules match in TypeScript and Rust.
- The native build and focused confirmed-queue test pass. The broad test suite remains skipped by explicit user direction for this tuning smoke.
- The Modal plan shows 16 cores per score container, 512 maximum active score CPUs, and no more than $100 worst-case cost.
- Goldfish, Matrix, PSRO, and HST evidence complete and verify for all eight kingdoms.
- Old 30-kingdom scientific evidence remains byte-identical.
- The comparison JSON is deterministic and the HTML presents the same values.
- The worktree is clean, with implementation and useful report artifacts committed. Large scientific files remain ignored.
