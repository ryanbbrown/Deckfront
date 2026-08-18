# Step 2: kingdoms, starting health, and card overrides

Implements step 2 of [10-automated-balance-search.md](./10-automated-balance-search.md). It depends on step 1, [10-1-card-batch.md](./10-1-card-batch.md).

Revised after plan review v1. The decisions are recorded in `.reviews/plans/balance-search-kingdom-config/balance-search-kingdom-config-synthesis-v1.md`.

## Objective

A kingdom is an explicit input to a game. It sets the market piles, the starting health, and per-experiment numeric card overrides. Nothing in the game module hard-codes 20 health or the eight-pile duel market.

## Scope

In scope: `src/game/`, `src/game-data/`, and tests other than `test/e2e/`.

Scope exception, carried from step 1: `src/server/gameService.ts` (the card view at line 188 and the `marketCost` call at line 37) and `src/ai/briefing.ts` (lines 11 and 22) must send the kingdom's cards instead of all of `CARDS`. Without this the browser shows every implemented card in the market and the starting-build picker. Make no other client or server change.

## Interface

```ts
export interface CardOverride {
  cost?: number;
  money?: number;
  values?: Readonly<Record<string, number>>;
}
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
export function kingdomMarket(kingdomId: string): CardDefinition[];
export function resetKingdoms(): void;
```

`GameState` gains `kingdomId: string` and `startingHealth: number`. It does **not** hold the resolved card library.

`kingdomMarket` returns the cards a kingdom offers: its piles, Cull, and the three treasures, all resolved. `src/server/gameService.ts` and `src/ai/briefing.ts` use it.

### Why a registry instead of the kingdom in state

The action search in step 4 clones states heavily, and step 8 exists to remove avoidable cloning. Putting a resolved 26-card library, or even a full kingdom, inside `GameState` makes every `structuredClone` copy it. Holding `kingdomId` keeps the clone small.

`resolveCard` memoises the merged definition for each `(kingdomId, definitionId)` pair, so an override costs one map lookup on the hot path.

The alternative, threading a `Kingdom` argument through every engine function, changes every engine signature and every client and server call site, which the scope forbids.

### Registry semantics

- `src/game-data/kingdoms.json` is registered eagerly when `src/game/kingdom.ts` loads.
- The default `kingdomId` is `distance-duel`.
- `kingdomOf` throws `Unknown kingdom: <id>` for an unknown id.
- `registerKingdom` deep-freezes what it stores. `kingdomOf` and `resolveCard` return frozen data, so a caller cannot change a kingdom's meaning after registration or make the memo stale.
- Registering an id twice with different content throws. Content is compared by canonical JSON with `actionPiles` sorted by `cardId`, so pile order does not matter.
- `resetKingdoms()` restores the built-in set. Tests use it; nothing else does.

### Always-available cards

Cull, Copper, Silver, and Gold are available in every kingdom and are **never** listed in `actionPiles`. Cull gets a pile of ten in every kingdom. Treasures have no pile.

This resolves an ambiguity in the design document, which says kingdom 1 has eight market piles, lists eight cards that do not include Cull, and separately says Cull is available in every kingdom. Mark this as provisional and record it in `PROGRESS.md`.

`buyActions` offers: every kingdom action pile with a count above zero, Cull while its pile lasts, and the three treasures without limit, plus the existing "End Buy phase" action. Delete `MARKET_CARD_IDS`, which is `Object.keys(CARDS)` today and would offer every implemented card.

### Two duel kingdoms

Today's market is `src/game-data/first-market.json`: Footwork, **Cull**, Muster, Feint, Drive, Flurry, Aim, Volley. The design document's kingdom 1 "Current duel" swaps Cull for **Adapt**. They are different kingdoms and need different ids.

| Id | Purpose | Listed piles | Supply keys |
| --- | --- | --- | --- |
| `distance-duel` | The browser default. Reproduces today's supply exactly. | Footwork, Muster, Feint, Drive, Flurry, Aim, Volley | Those 7 plus Cull = 8 |
| `current-duel` | Experiment kingdom 1. Added in step 5, not here. | The 7 above plus Adapt | Those 8 plus Cull = 9 |

## Health

`createGame` sets both fighters' health from `kingdom.startingHealth`. `checkInvariants` uses `state.startingHealth` as the health upper limit, replacing the literal 20 at `src/game/invariants.ts:9`.

## Overrides

An override patches `cost`, `money`, and individual `values` keys. It merges over the canonical definition and never changes `src/game-data/cards.json`.

Every place that reads a card number must go through `resolveCard`. The complete list:

- `submitBuild` and `finishSetup`;
- `buyActions`;
- `marketCost`, whose signature becomes `marketCost(state, definitionIds)` in step 1;
- the treasure money read at `src/game/engine.ts:213`;
- the Feint bonus read inside `dealDamage`;
- every effect in `src/game/effects.ts`.

A missed call site would give an override no effect and silently invalidate the rigged-melee calibration, so check 10 exists to catch one mechanically.

## Validation

Zod rejects: a non-positive or fractional `count`, a `startingHealth` that is not a positive integer, an empty `actionPiles`, and a malformed override.

`registerKingdom` rejects: an unknown card id in a pile or an override; a duplicate `cardId` in `actionPiles`; a treasure or Cull listed in `actionPiles`; a pile card that is not `type: 'action'`; an override key that is not `cost`, `money`, or a declared `values` key for that card's mechanic; and a non-finite override number.

The declared-key map comes from `src/game/values.ts`, added in step 1. Do not restate the keys here.

## Invariants

- The health limit is `state.startingHealth`.
- Supply keys equal the kingdom's pile ids plus Cull. A missing or extra key is an error.
- Each count is checked against that pile's declared count, replacing the blanket `count > 10` at `src/game/invariants.ts:17`. Cull's declared count is 10, from the always-available rule rather than from `actionPiles`.
- `state.startingHealth` matches the registered kingdom.

## Starting builds are limited to the kingdom

Today `submitBuild` accepts any card in `CARDS` (`src/game/engine.ts:194-203`). With twenty-six cards implemented, that would let a player build a card the kingdom does not sell. A starting build may contain only the kingdom's piles, Cull, and the three treasures. Step 4's strategy search uses the same rule. Record this as provisional in `PROGRESS.md`.

## Removals

`FIRST_MARKET`, `src/game-data/first-market.json`, `marketSchema`, and `MARKET_CARD_IDS` all go. `first-market.json` becomes the `distance-duel` entry in `kingdoms.json`. Confirmed importers: `src/game/config.ts:7`, `src/game/state.ts:1,22`, `src/game/index.ts:1`, `src/game/engine.ts:1,88`, and `test/distance-duel.test.ts:3,49`. No client or server file imports them. The project rule is to remove obsolete paths rather than keep a shim.

`createGame` loses its bare-number form. `test/distance-duel.test.ts:43-46,50` calls `createGame(2)`; those move to object configuration.

## Files expected to change

| File | Change |
| --- | --- |
| `src/game/kingdom.ts` | New. `Kingdom`, the registry, `resolveCard`, `kingdomMarket`, `resetKingdoms`, and the memo. |
| `src/game-data/kingdoms.json` | New. `distance-duel` only; step 5 adds the rest. |
| `src/game-data/first-market.json` | Deleted. |
| `src/game/config.ts` | Remove `FIRST_MARKET` and `MARKET_CARD_IDS` and their parse. |
| `src/game/schema.ts` | Kingdom schema. Delete `marketSchema`. |
| `src/game/types.ts` | `kingdomId` and `startingHealth` on `GameState`. |
| `src/game/state.ts` | Supply, health, and `kingdomId` from the kingdom. Drop the number form of `createGame`. |
| `src/game/engine.ts` | `resolveCard` at every value read. Kingdom-aware `buyActions` and `submitBuild`. |
| `src/game/invariants.ts` | Configured health limit. Per-pile supply counts. Cull as an implicit pile. |
| `src/game/index.ts` | Export the new interface; drop `FIRST_MARKET`. |
| `src/server/gameService.ts` | Scope exception: `kingdomMarket` at line 188, `marketCost` signature at line 37. |
| `src/ai/briefing.ts` | Scope exception: `kingdomMarket` at lines 11 and 22. |
| `test/distance-duel.test.ts` | `createGame(2)` call sites and the `FIRST_MARKET` assertion at `:49`. |
| `test/kingdom.test.ts` | New. |

## Checks

1. `createGame` with a 30-health kingdom starts both fighters at 30, and `assertInvariants` accepts 30 and rejects 31.
2. `createGame` with no `kingdomId` uses `distance-duel` and reproduces today's supply exactly: Footwork, Muster, Feint, Drive, Flurry, Aim, Volley, and Cull, each at 10. `test/distance-duel.test.ts:34,40` still assert health 20 and must pass unchanged.
3. A kingdom with ten action piles produces ten piles plus Cull. With enough money for the whole market — Gold and Starfire both cost 6 — `buyActions` offers exactly those piles, Cull, the three treasures, and "End Buy phase", and nothing else.
4. Buying a pile down to zero removes it from the buy list. The same holds for Cull.
5. An override of Heavy Blow to cost 3 and damage 6 changes the buy cost, the starting-build budget arithmetic, and the damage dealt, while the canonical definition stays at cost 5 and damage 4.
6. An override of Silver's `money` changes the money the Buy phase sees. This is what catches an unrouted `src/game/engine.ts:213`.
7. Registering the same kingdom id twice with different content throws. Registering it twice with the same content, in a different pile order, does not.
8. Mutating the object passed to `registerKingdom`, and mutating the object `kingdomOf` returns, changes no registered behaviour.
9. Registration rejects each case in the validation list: unknown card, duplicate pile, treasure or Cull in `actionPiles`, non-action pile card, unknown override key, non-finite override, `count` of 0 or above the pile size, and `startingHealth` of 0.
10. **Override coverage.** Register a kingdom that overrides `cost`, `money`, and every declared `values` key of every card to a distinctive number, then assert per mechanic that the observed behaviour changed. This is the only check that reliably catches a missed `resolveCard` call site.
11. A starting build containing a card the kingdom does not sell is rejected.
12. A kingdom whose `actionPiles` omit Cull still has Cull at 10 in the supply, and `assertInvariants` accepts it.
13. A supply with a missing or extra key fails `checkInvariants`.
14. `kingdomOf` throws for an unknown id, and `createGame` with an unknown `kingdomId` throws.
15. Create a game through `GameService`, save it, load it, and take one action. `kingdomId`, `startingHealth`, replay, and invariants all survive.
16. Two games created from the same seed, kingdom, and first player produce identical states after the same commands.
17. `grep -rn "createGame(" test/ src/` finds no bare-number call. `grep -rn "FIRST_MARKET\|MARKET_CARD_IDS\|marketSchema"` finds nothing. No health literal of 20 remains in `src/game/`.

## Completion criterion

Kingdoms, starting health, and overrides are explicit inputs, no literal 20 health remains in `src/game/`, the seventeen checks pass, and `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
