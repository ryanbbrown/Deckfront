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

## Implementation

1. Add focused rules and parity tests for every changed value and for Focus drawing only on the first Focus each turn.
2. Regenerate and validate the native kingdom payload and rule fingerprint through the existing project commands.
3. Keep the current Goldfish-only Modal route. Create an exact request for 16 cores per score Function and 512 maximum active CPUs: up to 32 score containers at once. Use the existing two-reducer cap. Set a scientific wall limit that covers all eight kingdoms and a maximum authorized cost of $100.
4. Run `plan`, capture its exact authorization token and cost bound, then run the paid Goldfish-only route. Download and verify all eight Goldfish outputs.
5. Consolidate each kingdom into a new root with `goldfish`, `matrix`, `psro`, and `logs` directories. Run Matrix locally, then PSRO locally. Run one kingdom at a time and use the machine's available cores without changing scientific settings.
6. Require native verification of each final Goldfish, Matrix, and PSRO evidence set. HST same-strategy telemetry must exist for every final strategy.
7. Produce a deterministic comparison artifact and HTML report for the exact eight kingdoms. Compare the new evidence with the matching kingdoms in `rust-balance-analysis-v2.json`. Report equilibrium-weighted archetype shares, changed-card acquisition, family damage, support/effective sizes, and before/after differences. Label this as a directional smoke, not final balance evidence.

## Acceptance

- All agreed card rules match in TypeScript and Rust.
- Existing conformance, native, typecheck, lint, and Modal wrapper tests pass.
- The Modal plan shows 16 cores per score container, 512 maximum active score CPUs, and no more than $100 worst-case cost.
- Goldfish, Matrix, PSRO, and HST evidence complete and verify for all eight kingdoms.
- Old 30-kingdom scientific evidence remains byte-identical.
- The comparison JSON is deterministic and the HTML presents the same values.
- The worktree is clean, with implementation and useful report artifacts committed. Large scientific files remain ignored.
