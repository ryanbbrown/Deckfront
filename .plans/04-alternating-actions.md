# Alternating actions and card balance

## Goal

Replace complete player turns with alternating single actions.

The change must make movement, protection, and control cards useful between attacks. It must also support future draw effects without making duplicate cards unusable.

## Proposed round structure

A round includes actions, purchases, cleanup, and a new draw.

1. Both players start the round with a five-card hand.
2. Each friendly piece receives one baseline move.
3. The starting player takes one action step.
4. The other player takes the next action step.
5. Players alternate until each player passes.
6. Each player gets one purchase.
7. Both players discard their remaining hands and played cards.
8. Both players draw five cards for the next round.
9. The other player starts the next round.

An action step contains exactly one of these choices:

- Move one piece with its baseline move.
- Play one action card.
- Pass for the rest of the round.

Playing treasure does not use an action step. Treasure plays automatically during that player's purchase.

Passing is final for the round. If one player passes, the other player can take consecutive action steps until passing.

The first player to score five ring-outs still wins. The match ends immediately after the fifth point.

## Card-use limits

Remove the rule that limits each named action to one use per piece each turn.

Alternating actions already interrupt repeated attacks. Removing the limit keeps third copies useful and supports future draw engines.

Keep Relay limited to one use per player each round. Cull and treasure remain unrestricted.

## Baseline moves

Each piece can use one baseline move per round.

A baseline move uses one complete action step. Card movement does not consume the baseline move unless the card says so.

## Proposed response timing

The app resolves one action, then gives the other player control.

For human actions:

1. Select the card or baseline move.
2. Select the actor and target or destination.
3. Preview the resolved action.
4. Confirm the action or undo it.
5. After confirmation, give control to the AI.

This extra confirmation preserves useful undo behavior. It also prevents the AI from replying before the player can correct a mistaken click.

## Passing and purchases

Add a `Pass for this round` action.

- A passed player cannot take another action that round.
- A player with no legal board action passes automatically.
- Both players enter purchases after both pass.
- The player who passed first buys first.
- Each player can buy one card.
- A purchased card enters that player's discard pile.
- The second purchase uses the market left after the first purchase.

Use pass order only to make purchase order deterministic. The current fixed market has enough cards that buying first rarely matters. Revisit this rule if the game gains a rotating or scarce market.

## Round initiative

The human starts round one. The starting player alternates each round.

The round display must show:

- The round number.
- The active player.
- The round's starting player.
- Which player has passed.
- Each piece's remaining baseline move.

## Ring-outs and respawns

A ring-out scores one point immediately.

A ringed piece respawns at the start of its owner's next action step. Mandatory respawns do not consume that action step. Resolve all required respawns before the player chooses an action.

Use the current respawn anchors and nearest-empty fallback.

## Status timing

### Brace

Brace cancels the next displacement against that piece. It then clears.

If Brace does not cancel a displacement, keep it for the whole round. Clear every unused Brace during round cleanup.

Brace makes an opponent spend one additional displacement to move the piece during that round.

### Pin

Pin cancels the target's next baseline move attempt.

- Keep Pin active across rounds until the target attempts a baseline move.
- When the target attempts a baseline move, the piece stays still.
- The failed baseline move consumes that piece's baseline allowance and the player's action step.
- Clear Pin after the failed attempt.
- A player can leave a piece Pinned by never attempting its baseline move.
- Pin does not stop Dash, Vault, Relay, Drive, or forced movement.
- An active Pin still enables Corner's second push.

### Block

A Block remains through the rest of the current round. Remove every Block during round cleanup.

Keep the limit of two Blocks per player. Playing a third Block replaces one owned Block.

## Card changes

| Card | Cost | Approved ability for implementation |
|---|---:|---|
| Copper | 0 | Provide 1 money. |
| Silver | 3 | Provide 2 money. |
| Gold | 6 | Provide 3 money. |
| Shove | 2 | Push one adjacent enemy one hex. The actor does not follow. |
| Dash | 2 | Move one friendly piece to an adjacent empty hex. |
| Brace | 2 | Give one friendly piece Brace under the new timing rule. |
| Cull | 3 | Trash exactly two cards. Cull can be one of them. |
| Drive | 3 | Push one adjacent enemy one hex, then follow into its old hex. |
| Breaker | 3 | Remove Brace from one adjacent enemy, then push it one hex. |
| Press | 5 | Push one adjacent enemy one hex. If you displaced it earlier this round, push it one additional hex. The actor does not follow. |
| Pull | 2 | Pull an enemy exactly two hexes away one hex toward the actor. |
| Vault | 3 | Jump one friendly piece over one adjacent piece into the empty hex beyond it. |
| Sweep | 4 | Move one adjacent enemy 120 degrees clockwise or counterclockwise around the actor. The actor does not follow. |
| Relay | 4 | Swap the positions of your two pieces at any distance. Use Relay once per round. |
| Block | 2 | Place a Block next to one friendly piece under the new timing rule. |
| Pin | 2 | Cancel one enemy's next baseline move attempt. Pin also enables Corner. |
| Corner | 4 | Push one adjacent enemy one hex. If it was Pinned, or ends next to your Block, push it one additional hex. The actor does not follow. |

Push always moves only the target. Drive is the only listed push card that moves the actor.

For Sweep, only the final destination must be empty. Sweep ignores the intermediate hex along the 120-degree arc. An off-board final destination causes a ring-out.

For Cull, choose exactly two cards. The choices can be two other cards, or Cull itself and one other card.

## Server state and rules

Replace full-turn state with explicit round state:

- Round number.
- Starting player.
- Active player.
- Passed players.
- Purchase order.
- Remaining baseline moves.
- Active Pin status until a baseline move attempt fails.
- Brace expiry during round cleanup.
- Block expiry round.
- Relay use for each player.

Remove per-piece named-action use state from the engine, API, AI briefing, UI, and saved games.

Every action must include the current revision. Reject stale actions without changing the saved game.

Do not load saved games from the complete-turn rules. A player must start a new match after this change.

## AI behavior

Run one ThinHarness decision for each AI action step.

The engine must enumerate every legal atomic action before the model runs. An atomic action contains every required choice, including actor, target, destination, card, and Cull targets.

Give each action an opaque action ID and a plain result summary. The list can contain 30 to 40 actions.

Examples include:

- Move piece A from `(0,0)` to `(1,0)`.
- Use Shove with piece B against enemy piece A.
- Use Sweep clockwise with piece A against enemy piece B.
- Trash Copper and Silver with Cull.
- Pass for the round.

The model chooses exactly one action ID. The model does not construct a command or submit its own coordinates. The server rejects missing, stale, or unknown action IDs.

The AI receives:

- Its private hand and deck zones.
- Public board state and action history.
- The current round and pass state.
- Remaining baseline moves.
- Every legal action for this action step.
- The editable strategy Markdown.

The AI must return exactly one listed action ID.

Keep these deterministic checks:

- If one legal action wins the match immediately, the AI must choose a winning action.
- If one legal action scores a point immediately, the AI cannot pass.
- Reject responses that contain more than one action ID.
- Reject stale revisions.

Remove the current rule that forces the AI to take a board action before buying. Passing is now a valid strategic choice.

Run AI purchases as separate enumerated decisions during the purchase stage. Keep cproxy as the ThinHarness backend. Use Luna with low reasoning.

The strategy prompt must explain how to rank actions. It must tell the AI to:

- Take an immediate match win.
- Take an immediate point unless a listed action wins more points.
- Protect pieces facing an immediate ring-out.
- Improve pushing position when no point is available.
- Use control and movement cards to prevent the opponent's next threat.
- Pass only when further actions provide less value than preserving cards or buying.

Record one trace for every AI action step and purchase. Include the round, action-step number, revision, prompt, tools, result, duration, and failure.

## User interface

Replace `Your action phase` with the round and active-player display.

Human action step:

- Enable one baseline move or one action card.
- Keep the existing actor, target, and destination highlights.
- Show the resolved preview before confirmation.
- Show `Confirm action`, `Undo action`, and `Pass for this round` controls.

AI action step:

- Lock human controls.
- Show the AI model and elapsed time.
- Show the single action after it commits.
- Return control to the human unless the human already passed.

Purchase stage:

- Show whose purchase is active.
- Show available money and legal market cards.
- Allow one purchase or `Buy nothing`.
- Continue to cleanup after both purchases.

Refresh must restore the exact round, active player, pass state, preview, and purchase state.

## Implementation order

### Phase 1: engine and cards

- Add round and action-step state.
- Add alternating action transitions and passing.
- Update baseline moves, respawns, Brace, Pin, and Block timing.
- Remove per-piece named-action limits.
- Apply every card cost and ability change.
- Update invariants, deterministic search, replay, and unit tests.

### Phase 2: server and AI

- Persist round and action-step state.
- Commit one confirmed action at a time.
- Update undo and confirmation boundaries.
- Update AI tools, briefing, correctness checks, traces, retries, and purchases.
- Replace free-form AI commands with one listed action ID.
- Reject stale actions and multi-action AI plans.

### Phase 3: interface

- Add the round display, pass controls, and action confirmation.
- Update status indicators and card text.
- Add the two-card Cull selection flow.
- Update Sweep destinations and unlimited Relay selection.
- Add alternating AI handoffs and purchase screens.

### Phase 4: verification

- Run the full unit suite, typecheck, lint, and build.
- Run the full real-server browser suite.
- Run the live cproxy AI tests.
- Complete one headed match with alternating actions and purchases.

## Required tests

### Engine tests

- One action changes the active player.
- One baseline move consumes one action step and one piece allowance.
- One card consumes one action step and stays played for the round.
- Different and duplicate cards can use the same piece in later action steps.
- Passing is final for the round.
- One active player continues after the other passes.
- Two passes start purchases.
- Purchases, cleanup, draw, and alternating initiative happen in order.
- Ring-outs, fifth-point wins, and respawns use the new timing.
- Brace, Pin, Block, and Relay use the new durations.
- Every changed card uses its exact cost and ability.
- Replay reproduces the exact final state.

### Browser tests

- Every card completes through visible controls under alternating actions.
- The opponent receives control after every confirmed action.
- Preview, undo, confirmation, and stale revision handling work.
- Passing prevents later actions that round.
- The non-passed player can take consecutive actions.
- Each purchase order and buy-nothing path works.
- Cull trashes two other cards or Cull plus one other card.
- Sweep offers both 120-degree destinations and scores off-board.
- Relay swaps pieces across the board and becomes unavailable afterward.
- Pin persists across rounds, cancels one baseline move attempt, and then clears.
- Brace and Block expire during the correct round cleanup.
- Refresh restores every phase.
- AI errors show a retry path without corrupting the game.

### AI tests

- The AI returns one action only.
- The AI can choose from at least 40 listed legal actions.
- The server rejects an action ID from an earlier revision.
- The model cannot invent coordinates, targets, or card combinations.
- The AI takes an immediate point and an immediate win.
- The AI can pass when no point is available.
- The AI acts repeatedly after the human passes.
- The AI purchases once during its purchase stage.
- A real cproxy browser test completes several alternating action steps.

## Decision status

Confirmed:

1. Remove the per-piece named-action limit.
2. Require explicit confirmation after every human action.
3. Make passing final and let the other player continue alone.
4. Use pass order for purchase order. Revisit purchase order with a rotating market.
5. Alternate the starting player each round, with the human starting round one.
6. Respawn pieces before their owner's next action without consuming that action.
7. Remove Blocks during round cleanup.
8. Keep Pin until a baseline move attempt fails and clears it.
9. Make Cull trash exactly two cards. Cull can be one of them.
10. Let Sweep ignore the intermediate hex during a 120-degree move.
11. Use Luna with low reasoning for every AI decision through cproxy.
12. A failed Pinned baseline move consumes the player's complete action step.
13. Brace cancels one displacement and otherwise lasts until round cleanup.
14. Enumerate every legal atomic action and let the AI choose one action ID.

No product decisions remain open.
