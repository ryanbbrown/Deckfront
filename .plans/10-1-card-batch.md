# Step 1: card batch

Implements step 1 of [10-automated-balance-search.md](./10-automated-balance-search.md). Card costs, rules, and values are authoritative in [09-card-list.md](./09-card-list.md).

## Objective

The game module contains every card in the first implementation batch, with the authoritative values, and has test coverage for each card's behavior.

## Scope

In scope: `src/game/` and `src/game-data/`, plus tests in `test/`.

Out of scope: `src/client/`, `src/server/`, Playwright tests, and the e2e coverage manifest. New cards are not added to the browser market, so the browser game keeps its current eight action piles.

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
| Flurry | Counts other **Tactical Actions** played this turn, to a maximum of 5. It currently counts every card played this turn. |

Feint keeps its current rule.

## Tactical Actions

A Tactical Action moves a fighter, changes a fighter condition, or deals damage. The set is: Footwork, Feint, Drive, Flurry, Aim, Volley, Heavy Blow, Quick Shot, Steady Shot, Ley Step, Arc Bolt, Fireball, Starfire, Step, Strike, and Shot.

Cull, Muster, Stipend, Reclaim, Adapt, Channel, and Prism are not Tactical Actions. An earlier Flurry counts for a later Flurry. The resolving Flurry does not count itself.

Encode this as one exported set in the game module. Derive it from the card definition, not from a list of literals repeated in the engine.

## Interface changes

### Card definitions

`CardDefinition` gains a required `values: Readonly<Record<string, number>>` field that holds every number the mechanic reads. Step 2 overrides cards by patching `cost` and `values`, so no mechanic may read a number from a literal in the engine.

Keep the existing optional `money` field. `src/client/Game.tsx` reads `card.money`, and that file is out of scope. Treasures therefore keep `money` and do not need `values`.

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
| `step` | (none) |
| `cull`, `money` | (none) |

### Mechanics

Add these `CardMechanic` values: `stipend`, `reclaim`, `adapt`, `melee`, `ranged`, `spell`, `channel`, `leyStep`, `prism`, `step`.

Heavy Blow and Strike share the `melee` mechanic. Quick Shot, Steady Shot, and Shot share `ranged`. Arc Bolt, Fireball, and Starfire share `spell`. They differ only in their values, so one mechanic each keeps the engine flat and makes step 2 overrides uniform.

### State

`PlayerState` gains:

- `mana: number` — mana held during the current Action phase.
- `positionChanged: boolean` — true when this player's own fighter changed position during this player's own turn.

`GameState` gains:

- `pendingChoice: { type: 'discard'; playerId: PlayerId } | null` — set while Prism waits for its discard.

`GameState.actionsThisTurn` keeps type `string[]` but holds **definition ids** instead of card instance ids. Flurry needs the definition to count Tactical Actions, and a played card's instance id no longer identifies its definition after it leaves the hand. `src/server/schemas.ts` already types this field as `z.array(z.string())`, and `test/server-distance-duel.test.ts` already seeds it with definition ids, so the field's shape does not change.

Keep `schemaVersion: 8`. The three new fields are additive, no new card reaches the browser market, and `src/server/schemas.ts` is out of scope. Record this as a provisional decision: the server's non-strict `gameStateSchema` silently drops `mana`, `positionChanged`, and `pendingChoice` when it reloads a saved browser game, which is harmless while no browser card uses them.

### Commands

Keep every existing command exactly as it is, so the client and server contracts do not change. Add four:

- `{ type: 'playAction'; cardInstanceId }` — every new card with no choice: Stipend, Adapt, Heavy Blow, Quick Shot, Steady Shot, Strike, Shot, Channel, Arc Bolt, Fireball, Starfire.
- `{ type: 'playMoveAction'; cardInstanceId; direction: DirectionChoice }` — Ley Step and Step. Both must move, so the choice has no `stay`.
- `{ type: 'playReclaim'; cardInstanceId; recoverInstanceId: string | null }` — the recovered card is chosen from the discard pile, which is known before the card resolves. `null` means recover nothing.
- `{ type: 'resolveDiscard'; cardInstanceId }` — resolves `pendingChoice`.

Prism draws before it discards, so the discardable set includes the drawn card and is not knowable when Prism is enumerated. Prism therefore resolves through `pendingChoice`: `playAction` on Prism gains mana, draws, and sets `pendingChoice`; `listLegalActions` then returns only `resolveDiscard` actions until the choice resolves. This keeps hidden information hidden. The alternative, enumerating the post-draw discard choices inside `listLegalActions`, would leak the next drawn card into the action list.

If the hand is empty after Prism's draw, resolve the pending choice immediately and set it to `null`, so no state can deadlock.

### Availability

Add `DisabledReasonCode` values `NEEDS_MANA` and `RESOLVE_CHOICE_FIRST`, with reason text. `src/client/Game.tsx` renders `reason` as free text and does not switch on the code, so this stays inside the game module.

Range gates: `melee` needs Close. `ranged` needs Near or Far. `spell` has no range gate and needs mana at least `values.manaCost`. `step` and `leyStep` need at least one legal destination inside the arena.

## Engine structure

Replace the growing `switch` in `playCard` with one effect table in a new file `src/game/effects.ts`:

```ts
interface CardEffect {
  tactical: boolean;
  gate(state: GameState, playerId: PlayerId, values: Values): DisabledReasonCode | null;
  choice: 'none' | 'movement' | 'direction' | 'trashOneOrTwo' | 'reclaim';
  resolve(context: EffectContext, values: Values, choice: Choice): void;
}
export const EFFECTS: Readonly<Record<CardMechanic, CardEffect>>;
```

`listLegalActions` and `cardAvailability` read the table instead of listing mechanics inline. This keeps `engine.ts` from growing one case for each of fifteen new cards and gives the step 4 action search one place to read a card's shape.

Keep the existing commands' resolution behavior byte-for-byte, apart from the three corrected values above.

## Rules detail

- **Mana** resets to 0 when the Action phase ends, for the player who ended it. A spell that cannot pay its mana cost is not a legal action.
- **`positionChanged`** becomes true when the acting player's own fighter position changes during that player's own turn. Footwork with `stay`, and a Drive that hits a wall, do not set it. A Drive that moves does set it, for the acting player only. It resets at the start of each player's own turn, next to the existing `actionsThisTurn` reset.
- **Adapt** draws `values.draw`, then draws `values.movedDraw` more when `positionChanged` is true.
- **Reclaim** draws first, then puts the chosen discard-pile card on top of the draw pile. The chosen card must be in the discard pile when the command resolves. Enumerate one action for each distinct card instance in the discard pile, plus one action that recovers nothing.
- **Quick Shot** deals damage, then draws. Skip the draw when the damage ends the game, matching Drive's existing behavior of stopping after a win.
- **Spells** spend mana before dealing damage, and deal damage at any range. Spell damage is not Close damage, so it does not consume Exposed. Match Volley, which passes `closeDamage: false`.
- **Melee** damage is Close damage and consumes Exposed. Ranged damage is not.
- **Flurry** counts entries in `actionsThisTurn` whose definition is a Tactical Action, excluding the resolving Flurry, multiplied by `values.perAction`, capped at `values.max`.

## Files expected to change

| File | Change |
| --- | --- |
| `src/game-data/cards.json` | Fifteen new cards. `values` on every card. Footwork cost 3. Volley values 2/4/5/6. |
| `src/game/schema.ts` | `values` field, new mechanic enum values, per-mechanic required value keys. |
| `src/game/types.ts` | New mechanics, commands, reason codes, `values`, `mana`, `positionChanged`, `pendingChoice`. |
| `src/game/effects.ts` | New. The effect table and the Tactical Action set. |
| `src/game/engine.ts` | Read the effect table. Pending choice. Flurry counting. Mana reset. `positionChanged`. |
| `src/game/state.ts` | Initialise `mana`, `positionChanged`, `pendingChoice`. |
| `src/game/invariants.ts` | Mana is not negative. `pendingChoice` only in the Action phase and only for the active player. |
| `src/game/index.ts` | Export the Tactical Action set and the effect table. |
| `test/distance-duel.test.ts` | Update Footwork cost and Volley damage expectations. |
| `test/cards.test.ts` | New. Behaviour tests for every new card. |

## Known consequences to accept

- `test/distance-duel.test.ts:32` and `:39` assert `firstBuyMoney` for builds containing Footwork. Footwork's cost change from 2 to 3 changes those numbers. Update them to the values the authoritative cost produces.
- `test/distance-duel.test.ts:141` asserts Volley 2/5/5/7. Update it to 2/4/5/6.
- `src/ai/briefing.ts` sends `Object.values(CARDS)` as the market, so the browser AI briefing would list all twenty-six cards with an undefined count for cards outside the supply. This is server code and out of scope. Flag it in the handoff, and do not change it in this step. Step 2 introduces the kingdom that the briefing would need.

## Checks

Card behaviour tests, with independently derived expected values:

1. Stipend draws 1 and adds 1 money at the end of the Action phase.
2. Reclaim draws 1, then places a named discard-pile card on top of the draw pile, and the next draw takes exactly that card. Recovering nothing leaves the discard pile unchanged.
3. Adapt draws 1 after no movement, and 2 after Footwork moved left. Footwork with `stay` gives 1. A Drive that hits a wall gives 1. A Drive that moves gives 2.
4. Heavy Blow deals 4 at Close, 6 into Exposed, and is not legal at Near or Far.
5. Quick Shot deals 1 and draws 1 at Near and at Far, and is not legal at Close.
6. Steady Shot deals 3 at Near and Far, and is not legal at Close.
7. Channel gains 1 mana and draws 1. Mana is 0 again after the Action phase ends.
8. Ley Step moves exactly 1 space and gains 1 mana, and offers no move into a wall.
9. Prism gains 2 mana, draws 1, sets `pendingChoice`, allows only `resolveDiscard`, and moves exactly the chosen card to the discard pile.
10. Arc Bolt with 1 mana deals 3 at Close, Near, and Far, and leaves 0 mana. With 0 mana it is not legal, with reason code `NEEDS_MANA`.
11. Fireball needs 2 mana and deals 5. Starfire needs 3 mana and deals 8.
12. A spell does not consume Exposed.
13. Step moves exactly 1 space and draws nothing. Strike deals 2 at Close only. Shot deals 2 at Near or Far only.
14. Flurry after Channel, Muster, and Aim deals 1, because only Aim is Tactical. Flurry after six Tactical Actions deals 5, the cap.
15. Volley deals 2 at Near, 4 at Far, 5 at Near when Aimed, and 6 at Far when Aimed.
16. Footwork costs 3, and a starting build of Footwork, Aim, and Volley leaves 1 money.
17. Every new card passes `assertInvariants` after it resolves.
18. `applyCommand` and `replayCommands` produce identical states for one command of each new command type.

## Completion criterion

Every card in the batch exists with its authoritative values, the three corrections are applied, the checks above pass, and `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
