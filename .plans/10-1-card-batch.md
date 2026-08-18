# Step 1: card batch

Implements step 1 of [10-automated-balance-search.md](./10-automated-balance-search.md). Card costs, rules, and values are authoritative in [09-card-list.md](./09-card-list.md).

Revised after plan review v1. The decisions are recorded in `.reviews/plans/balance-search-card-batch/balance-search-card-batch-synthesis-v1.md`.

## Objective

The game module contains every card in the first implementation batch, with the authoritative values, and has test coverage for each card's behavior.

## Scope

In scope: `src/game/`, `src/game-data/`, and tests in `test/` other than `test/e2e/`.

**Scope exception.** `GOAL.md` puts client and server code out of scope. Three narrow edits are still required, because without them this step breaks the running browser game rather than only leaving it untested:

1. `src/server/schemas.ts`: add `mana`, `positionChanged`, and `pendingChoice` to `gameStateSchema`, and add the new command variants to `gameCommandSchema`. `gameStateSchema` is a non-strict `z.object`, so it strips unknown keys on load, and `src/server/persistence.ts:22` then runs `assertInvariants` on the stripped state.
2. `src/server/gameService.ts:188`: send the kingdom's cards instead of `structuredClone(CARDS)`. The market and the starting-build picker render every entry (`src/client/Game.tsx:114`, `src/client/App.tsx:98`), so all fifteen new cards would appear as tiles reading `undefined left`, and the picker would let a player build one.
3. `src/ai/briefing.ts:11,22`: send the kingdom's market instead of all of `CARDS`.

Edits 2 and 3 need the kingdom from step 2. Do them in step 2 if step 1 lands first; edit 1 belongs here. Make no other client or server change.

Out of scope: everything else in `src/client/` and `src/server/`, Playwright tests, and the e2e coverage manifest.

## Cards to add

| Id | Name | Cost | Rule |
| --- | --- | ---: | --- |
| `stipend` | Stipend | 3 | Draw 1 card. Provide 1 money. |
| `reclaim` | Reclaim | 3 | Draw 1 card. You may put one card from your discard pile on top of your deck. |
| `adapt` | Adapt | 4 | Draw 1 card. If your position changed during your turn, draw 1 more. |
| `heavyBlow` | Heavy Blow | 5 | At Close, deal 4 damage. |
| `quickShot` | Quick Shot | 3 | At Near or Far, deal 1 damage. Draw 1 card. |
| `steadyShot` | Steady Shot | 4 | At Near or Far, deal 3 damage. |
| `channel` | Channel | 3 | Gain 1 mana. Draw 1 card. |
| `leyStep` | Ley Step | 3 | Move 1 space Left or Right. Gain 1 mana. |
| `prism` | Prism | 5 | Gain 2 mana. Draw 1 card, then discard 1 card. |
| `arcBolt` | Arc Bolt | 3 | Spend 1 mana. Deal 3 damage at any range. |
| `fireball` | Fireball | 5 | Spend 2 mana. Deal 5 damage at any range. |
| `starfire` | Starfire | 6 | Spend 3 mana. Deal 8 damage at any range. |
| `step` | Step | 2 | Move 1 space Left or Right. |
| `strike` | Strike | 3 | At Close, deal 2 damage. |
| `shot` | Shot | 3 | At Near or Far, deal 2 damage. |

## Existing cards to correct

| Card | Change |
| --- | --- |
| Footwork | Cost 2 becomes cost 3. The move stays optional. |
| Volley | Damage becomes 2 at Near and 4 at Far. Aimed becomes 5 at Near and 6 at Far. The current values are 2/5 and 5/7. |
| Flurry | Gains a **Close** range gate, and counts other **Tactical Actions** played this turn, to a maximum of 5. It has no gate today and counts every card played. |

Feint keeps its current rule.

Every corrected card's `text` in `src/game-data/cards.json` must be rewritten to match. Volley still reads "5 damage at Far range. Aimed changes this to 5 or 7", and Flurry still reads "each other Action played this turn". The card face renders this text.

## Tactical Actions

A Tactical Action moves a fighter, changes a fighter condition, or deals damage. The set is: Footwork, Feint, Drive, Flurry, Aim, Volley, Heavy Blow, Quick Shot, Steady Shot, Ley Step, Arc Bolt, Fireball, Starfire, Step, Strike, and Shot.

Cull, Muster, Stipend, Reclaim, Adapt, Channel, and Prism are not Tactical Actions. An earlier Flurry counts for a later Flurry. The resolving Flurry does not count itself.

Derive the exported set from the effect table's `tactical` flag: every card whose mechanic's effect has `tactical: true`. Do not add a field to `CardDefinition` and do not repeat a list of literals in the engine.

## Interface changes

### Card definitions

`CardDefinition` gains `values`. Step 2 overrides cards by patching `cost`, `money`, and `values`, so no mechanic may read a number from a literal in the engine.

- `values: Readonly<Record<string, number>>` is **required** for `type: 'action'`. The `cull` and `step` mechanics carry `{}`.
- `values` is **absent** for `type: 'treasure'`. Treasures keep the existing top-level `money` field, which `src/client/Game.tsx:100` reads.

Value keys by mechanic:

| Mechanic | Keys |
| --- | --- |
| `footwork` | `draw` |
| `muster` | `draw` |
| `feint` | `bonus` |
| `drive` | `damage`, `wallDamage` |
| `flurry` | `perAction`, `max` |
| `aim` | `draw` |
| `volley` | `near`, `far`, `aimedNear`, `aimedFar` |
| `stipend` | `draw`, `money` |
| `reclaim` | `draw` |
| `adapt` | `draw`, `movedDraw` |
| `melee` | `damage` |
| `ranged` | `damage`, `draw` |
| `spell` | `damage`, `manaCost` |
| `channel` | `mana`, `draw` |
| `leyStep` | `mana` |
| `prism` | `mana`, `draw`, `discard` |
| `cull`, `step` | none |

This map lives in `src/game/values.ts`, a leaf module that imports nothing. `config.ts` imports `schema.ts`, and `effects.ts` imports `config.ts`, so putting the map in `effects.ts` and importing it from `schema.ts` would be a cycle. Step 2 reads the same map to reject unknown override keys, so it is the single source of truth.

### Mechanics

Add these `CardMechanic` values: `stipend`, `reclaim`, `adapt`, `melee`, `ranged`, `spell`, `channel`, `leyStep`, `prism`, `step`.

Heavy Blow and Strike share `melee`. Quick Shot, Steady Shot, and Shot share `ranged`. Arc Bolt, Fireball, and Starfire share `spell`. They differ only in their values.

### State

`PlayerState` gains:

- `mana: number` — mana held during the current Action phase.
- `positionChanged: boolean` — true when this player's own fighter changed position during this player's own turn.

`GameState` gains:

- `pendingChoice: { type: 'discard' | 'recover'; playerId: PlayerId } | null`.

`GameState.actionsThisTurn` keeps type `string[]` but holds **definition ids**. Flurry needs the definition to count Tactical Actions, and a played card's instance id no longer identifies its definition. Change the push at `src/game/engine.ts:137` from `card.id` to `card.definitionId`. `previousActions` is captured at line 135 before the push, so the Flurry filter must exclude the resolving Flurry explicitly.

`schemaVersion` stays 8. The new fields are added to `gameStateSchema` under the scope exception, so nothing is silently stripped.

### Commands

Keep every existing command exactly as it is. Add:

- `{ type: 'playAction'; cardInstanceId }` — Stipend, Reclaim, Adapt, Heavy Blow, Quick Shot, Steady Shot, Strike, Shot, Channel, Prism, Arc Bolt, Fireball, Starfire.
- `{ type: 'playMoveAction'; cardInstanceId; direction: DirectionChoice }` — Ley Step and Step. Both must move, so there is no `stay`.
- `{ type: 'resolveDiscard'; discardInstanceId }` — resolves a `discard` pending choice.
- `{ type: 'resolveRecover'; recoverInstanceId: string | null }` — resolves a `recover` pending choice. `null` recovers nothing.

**Dispatch on `command.type`.** `execute` currently routes with `if ('cardInstanceId' in command)` at `src/game/engine.ts:206`. A resolve command carrying `cardInstanceId` would be sent to `playCard`, which moves the card to `deck.play`, pushes to `actionsThisTurn`, and records `cardPlayed`, corrupting Flurry counts. The resolve commands therefore use distinct field names, **and** `execute` dispatches on `command.type`.

### Pending choices

Prism draws before it discards, and Reclaim draws before it recovers. In both cases the target set is not knowable when the card is enumerated, and Reclaim has a worse problem: `draw` moves the whole discard pile into the draw pile when the draw pile is empty (`src/game/engine.ts:114-117`), so a pre-chosen target can vanish and a legal action would throw.

Both therefore resolve through `pendingChoice`:

- Prism: `playAction` gains mana and draws, then sets `pendingChoice: { type: 'discard' }`.
- Reclaim: `playAction` draws, then sets `pendingChoice: { type: 'recover' }`.

While `pendingChoice` is set, `listLegalActions` returns **only** the matching resolve actions. `endActionPhase` and every card action are suppressed.

If the relevant zone is empty when the choice would be set — an empty hand after Prism's draw, an empty discard pile after Reclaim's draw — resolve immediately and leave `pendingChoice` at `null`, so no state can deadlock.

### Availability

Add `DisabledReasonCode` values `NEEDS_MANA` and `RESOLVE_CHOICE_FIRST`, with reason text. `src/client/Game.tsx` renders `reason` as free text and does not switch on the code.

`ActionAvailability.selection` becomes `'none' | 'movement' | 'direction' | 'trashOneOrTwo' | 'recover' | 'discard'`. `direction` is separate from `movement` because it has no `stay`. The addition is additive, so the client's existing branches keep working.

Range gates: `melee` and `flurry` need Close. `ranged` needs Near or Far. `spell` has no range gate and needs at least `values.manaCost` mana. `step` and `leyStep` need at least one legal destination inside the arena.

## Engine structure

Replace the growing `switch` in `playCard` with one effect table in a new file `src/game/effects.ts`:

```ts
interface CardEffect {
  tactical: boolean;
  gate(state: GameState, playerId: PlayerId, values: Values): DisabledReasonCode | null;
  choice: 'none' | 'movement' | 'direction' | 'trashOneOrTwo';
  resolve(context: EffectContext, values: Values, choice: Choice): void;
}
export const EFFECTS: Readonly<Record<CardMechanic, CardEffect>>;
```

`listLegalActions` and `cardAvailability` read the table instead of listing mechanics inline. Pending choices are resolved by the engine, not by the table, because they are a phase state rather than a card play.

Keep the existing commands' resolution behavior identical, apart from the three corrections above. The existing assertions for Feint, Drive, Aim, Volley, Cull, Footwork, and Muster are the regression net.

## Rules detail

- **Mana** is per player. It resets to 0 when the Action phase ends, for the player who ended it only. A spell that cannot pay its mana cost is not a legal action.
- **`positionChanged`** becomes true when the acting player's own fighter position changes during that player's own turn. Footwork with `stay`, and a Drive that hits a wall, do not set it. A Drive that moves sets it for the acting player only, never for the opponent it also moves. Reset it for the player **about to act**, after the `activePlayerId` switch at `src/game/engine.ts:228`, and in `finishSetup`. Resetting beside the `actionsThisTurn` clear at line 227 would clear the wrong player's flag.
- **Feint's bonus** must not stay a literal. It is applied as `amount += 2` inside `dealDamage` at `src/game/engine.ts:127`, not inside the Feint case. `dealDamage` reads the bonus from the resolved Feint definition at damage time. `FighterState.exposed` stays a boolean, so the client and the server schema are unchanged.
- **Adapt** draws `values.draw`, then draws `values.movedDraw` more when `positionChanged` is true.
- **Quick Shot** deals damage, then draws. Skip the draw when the damage ends the game, matching Drive.
- **Spells** spend mana before dealing damage, at any range. Spell damage is not Close damage, so it does not consume Exposed. Ranged damage does not either. Melee damage does.
- **Flurry** counts entries in `actionsThisTurn` whose definition is a Tactical Action, excluding the resolving Flurry, multiplied by `values.perAction`, capped at `values.max`.
- **Treasure money** is read at `src/game/engine.ts:213`. Step 2 routes it through `resolveCard` so an experiment can retune Silver.
- **`marketCost`** at `src/game/engine.ts:251` takes no state, so it cannot see an override. Its signature becomes `marketCost(state, definitionIds)`. `src/server/gameService.ts:37` is its only outside caller and is covered by the scope exception.

## Files expected to change

| File | Change |
| --- | --- |
| `src/game-data/cards.json` | Fifteen new cards. `values` on every action card. Footwork cost 3. Volley values 2/4/5/6. Corrected text for Footwork, Flurry, and Volley. |
| `src/game/values.ts` | New. The per-mechanic value-key map. Imports nothing. |
| `src/game/schema.ts` | `values` field, new mechanic enum values, per-mechanic key validation for action cards. |
| `src/game/types.ts` | New mechanics, commands, reason codes, `values`, `mana`, `positionChanged`, `pendingChoice`, extended `ActionAvailability.selection`. |
| `src/game/effects.ts` | New. The effect table. |
| `src/game/engine.ts` | Effect table. `execute` dispatches on type. Pending choices. Flurry gate and counting. Mana. `positionChanged`. Feint bonus in `dealDamage`. `marketCost` signature. Definition ids in `actionsThisTurn`. |
| `src/game/state.ts` | Initialise `mana`, `positionChanged`, `pendingChoice`. |
| `src/game/invariants.ts` | Mana is a non-negative integer. `pendingChoice` only in the Action phase, only for the active player. |
| `src/game/index.ts` | Export the Tactical Action set and the effect table. |
| `src/server/schemas.ts` | Scope exception: new state fields and command variants. |
| `test/distance-duel.test.ts` | Footwork cost, Volley damage, and both Flurry tests. |
| `test/server-distance-duel.test.ts` | The Flurry case at `:96` and `:110`. |
| `test/cards.test.ts` | New. Behaviour tests for every new card. |

## Known consequences to accept

Confirmed against the snapshot:

- `test/distance-duel.test.ts:32` asserts `firstBuyMoney` for a build containing Footwork. Cost 3 changes it. Line `:39` is **not** affected; it asserts serials and hands for builds with no Footwork.
- `test/distance-duel.test.ts:141` asserts Volley 2/5/5/7. It becomes 2/4/5/6.
- `test/distance-duel.test.ts:133-137` plays Flurry at Near and Far. With the Close gate it becomes an availability test asserting `NEEDS_CLOSE`.
- `test/distance-duel.test.ts:138-139` plays six Musters then Flurry and expects 5 damage. Muster is not Tactical, so rewrite it with Tactical Actions.
- `test/server-distance-duel.test.ts:96,110` seeds `actionsThisTurn = ['muster', 'muster']` and expects health 18. Both the Tactical rule and the Close gate break it. It runs in `npm test`. Seed Tactical definition ids and place the fighters at Close.

### Deferred: three stale e2e assertions

`GOAL.md` puts Playwright tests out of scope and forbids running them. Do not edit them. Record them so a later goal fixes them:

| Test | Line | Cause | Correct expectation |
| --- | --- | --- | --- |
| `DD-E2E-031` | `test/e2e/distance-duel.spec.ts:224` | Footwork costs 3, seeded money is 2 | Seed 3 money |
| `DD-E2E-009` | `:103` | Aimed Far Volley is 6, not 7 | 14 health |
| `DD-E2E-012` | `:121` | Far Volley is 4, not 5, so it no longer kills at 5 health | Seed 4 health |

## Checks

Card behaviour, with independently derived expected values:

1. Stipend draws 1 and adds 1 money at the end of the Action phase.
2. Reclaim draws 1, sets a `recover` pending choice, and the chosen card becomes the next card drawn. Recovering nothing leaves the discard pile unchanged.
3. Reclaim with an empty draw pile and a non-empty discard pile: the draw reshuffles, and the recover choice offers the discard pile as it is after the draw.
4. Reclaim with an empty discard pile after the draw resolves immediately and leaves `pendingChoice` at `null`.
5. Adapt draws 1 after no movement and 2 after Footwork moved left. Footwork with `stay` gives 1. A Drive that hits a wall gives 1. A Drive that moves gives 2. Moving away and back gives 2.
6. Drive moves both fighters, but the opponent's `positionChanged` stays false, and Adapt on their next turn draws 1.
7. `positionChanged` resets between a player's own turns: move on turn 1, then Adapt on that player's next turn draws 1.
8. Heavy Blow deals 4 at Close, 6 into Exposed, and is not legal at Near or Far.
9. Quick Shot deals 1 and draws 1 at Near and Far, is not legal at Close, and skips its draw when the damage wins the game.
10. Steady Shot deals 3 at Near and Far and is not legal at Close.
11. Channel gains 1 mana and draws 1. Mana is 0 after the Action phase ends. Channel gives the opponent no mana, and the reset touches only the player who ended the phase.
12. Ley Step moves exactly 1 space, gains 1 mana, and offers no move into a wall.
13. Prism gains 2 mana, draws 1, sets `pendingChoice`, and moves exactly the chosen card to the discard pile. With an empty hand after the draw it resolves immediately.
14. While `pendingChoice` is set, `listLegalActions` returns only the matching resolve actions, and `endActionPhase` is suppressed.
15. Arc Bolt with 1 mana deals 3 at Close, Near, and Far and leaves 0 mana. With 0 mana it is illegal with reason code `NEEDS_MANA`.
16. Fireball needs 2 mana and deals 5. Starfire needs 3 mana and deals 8.
17. A spell does not consume Exposed. A melee attack does.
18. Step moves exactly 1 space and draws nothing. Strike deals 2 at Close only. Shot deals 2 at Near or Far only.
19. Flurry is illegal at Near and Far with reason code `NEEDS_CLOSE`.
20. Flurry after Channel and Muster deals 0, because neither is Tactical. After Aim at Near then Footwork to Close it deals 2.
21. Flurry counts an earlier Flurry and does not count itself. Six Tactical Actions give 5, the cap.
22. Volley deals 2 at Near, 4 at Far, 5 at Near when Aimed, and 6 at Far when Aimed.
23. Footwork costs 3, and a starting build of Footwork, Aim, and Volley leaves 1 money.
24. Every new card passes `assertInvariants` after it resolves.
25. For one command of each new type, replaying from the initial state reaches a **fixed expected state** written independently in the test. Comparing `applyCommand` with `replayCommands` alone is not a check, because `replayCommands` calls `applyCommand`.

## Completion criterion

Every card in the batch exists with its authoritative values, the three corrections are applied, the twenty-five checks pass, and `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
