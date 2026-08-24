# Card motion and watchable AI turns

## Goal

Make card movement readable without changing game rules. Human-played cards move from the hand to Played this turn. Drawn cards rise from the bottom into the hand. AI turns show the AI hand and play visible cards one at a time.

## Product decisions

- Human card movement starts only after the server accepts the action. Do not use optimistic game state.
- A played card rises from its hand stack and lands in its Played this turn stack.
- A drawn card rises from below the hand panel. The animation does not start at the deck pile.
- New card definitions append at the right of the stable hand order. A duplicate lands on its existing group.
- Add two small zone piles at the bottom left of the hand section:
  - a face-down draw pile with the number of cards left;
  - a face-up discard pile showing the most recently discarded card and the discard count.
- Keep the hand centered and visually dominant. The two zone piles must not push the hand off center or cause page overflow at 1920×1080.
- During an AI turn, reuse the hand panel for the face-up AI hand. Label it `AI hand` and tint the panel with the AI player color.
- Start visible AI card plays about 500 milliseconds apart. Internal target, movement, discard, recover, trash, and gain decisions do not get prompts or their own long pause.
- Do not show the AI drawing its next hand at the end of its turn. When the next AI turn starts, show that hand already present.
- Add an `Animate AI turns` setting. It is on by default, appears with AI setup controls and during an AI game, and persists in local storage. Turning it off gives the current immediate AI behavior. Turning it off during playback finishes the playback immediately.
- `prefers-reduced-motion: reduce` also skips card travel and AI playback delays.
- Local games keep both players interactive. AI playback never exposes interactive AI actions.

## State and API model

- Keep the saved game state authoritative and synchronous. The server still completes and saves the human action and the complete AI response inside one repository lock.
- Keep mutation bodies compatible with `GameView`. Create `GameUpdateView = GameView & { presentation: PresentationSequence }` and return it from create, build, action, and undo mutations. GET and export return plain `GameView`. A mutation with no visible work returns an empty sequence.
- Capture presentation from every path that can run the AI: game creation, completed starting build, and a committed action. Capture one frame after each command, including commands selected by the AI.
- Include an initial frame before automatic AI work so the client can show the AI hand before its first play. This applies to AI-first draft-off creation and to an AI turn started by completing the human build.
- Each frame contains a compact render projection, an event high-water mark, and presentation transfers. It excludes revision, browser actions, the static card catalog, and fixed and variable market IDs.
- A presentation transfer identifies the physical card instance, definition, player, and kind. The only travel kinds in this scope are `handToPlayed` and `drawToHand`.
- Derive `handToPlayed` by comparing physical hand and play zones before and after a command. Derive `drawToHand` from newly added hand instances when the command emits a draw event. A reshuffle draw is still a semantic draw from below the hand.
- Mark every draw caused by `endBuyPhase` as hidden because that command changes the displayed player. Update discard, trash, recover, gain, purchase, cleanup, and reshuffle state without card travel in this scope.
- Add the public top discard card to each player projection. Keep draw and discard counts in the existing zone counts. The zone piles follow the player currently displayed in the hand panel, including the AI during playback.
- Do not include browser action presentations in playback frames. The client must gate all choice surfaces on `playback inactive` and render playback hands in a separate neutral read-only mode, without unavailable opacity or reason text.
- The client keeps the final authoritative response separately while it renders frames. Game ID and revision always come from that final response, never from a frame. After the final frame, install the final `GameView`.
- Reveal action-log events only through the current frame. Do not show the final AI log before its visible actions occur.

## Interaction sequencing

### Human card play

1. Keep the selected card in the hand while the request is pending.
2. Measure the source hand group before applying the accepted frame.
3. Apply the accepted presentation frame. Withhold the arriving physical card from the visible destination group until landing. An existing group keeps its old count; a new group renders an invisible card-sized placeholder so it can be measured.
4. Measure the destination in `useLayoutEffect` after React commits the frame.
5. Render one temporary canonical card face in a fixed portal attached to `document.body`. This avoids `.table-shell` clipping and stays below native dialogs.
6. Move it from the source rectangle to the destination over about 280 milliseconds, then highlight the destination for about 80 milliseconds.
7. Release the withheld card into the visible destination group, remove the temporary card, and continue the queue.

Movement and target cards do not move when first selected. They move only after the player submits the legal movement or target action.

### Draw

1. Apply the accepted frame while withholding arriving physical cards from visible hand groups. Existing groups keep their old counts; new groups use invisible measured placeholders.
2. Start each temporary card below the hand panel, aligned with its destination.
3. Move it straight upward over about 260 milliseconds.
4. Stagger multiple cards by about 90 milliseconds.
5. Release each withheld card when its temporary card lands.

An action such as Muster can play one card and draw cards in the same command. Play the source card first, then raise the drawn cards. Do not animate any end-of-turn replenishment from `endBuyPhase` because the displayed player changes in that command.

### AI turn

1. Show a static `AI turn` banner and the complete current AI hand.
2. Hide or disable phase controls, market actions, movement choices, hand choice controls, card pickers, and playable card semantics.
3. For each AI card-play command, move that card to Played this turn over about 280 milliseconds and leave about 220 milliseconds for the board and log result to settle.
4. Apply automatic follow-up decisions without a modal, choice bar, movement buttons, or a 500 millisecond pause.
5. Use a short log highlight for purchases and phase changes.
6. When the AI ends its Buy phase, do not render its hidden draw transfer. Switch directly to the final human hand and `Your turn` state.
7. If an AI frame contains victory, show the winner and board result in that frame, keep all gameplay controls disabled, and finish the remaining empty sequence.

The turn banner is the only live status. Keep it stable during the AI turn so screen readers do not announce every card and event.

### Play all

- Submit one copy at a time.
- Await that accepted response and its human card playback before submitting the next copy.
- Use the final authoritative revision from each response for the next request.
- Keep the batch control locked until no matching direct play remains or a request fails.

## Interruptions

- Disable normal gameplay commands while presentation playback is active.
- Undo remains available. If selected during playback, cancel timers and temporary cards, install the final authoritative response, then submit Undo with that response revision. One Undo still removes the human command and the complete AI response.
- New game cancels playback and pending requests, clears the active game, and must ignore late responses from the old game.
- Reload does not resume presentation playback. It loads the final persisted human decision point.
- If the document becomes hidden, finish the sequence immediately.
- Turning off `Animate AI turns` or entering reduced-motion mode cancels temporary cards and installs the final state immediately.
- A request error starts no presentation sequence and leaves the prior accepted game visible. If presentation rendering fails after an accepted response, install that final accepted game in `finally`.

## Visual hierarchy

- Keep Played this turn above the hand.
- Keep the hand centered in the available table width.
- Use small draw and discard piles in the bottom-left corner of the hand panel. Their card faces are smaller than played cards and do not lift on hover.
- The draw pile uses a clear card back and an absolute count badge.
- The discard pile uses the canonical face scaled down and an absolute count badge. Show an empty placeholder when there is no discard.
- Flying cards sit above the table and below real dialogs.
- Give the AI hand panel a restrained player-color border and `AI hand` label. Do not dim the arena or Played this turn.

## Likely files

- `src/shared/api.ts`: mutation response, playback frame, transfer, and discard-top types.
- `src/server/gameService.ts`: frame capture, transfer derivation, event boundaries, and discard-top projection.
- `src/server/httpServer.ts`: mutation response shape.
- `src/client/api.ts`: mutation response types.
- `src/client/App.tsx`: persisted AI animation setting, create-response presentation handoff, and stale-request protection.
- `src/client/Game.tsx`: display-state selection, neutral playback hand rendering, interaction gating, zone piles, Play all sequencing, and playback integration. Put the in-game animation toggle in the phase controls.
- `src/client/playback.tsx`: one focused playback controller, timing constants, destination withholding, and fixed flying-card portal.
- `src/client/styles.css`: card travel, invisible destination placeholders, zone piles, AI emphasis, and reduced-motion rules.
- `test/ai-game.test.ts`, `test/server-distance-duel.test.ts`, `test/http-distance-duel.test.ts`, and `test/draft-ui.test.tsx`: service, response-contract, and client coverage.
- `test/e2e/fixture.ts`: a deterministic AI-game opener and animation-off setup for unrelated tests.
- `test/e2e/distance-duel.spec.ts` and `test/e2e/coverage-manifest.json`: browser flows and coverage records.
- `README.md`: current AI turn and zone-pile behavior.

## Implementation phases

1. Add the presentation contract, discard-top projection, and deterministic server frame capture. Keep saved schemas unchanged.
2. Add the client playback controller and make every gameplay surface non-interactive during playback.
3. Add human play and draw travel using stable physical card IDs.
4. Add the draw/discard piles and preserve the centered hand layout at 1920×1080.
5. Add AI hand playback, the persisted animation setting, interruption handling, and reduced-motion behavior.
6. Add tests, update the E2E manifest and README, then run all validation.

Each phase must end with its relevant tests passing.

## Acceptance checks

- After an accepted human card action, one visible physical card moves from its hand group to its Played this turn group.
- The destination card and grouped count do not appear before the temporary card lands.
- Playing one copy from a grouped hand changes the count without moving the remaining group.
- A drawn card rises from below the hand and lands in the correct group. Multiple draws are staggered.
- The bottom-left draw pile shows the exact remaining draw count.
- The bottom-left discard pile shows the most recent discarded card and exact discard count.
- The hand remains centered and the page has no horizontal or vertical overflow at 1920×1080.
- AI-first games animate the first AI turn whether it starts in draft-off creation or after the human completes the draft.
- An animated AI turn shows the AI hand and visible card plays about 500 milliseconds apart.
- The playback hand is clear and readable, without unavailable opacity or empty reason labels.
- No decision dialog, choice bar, movement choice, enabled market pile, or playable hand control appears during AI playback.
- The AI end-of-turn draw does not reveal its next hand.
- Turning off `Animate AI turns` before or during playback produces the immediate final human state.
- Reduced motion produces the immediate final state without card travel.
- Undo during playback restores the previous human decision point and never exposes a playable AI state.
- New game during a pending request or playback cannot be reversed by a late response.
- Reload during or after playback shows the saved final human decision point.
- Play all animates every accepted copy in order and uses the correct revision for each request.
- Existing card grouping, local play, choices, action history, Undo history, and layout behavior remain correct at 1920×1080 and 1600×1080.

## Test strategy

- Service tests use a fixed AI strategy and assert exact frame order, card-instance transfers, event boundaries, and equality between the last compact frame projection and the same projection of the final returned game.
- Service tests cover AI-first draft-on build completion and AI-first draft-off creation.
- Service tests cover local and human-to-AI `endBuyPhase`, draw-pile reshuffling, semantic draw transfers, and hidden replenishment draws.
- Service tests assert that frames contain no browser actions or static card catalog and that presentation data is not persisted, reloaded, or exported.
- HTTP tests assert that create, build, action, and undo return direct `GameView` fields plus a presentation sequence while GET and export remain plain current views.
- Existing service and client tests that consume mutation results continue to use direct `GameView` properties.
- Playwright tests seed known hands and draw piles, then assert observable flying-card elements, source and destination bounds, and the absence of an early destination card or count.
- A grouped-card browser test asserts that one copy flies while the remaining stack keeps its slot.
- A Play all browser test asserts ordered animation and complete batch behavior.
- A deterministic AI fixture seeds the AI hand. AI browser tests cover visible play order, AI-first draft on and off, and the absence of all choice surfaces throughout playback.
- Interruption browser tests cover Undo, New game, the animation setting, `visibilitychange`, and a request failure during an accepted-state transition.
- Setting persistence is checked after reload. Unrelated E2E fixtures persist `Animate AI turns = off`; animation tests use the real bounded timing constants.
- A reduced-motion browser test uses Playwright media emulation and asserts that no flying card appears.
- Layout tests assert centered hand bounds, visible zone piles, and zero document overflow at 1920×1080 and 1600×1080.

## Validation

Run after implementation and after required review fixes:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Manually inspect one human play, one multi-card draw, one animated AI turn, animation disabled, Undo during playback, New game during playback, reduced motion, and the hand layout at 1920×1080.
