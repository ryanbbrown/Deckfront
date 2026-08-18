# Step 3: deterministic match runner and telemetry

Implements step 3 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on steps 1 and 2.

## Objective

A headless match runner plays one complete game between two agents without the browser and without generative AI. The same inputs always produce the same result. It reports telemetry that the balance report needs.

## Scope

New code lives in `src/sim/`. It imports from `src/game/` only. It must not import from `src/client/` or `src/server/`. Prove this with an ESLint `no-restricted-imports` rule under a `files: ['src/sim/**']` override in `eslint.config.js`. Core ESLint already supplies the rule, so this needs no new dependency, and a lint rule catches the violation at author time. Do not also write a test for it.

## Interface

```ts
export class ActionSearchOverflowError extends Error {}

export interface Agent {
  readonly id: string;
  chooseStartingBuild(state: GameState, playerId: PlayerId): string[];
  // Serves the Action phase, the Buy phase, and pending-choice resolution.
  // Throws ActionSearchOverflowError when its search exceeds its state limit.
  chooseAction(state: GameState, playerId: PlayerId, actions: readonly LegalAction[]): LegalAction;
}

export interface MatchConfig {
  kingdomId: string;
  seed: number;
  firstPlayerId: PlayerId;
  swapSides: boolean;             // exchanges the two starting positions
  turnLimitPerPlayer: number;     // 100 in the approved limits
  actionCapPerTurn: number;       // 200 in the approved limits
  agents: Record<PlayerId, Agent>;
}

export interface MatchResult {
  config: Omit<MatchConfig, 'agents'> & { agentIds: Record<PlayerId, string> };
  outcome: 'ochre' | 'indigo' | 'draw' | 'aborted';
  reason: 'victory' | 'turnLimit' | 'actionCap' | 'actionSearchOverflow';
  turns: number;                  // completed player turns
  telemetry: MatchTelemetry;
}

export function runMatch(config: MatchConfig): MatchResult;
```

An agent is a plain interface so step 4 can supply the strategy-driven agent and the fixed baselines, and so tests can supply a trivial agent.

### Agent contract

- **Build order is fixed.** `createGame` sets `activePlayerId: 'ochre'` and `submitBuild` requires the active player (`src/game/state.ts:17`, `src/game/engine.ts:242,250`), so builds are always ochre then indigo whatever `firstPlayerId` says. `firstPlayerId` decides who acts on turn 1, not who builds first.
- **Invalid builds are match failures.** `submitBuild` throws for an over-budget or off-kingdom build. `runMatch` propagates that; it does not clamp or repair. Step 4 owns the repair rule.
- **Agents must not mutate the state they are given.**
- **`runMatch` validates the returned action** against the list it supplied, so a step-4 bug fails with a useful message rather than the engine's "Unknown or stale legal action". Action ids embed `state.version` (`src/game/engine.ts:24,290`), so a stale id is a real failure mode.

### Arena side

`swapSides` **exchanges** the two starting positions: ochre starts at 3 and indigo at 2, instead of ochre at 2 and indigo at 3. `createGame` gains a `swapSides` option, declared `swapSides?: boolean | undefined` to match `CreateGameConfig`'s existing style under `exactOptionalPropertyTypes`. Nothing else in the game module changes.

Reflecting both fighters about centre space 3 would **not** work. `ARENA_MIN` is 1 and `ARENA_MAX` is 5 and every position rule is left/right symmetric, so a reflection produces an isomorphic board: ochre still sits one space from a back wall and indigo still sits on centre. Only the direction labels change. The parent plan wants seat advantage to cancel over a pairing, and the real asymmetry is that the two fighters start at different distances from their back walls, which matters for Drive wall collisions. Exchanging the positions cancels it; reflecting does not.

## Telemetry

```ts
export interface MatchTelemetry {
  turnsToWin: number | null;                 // completed player turns when the game ended
  eventCount: number;
  damageByCard: Record<PlayerId, Record<string, number>>;
  playsByCard: Record<PlayerId, Record<string, number>>;
  purchasesByCard: Record<PlayerId, Record<string, number>>;
  startingBuild: Record<PlayerId, string[]>;
  deadDraws: Record<PlayerId, { range: number; mana: number; setup: number; total: number }>;
  moneySpent: Record<PlayerId, number>;
  unspentMoney: Record<PlayerId, number>;
  finalHealth: Record<PlayerId, number>;
}
```

**Dead draws.** Snapshot `listActionAvailability` from the state **before** applying `endActionPhase`. After it applies, `phase` is `'buy'` and every card reports `WRONG_PHASE` (`src/game/engine.ts:43,267`), so the reason codes are gone. Count only cards whose resolved type is `action`; treasures report `TREASURE_AUTOPLAYS` and `endActionPhase` removes them from hand anyway.

- `range` — reason code `NEEDS_CLOSE` or `NEEDS_NEAR_OR_FAR`.
- `mana` — reason code `NEEDS_MANA`.
- `setup` — a card that is **legal** but missing its setup: a Volley while `aimed` is false, or a Flurry with no Tactical Action yet this turn. The parent plan asks for this column and no reason code can supply it, because the play is legal. These two narrow rules are the whole definition.
- `total` — every disabled action card. `range` and `mana` are subsets of `total`; `setup` is not, because those cards were playable.

**Damage by card.** Read the `damage` events that follow each `cardPlayed` event and attribute them to the definition id of the most recent `cardPlayed` event by that player. Drive's wall collision produces a second `damage` event for the same card and both belong to Drive.

This is **raw damage dealt, overkill included**. `dealDamage` clamps health with `Math.max(0, …)` but records the unclamped amount in the event (`src/game/engine.ts:137-138`), so on a killing blow the total exceeds the health lost. Feint's `+2` is applied inside `dealDamage`, so it lands on the follow-up attack's definition id, not on Feint.

**Money.** `endBuyPhase` zeroes `player.money` (`src/game/engine.ts:280`), so read money **before** applying it.

- `unspentMoney` — summed over completed Buy phases, read from `player.money` immediately before `endBuyPhase` applies.
- `moneySpent` — the sum of `purchase` event `cost` details, which already carry overridden costs. Purchase costs only; the starting budget is not spending.
- Turn 1's available money includes `firstBuyMoney`, the remainder of the 12-money starting budget (`src/game/engine.ts:231,265`), so a large first-turn `unspentMoney` is expected.

**Accumulation.** Accumulate from the event slice added by each applied action, never by rescanning the whole event log. `telemetry.ts` exports a **pure accumulator** — event slice plus availability list plus the running telemetry, in; a new telemetry value, out. Checks 3–5 need exact board states that are fragile to reach from a seed, so they drive the accumulator with synthetic slices instead of hunting for a shuffle.

## Turn limit and action cap

After each applied action, in this order:

1. If `state.winner` is set or `state.phase === 'ended'`, stop with `outcome` = the winner and `reason: 'victory'`. This is tested **first**, so a lethal blow on the limit turn reports a victory rather than a draw.
2. If actions applied within the current player turn exceed `actionCapPerTurn`, stop with `outcome: 'draw'` and `reason: 'actionCap'`.
3. If `state.turn > turnLimitPerPlayer * 2`, stop with `outcome: 'draw'` and `reason: 'turnLimit'`.

`finishSetup` sets `turn = 1` and `endBuyPhase` increments it (`src/game/engine.ts:238,283`), so `turn` counts half-turns and already points at the next one once a turn completes. `MatchResult.turns` is therefore `state.turn - 1`: completed player turns. Reaching the limit means `turns === turnLimitPerPlayer * 2`.

The action cap is not redundant with the turn limit, which bounds turns, not actions. Copper costs 0 (`src/game-data/cards.json:3`) and treasures are always buyable regardless of supply (`src/game/engine.ts:95-96`), so an agent that buys Copper while money remains never reduces its money and never leaves the Buy phase. Step 4's buy rule has exactly that shape. Without the cap a defect there hangs an unattended 8-hour run with no output instead of failing. The Action phase is safe on its own — every play removes a card from hand and draws come from a finite deck.

Preserve the telemetry gathered so far for every stop reason.

## Overflow

`ActionSearchOverflowError` lives in `src/sim/types.ts`. Step 4's search throws it; `runMatch` catches it and returns `outcome: 'aborted'`, `reason: 'actionSearchOverflow'`, with the telemetry gathered so far.

The outcome is deliberately **not** `'draw'`. The parent plan scores a draw as 0.5, which would pay a strategy for blowing the state limit. Step 6 excludes an aborted pairing from scoring instead.

## Determinism

The runner adds no randomness of its own. Every random result comes from `GameState.rngState`, which the seed fixes. An agent that needs randomness must take a seed derived from the match seed, not a global source.

Two checks: the same config run twice produces deeply equal `MatchResult` values, and two fixed seeds produce **different complete event logs**. Comparing event counts is weak, because two seeds easily give the same count.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/types.ts` | New. `Agent`, `MatchConfig`, `MatchResult`, `MatchTelemetry`, `ActionSearchOverflowError`. |
| `src/sim/match.ts` | New. `runMatch`. |
| `src/sim/telemetry.ts` | New. Pure event-slice accumulator. |
| `src/game/state.ts` | `swapSides` option on `createGame`. |
| `eslint.config.js` | `no-restricted-imports` override for `src/sim/**`. |
| `test/sim/scripted.ts` | New. A test agent that follows a fixed preference list. Test-only, so it lives under `test/`. |
| `test/sim/match.test.ts` | New. |
| `test/sim/telemetry.test.ts` | New. Pure accumulator, synthetic slices. |

## Checks

1. Two runs of the same config produce deeply equal `MatchResult` values, and two fixed seeds produce different complete event logs.
2. Two agents that immediately end both phases reach the turn limit and report `draw` / `turnLimit`, with `turns === turnLimitPerPlayer * 2`. Assert both `turns` and final `state.turn` at `turnLimitPerPlayer = 2`, so the boundary is pinned by a small readable case rather than a 200-turn run.
3. A scripted lethal line reports the correct winner, `turnsToWin`, and `victory`. A lethal blow **on the limit turn** also reports `victory`, not `turnLimit`.
4. On a synthetic slice, `cardPlayed{drive}` followed by `damage`, `wallCollision`, `damage` attributes both amounts to Drive. A lethal overkill case records raw damage exceeding the health lost.
5. On a hand-crafted availability list: a Volley entry with `NEEDS_NEAR_OR_FAR` counts one `range`; an Arc Bolt entry with `NEEDS_MANA` counts one `mana`; a treasure entry with `TREASURE_AUTOPLAYS` is excluded entirely; an unrelated disabled action counts in `total` only. A legal Volley with `aimed` false counts one `setup`.
6. `swapSides` puts ochre at 3 and indigo at 2, and `rangeBand` is still `Near`. `assertInvariants` still passes.
7. Swapping `firstPlayerId` changes which player acts on turn 1 and leaves both deck shuffles byte-identical for a fixed seed. The test agent must not be able to branch on `selectedFirstPlayerId`, which `chooseStartingBuild` can see, or the check proves nothing.
8. An agent that always buys Copper terminates with `actionCap` rather than hanging. Give the test a timeout so a regression fails instead of blocking the suite.
9. An agent that throws `ActionSearchOverflowError` mid-match yields `aborted` / `actionSearchOverflow` with the telemetry gathered so far preserved.
10. A buy phase with one purchase records `moneySpent === cost` and `unspentMoney === money into the phase − cost`; with no purchases, `moneySpent === 0`. Turn 1 includes `firstBuyMoney`.
11. `runMatch` rejects an agent that returns an action it was not offered, with a message naming the agent.
12. `assertInvariants` passes after every applied action across one full match, in a test rather than in the hot path.

## Completion criterion

`runMatch` plays complete deterministic games with the telemetry above, the checks pass, and the four verification commands pass.

## Note for step 8

`applyAction` `structuredClone`s the whole state, including the ever-growing `events` array, on every action (`src/game/engine.ts:292`). Over a 200-turn match that is already the quadratic term. The event-slice accumulator avoids a *second* quadratic factor; it does not make long matches cheap. Do not fix the cloning here — that is step 8.
