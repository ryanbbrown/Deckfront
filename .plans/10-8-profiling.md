# Step 8: profile complete experiments

Implements step 8 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 7.

Step 9, a native-language port, is outside this goal. `GOAL.md` keeps TypeScript as the reference implementation.

## Objective

Measure where a complete experiment spends its time, then remove avoidable cost. Profile before optimising.

## Method

1. Profile a **bounded fixed workload** — one kingdom, one fixed seed, a fixed match count — with:

   ```sh
   node --cpu-prof --cpu-prof-dir .experiments/profiles --import tsx <entry>
   ```

   `tsx` runs the workload in a child process, so putting `--cpu-prof` on a `tsx` wrapper profiles the wrapper. The `--import` form keeps it in one process. If `--prof` is used instead, it needs a second `node --prof-process` pass over `isolate-*.log`.

   Do **not** profile a smoke experiment: 20 candidates × 3 leaders × 5 generations × 5 seeds makes a large profile and a slow before-and-after loop. The smoke run supplies the throughput number, not the profile.

2. Record throughput: matches per second, action-search nodes per decision, and the maximum node count seen. **Reuse the timing path step 4 already records**, so there are not two disagreeing numbers.

3. Only then change code, in the order the design document gives.

**Measurement noise.** Before-and-after numbers move by tens of percent between runs on a laptop. Take repeated timing runs, record the **median**, and record the machine and the Node version. Without that, the deltas cannot support a decision.

Record the measurements in `PROGRESS.md` before and after each change. A change without a before-and-after number does not belong in this step.

Profile artifacts go to `.experiments/profiles/`, which `.gitignore` already covers. `isolate-*.log` and `*.cpuprofile` are ignored nowhere else and would otherwise land in the repository root, and the `implement` workflow depends on a clean tree.

## Expected costs

Four are known from reading the code. The profile must confirm each before it is changed.

- **Cloning.** `applyAction` calls `cloneGame` — `structuredClone` — on the whole state for every action, and the search applies many actions per decision. `GameState.events` grows for the whole game, so each clone costs more as the game runs. A single game is therefore quadratic in its action count.
- **Double enumeration.** `applyAction` re-runs `listLegalActions` to resolve the action id (`src/game/engine.ts:290`), after the search has already enumerated the same list.
- **Double cloning in `applyCommand`.** `applyCommand` clones the state (`src/game/engine.ts:295`), then for every non-build command discards that clone and calls `applyAction`, which enumerates and clones again.
- **Event recording.** Events are needed for telemetry in a real match. Inside the search they are needed only for the drawn-card count — see below.

An **id-free apply path** addresses the second and third costs and is a smaller, safer change than a custom clone. Consider it first.

## Candidate changes

Decide from the profile, not from this list.

**A search-mode apply that skips event recording.** Two constraints:

- It must keep a plain counter of cards drawn. Step 4's scoring reads `cardsDrawn` from `draw` events and explicitly rejects the hand-size reading, because that biases the search against playing attacks. With recording off and no counter, `cardsDrawn` is 0 on every branch, `weights.cardsDrawn` dies, and the search silently picks different actions. The identity check below would catch the drift, but it would read as a clone bug rather than a lost scoring input.
- The mode is a **parameter on the apply path**, never a field on `GameState`. `gameStateSchema` is a plain `z.object` that strips unknown keys, and `src/server/persistence.ts` then runs `assertInvariants` on the stripped state — the exact break already recorded in `PROGRESS.md`. A new state field breaks the running browser game after a reload, which `GOAL.md` puts out of scope to fix. The default keeps recording on, and no call site in `src/server/` or `src/client/` changes.

**A cheaper clone for the search that copies only the mutable zones.** This relies on an invariant that is true today but unenforced: `CardInstance` objects are never mutated in place anywhere in `src/game/` — cards are only moved between arrays — so a clone can share the instance objects and copy only the arrays. State the invariant with the change, and add the aliasing test below.

**Capping or draining `events` per turn is ruled out.** `src/game/invariants.ts:46` requires `event.sequence === index` across the whole array and `record` derives the sequence from `state.events.length`, so draining restarts sequences at 0, `assertInvariants` throws, and telemetry sequence numbers repeat. Step 3's determinism check also needs a complete event log. Making it work would need a separate monotonic counter plus an invariant change, at which point it is no longer a cheap win.

## Result identity

Any change here must keep results identical, and that must be **a committed test**, not a one-time manual comparison. A manual before-and-after protects nothing once this step ends.

Store `MatchResult` values for a fixed seed set in `test/` and assert them in `npm test`. Include a kingdom with mana and pending choices — Channel, Prism, Reclaim — because those paths mutate the most state and are where a cheap clone fails first. Include at least one fixture that runs near the 100-turn draw limit: the quadratic term only bites in long matches, so a set of short games could pass while missing the regression.

Widen the oracle beyond the summary: for two or three matches also compare the final `GameState` and the complete event log by deep equality. A bad shared reference can leave `MatchResult` intact while corrupting a zone.

## Fallback

If throughput after the profile-justified changes still does not fit the budget, **lower the full-run size** — the parent plan allows it and requires recording the actual limits. Beam search is named as the next fallback, but adopting it is the main agent's decision, not the writer's. Do not invent a third option.

## Checks

1. A recorded before-and-after profile for each change, with the median of repeated timings, the machine, and the Node version.
2. A committed fixture test asserts identical `MatchResult` values across every change in this step, including a mana-and-pending-choice kingdom and a near-limit-length match.
3. `cheapClone(state)` deep-equals `structuredClone(state)`; mutating every array and nested object in the clone leaves the original unchanged. This is the only check that catches a shared array.
4. A search-mode apply leaves `events` empty **and** still reports the correct drawn-card count, so `weights.cardsDrawn` behaves as it did before.
5. A full real match still ends with contiguous event sequences `0..n-1` and passes `assertInvariants`.
6. Measured throughput is recorded in `PROGRESS.md` and used to size the full run, including the tournament term from step 6's sizing formula.

## Completion criterion

Throughput is measured and recorded, any optimisation is justified by a profile and proven result-identical by a committed test, and the four verification commands pass.
