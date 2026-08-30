# Playback feedback refinements

## Goal

Make repeated plays, purchases, and damage easier to follow without changing game rules.

## Decisions

- `Play all` starts each repeated card flight at the same cadence as treasure cards that move to Played this turn when the Action phase ends.
- Use one shared card-stack start interval of about 90 milliseconds. Keep each individual card flight readable.
- Keep Play all requests sequential so every request uses the accepted revision from the prior response. Queue their presentation so network timing does not define the visible cadence.
- Preserve frame, event, draw, and damage order during rapid Play all playback.
- Every accepted purchase briefly shows the canonical full card face above its compact market pile. Scale it to about the played-card size so its title, image, rules, and cost remain readable.
- Fade the purchase card in, hold it briefly, and fade it out in about 500 to 650 milliseconds total. Do not move it to the discard pile.
- Show the same purchase preview for human and animated AI purchases. When AI animation is off or reduced motion is requested, keep the current immediate behavior.
- When a frame deals damage, flash and briefly shake the damaged fighter and show a clear `−N` damage label at that fighter.
- Start damage feedback when the damaging card lands. Its settle time counts toward the existing AI 500 millisecond card rhythm instead of adding another long pause.
- Reduced motion skips shake and travel. The accepted health value remains immediately visible.
- Keep all existing AI interaction suppression, Undo, New game, reload, and playback interruption behavior.

## State and sequencing

- Add `purchase` to the ephemeral presentation transfer types. For `buyCard`, identify the new physical card in the buyer's discard pile and include its card instance and definition in the frame. Do not persist this transfer.
- The client anchors a purchase preview to the matching `[data-market-card]` pile. Render the preview in the existing fixed presentation layer so table clipping cannot hide it and native dialogs remain above it.
- A purchase frame reveals its event in sequence, shows one preview, then continues. AI purchases must not appear in the final log before their frame.
- Derive damage feedback from the new public damage events revealed by each presentation frame. No game-engine or persisted schema change is needed.
- Pass the active damage feedback to `Board`. Apply it only to the event's target fighter and amount.
- For Play all, retain accepted updates in order and present consecutive same-definition hand-to-play transfers with the shared 90 millisecond start interval. Release each physical card and grouped count as its flight lands. Draw and damage feedback caused by those plays stays in command order.
- Cancel purchase and damage overlays with the same playback token used for card travel.

## Likely files

- `src/shared/api.ts`: purchase transfer type.
- `src/server/gameService.ts`: derive purchase transfers.
- `src/client/playback.tsx`: shared stack cadence and purchase preview layer.
- `src/client/Game.tsx`: rapid Play all queue, purchase sequencing, and damage-event sequencing.
- `src/client/Board.tsx`: target fighter damage feedback.
- `src/client/styles.css`: purchase fade, fighter hit, and damage label.
- `test/server-distance-duel.test.ts`: purchase transfer contract.
- `test/e2e/distance-duel.spec.ts` and `test/e2e/coverage-manifest.json`: visible cadence and feedback.
- `README.md`: current playback behavior.

## Acceptance checks

- Three cards submitted through Play all start moving at the same interval as three treasure cards moved by End Action phase.
- Play all still uses correct revisions, stops when a card needs a choice, and preserves resulting draws and effects.
- A human purchase shows one readable canonical card preview anchored to the bought market pile, then removes it.
- An animated AI purchase shows the same preview before the turn continues.
- Purchase previews never make the table overflow and never appear above a native dialog.
- A damaging human card shows the exact damage amount on the correct fighter when the card lands.
- A damaging AI card shows the same feedback without extending the normal card rhythm beyond a small tolerance.
- Damage feedback does not appear for non-damaging cards.
- Turning AI animation off and reduced motion retain immediate accepted state without purchase, travel, shake, or damage overlays.
- Existing card travel, draw and discard piles, AI hand playback, Undo, New game, and layout tests remain correct.

## Test strategy

- Service: buying an action and each treasure creates one ephemeral purchase transfer with the correct physical card and player. GET, export, and persistence still contain no presentation data.
- Browser: record flight start times for Play all and an equal-sized treasure stack; assert both use the same bounded interval.
- Browser: buy a known card and assert the preview uses its canonical face, is anchored near its market pile, and disappears.
- Browser: seed a deterministic AI purchase and assert its preview appears before control returns to the human.
- Browser: play known human and AI damage cards; assert the target player and exact amount, and assert no damage marker for a non-damaging card.
- Browser: cover reduced motion and the disabled AI animation setting.

## Validation

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Manually inspect Play all, an End Action treasure stack, one human purchase, one AI purchase, one human hit, and one AI hit at 1920×1080.
