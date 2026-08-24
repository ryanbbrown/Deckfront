# Game reset and card warnings

## Goal

Add clear game controls, a deterministic persisted-game reset, and card warnings that stay above the full card face.

## Implementation

1. Add a revision-locked reset endpoint. Rebuild draft-off games from `initialState`; rebuild draft games by replaying their two saved starting-build commands. Clear progress metadata and undo history, then run an AI-first opening turn with the persisted strategy.
2. Replace the rail icons with `Undo`, `Reset`, and `New game`. Put reset behind an in-app confirmation and stop active playback before reset or navigation.
3. Raise and constrain unavailable-card warnings inside the card border so they cover rules and cost content.
4. Add service, HTTP, and Playwright regressions for reset identity, deterministic state, no AI retraining, confirmation behavior, control order, playback interruption, and warning geometry/stacking. Update the E2E coverage manifest.

## Verification

Run the focused Vitest and Playwright tests, then run all unit/integration tests, typecheck, lint, build, and the E2E manifest validator.
