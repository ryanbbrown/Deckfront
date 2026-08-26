# Initial-matrix calibration correction

## Protocol

Replace protocol v1 with a clean protocol v2. Do not read, migrate, or accept v1 evidence.

Evaluate all 1,275 upper-triangle cells for the selected 50 strategies:

- 1,225 off-diagonal cells provide payoff and acquisition telemetry.
- 50 diagonal cells provide self-play acquisition telemetry only.
- Each seed record contains exactly two complete, non-aborted games.
- Payoff matrices use only off-diagonal records and always have zero diagonals.

Cell chunks record their purpose, cell identity, seed range, per-seed payoff or null, full telemetry, exact match count, measured simulation wall time, and a hash over all saved fields including simulation time.

Resume fails closed for v1, stale, incomplete, unexpected, or corrupt evidence. Use a new v2 output directory.

## Analysis

For a seed range of size `S`, let `p_i` be the selected equilibrium weight of strategy `i`, `C^c_{ij,i}` be card `c` acquisitions by strategy `i` in off-diagonal cell `{i,j}`, and `C^c_{ii}` be combined acquisitions by both players in diagonal cell `{i,i}`.

```text
r^c_i(p) = p_i C^c_ii / (4S) + sum[j != i] p_j C^c_ij,i / (2S)
E^c(p) = sum[i] p_i r^c_i(p)
```

Use these selected-lottery-versus-itself rates with the project `classifyStrategyDamage` classifier. Report:

- per-strategy acquisition rates,
- classifier labels,
- selected archetype shares,
- expected card copies per player-game,
- feasible archetype ranges from the existing equilibrium group-range solver.

Hold classifier labels fixed while the LP varies equilibrium weights. State that these ranges are conditional on the selected-lottery labels and the discovered 50-strategy matrix.

## Schedule and costs

Support and document:

```text
--max-seeds 100
--prefixes 50,75
--held-out-start 75
```

Prefixes use seed ordinals 1–50 and 1–75. Held-out evidence uses ordinals 76–100.

For 50 strategies and 100 seeds:

| Evidence | Cells | Games |
|---|---:|---:|
| Off-diagonal payoff and telemetry | 1,225 | 245,000 |
| Diagonal telemetry | 50 | 10,000 |
| Total | 1,275 | 255,000 |

- Prefix 50: 122,500 payoff games + 5,000 diagonal games = 127,500.
- Prefix 75: 183,750 payoff games + 7,500 diagonal games = 191,250.
- Held-out 76–100: 61,250 payoff games + 2,500 diagonal games = 63,750.

Report separate off-diagonal, diagonal, and total cell counts, game counts, and measured chunk wall times. Report solver wall time separately. Measured chunk wall time is the exact sum of saved chunk times, not estimated CPU time or complete command time.

## Files

- `src/sim/initialMatrixCalibration.ts`: v2 protocol, validation, payoff and telemetry analysis, costs, and classifier output.
- `scripts/initial_matrix_calibration.ts`: diagonal scheduling, strict chunk loading and resume, and v2 report output.
- `test/sim/initialMatrixCalibration.test.ts`: focused weighting, diagonal, cost, and corruption regressions.
- `README.md`: max-100 command, evidence basis, costs, timing, and diagnostic limits.

Do not change full PSRO files or `docs/strategy-search-process.md`.

## Verification

Run:

```text
npx vitest run test/sim/initialMatrixCalibration.test.ts \
  test/sim/lotteryAcquisition.test.ts \
  test/sim/equilibriumGroupRange.test.ts \
  test/sim/balanceCorpus.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

Also validate the real ordered ranked and reservoir artifacts without scoring a matrix. Inspect the complete diff against `c524b2904ddc572157dc34a829d11a6599b3fbc7`. Do not run the 255,000-game calibration.
