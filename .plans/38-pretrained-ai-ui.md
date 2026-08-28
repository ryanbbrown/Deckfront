# Pretrained AI in the current game UI

## Goal

Use the completed 30-kingdom strategy search in the current Deckfront UI. Refresh chooses one trained kingdom, and AI games select a saved ordered buy plan without running strategy search.

## Decisions

- Work from current `main`. Preserve its market art, setup rail, battlefield, animations, card playback, reset controls, and full card catalog.
- Commit one server-only JSON catalog derived from `.data/strategy-search-30/rust-balance-analysis-v1.json`.
- Store the 30 exact variable-card sets and every final-matrix ordered plan with its equilibrium weight and score against the equilibrium.
- Keep all four difficulty levels. Expert samples by equilibrium weight. Easy, Normal, and Hard use the existing score targets and deterministic seed selection.
- Keep the current create-game request shape. Match the submitted variable-card set to the catalog without depending on card order.
- Add the 30 card sets to the setup response. Initial setup, Refresh, and New game choose from those sets and do not repeat the current set when another set is available.
- Force starting draft off for every AI game at the server boundary. Hide the Starting draft switch in AI mode. Local games keep the current draft option.
- Keep the current training request state and AI animation behavior. Static plan selection is immediate.
- Keep `tacticalAgent` as the runtime AI. The saved plan controls purchases, and the existing tactical policy controls actions.
- Keep the selected strategy in the saved game so reload, replay, reset, Undo, presentation frames, and automatic turns continue to work.

## Scope

1. Add a compact pretrained-opponent catalog and a loader that validates its structure and exact kingdom signatures.
2. Replace the default runtime AI search with deterministic selection from the catalog. Do not change simulator or Rust search tools.
3. Return the 30 trained variable-card sets from `/api/setup` and use them in the current React setup flow.
4. Force draft-off AI creation in `GameService` and update the current setup rail.
5. Update focused unit, HTTP, and browser tests plus the README.

## Acceptance checks

- `/api/setup` returns exactly 30 unique trained kingdoms, each with 10 unique eligible variable cards.
- Initial setup, Refresh, and New game use one of the 30 trained kingdoms; Refresh and New game change the current kingdom.
- An AI request for a trained kingdom does not start workers or strategy search.
- The same kingdom, seed, and difficulty select the same ordered plan.
- Expert uses only positive-weight equilibrium plans with the saved weights.
- Easy, Normal, and Hard keep the existing score-band and nearest-score behavior.
- Every selected plan is a valid 10-slot `Strategy` after inactive-slot padding.
- AI games always report `startingDraftEnabled: false`, start with the draft-off deck, and do not show the Starting draft switch.
- Local games retain the Starting draft switch and current behavior.
- Current market art, setup rail, AI playback, persistence, reload, reset, replay, Undo, and automatic turns still work.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```
