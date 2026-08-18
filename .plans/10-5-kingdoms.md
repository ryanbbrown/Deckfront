# Step 5: the five kingdoms and calibration checks

Implements step 5 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on steps 2 and 4.

Step 6 depends on this step for `CalibrationInput`. The dependency runs forward with the implementation order: step 5 **defines** the shape, step 6 fills it.

## Objective

The five approved kingdoms exist as committed data beside `distance-duel`, and the rigged-melee calibration check runs as code.

## Kingdoms

Cull, Copper, Silver, and Gold are available in every kingdom and are not listed as piles. Step, Strike, Shot, and Starfire are in no initial kingdom. Every action pile holds ten cards.

`src/game-data/kingdoms.json` ends with **six** entries: `distance-duel` **unchanged**, plus the five below. `DEFAULT_KINGDOM_ID` is `distance-duel` (`src/game/kingdom.ts:7`), `kingdomOf` throws on an unknown id, and `test/kingdom.test.ts:48`, `test/distance-duel.test.ts`, `test/ai-runner.test.ts`, and `src/server/gameService.ts` all depend on it. Replacing the file would break every browser game, and `kingdomLibrarySchema` only requires `min(1)`, so the schema would not catch it.

| Id | Name | Health | Piles |
| --- | --- | ---: | --- |
| `current-duel` | Current Duel | 20 | Footwork, Muster, Feint, Drive, Flurry, Aim, Volley, Adapt |
| `three-way-open` | Three-Way Open | 20 | Footwork, Stipend, Drive, Heavy Blow, Aim, Volley, Channel, Ley Step, Arc Bolt, Fireball |
| `three-way-engine` | Three-Way Engine | 30 | Footwork, Muster, Stipend, Reclaim, Adapt, Heavy Blow, Steady Shot, Channel, Prism, Fireball |
| `range-rich-mixed` | Range-Rich Mixed | 20 | Footwork, Adapt, Quick Shot, Steady Shot, Aim, Volley, Drive, Heavy Blow, Channel, Arc Bolt |
| `rigged-melee` | Rigged Melee | 20 | Same piles as `three-way-open`, with Heavy Blow overridden to cost 3 and damage 6 |

`current-duel` has eight `actionPiles`. The other four have ten. This is intended: `current-duel` keeps the current duel market.

`rigged-melee` is a calibration fixture. Its Heavy Blow override is not a proposed card value.

## Expectations

Only rigged melee is a hard check. The others are findings.

- Current duel: explore revised melee against ranged play.
- Three-way open: no outcome is assumed.
- Three-way engine: test whether longer games reward deck improvement and combinations.
- Range-rich mixed: expect ranged cards to appear most often. This is a broad expectation, not a fixed win-rate requirement.

## Calibration input

Declared here so `src/sim/calibration.ts` can be written before step 6 exists. Step 6 must produce this from its tournament, and owns the seat-to-strategy attribution.

```ts
export interface CalibrationInput {
  // Last generation's leaders only, in rank order, excluding the fixed baselines.
  finalLeaders: readonly { strategyId: string; rank: number }[];
  // definition id -> copies acquired, summed over every match the strategy played.
  // Acquisition is starting build plus purchases. Agendas are not acquisitions.
  acquisitionsByStrategy: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface CalibrationResult {
  passed: boolean;
  topStrategyId: string;
  topStrategyCopies: number;
  leadersWhoAcquired: number;
  leaderCount: number;
}

export function checkRiggedMelee(input: CalibrationInput): CalibrationResult;
```

## Rigged melee calibration check

The check passes when either condition is true:

- the top strategy in the final round robin acquired at least one Heavy Blow;
- at least 80 percent of the final leaders acquired at least one Heavy Blow.

**Acquisition is the starting build plus purchases.** Not purchases alone. In `rigged-melee` Heavy Blow costs 3, so a strong evolved melee leader can start with two or three copies, satisfy its `desiredCount` before the first Buy phase, and buy none. Counting purchases only would report a blocker for exactly the behaviour the check exists to confirm. The exclusion that matters is the **agenda**: an agenda entry that was never acquired is not an acquisition.

**"Final leaders" is the last generation's leader set only**, with the fixed baselines excluded from both the numerator and the denominator. Any wider reading makes the 80 percent branch unreachable: the round robin also holds retained leaders from every generation, and four of the five baselines — `treasure-only`, `ranged-standard`, `mage-standard`, `engine-draw` — will never acquire Heavy Blow.

**Threshold is integer arithmetic:** `leadersWhoAcquired * 10 >= leaderCount * 8`, so the result does not depend on float rounding. With 3 smoke leaders that needs 3 of 3.

**An empty leader list throws.** A vacuous pass on the only hard gate would hide a broken search.

**A tie for top** is broken by the stable hash of the canonical strategy form, the same tiebreak leader selection uses, so the gate is deterministic.

**The gate applies to the full run.** The smoke run computes and reports the same numbers as a finding, because three leaders over five generations is not enough signal to fail a goal on.

If the check fails on the full run after the repair cap in `GOAL.md`, record it as a blocker with its numbers in `PROGRESS.md` and stop. Do not tune the threshold, the kingdom, or the strategies to make it pass.

## Files expected to change

| File | Change |
| --- | --- |
| `src/game-data/kingdoms.json` | Add the five curated kingdoms. `distance-duel` stays. |
| `src/sim/calibration.ts` | New. `CalibrationInput`, `CalibrationResult`, `checkRiggedMelee`. |
| `test/kingdom.test.ts` | Extended for the kingdom-data checks. |
| `test/sim/calibration.test.ts` | New. |
| `PROGRESS.md` | Evidence and next step, as `GOAL.md` requires. |

## Checks

1. Each of the six kingdoms loads and deep-equals its id, name, health, exact pile ids, pile counts, and overrides. Each offers Cull and the three treasures.
2. `distance-duel` is still the default and still has its existing supply. The registry holds six kingdoms.
3. `current-duel` has eight `actionPiles`; the other four have ten. The check asserts on `actionPiles.length`, not on supply keys or market entries, which also carry Cull and the treasures.
4. `three-way-engine` starts both fighters at 30 health, and `assertInvariants` passes on a fresh `createGame` for every kingdom.
5. `rigged-melee` sells Heavy Blow for 3 and deals 6 damage with it, and the canonical definition stays at cost 5 and damage 4.
6. **Override isolation.** In one process, `three-way-open` resolves Heavy Blow at cost 5 / damage 4 while `rigged-melee` resolves it at 3 / 6. These two kingdoms share identical piles, which makes them the ideal probe for a memo-key defect in `resolveIn` — the failure mode that would silently invalidate the whole calibration.
7. `rigged-melee` and `three-way-open` have identical piles.
8. Step, Strike, Shot, and Starfire are in no kingdom.
9. Override validation still rejects a value key the mechanic does not declare, for example a `heavyBlow` override naming `draw`.
10. The calibration check passes a synthetic input whose top strategy acquired Heavy Blow; passes one where exactly 80 percent of leaders acquired it; fails one at 79 percent where the top strategy did not; and throws on an empty leader list.
11. The calibration check reads acquisitions, not agendas: a leader whose agenda names Heavy Blow but who never acquired one does not count. A leader that acquired Heavy Blow **only in its starting build** does count.
12. One short match per baseline pair per curated kingdom completes without throwing, and the exact repaired starting build is pinned for all 25 kingdom-and-baseline pairs. Step 4's equivalent check cannot cover these kingdoms, because step 4 runs before they are registered.

    Pinning the exact build replaces an earlier "each repaired build is non-empty" wording, which was wrong: `treasure-only`'s build is **deliberately** empty, so that the whole 12 carries into the first Buy phase as `firstBuyMoney`. Pinning the exact list is also the stronger check, because it catches a build that repairs to the wrong cards, not only one that repairs to nothing.

## Completion criterion

Six kingdoms exist as committed data with the approved values, the calibration check runs over `CalibrationInput`, the checks pass, and the four verification commands pass.
