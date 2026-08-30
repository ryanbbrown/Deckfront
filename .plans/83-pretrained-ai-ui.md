# Pretrained AI in the game UI

## Goal

Use the completed 30-kingdom strategy search during normal play. Refresh chooses one of those kingdoms, and AI games select a saved ordered buy plan without running strategy search.

## Decisions

- Commit one server-only JSON catalog derived from `.data/strategy-search-30/rust-balance-analysis-v1.json`.
- Store the 30 exact variable-card sets and every final-matrix ordered plan with its equilibrium weight and score against the equilibrium.
- Keep the existing difficulty control. Expert samples by equilibrium weight. Easy, Normal, and Hard use the existing score targets and deterministic seed selection.
- Keep the current create-game request shape. The server matches the submitted variable-card set to the catalog without depending on card order.
- Add the 30 card sets to the setup response. Initial setup and Refresh market choose from those sets and do not repeat the current set when another set is available.
- Force starting draft off for every AI game at the server boundary. Hide the starting-draft control in AI mode. Local games keep the current draft option.
- Keep the existing training request state. Static plan selection is immediate, so it may appear only briefly.
- Keep `tacticalAgent` as the only runtime AI. The saved plan controls purchases, and the existing tactical policy controls actions.
- Keep the selected strategy in the saved game so reload, replay, Undo, and automatic turns continue to work.

## Scope

1. Add a compact pretrained-opponent catalog and a loader that validates its structure and exact kingdom signatures.
2. Replace the default runtime AI search with deterministic selection from the catalog. Do not change simulator or Rust search tools.
3. Return the 30 trained variable-card sets from `/api/setup` and use them in the React setup table.
4. Force draft-off AI creation in `GameService` and update setup behavior.
5. Update focused unit, HTTP, and browser tests plus the README.

## Acceptance checks

- `/api/setup` returns exactly 30 unique trained kingdoms, each with 10 unique eligible variable cards.
- Initial setup and every refresh use one of the 30 trained kingdoms; refresh changes the current kingdom.
- An AI request for a trained kingdom does not start workers or strategy search.
- The same kingdom, seed, and difficulty select the same ordered plan.
- Expert uses only positive-weight equilibrium plans with the saved weights.
- Easy, Normal, and Hard keep the existing score-band and nearest-score behavior.
- Every selected plan is a valid 10-slot `Strategy` after inactive-slot padding.
- AI games always report `startingDraftEnabled: false`, start with the draft-off deck, and do not show the starting-draft control.
- Local games retain the starting-draft control and current behavior.
- AI automatic turns, persistence, reload, replay, and Undo still use the selected saved strategy.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```
