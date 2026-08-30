> Superseded by [the current card reference](../09-card-list.md). Do not use this archived plan for current card rules.

# 30 - Card List

## Mage

### Resource

- **Focus** (1) — Gain 1 mana.
- **Channel** (3) — Gain 1 mana. Draw 1 card.
- **Ley Step** (3) — Move 1 space. Gain 1 mana. Gain 1 additional mana if you are at Far range after moving.
- **Attune** (4) — Gain 1 mana. Draw 1 card. Gain 1 additional mana for each other copy of Attune you played this turn.
- **Prism** (5) — Gain 2 mana. Draw 1 card, then discard 1 card.

### Damage

- **Arc Bolt** (4) — Spend 1 mana. Deal 3 damage at any range.
- **Fireball** (5) — Spend 2 mana. Deal 7 damage at any range.
- **Starfire** (6) — Spend 3 mana. Deal 12 damage at any range.

### Combo

- **Discharge** (4) — Deal 2 damage at any range for each mana you have. Lose all mana.
- **Cascade** (5) — Spend 1 mana. Deal 3 damage at any range. Deal 2 additional damage for each other spell you played this turn.
- **Overload** (5) — Deal 2 damage at any range for each mana you spent this turn.

## Melee

### Setup

- **Feint** (5) — At Close range, draw 1 card. Each Close-range attack you make this turn deals 1 additional damage.

### Damage

- **Jab** (3) — At Close range, deal 1 damage. Draw 1 card.
- **Strike** (3) — At Close range, deal 2 damage.
- **Drive** (4) — At Close range, deal 2 damage. Then move both fighters 1 space so they remain Close. If a wall blocks the move, neither fighter moves and the attack deals 2 additional damage.
- **Heavy Blow** (5) — At Close range, deal 4 damage.

### Combo

- **Opening Strike** (3) — At Close range, deal 4 damage if this is the first card you played this turn. Otherwise deal 1 damage.
- **Rally** (4) — At Close range, deal 1 damage. Deal 1 additional damage for each other copy of Rally you played this turn.
- **Bull Rush** (4) — At Close range, discard 1 Melee card: deal 5 damage.
- **Flurry** (5) — At Close range, deal 1 damage for each other Tactical Action played this turn.

## Ranged

### Setup

- **Aim** (5) — At Near or Far range, draw 1 card. Add 2 damage to the next ranged attack you make this turn.

### Damage

- **Peppering Shot** (3) — At Near or Far range, deal 1 damage. Draw 1 card.
- **Steady Shot** (3) — At Near or Far range, deal 2 damage.
- **Repelling Shot** (3) — At Far range, deal 2 damage. At Near range, deal 1 damage. Move the opponent 1 space farther away. If they cannot move, move yourself 1 space farther away instead.
- **Longshot** (4) — At Near or Far range, deal damage equal to the number of spaces between you and your opponent, plus 1.
- **Volley** (5) — At Near range, deal 1 damage. At Far range, deal 4 damage.

### Combo

- **Salvage Shot** (4) — At Near or Far range, discard 1 Ranged card: deal damage equal to its cost. Draw 1 card.
- **Precision Shot** (5) — At Near or Far range, deal 4 damage. Each other copy of Precision Shot you play this turn deals 2 damage instead.

## Neutral

### Movement

- **Step** (2) — Move 1 space.
- **Footwork** (3) — You may move 1 space. Draw 1 card.

### Draw and filter

- **Stipend** (3) — Draw 1 card. Provide 1 money.
- **Reclaim** (3) — Put 1 card from your discard pile into your hand. If your discard pile is empty, draw 1 card.
- **Regroup** (3) — Draw 2 cards. Discard 1 card.
- **Adapt** (4) — Draw 1 card. If your position changed this turn, draw 1 more.
- **Muster** (5) — Draw 2 cards.
- **Regiment** (7) — Draw 3 cards.

### Trashing

- **Discipline** (2) — Trash 1 card from your hand. Deal 1 damage at any range.
- **Cull** (3) — Trash 1 or 2 cards from your hand.
- **Sharpen** (3) — Draw 1 card. You may trash 1 card from your hand.
- **Reforge** (4) — Trash 1 card from your hand. Gain a card costing up to 3 more than it.
- **Scour** (5) — Trash up to 2 cards from your hand. Draw 1 card for each card trashed.

### Combo

- **Improvise** (5) — Deal 2 damage at any range for each different card family you played this turn.

## Starting deck

The draft is a configurable mode.

- Draft off: 7 Copper and 3 Scrap. No starting build phase. Scrap is not sold in the market.
- Draft on: current rules. 7 Copper and a starting build bought with 12 money. No Scrap.

- **Scrap** (0) — Deal 1 damage at any range.

## Treasure

- **Copper** (0) — Provide 1 money.
- **Silver** (3) — Provide 2 money.
- **Gold** (6) — Provide 3 money.

## Rules notes

- Step and Focus remain available in every kingdom. Cull does not; it becomes a normal market pile.
- A card that trashes cards from your hand may also trash itself.
- Feint does not stack. A second Feint in the same turn adds nothing.

## Implementation plan

### Scope and fixed behavior

- Treat the card list above as the source of truth. Update existing card costs, text, values, and behavior when they differ from the current library.
- Keep starting health at 40 and keep the first-player health penalty.
- Do not edit deck-strategy discovery: `src/sim/psro.ts`, `finalSearch.ts`, `responseOracle.ts`, `randomStrategy.ts`, `mutation.ts`, `equilibrium.ts`, or `mixtureEvaluation.ts`. Tactical play and scoring files are in scope: `simulationKernel.ts`, `tacticalPilot.ts`, `positionValue.ts`, `search.ts`, and `telemetry.ts`.
- Bump persisted game and API schema versions because the game state and record shape change. Old saved games can fail with the existing unsupported-schema response; no migration is required.

### Card and rules model

1. Add every listed card to `src/game-data/cards.json`. Keep Mage cards in the `mana` family, Melee cards in `melee`, Ranged cards in `ranged`, Treasures in `treasure`, and Neutral cards plus Scrap in `engine`.
2. Add the required mechanics to `CardMechanic`, the card schema enum, `VALUE_KEYS`, and `EFFECTS`. Add `draw` to the existing `melee` mechanic and update Strike and Heavy Blow with `draw: 0`. Keep the existing `ranged.draw` key for Steady Shot and Peppering Shot.
3. Replace mechanic value shapes that no longer describe the rules:
   - Feint has `draw` and `bonus`. It draws 1 and has a persistent bonus of 1 for each later Close-range attack that turn.
   - Flurry has `perAction` with no damage cap.
   - Aim has `draw` and `bonus`; its bonus applies to the next Ranged attack, not only Volley.
   - Volley has `near` and `far`; the shared Ranged attack resolver applies Aim.
   - Repelling Shot has separate `near` and `far` damage.
   - Ley Step has base mana and Far-range bonus mana.
4. Use one per-turn state object in both the main engine and compact simulation kernel. It must record cards played, spaces moved by the active fighter, mana spent, spells played, copies played by definition, and distinct families played. Record the current card before its effect resolves. Effects that say “other” subtract the current card. Reset all turn state in `endBuyPhase`.
5. Count Arc Bolt, Fireball, Starfire, Discharge, Cascade, and Overload as spells. Losing mana to Discharge is not mana spent. Mana costs paid by Arc Bolt, Fireball, Starfire, and Cascade are mana spent.
6. Use this exact Tactical Action set for Flurry: Step, Footwork, Ley Step, Feint, Jab, Strike, Drive, Heavy Blow, Opening Strike, Rally, Bull Rush, Flurry, Aim, Peppering Shot, Steady Shot, Repelling Shot, Longshot, Volley, Salvage Shot, Precision Shot, Arc Bolt, Fireball, Starfire, Discharge, Cascade, Overload, Discipline, Improvise, and Scrap. Every other card is non-tactical. `EFFECTS[mechanic].tactical` is the source of this classification; add a test that derives the IDs from `EFFECTS` and asserts this exact set.
7. Keep `positionChanged` for Adapt. Increase spaces moved only when the active fighter moves, including Drive and Repelling Shot fallback movement. Forced opponent movement does not count for that opponent. No card in this batch reads spaces moved, but the counter is required game state for the shared per-turn tracking pass.
8. Keep `FighterState.exposed` as the target-side Feint condition. Make it last until `endBuyPhase`, add 1 damage to every Close-range attack by that target's opponent, and do not consume it. Opening Strike, Rally, and Bull Rush must use the same Close-damage path as Jab, Strike, Drive, Heavy Blow, and Flurry. Drive receives the Feint bonus once on its base hit; wall-collision damage is part of the same attack and does not receive a second bonus. Replaying Feint records the same `Exposed` condition without increasing the bonus. Update `src/client/Board.tsx` from “next attack: +2” to the persistent +1 rule.
9. Make Aim last until the next Ranged attack or `endBuyPhase`. Add 2 damage once, then consume Aim. Route Volley, the `ranged` mechanic, Repelling Shot, Longshot, Salvage Shot, and Precision Shot through one shared Ranged-damage helper in both engines.
10. Reclaim moves one card from discard directly into hand. If discard is empty when Reclaim resolves, draw one card instead. It is not optional when a discard card exists. Update the action log so it says the recovered card went to hand, not to the top of the deck.
11. Reforge gains a card from the current market into discard, pays no money, and reduces an Action pile. It can gain an unlimited Treasure without changing supply. Add `gain` to `GAME_EVENT_TYPES`, publish the gained definition ID, and do not add the card to `purchases` or simulator `purchasesByCard` telemetry.
12. Precision Shot deals 4 for the first copy played that turn and replaces the damage with 2 for every later copy. It does not add or subtract 2 from a common base.
13. Longshot damage is `Math.abs(actorPosition - opponentPosition)`: 1 at Near range and 2 to 4 at Far range.
14. Jab and Peppering Shot draw only if their damage did not end the game, matching the current Ranged cantrip ordering.

### Card choices

- Add one generic pre-resolution command, `playTargetedAction`, with `cardInstanceId` and `targetCardInstanceIds`. The effect metadata declares minimum and maximum target counts, hand or played-card eligibility, and an optional family filter. Legal-action generation, not the browser, enumerates the accepted target combinations.
- Use `playTargetedAction` for Cull, Discipline, Scour, Bull Rush, Salvage Shot, and Reforge. Cull trashes 1 or 2 cards. Discipline and Reforge trash exactly 1. Scour trashes 0, 1, or 2. Bull Rush discards exactly 1 remaining Melee card. Salvage Shot discards exactly 1 remaining Ranged card.
- Cards with a trash effect can select their own played instance. Discard effects cannot select the played card.
- Keep `resolveDiscard` for Regroup and Prism. They draw before their mandatory discard choice.
- Change Reclaim's `resolveRecover` command to require a non-null discard instance and move it to hand. Do not offer “recover nothing.”
- Add a persisted `optionalTrash` pending-choice variant with the source card instance ID and a `resolveOptionalTrash` command whose target is a hand or source-play instance, or `null` to skip. Sharpen draws first and then creates this choice, so its drawn card is eligible.
- Add a persisted `gain` pending-choice variant with `maxCost` and a `resolveGain` command with a definition ID. Reforge creates it after trashing its target. Legal gain choices contain every non-empty market card with cost at most the limit.
- Make `PendingChoice` a discriminated union. Update `GameCommand`, server schemas, cloning, replay, legal-action projection, shared API types, and public selection projection for `optionalTrash` and `gain`. Branch invariants by type: discard and recover require a positive `remaining`; gain requires a nonnegative integer `maxCost`; optional trash requires its source instance to remain in the active player's play zone.
- Generalize `ActionAvailability` and the React card-target overlay with minimum and maximum target counts. For Scour, expose the zero-target legal action as the selected action when no target is selected. Render pending gain choices as trusted legal-action buttons.
- Implement the same pre-resolution targets and pending continuations in the compact kernel. Its deterministic pilot must choose legal family discards, optional trash targets or skip, and a legal Reforge gain.

### Starting draft toggle

1. Add `startingDraftEnabled` to game creation config, the create-game API request, saved game state/record, public game view, and the new-game UI. Default it to `true`.
2. Draft on keeps the current `startingBuild` phase, 12-money build, 7 Copper starting deck, and first-buy carry.
3. Draft off starts in the Action phase with 7 Copper and 3 Scrap per player. Shuffle and draw five cards with the normal seeded order. Set `startingBuild` to `null`, `firstBuyMoney` to 0, and `firstBuyPending` to `false` for both players. Start turn 1 with the selected first player and no build commands.
4. Keep `startingBuild`, `firstBuyMoney`, and `firstBuyPending` in state and persistence. Reject starting-build commands when the toggle is off.
5. Scrap is a starting-only Action card. Exclude it from fixed cards, variable kingdom candidates, market lists, and gain choices.
6. Add the toggle to direct compact match configuration and rules fingerprints. Draft-off compact matches ignore strategy starting builds and report empty starting builds. Add starting-only card definitions to the compact-kernel card index without adding them to supply or market lists.
7. Do not thread the toggle through PSRO, pairing, mutation, or other strategy-discovery code in this task. AI training continues to use draft-on simulations. A draft-off AI game starts without a build and ignores the trained strategy's starting build; its buy agenda and repeat purchase still control play. Record this known training mismatch as a residual risk for the separate strategy-discovery thread.

### Markets, simulation, and cache identity

- Change `ALWAYS_AVAILABLE_ACTION_IDS` to Step and Focus. Add Cull explicitly to every curated kingdom.
- Replace the curated kingdom lists with coherent 10-pile sets that include Cull and exercise the batch:
  - Distance Duel: Cull, Footwork, Feint, Jab, Drive, Flurry, Aim, Peppering Shot, Repelling Shot, Volley.
  - Current Duel: Cull, Channel, Attune, Arc Bolt, Cascade, Feint, Rally, Aim, Precision Shot, Improvise.
  - Three-Way Open: Cull, Ley Step, Fireball, Discharge, Footwork, Drive, Longshot, Volley, Stipend, Improvise.
  - Three-Way Engine: Cull, Channel, Attune, Overload, Jab, Rally, Peppering Shot, Precision Shot, Regroup, Improvise.
  - Range-Rich Mixed: Cull, Ley Step, Adapt, Fireball, Bull Rush, Heavy Blow, Aim, Repelling Shot, Longshot, Salvage Shot.
- Keep random kingdoms at 10 variable piles. Cull can now appear in a random kingdom; Scrap cannot.
- Implement all mechanics and choice behavior in `src/sim/simulationKernel.ts`. Extend the tactical pilot with enough state and deterministic choices to play every new card legally. Do not change strategy discovery.
- Bump the compact-kernel and tactical-pilot protocol versions. Add a draft-toggle argument to direct `rulesFingerprint` calls and include it in the fingerprint rules; existing discovery callers use the draft-on default. Card and kingdom data remain part of the fingerprint.
- Add normalized `startingDraftEnabled` to `MatchConfig`, compact `MatchResult.config`, and direct match runner results so draft-on and draft-off results have different configuration identities.
- Update `src/sim/tacticalPilot.ts`, `positionValue.ts`, `search.ts`, and `telemetry.ts` for Feint +1 persistence, uncapped Flurry, shared Aim bonus, range-dependent Repelling Shot, and every new damage mechanic. These are tactical play and scoring changes, not deck-strategy discovery.
- Update `src/sim/balanceSuite.ts` damage classification for the new attack mechanics and bump the suite to `balance-suite-v3`. Run `npm run balance:suite:manifest` and commit `src/sim/balance-suite-manifest.json`; this manifest is executable suite configuration, not a cached result.
- Do not run balance searches or regenerate balance reports. Existing result artifacts can remain stale because their fingerprint checks fail closed.

### Tests and validation

- Add main-engine behavior tests for every new card, including range and mana gates, first/other-copy boundaries, Precision Shot's replacement damage, family distinctness, Feint draw and duration, Aim duration for every Ranged attack mechanic, Reforge sold-out piles and unlimited Treasures, self-trash rules, discard family filters, and counter reset at turn end.
- Add draft-on and draft-off tests at the engine, server/API, persistence replay, AI-game start, and UI request boundaries. Render and play Scrap from a draft-off `GameView`; prove `cards.scrap` exists while Scrap never appears in a fixed list, variable market, gain choice, or simulator supply.
- Update kingdom, random-market, schema, override-coverage, fingerprint, simulator parity, tactical-pilot, and fixture expectations affected by the new rules.
- Add compact-kernel parity tests that compare representative deterministic card sequences or outcomes with the main engine. Include Cascade, Discharge, Overload, uncapped Flurry, Precision Shot, Reforge, draft-off initial hands, and counter reset. Do not use a second copy of the effect formula as the expected value.
- Prove the regenerated balance-suite manifest imports and matches its generator byte for byte. Prove direct draft-on and draft-off compact results expose different configuration identities.
- Persist and reload states with `optionalTrash` and `gain` pending choices, then resolve them through replay. Prove family-targeted cards have no legal play when no eligible target exists.
- Update `README.md` with the draft toggle and current card/market rules.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Do not run balance search or regenerate balance reports.

### Acceptance checks

- Every card in this document parses and can resolve through legal actions in the main engine and compact simulator.
- Draft-on games keep the existing setup flow. Draft-off games start immediately with exactly 7 Copper and 3 Scrap per player and no first-buy carry.
- Step and Focus are the only always-available Action piles. Every curated kingdom contains Cull. Scrap is never sold or gained.
- Per-turn combo values include the current card only when the text does not say “other,” and all counters reset before the next player acts.
- Feint affects every later Close-range attack that turn without stacking. Aim affects exactly the next Ranged attack.
- Rules fingerprints change for this batch and differ between draft-on and draft-off rules.
- `GameView.cards` includes Scrap and all definitions needed to render owned cards. Market IDs and gain choices still exclude Scrap. Preserve kingdom overrides by replacing base definitions with resolved market definitions in that dictionary.
- Bump schema literals together in `GameState` (`types.ts`), state creation (`state.ts`), `checkInvariants`, `gameStateSchema`, `gameRecordSchema`, persistence's record guard, `GameView`, and `GameExport`.
- Add `startingDraftEnabled` to the strict `createGameRequestSchema`, `gameRecordSchema`, game state, record type, public view, and client request.
- Tests, typecheck, lint, and build pass without edits to `src/sim/psro.ts` or strategy-discovery code.
