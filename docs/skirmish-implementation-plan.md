# Skirmish Implementation Plan

Implementation plan for the ruleset in `docs/skirmish-rules-draft.html`. Goal-file and process changes are out of scope, and so is anything to be settled by playing the game — those live in `docs/skirmish-balance-questions.md`.

## Decisions

**Work in root `src/`.** The new rules delete more of the current board layer than they keep, so branching an experiment sandbox would fork a codebase that is about to be rewritten anyway.

**The current red tests do not need repairing.** `bun run test` at root is 64 passed / 50 failed across 25 files, and every one of the 50 failures is `ENOENT` on a fixture that commit `84250b0` moved out of root — no logic failures. The 8 red files are all board-layer (`board/coordinates`, `board/schema`, `cli/board-turn`, `integration/territory-config`, `playtest/commit-turn`, `playtest/deck-validation`, `playtest/run`, `replay/schema`) and are exactly the files this plan deletes or rewrites; restoring their fixtures would mean maintaining assets for the retired game.

The bar is a confident green suite on the new mechanics. Step 1 clears the red by removing the retired cases, and every step after it adds its own tests back. The 17 currently-green files are `core/`, `config/`, `cli/`, and the `integration/` deck tests — the deck engine, which this plan barely touches; they should stay green throughout as a regression check.

**Carry two things forward from `experiments/E001-current-best/code`:**

1. The `game/` asset layout (`game/map.json`, `game/units.json`), replacing root's `maps/<id>.json` + `rulesets/<id>/units.json` paths — which are dangling, and are the direct cause of the red baseline above.
2. The ThinHarness runner (`scripts/run_game_thinharness.py`, `scripts/playtest_context.py`, `scripts/run_game.py`) and `agent-context/prompts/`.

E001's `src/playtest/rulesConfig.ts` has no root counterpart, and its contents are entirely recruiting, income, and center dominance — all deleted. Nothing to carry.

**Do not carry forward** `game/cards.json` (prose card list for the old damage/heal cards) or `game/board-rules.md` (267 lines describing the retired game).

**Coordinates are 0-indexed**, matching every existing fixture (`maps/sketch-v1.json` and E001's `game/map.json` both run `col 0..12`, `row 0..9`). Rows `0..16`, middle row **8**.

**The board is symmetric under 180° rotation**, not reflection: `(row, col) → (16 - row, W(row) - 1 - col)`, where `W` is the row's width. Row 8 must be 9 wide so the rotation has a fixed centre hex to put the attack point on. Row 8 is even, so **even rows are 9 wide (cols `0..8`) and odd rows are 10 wide (cols `0..9`)** — 9×9 + 8×10 = 161 hexes. The narrow rows are the inset ones.

Rotation keeps the two flanks distinct — one player's left is the other's right — where a top-to-bottom reflection would make any plan for one wing the plan for both. It costs the neutrality of the two outer key points: the centre is fixed, but range and movement swap. They stay eight rows from either home row, so distance is equal and only the terrain en route differs. `docs/skirmish-rules-draft.html` carries the full argument.

**The double-implementation invariant stays.** `src/playtest/boardTurn.ts` executes a turn and `src/playtest/run.ts` independently re-validates the same rules against the replay. Every rule below is written twice on purpose. This roughly doubles the cost of each board rule and is the reason the plan is ordered to get the shared vocabulary right before either implementation starts.

## What the rules require that the code cannot express

| Requirement | Blocker today |
|---|---|
| Per-unit range and movement | `boardStateSchema.units` stores `attack` only; range and movement are looked up per *type* in `units.json` (`boardTurn.ts:178`, `boardTurn.ts:268`) |
| Move → attack → move on one budget | `boardTurnActionsSchema` takes independent `movements` and `attacks` arrays with no ordering between them |
| Threshold upgrade cost | `applyUpgrades` checks a flat symbol total against `upgradeDamage`/`upgradeHealth`; there is no notion of cost scaling with the value reached |
| Attack/movement/range symbols per unit type | `produced` is a flat `Record<string, number>` with no type tagging |
| Line of sight | No LOS function exists. Attacks are gated on `mapDistance`, which is BFS over open hexes — so today walls *inflate* attack range by routing the count around them, where the new rule wants a straight-line occlusion test on the true `hexDistance` |
| Pointy-top odd-row board | `coordinates.ts` hard-fails on anything but `odd-column` (`assertOddColumn`), and `boardMapSchema.coordinateSystem` is a single-value enum |
| Key points | `supplyCenters` grants income, not upgrades |
| Elimination win, and draws | Win machinery is built around `unitLead`, `centerMajority`, `sixCenterDominance`, and `replayWinEventSchema.player` is required (`replay/schema.ts:87`), so a draw is unrepresentable |
| Two-player roster without supply | Turn order and opponent lookup all derive from `state.supply` (`boardTurn.ts:418`, `run.ts:904`, `run.ts:978`), which this ruleset deletes |
| Draft of ≤3 cards for ≤8 | `DRAFT_BUDGET = 12` is hard-coded, there is no card-count cap, and unspent budget is refunded as first-turn money (`cli/session.ts:9`, `:100`, `:116`) |
| No max HP | `units[].maxHp` is required and `hp` is clamped to it on heal |

## Sizing

Root `src/` is 4220 lines.

- **Untouched (~1900, 45%)** — `core/` less one flag (816), `config/` less one field, `cli/` less the draft constants (672), `replay/schema.ts` partially.
- **Rewritten (~1550, 37%)** — `playtest/boardTurn.ts` (449), `playtest/run.ts` (1100). `run.ts` shrinks substantially: `validateRecruits`, `validateHealsAndUpgrades`, `validateSupplyAndCenters` and the entire win-event section (roughly lines 737–917) are deleted and replaced by something much smaller.
- **Edited (~450)** — `board/schema.ts` (196), `board/coordinates.ts` (103), `replay/schema.ts` (123).
- **New** — LOS, odd-row coordinates, key points, map generation and symmetry checks, setup/deployment validation, viewer changes.

This is major surgery on one layer, not a rewrite. The deck engine (`core/`) is untouched apart from one config flag.

---

## Step 1 — Delete the retired subsystems

Do this first and alone. Every later step is easier to reason about against a smaller surface, and deleting first prevents accidentally preserving a rule nobody wants.

Remove: recruiting, healing, supply/income, supply centers, home bases, deck damage, re-attack, `maxHp`, the `mage` role, and the three win-event types.

Touches `board/schema.ts`, `replay/schema.ts`, `playtest/boardTurn.ts`, `playtest/run.ts`, and the eight red test files — `integration/territory-config.test.ts` is deleted outright; the other seven are emptied of retired-subsystem cases and refilled by later steps.

Removing `supply` removes the player roster. Replace it in the same step, before anything depends on the gap: `boardStateSchema` gains `players: [string, string]` as the authoritative roster and turn order, and `advanceTurn` / `opponentForPlayer` / `nextBoardTurn` read from it. Deriving the roster from the units array instead would make a player disappear the moment they are eliminated, which is precisely the state the win check needs to observe.

**Verify:** `bun run typecheck` clean; `bun run test` fully green — all 25 files, no skips (the 17 deck-engine files unchanged, the 8 board files green because their retired cases are gone rather than pending); `grep -rn "recruit\|supplyCenter\|maxHp\|heal" src/` returns nothing.

## Step 2 — Pointy-top odd-row coordinates

`src/board/coordinates.ts`:

- Add an odd-row direction table. Directions become `east | northeast | northwest | west | southwest | southeast`; there is no north or south on a pointy-top grid, so `HexDirection` changes shape and every consumer must be revisited rather than renamed.
- Even (narrow, inset) rows: `E(+1,0) NE(+1,-1) NW(0,-1) W(-1,0) SW(0,+1) SE(+1,+1)`. Odd (wide) rows: `E(+1,0) NE(0,-1) NW(-1,-1) W(-1,0) SW(-1,+1) SE(0,+1)`.
- Cube conversion: `x = col - ((row + (row & 1)) >> 1)`, `z = row`, `y = -x - z`.

Both tables and the cube formula were derived from hex centre geometry and checked against BFS over the real 161-hex board — they agree on every pair from six different origins spanning both parities and all four corners.
- Replace `assertOddColumn` with a dispatch on `coordinateSystem`.

`src/board/schema.ts`: extend `coordinateSystem` to `z.enum(['odd-column', 'odd-row'])`, and add a refinement pairing it with `orientation` — `flat` requires `odd-column`, `pointy` requires `odd-row`. Nothing pairs them today, so a map can declare `pointy` + `odd-column` and get silently inconsistent geometry between engine and viewer. That is exactly the bug class this step introduces the opportunity for.

Keep odd-column support. It costs almost nothing, and dropping it would break the existing map fixtures for no gain.

**Verify:** a table test asserting, for a hand-checked 5×5 odd-row grid, that every hex has exactly six neighbours, that neighbour-of-neighbour returns the origin in the opposite direction, and that `hexDistance` matches hand-computed values for a dozen pairs spanning both row parities. Parity bugs in offset grids show up only on one parity, so the fixture must include both. Plus a negative test rejecting `pointy` + `odd-column`.

## Step 3 — Line of sight

New `lineOfSight(map, from, to)` in `coordinates.ts`.

The rule is "blocked only by a wall hex interior; grazing an edge or vertex does not block." Implement it directly: take the segment between the two hex centres in pixel space and test it against each wall hexagon's open interior. Blocked if the segment enters any wall's interior; grazing an edge or vertex is a boundary touch and does not count.

Do not use the epsilon-nudge trick (interpolate twice with opposite offsets, blocked if both traces hit a wall). It is an approximation of the exact test that needs its own correction for walls on both sides of a grazed edge, and its answers depend on the epsilon. The exact test is about the same amount of code and has no tuning parameter.

Grazing is the common case here rather than the exotic one — the board is 17 rows tall and pointy-top, so the main axis of advance runs through hex vertices.

`lineOfSight` takes the **map**, never a synthesized map. `boardTurn.ts:439`'s `mapWithEnemyBlocked` folds units into `map.blocked` for pathfinding; handing that to LOS would make units block sight, which is not the rule. Give it a distinct type or wrapper so the two cannot be confused at a call site — the risk goes up in Step 8, where that map starts including friendly units too.

**Verify:** a fixture map with asserted clear/blocked pairs for straight-vertical, straight-horizontal, and both diagonal families; at least two lines passing exactly through a wall's vertex that must come back clear; one line running along the shared edge of two adjacent walls and one through the vertex where three walls meet, both clear. Assert symmetry: `los(a,b) === los(b,a)` for every pair. Assert a unit standing between `a` and `b` does not block.

## Step 4 — Board state and unit model

`boardStateSchema.units[]` becomes:

```
id, player, type, col, row, hp, attack, movement, range
```

`maxHp` is gone. `movement` and `range` move from per-type lookup to per-unit state, initialised from `units.json` at setup and mutated by upgrades. `units.json` keeps the base stat lines and the `soldier`/`archer` roles; it stops being the runtime source of truth for anything upgradeable.

`hp` becomes `z.number().int().positive()`. Zero-HP units are removed immediately by the rules, so a snapshot containing one is not a valid state — and since the win check and both tiebreaks count array entries and sum HP, a lingering 0-HP unit would corrupt all three silently rather than failing loudly.

`unitRulesSchema` drops `heal`, and `role` narrows to `melee | ranged`.

Add `canUpgradeRange: boolean` per type rather than special-casing `type === 'soldier'` in the validator. The rules doc treats "soldiers cannot upgrade range" as a hard constraint, so it should be data on the unit type, not a string comparison in two places — and Step 8's key-point interaction needs the same flag, which is the second place it would otherwise be duplicated.

**Verify:** round-trip a board state through the schema and assert `maxHp` is rejected as an unknown key (the schemas are `.strict()`, so this is a real assertion that old snapshots fail loudly rather than silently losing a field). Assert a 0-HP unit is rejected.

## Step 5 — Map generation and symmetry

Author `game/map.json` as 17 rows `0..16`: even rows 9 wide (cols `0..8`), odd rows 10 wide (cols `0..9`), 161 hexes.

Generate it with a committed script rather than by hand — `scripts/build_map.py` emitting the JSON — because the symmetry constraint and the alternating widths make hand-authoring error-prone in exactly the way that produces an unexplained balance skew.

Map schema changes:

- `supplyCenters` and `homeBases` are replaced by `keyPoints: [{ id, stat: 'attack'|'movement'|'range', col, row }]` and `deployment: [{ player, hexes }]`.
- Fixed geometry and symmetry go in a **Skirmish-specific validator** (`validateSkirmishMap`), not a `superRefine` on the generic `boardMapSchema`. A hard-coded 17-row symmetry rule on the shared schema would reject every otherwise-valid non-Skirmish map, including the odd-column fixtures Step 2 deliberately keeps.

Write the rotation once as `rotate(row, col) → [16 - row, W(row) - 1 - col]` and use it for every assertion below. It is an involution, so `rotate(rotate(h)) === h` is a cheap self-check on the helper before anything else depends on it.

`validateSkirmishMap` asserts:

- Row widths follow the parity rule exactly, and no hex falls outside `0..W(row)-1`. The rotation check cannot catch a board that is uniformly the wrong width, since such a board is still symmetric.
- Hexes, walls and deployment zones are invariant under `rotate`.
- The deployment zones **swap** under `rotate` — P1's zone maps onto P2's — rather than each mapping onto itself.
- Exactly three key points, three distinct stats, all on row 8.
- The **attack** point is on the fixed hex `(8, 4)`, the only hex `rotate` maps to itself.
- The other two key points are a rotation pair: `rotate(range) === movement`.
- Key point and deployment hexes are not walls; deployment zones name each of the two players once and do not overlap.

The last three are the ones worth writing carefully. They are what keep the attack point genuinely neutral and the other two symmetric to each other, and a violation is invisible in play until a batch comes back skewed.

**Wall layout (settled).** Nine seed hexes authored for the top half and rotated into the bottom, giving 18 walls in segments of 4, 3 and 2. In the diagram's 1-indexed form the seeds are `(4,2) (5,2) (5,3) (6,4)`, `(3,7) (3,8) (4,9)`, `(7,6) (8,7)`; `scripts/build_map.py` should hold them 0-indexed and generate the far half rather than listing all 18. The exact arrangement is still tunable — the constraints it must keep are the density band, segment lengths of 2–4, clear home rows and key point hexes, and relatively clear approaches to the range and movement points, which is what limits the terrain asymmetry rotation introduces.

**Verify:** `validateSkirmishMap` runs on the real map in CI, plus negative tests for each assertion — a wall breaking rotation, the attack point off centre, range and movement not a rotation pair, two key points sharing a stat, deployment zones that map onto themselves instead of swapping, a wall on a deployment hex, a row of the wrong width — each asserting the specific issue path rather than just "threw". Assert the real map's wall count and segment lengths sit inside the stated bands, since those are the constraints a later retune is most likely to break silently.

## Step 6 — Setup: draft and army

The rules define two setup decisions and the code implements neither.

**Draft.** Each player takes up to three cards with total printed cost at most 8; deck is 7 Copper plus the draft. Replace `cli/session.ts`'s `DRAFT_BUDGET = 12` with a config-sourced `{ maxCards: 3, maxCost: 8 }`, and **delete the carryover path** (`session.ts:103`, `:116–119`, and `PlayerState.draftCarryoverMoney`). Refunding unspent budget as first-turn money contradicts the rule that makes a small draft attractive — the payoff for taking fewer cards is deck density, and paying it back in coin cancels that.

**Army.** Five units per player. The soldier/archer split is submitted at setup rather than fixed in an asset (rules doc: "chooses the distribution between soldiers and archers at setup").

Setup validation: exactly two players, exactly five units each, every deployment hex inside that player's zone, no two units on one hex, types drawn from `units.json`, and base stats initialised from `units.json` rather than submitted. `initialBoardState` (`run.ts:100–114`) still builds `supplyControl`/`supply` and is rewritten here.

**Verify:** accept drafts of 0–3 cards costing ≤8; reject a fourth card and reject cost 9; assert first-turn money equals `initialMoney` regardless of draft spend. Accept a legal 5-unit deployment; reject four units, six units, a duplicate hex, a wall hex, a hex in the opponent's zone, an unknown type, and a submitted stat line that differs from `units.json`.

## Step 7 — Symbols in the deck config

Symbols are per-turn player attributes, which the deck engine already supports: `PlayerState.attributes` is reset every turn by `resetTurnResources` and cards grant into it via `GrantEffect.attributes`. No engine change needed for symbols themselves.

Five attribute keys, matching the five lanes: `soldierAttack`, `soldierMovement`, `archerRange`, `archerAttack`, `archerMovement`. There is deliberately no `soldierRange`.

Author `game/deck.yaml` against the existing `GameConfigSchema` with the twelve piles from the rules doc.

One engine change is needed: **no action limit.** Add `setup.unlimitedActions: boolean` (default `false`); when set, `legalActions` and `engine` skip the action count check and decrement. Nothing else changes — `moveToBuy` stays available at all times, so playing a card remains a choice.

Preferred over setting `initialActions` to a large number, because cycling cards make the real bound unpredictable and a silent cap would surface as an unreproducible mid-game stall.

`endGame` no longer ends the game — the deck-side end condition is unused, and the game ends on elimination or the turn cap. Set it to an expression that never fires and note why, rather than removing the field and forking the config schema.

**Verify:** a hand of six cycling cards plays all six with `unlimitedActions`, and the same config without the flag stops after one. `moveToBuy` is accepted with playable cards still in hand. A test asserting `attributes` at the start of each turn equal the configured `setup.attributes` baseline — `resetTurnResources` resets to that baseline, not to zero, and symbols not carrying over is a load-bearing rule that is currently only an emergent property of that function.

## Step 8 — Activation model

This is the core rewrite and the part most likely to be got wrong.

Replace the independent `movements` / `attacks` arrays with an ordered list of activations, one per unit, at most one per unit per turn:

```
activations: [
  { unit, from, via?, attack?: { target }, to }
]
```

`via` is the hex the unit attacks from; `to` is where it finishes. `via` absent means `via === from`. Legality:

- `from` matches the unit's current position.
- `mapDistance(from, via) + mapDistance(via, to)` ≤ the unit's *current* `movement`, with each leg individually pathable.
- **All units block movement, friendly and enemy alike.** `from`, `via` and `to` are the only hexes the moving unit may occupy, and both `via` and `to` must be empty. Pathfinding treats every occupied hex as impassable, so the existing `mapWithEnemyBlocked` becomes `mapWithUnitsBlocked` and stops needing to know whose unit it is.
- If `attack` is present: target is an enemy, `hexDistance(via, target)` ≤ the unit's current `range`, and if `range > 1`, `lineOfSight(via, target)` is clear. Note `hexDistance`, not `mapDistance` — attack range is straight-line with occlusion, where today it is a wall-routed BFS count.
- Damage is the attacker's current `attack`. One attack per activation.
- A unit removed at 0 HP is gone; a unit killed before its own activation never activates.

Activations resolve strictly in order against the live board: each one sees the positions and deaths the previous ones produced. The order must be preserved in the replay, since it is what makes a turn reproducible.

**Verify:** move-attack-move with an exact budget passes and one over fails; retreat-only and advance-only both work; attacking through a wall at range 2 fails while the same attack at range 1 succeeds; a unit killed mid-turn cannot appear in a later activation; a path opened by an earlier activation's kill or vacancy is legal for a later one, and illegal if the two are reordered; `via` or `to` on any occupied hex fails, friendly or enemy.

## Step 9 — Upgrades

Replace `applyUpgrades` entirely.

```
upgrades: [ { target, stat: 'attack'|'movement'|'range', to } ]
```

Cost is `to` symbols of the lane `(unit type, stat)`. Checks:

- `to` equals the unit's current stat + 1. Raises are always exactly one step.
- At most one raise per `(unit, stat)` per turn, counting key point grants.
- Soldiers cannot raise range — read from `canUpgradeRange`, not from the type name.
- Per-lane spend ≤ per-lane produced. Five independent budgets, not one.
- Unspent symbols are discarded, not carried.

Key points resolve before symbol spending, as a separate `keyPointUpgrades` list derived by the engine rather than submitted by the player — occupancy at start of turn is a fact about the board, not a choice, so letting the player assert it invites a class of replay divergence that strict validation would have to catch anyway.

The key point grant respects `canUpgradeRange`: a soldier standing on the range point gets nothing. The rules doc calls this out ("the range point is dead to soldiers, but denial still matters"), and it is the case where the grant path and the spend path must agree — deriving the grant without the check would hand soldiers a stat they can never otherwise raise.

**Verify:** raising attack 1→2 costs 2 and 2→3 costs 3; 5 symbols on one unit still yields +1 with 3 wasted; 4 symbols raise two different units; a soldier range upgrade is rejected; a soldier on the range point receives no grant while an archer on it does; archer-attack symbols cannot pay for a soldier's attack; a key point grant blocks a symbol raise of the same stat on the same unit that turn.

## Step 10 — Win condition and clock

Delete the `unitLead` / `centerMajority` / `sixCenterDominance` machinery and the response-window logic (`run.ts` ~737–917).

Replace with: a player wins when the opponent has zero units. Check at end of turn. On reaching the turn cap, decide by units remaining, then total remaining HP, then draw.

`replayWinEventSchema` narrows to:

```
{ type: 'elimination' | 'turnCap', outcome: 'win' | 'draw', player: string | null,
  completedTurns, playerUnits, opponentUnits, playerHp, opponentHp }
```

`player` becomes nullable and `outcome` is explicit, because `player: z.string().min(1)` is currently required and a draw has no player — without this the tiebreak's third branch is literally unrepresentable in a replay. HP totals are recorded because the second tiebreak is decided on them, and a terminal event that omits the quantity it was decided by cannot be independently re-checked.

**The turn cap is a runner parameter, not a rule** — it belongs in `run.yaml`. But it has to be bound into the replay to be validatable: the runner writes the cap into the timeline's run metadata at start, strict validation reads it from there, and the terminal event is generated deterministically by the runner when `completedTurns` reaches it. E001's runner treats `max_turns` as iterations of the *current invocation* and stops without emitting a terminal event (`run_game_thinharness.py:435`), so a resumed run would silently get a second full allowance. Porting that behaviour unchanged would make the cap depend on how many times the run was resumed.

**Verify:** an elimination replay validates and a fabricated one where the loser still has a unit fails; a turn-cap replay resolves each tiebreak level, including an exact draw, and each records the quantity it was decided on; a run resumed after interruption stops at the same absolute turn as an uninterrupted one and emits exactly one terminal event; keep `terminalWinEvents` working, since that was the fix for wins confirmed at the start of the following turn.

## Step 11 — Validator

Rewrite `run.ts`'s board section as the independent second implementation of steps 8–10. It must not import the executor's helpers — that is the entire point of the duplication, and sharing a helper silently converts two implementations into one.

**Verify:** a mutation check. Take a valid replay bundle and programmatically corrupt it one field at a time — move a unit one hex further, drop a symbol, raise a stat two steps, attack through a wall, resurrect a dead unit, reorder two activations, swap a draw to a win — and assert strict validation rejects every mutation. A validator that passes the happy path proves very little; this is the test that proves the second implementation is actually independent.

## Step 12 — Asset paths and viewer

The `maps/<id>.json` + `rulesets/<id>/` layout is read from four independent places. Migrating to `game/` means changing all of them, and the red baseline in the Decisions section is what happens when one copy of a path goes stale:

- `playtest/boardTurn.ts:178` (executor)
- `playtest/run.ts` (initializer and replay validator, separate loaders)
- `viewer/src/boardState.ts:26, 63, 64`
- `viewer/vite.config.ts:30–31` (the `/game-data` middleware allowlist, which will 403 the new paths until updated)

`viewer/src/hex.ts`: the pointy branch of `hexToPixel` currently uses an axial projection (`x = √3·(col + row/2)`), which shears a rectangular board into a parallelogram. It is dead code today because both maps declare `flat`. Replace it with odd-row offset — `x = √3·(col + 0.5·(row & 1))`, `y = 1.5·row` — and validate `coordinateSystem` in that branch the way the flat branch already does.

Then: render key points, show per-unit `attack`/`movement`/`range`, drop supply-center and income UI.

**Verify:** load both a live board and a replay through the new `game/` paths and confirm neither 403s. Then render a real replay and look at it. Confirm the board is a vertical rectangle with jagged sides and flat top and bottom, that the three key points sit on the middle row, and that a unit's rendered neighbours are the hexes the engine considers adjacent — pick a unit, list its engine neighbours, and check them against the picture.

## Step 13 — Harness and agent context

Port the ThinHarness runner from E001. The two-tool structure (`submit_deck_turn` then `submit_board_turn`, both strict-validated, invalid submissions returned as retryable tool errors with no deterministic fallback) carries over unchanged.

The Pydantic schemas in `run_game_thinharness.py` change to match the new action shapes — activations replacing movements/attacks, stat-typed upgrades, no recruits or heals — plus the two setup submissions from Step 6 (draft and army composition).

Write a new `game/board-rules.md`. The existing 267-line version describes the retired game and must be replaced rather than edited; it is the agents' only description of what is legal, and a stale sentence in it produces retry loops that look like model failure.

**Verify:** a full ThinHarness playthrough reaching a legal winner, passing `bun run validate-run -- --strict --strict-deck --strict-win`. Record retry counts per action shape — a high rate on one shape means the prompt and the schema disagree.

---

## Order and rationale

1–2–3 first: delete, then coordinates, then LOS. All three are self-contained, testable in isolation, and every later step depends on them. Step 1 also restores a green suite, which is what makes every later verify meaningful.

4–5–6–7 next: the data model and setup. Cheap once the geometry is settled, and they unblock both implementations of the rules.

8–9–10 are the rules, written once in the executor. 11 writes them a second time in the validator. Doing 11 immediately after rather than interleaving keeps the two implementations genuinely independent — writing them side by side is how they end up sharing assumptions.

12 and 13 are last because both need a working replay to test against.

## Risks

**The double implementation is the schedule.** Steps 8–10 and step 11 are the same rules twice. If the plan slips, it will slip here, and the tempting fix — sharing a helper between executor and validator — destroys the property the duplication exists to provide.

**`HexDirection` changes shape, not just names.** Pointy-top has no north or south. Any code or prompt that says "move north" is wrong rather than merely renamed, and the compiler will only catch the TypeScript half.

**The activation budget's two-leg case is intentionally permissive.** Two legs summing to the budget is not the same as a single path of that length, because a blocked BFS can make a two-leg route legal where a direct one is not. That is intended, and it is the likeliest place for the executor and validator to diverge on a board state neither test suite happened to cover.

**Every number is an asset, not a constant.** Stat lines, pile costs and symbol densities are all proposals (see `docs/skirmish-balance-questions.md`). Read them from `game/` with no numeric constants in `src/`, so retuning is an asset edit.
