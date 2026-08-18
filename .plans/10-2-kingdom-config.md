# Step 2: kingdoms, starting health, and card overrides

Implements step 2 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 1, [10-1-card-batch.md](./10-1-card-batch.md).

## Objective

A kingdom is an explicit input to a game. It sets the market piles, the starting health, and per-experiment numeric card overrides. Nothing in the game module hard-codes 20 health or the eight-pile duel market.

## Scope

In scope: `src/game/`, `src/game-data/`, and tests. Out of scope: `src/client/` and `src/server/`. The browser game keeps its current behaviour by using a kingdom that reproduces today's market and 20 health.

## Interface

```ts
export interface CardOverride { cost?: number; values?: Record<string, number> }
export interface Kingdom {
  id: string;
  name: string;
  startingHealth: number;
  actionPiles: { cardId: string; count: number }[];
  overrides?: Record<string, CardOverride>;
}
export function createGame(config: { seed: number; firstPlayerId?: PlayerId; kingdomId?: string }): GameState;
export function registerKingdom(kingdom: Kingdom): void;
export function kingdomOf(id: string): Kingdom;
export function resolveCard(state: GameState, definitionId: string): CardDefinition;
```

`GameState` gains `kingdomId: string` and `startingHealth: number`. It does **not** hold the resolved card library.

### Why a registry instead of the kingdom in state

The action search in step 4 clones states heavily, and step 8 exists to remove avoidable cloning. Putting a resolved 26-card library, or even a full kingdom, inside `GameState` makes every `structuredClone` copy it. Holding `kingdomId` keeps the clone small, and the module-level registry resolves the definition.

`resolveCard` memoises the merged definition for each `(kingdomId, definitionId)` pair, so an override costs one map lookup on the hot path.

Determinism is preserved because a kingdom id always maps to the same data within a run, and the experiment output records the complete resolved kingdom next to its results. The registry rejects a second registration of the same id with different content, so a run cannot silently change a kingdom's meaning.

The alternative, threading a `Kingdom` argument through every engine function, is honest but changes every engine signature and every call site in the client and server, which the scope forbids.

### Always-available cards

Cull, Copper, Silver, and Gold are available in every kingdom and are not listed in `actionPiles`. Cull gets a pile of ten in every kingdom. Treasures have no pile.

This resolves an ambiguity in the design document. It says kingdom 1 has eight market piles and lists eight cards that do not include Cull, and it separately says Cull is available in every kingdom. Reading Cull as an always-available row keeps both statements true and keeps kingdom 1's own list at eight. Mark this as provisional and record it in `PROGRESS.md`.

`buyActions` therefore offers: every kingdom action pile with a count above zero, Cull while its pile lasts, and the three treasures without limit. Replace `MARKET_CARD_IDS`, which is `Object.keys(CARDS)` today and would offer every implemented card.

## Health

`createGame` sets both fighters' health from `kingdom.startingHealth`. `checkInvariants` uses `state.startingHealth` as the health upper limit, replacing the literal 20 at `src/game/invariants.ts:9`.

## Overrides

An override patches `cost` and individual `values` keys. It merges over the canonical definition and never changes `src/game-data/cards.json`. An override for an unknown card id, or for a `values` key the mechanic does not read, is an error at registration, not a silent no-op.

Every place that reads a card number must go through `resolveCard`, including the starting-build budget check in `submitBuild`, `finishSetup`, `buyActions`, and every effect in `src/game/effects.ts`. A missed call site would give an override no effect, which would silently invalidate the rigged-melee calibration, so the review must check this specifically.

## Files expected to change

| File | Change |
| --- | --- |
| `src/game/kingdom.ts` | New. `Kingdom`, the registry, `resolveCard`, and the memo. |
| `src/game-data/kingdoms.json` | New. The duel kingdom that reproduces today's browser market and 20 health. The five curated kingdoms arrive in step 5. |
| `src/game/schema.ts` | Kingdom schema. Replace `marketSchema`'s fixed length of 8. |
| `src/game/types.ts` | `kingdomId` and `startingHealth` on `GameState`. |
| `src/game/state.ts` | Build supply, health, and `kingdomId` from the kingdom. |
| `src/game/engine.ts` | `resolveCard` at every value read. Kingdom-aware `buyActions`. |
| `src/game/invariants.ts` | Configured health limit. Supply counts checked against the kingdom's declared pile size. |
| `src/game/index.ts` | Export the new interface. |
| `test/kingdom.test.ts` | New. |

`src/game/config.ts` keeps `FIRST_MARKET` only if the client or server still imports it; otherwise remove it rather than leave a compatibility shim.

## Checks

1. `createGame` with a 30-health kingdom starts both fighters at 30, and `assertInvariants` accepts 30 and rejects 31.
2. `createGame` with the default duel kingdom reproduces today's supply exactly, and the existing suite passes unchanged apart from the step 1 value corrections.
3. A kingdom with ten action piles produces ten piles plus Cull, and `buyActions` offers exactly those piles, Cull, and three treasures, and nothing else.
4. An override of Heavy Blow to cost 3 and damage 6 changes the buy cost, the starting-build budget arithmetic, and the damage dealt, while the canonical definition stays at cost 5 and damage 4.
5. Registering the same kingdom id twice with different content throws.
6. An override naming an unknown card, or an unknown `values` key, throws at registration.
7. Two games created from the same seed, kingdom, and first player produce identical states after the same commands.

## Completion criterion

Kingdoms, starting health, and overrides are explicit inputs, no literal 20 health remains in `src/game/`, the checks above pass, and the four verification commands pass.
