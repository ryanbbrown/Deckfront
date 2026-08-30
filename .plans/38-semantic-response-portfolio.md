# Semantic response portfolio

## Goal

Make independent Kingdom 009 searches cover and refine the same viable damage packages instead of relying on uniform raw-slot luck.

Current v4 baseline:

- Seed 35001 versus 35002 cross-play is 51.3% / 47.1%.
- Metagame shares are 85.1% Melee / 14.9% Ranged versus 70.2% Melee / 29.8% Ranged.
- Seed 35002's 25.1%-weight Precision Shot–Longshot strategy scores 55.5% against seed 35001, with a 53.9% confidence-interval lower bound.
- Seed 35001 archived 20 other Precision Shot–Longshot plans but never generated that effective order and quantity structure.

## Decisions

1. Add one deep strategy-proposal module. Its interface accepts a kingdom, deterministic seed, proposal count, excluded identities, and optional parent strategies. It returns exactly the requested number of unique canonical policies plus auditable source diagnostics.
2. Keep the existing stopless, eight-active-slot response grammar. Remove exact behavioral no-ops, including contiguous increasing targets for the same card, before identity.
3. Split every 20,000-policy fresh batch into:
   - 60% semantic recipes;
   - 25% local mutations around current equilibrium support and archived finalists;
   - 15% unrestricted uniform policies.
   If there are no parents, move the local quota to semantic recipes.
4. Derive reusable card roles from card definitions and mechanics, not kingdom-specific card names. Roles include direct damage family, mana, movement, draw/filter, trashing, economy, and family fodder.
5. Build semantic recipes by choosing one- or two-card damage cores, then adding required enablers and optional engine/economy roles. Cover every available damage core before repeating one. Include pure-family and mixed-family cores when the kingdom offers them.
6. Generate several stage shapes: damage first, engine first, and staged damage around support. Use role-appropriate finite count ranges. Choose an infinite fallback from a core damage card or independently useful engine card. Reject recipes with no credible damage path or missing hard requirements such as mana for a spell.
7. Local mutation operators change one meaningful policy decision: count, card within a compatible role, adjacent order, insertion, deletion, or infinite fallback. Preserve the response grammar and normalize before identity. Repeated PSRO rounds provide iterative refinement.
8. Keep archived-finalist reconsideration, batched admission, five-clean-round convergence, and the strict 50% gate from v4. Use the same proposal portfolio for the final independent search. Do not reduce the 20,000 fresh-policy budget.
9. Bump artifact and suite versions. Persist proposal-source counts and recipe coverage so resumability fails closed and reports can explain what was searched.
10. Keep a uniform tail to preserve unexpected strategies. Do not add MAP-Elites, behavioral fingerprints, per-kingdom recipes, or new card metadata in this implementation.

## Tests

- Role derivation recognizes damage, mana, movement, draw/filter, trashing, economy, and discard-fodder requirements through card definitions.
- A Kingdom 009-sized generation batch covers every available damage core, including Precision Shot + Longshot.
- Semantic recipes contain a damage path, required enablers, legal counts, a useful fallback, and no cumulative no-op slots.
- Local mutations are canonical, legal, unique, and differ meaningfully from their parent.
- The 60/25/15 allocation is exact when parents exist and reallocates the parent quota when they do not.
- Same seed and inputs produce identical proposals and diagnostics; different seeds preserve recipe coverage.
- Artifact validation rejects stale versions, wrong source counts, missing recipe coverage, and malformed proposal evidence.
- Tests observe the public proposal-module and random-PSRO interfaces. They must not reproduce the generator implementation as their oracle.

## Kingdom 009 pilot

Run seeds 35001 and 35002 with 10 workers. Produce the same fresh cross-play and acquisition-based metagame calculations used for v4.

A decent result must meet all of these empirical gates:

- both lottery cross-play directions are within 47%–53%;
- the largest Melee, Ranged, or Mage share difference is at most 10 percentage points;
- no support strategy from either run has a held-out 95% confidence-interval lower bound above 52% against the other lottery;
- the known v4 Precision Shot–Longshot challenger has a held-out lower bound at or below 52% against both new lotteries, or an equivalent Ranged response appears in both discovered populations;
- generated support plans have no cumulative or contiguous duplicate-target no-ops.

If the pilot misses a gate, inspect proposal coverage and diagnostics before changing recipe heuristics. Do not run the full ten-kingdom suite.

## Validation

Run focused tests, the full test suite, typecheck, lint, and `git diff --check`. The `/implement` request has zero plan-review and zero implementation-review cycles. Run no review panel as part of those cycles.
