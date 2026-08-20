# Five-kingdom balance report

## Goal

Generate one local HTML report from fresh 40-health full runs for `current-duel`,
`three-way-open`, `three-way-engine`, `range-rich-mixed`, and `rigged-melee`. The report must help a
designer judge kingdom strategy diversity and card usefulness. It must not change game or simulator
rules.

## Definitions

- A **lottery strategy** has at least 0.1% weight in the final equilibrium. This removes the solver's
  tiny maximum-support witness weights while preserving every material strategy.
- A **near-competitive strategy** has less than 0.1% lottery weight and scores at least 48% against
  the material lottery. The two-point band is a visible provisional threshold, not proof that the
  strategy is equally strong.
- A **viable strategy** is either a lottery strategy or a near-competitive strategy.
- A strategy's score against the lottery is its win-scale score against the normalized material
  lottery weights: `win-scale score = (centered payoff + 1) / 2`. The 48% boundary is therefore a
  centered payoff of `-0.04`. Truncation and normalization mean the material lottery is a reporting
  approximation of the solved equilibrium.
- Every action card has one reporting family. Engine: Footwork, Cull, Muster, Stipend, Reclaim,
  Adapt, and Step. Melee: Feint, Drive, Flurry, Heavy Blow, and Strike. Ranged: Aim, Volley, Quick
  Shot, Steady Shot, and Shot. Mage: Channel, Ley Step, Prism, Arc Bolt, Fireball, and Starfire.
  Treasure is separate. Aim is ranged setup; Ley Step is a mana enabler; Footwork and Cull are
  general engine support. Fail if any curated action card has no family.
- Planned card use has three separate fields: starting build, finite purchase plan, and repeat
  purchase. Acquired card use comes from match telemetry and must remain separate. A repeat card or
  late purchase step does not count as acquired unless telemetry records an acquisition.
- `rigged-melee` is a calibration kingdom. Show it, but exclude it from normal-kingdom totals.

## Implementation

1. Extend the experiment artifact protocol with a deterministic rules fingerprint that includes the
   complete kingdom configuration, starting budget, first-buy carry limit, turn and action limits,
   matrix orientation protocol, and an explicit simulation-kernel/pilot protocol version. The report
   must reject missing or mismatched fingerprints. Rerun all five full searches after this lands.
2. Add a deterministic TypeScript report generator under `scripts/` that loads and validates those
   five full artifact sets with Zod. Fail with a useful message when a run is absent, invalid, not
   full mode, incomplete, has inconsistent strategy ids, uses an unsupported schema, or differs from
   the current kingdom and rules fingerprint.
3. Keep balance calculations in exported pure transformations. Calculate material lottery weights,
   score against the lottery, viable strategies, pairwise viable-strategy scores, strategy card
   families, and cross-kingdom card-use counts.
4. Use the saved payoff matrix for scores and cross-strategy matchups. Call `playPairing` directly for
   self-play of material lottery strategies because payoff matrices have no diagonal cells. Self-play
   results supply telemetry only: they never change a payoff, score, or equilibrium. Read turns,
   draws, first-player outcomes, and acquisitions; ignore the meaningless candidate mean and divide
   same-id acquisition counts between the two players. At most one 100-game self-play pairing runs
   per material lottery strategy.
5. Calculate final-lottery telemetry with normalized material weights. A self-play cell has weight
   `w_i²`; an unordered cross-play cell has weight `2 × w_i × w_j`. Weight telemetry numerators and
   denominators, not cell averages. Test this with unequal weights. Deterministic self-play may rerun
   during generation; do not write a cache into the experiment directories.
6. Render and commit `.html/balance-report.html`. Put the conclusions and definitions before detail.
   For each kingdom, show lottery weights, near-competitive strategies, build and one column per
   purchase step, repeat purchase, families, score against the lottery, and the viable-strategy
   matchup matrix. Each finite step displays remaining purchases after subtracting starting copies.
7. Add a normal-kingdom action-card table with availability; build, agenda, and repeat plan presence;
   acquired-in-evaluation evidence; average material-lottery weight of plans using the card; and the
   kingdoms that use it. Count a card once per strategy for plan presence. State that four normal
   curated kingdoms are an initial sample and cannot establish corpus-wide card health.
8. Add an npm command and concise README instructions for local regeneration. Replace the obsolete
   README sentence that promises a future dashboard. State that `.experiments/` inputs are ignored
   and required locally.

## Tests

- Test the public artifact-to-report-model transformation with a small independent fixture whose
  equilibrium weights and matchup scores have hand-calculated expected values.
- Prove both sides of the exact 0.1% material-weight and 48% win-scale boundaries, weight
  renormalization, calibration exclusion, exhaustive card families, and separate plan/acquisition
  counting.
- Prove that mirror results do not affect scores or weights and test weighted lottery telemetry with
  unequal weights, self-play, cross-play, draws, first-player results, and winner-only turn means.
- Test artifact validation errors and deterministic HTML output in the same and a fresh process.
- Assert required report sections and labels. Do not use a snapshot as the only oracle.

## Acceptance checks

- The committed report is generated from all five fresh full artifact sets and shows each run seed,
  completion time, strategy count, matrix-cell count, rules fingerprint, turn limit, and action cap.
- Each kingdom's lottery membership matches its saved matrix weights under the stated 0.1% rule.
- The report clearly separates lottery membership, near-competitive results, and card-plan use.
- The page works at desktop and narrow widths, with wide tables scrolling inside their sections.
- A second generation is byte-identical. The generator uses fixed numeric formats, embeds no
  generation timestamp, and uses no locale-dependent formatting.
- Focused tests, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run build:sim`, and `git diff --check` pass.
