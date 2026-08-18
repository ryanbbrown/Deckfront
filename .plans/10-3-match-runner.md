# Step 3: deterministic match runner and telemetry

Implements step 3 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on steps 1 and 2.

## Objective

A headless match runner plays one complete game between two agents without the browser and without generative AI. The same inputs always produce the same result. It reports telemetry that the balance report needs.

## Scope

New code lives in `src/sim/`. It imports from `src/game/` only. It must not import from `src/client/` or `src/server/`. Add a lint rule or a test that proves this, because a later step could break it silently.

## Interface

```ts
export interface Agent {
  readonly id: string;
  chooseStartingBuild(state: GameState, playerId: PlayerId): string[];
  chooseAction(state: GameState, playerId: PlayerId, actions: readonly LegalAction[]): LegalAction;
}

export interface MatchConfig {
  kingdomId: string;
  seed: number;
  firstPlayerId: PlayerId;
  mirrored: boolean;        // swaps the arena side
  turnLimitPerPlayer: number;   // 100 in the approved limits
  agents: Record<PlayerId, Agent>;
}

export interface MatchResult {
  config: Omit<MatchConfig, 'agents'> & { agentIds: Record<PlayerId, string> };
  outcome: 'ochre' | 'indigo' | 'draw';
  reason: 'victory' | 'turnLimit' | 'actionSearchOverflow';
  turns: number;
  telemetry: MatchTelemetry;
}

export function runMatch(config: MatchConfig): MatchResult;
```

An agent is a plain interface so step 4 can supply the strategy-driven agent and the fixed baselines, and so tests can supply a trivial agent.

### Arena side

`mirrored` reflects both starting positions about the centre space, so ochre starts at 4 and indigo at 3 instead of ochre at 2 and indigo at 3. `createGame` gains a `mirrored` option to support this. Nothing else in the game module changes.

## Telemetry

```ts
export interface MatchTelemetry {
  turnsToWin: number | null;
  damageByCard: Record<string, number>;      // definition id -> total damage dealt
  playsByCard: Record<PlayerId, Record<string, number>>;
  purchasesByCard: Record<PlayerId, Record<string, number>>;
  startingBuild: Record<PlayerId, string[]>;
  deadDraws: Record<PlayerId, { range: number; mana: number; total: number }>;
  moneySpent: Record<PlayerId, number>;
  unspentMoney: Record<PlayerId, number>;
  finalHealth: Record<PlayerId, number>;
}
```

**Dead draws.** When a player ends the Action phase, count the action cards left in hand that were not legal to play. Attribute each to `range` when its reason code is `NEEDS_CLOSE` or `NEEDS_NEAR_OR_FAR`, and to `mana` when its reason code is `NEEDS_MANA`. Count every other unplayed action card in `total` only. This uses `listActionAvailability`, so the definition follows the engine rather than a second copy of the rules.

**Damage by card.** Read the `damage` events that follow each `cardPlayed` event. Attribute the damage to the definition id of the most recent `cardPlayed` event by that player. Drive's wall collision produces a second `damage` event for the same card, and both belong to Drive.

Accumulate telemetry from the event slice added by each applied action, not by scanning the whole event log each time. Scanning would be quadratic in the number of actions.

## Turn limit

`GameState.turn` counts each player's turn separately, so the limit is reached at `turnLimitPerPlayer * 2` turns. Record the result as a draw with reason `turnLimit`. Preserve the telemetry gathered so far.

## Determinism

The runner adds no randomness of its own. Every random result comes from `GameState.rngState`, which the seed fixes. An agent that needs randomness must take a seed derived from the match seed, not a global source.

Add a determinism check that runs the same match twice and compares the complete `MatchResult` by deep equality, and a second check that a different seed produces a different event count for at least one of several fixed seeds.

## Files expected to change

| File | Change |
| --- | --- |
| `src/sim/types.ts` | New. `Agent`, `MatchConfig`, `MatchResult`, `MatchTelemetry`. |
| `src/sim/match.ts` | New. `runMatch`. |
| `src/sim/telemetry.ts` | New. Event-slice accumulation. |
| `src/sim/agents/scripted.ts` | New. A test agent that follows a fixed preference list, used only by tests until step 4. |
| `src/game/state.ts` | `mirrored` option on `createGame`. |
| `test/sim/match.test.ts` | New. |

## Checks

1. Two runs of the same config produce deeply equal `MatchResult` values.
2. A match between two agents that immediately end both phases reaches the turn limit and reports `draw` with reason `turnLimit`, and the turn count equals `turnLimitPerPlayer * 2`.
3. A scripted lethal line reports the correct winner, `turnsToWin`, and reason `victory`.
4. `damageByCard` for a turn that plays Drive into a wall attributes both damage events to Drive, and the total matches the health lost.
5. `deadDraws` counts a Volley held at Close as one range dead draw, and an Arc Bolt held with no mana as one mana dead draw.
6. `mirrored` puts ochre at 4 and indigo at 3, and the initial range band is unchanged.
7. Swapping `firstPlayerId` changes which player acts on turn 1 and does not change the deck shuffles for a fixed seed.
8. A test proves `src/sim/` imports nothing from `src/client/` or `src/server/`.

## Completion criterion

`runMatch` plays complete deterministic games with the telemetry above, the checks pass, and the four verification commands pass.
