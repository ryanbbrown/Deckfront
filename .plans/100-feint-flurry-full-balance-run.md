# Feint and Flurry full balance run

Status: Complete

## Scope

- Scientific rules commit: `9bcc8d28f1e59603680b3c8ae7ca28a82d767a70`.
- Reuse the complete 30-kingdom run from plan 99.
- Run Goldfish, Matrix, and PSRO for the other 130 kingdoms.
- Give every kingdom equal weight. Within each kingdom, both players use the stored equilibrium lottery.

## Verification

- All 160 kingdoms passed structural validation.
- Goldfish completed without retries or admission failures.
- Every kingdom ended with two clean final PSRO searches.
- The report verified all evidence files against the current release binary.
- Focused report tests, typecheck, lint, and the production build passed.

## Result

Expected damage per player side:

- Mage: 11.3610
- Melee: 10.3938
- Ranged: 10.2060
- Engine: 9.8110

Pure archetype shares:

- Melee: 28.9751%
- Mage: 27.6270%
- Ranged: 22.2717%

Mixed archetype shares:

- Melee + Ranged: 12.4545%
- Ranged + Mage: 7.0772%
- Melee + Mage: 1.4633%
- Melee + Ranged + Mage: 0.1312%

The 130 new kingdoms cost $4.5265 for Goldfish and $3.1356 for PSRO, or $7.6621 total. Cumulative Modal cost across the recorded balance experiments is about $20.4129.

The final report is `.html/strategy-search-160-feint-flurry-engine-head-9bcc8d2.html`.
