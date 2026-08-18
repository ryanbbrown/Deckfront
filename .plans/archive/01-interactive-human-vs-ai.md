> **Superseded:** Use [12-repository-cleanup.md](../12-repository-cleanup.md) for the current repository and browser scope. Use [09-card-list.md](../09-card-list.md), [10-automated-balance-search.md](../10-automated-balance-search.md), and [11-search-performance.md](../11-search-performance.md) for current game and simulator decisions.

# Interactive human versus AI prototype

## Goal

Replace the scripted replay viewer with an interactive deck-building game.
The human plays one side and ThinHarness plays the other side.
The prototype must answer three questions:

1. Does the 19-hex board create useful tactical choices?
2. Do purchases create distinct interaction engines during one match?
3. Can a strategy prompt produce recognizable AI behavior without allowing illegal play?

The prototype does not need production accounts, matchmaking, or deployment.

## Product decisions

- Use a 19-hex board with axial radius 2.
- Give each player two identical pieces.
- Use alternating turns without reactions.
- Draw five cards each turn.
- Let players play any number of action cards from their hand.
- Give each piece one baseline move per turn.
- Let players interleave baseline moves and card plays.
- Give each player one purchase after the action phase.
- Put purchased cards in the discard pile.
- Discard the remaining hand and played cards during cleanup.
- Draw the next hand after cleanup.
- Award one point for each enemy ring-out.
- End the match immediately when a player reaches five points.
- Do not include extra card draw in the first version.
- Do not include actions during the opponent's turn.

Target a match length of 15 to 25 minutes.
Record actual match length and turn count in every saved game.

## Board rules

### Coordinates and occupancy

Use the existing axial coordinates and six hex directions.
Each board hex can contain one piece or one temporary block.
Pieces cannot move through occupied hexes unless a card allows it.

Start Ochre at `(-1, 0)` and `(-1, 1)`.
Start Indigo at `(1, -1)` and `(1, 0)`.
These four starting hexes are also their owners' respawn anchors.
Choose the first player with the saved random seed.

### Baseline movement

Each piece can make one baseline move during its owner's action phase.
A baseline move enters one adjacent empty board hex.
Card movement does not consume or restore baseline movement.
A pinned piece cannot use baseline movement during its next turn.

### Displacement

A push moves one adjacent enemy directly away from the acting piece.
The chosen target must be an adjacent enemy.
A piece or temporary block in the destination makes a push against an unbraced target illegal.
Check Brace before destination occupancy.
A displacement card can remove Brace even when its destination would be blocked.
Resolve multi-hex displacement as separate push steps.
A displacement beyond the board causes a ring-out.
Remove the ringed piece and award one point immediately.
Stop resolving effects against a ringed piece.

Award the point to the opponent of the ringed piece.

Pull and Sweep also count as displacement.
Brace can cancel any of these effects.
Normal movement never causes a ring-out.

### Respawning

Respawn ringed pieces at the start of their owner's next turn.
The owner selects either empty respawn anchor on their side.
If both anchors are occupied, select any empty hex with minimum distance from either anchor.
Resolve multiple respawns one at a time.
Clear every status from a ringed piece.
A respawned piece receives its normal baseline move.

The engine must list every legal respawn location.
The human or AI must choose among those locations.

### Status duration

`Braced` lasts until it cancels one displacement card or its owner's next turn starts.
Brace on the chosen target cancels the complete push and is then removed.
Brace cancels all steps from a multi-step Press or Corner.

Apply `Pinned` immediately.
It removes that piece's baseline move during its next turn.
It remains active through the source player's following action phase.
It clears during that source player's cleanup.
Pinned pieces can still use card movement.

Temporary blocks remain through their owner's following action phase.
They clear during that owner's cleanup.
Each player can have at most two temporary blocks.
A third Block play must replace one owned block.

At turn start, first expire the active player's old Brace statuses.
Then resolve respawns and reset baseline moves.
Resolve the action phase after every required respawn choice.

### Turn end

The match ends as soon as a player reaches five points.
Do not resolve unused cards, purchases, cleanup, or respawns after the win.

## Deck rules

Port Deckfront's seeded shuffle, zone movement, treasure, purchase, cleanup, and card conservation behavior.
Use one combined resolver for deck actions and board actions.
Represent every physical card as `{ id, definitionId }`.
Do not copy Deckfront's free trash action or board-specific phase flow.
Do not create a runtime dependency on the sibling Deckfront checkout.

Set `unlimitedActions` to true.
Keep one buy, zero starting money, and a five-card hand.
Auto-play all treasure cards when the player enters the buy phase.
Do not let a player return to board actions after entering the buy phase.
Unspent money does not carry between turns.

Use this ten-card starting deck for each player:

- Five Copper cards
- Two Shove cards
- Two Dash cards
- One Brace card

Copper produces one money.
Silver costs three and produces two money.
Gold costs six and produces three money.
Use supplies of 60 Copper, 40 Silver, and 30 Gold.
Use ten copies of each basic action card.
Create starting cards outside these supply counts.

The starting deck averages 2.5 board cards in each hand.
Baseline movement preserves board agency when a hand contains mostly treasure.

## Card resolution rules

Every card in a hand is a separate card instance.
Playing a card moves that instance from the hand to the play zone.
The player must complete every required choice before playing another card.
Optional choices appear as explicit legal actions.

The engine generates legal actions from the complete game state.
The client and AI can only submit a generated action identifier.
The server rechecks legality before every transition.

Cards use these common terms:

- `Move`: relocate a friendly piece without displacing another piece.
- `Push`: displace an adjacent enemy directly away from the acting piece.
- `Follow`: move the acting piece into the hex that the target vacated.
- `Pull`: displace an enemy one hex toward the acting piece.
- `Sweep`: displace an adjacent enemy around the acting piece by 60 degrees.
- `Jump`: move over one adjacent piece into the next hex on the same line.

## Basic card piles

Basic piles appear in every match.

### Shove — cost 2

Choose a friendly piece and an adjacent enemy.
Push that enemy one hex.

### Dash — cost 2

Move one friendly piece into an adjacent empty board hex.
This move works after that piece uses its baseline move.

### Brace — cost 2

Give one friendly piece Braced.
Use the standard Braced duration.

### Cull — cost 2

Trash Cull or one other card from your hand.
Do not replace the trashed card during this turn.

Cull lets a player increase combo frequency at an immediate tactical or buying cost.

These cards teach the basic rules and keep random markets functional.

## First kingdom market

The first match uses ten shared kingdom piles.
Each pile starts with six copies.
The card library and market must live in data files, not application code.

### Direct-force package

#### Drive — cost 3

Choose a friendly piece and an adjacent enemy.
Push that enemy one hex.
Follow into the vacated hex after a successful push.

Follow only when the target moved or rang out.
Follow enters the target's original hex and does not use baseline movement.
Do not follow after Brace or a blocked push.

Drive preserves contact and supports another push from the same direction.

#### Breaker — cost 4

Choose a friendly piece and an adjacent enemy.
Push that enemy one hex.
Remove and ignore Brace on the chosen target.

Breaker prevents Brace from becoming a complete answer to force decks.

#### Press — cost 5

Choose a friendly piece and an adjacent enemy.
Push that enemy one hex.
Push it one additional hex when your side displaced it with an earlier resolved card this turn.
Shove, Drive, Breaker, Pull, Sweep, and Corner count as displacement.
Resolve both hexes separately.

Press converts setup and contact into a possible ring-out.

### Geometry package

#### Pull — cost 3

Choose a friendly piece and an enemy exactly two hexes away on one line.
Move the enemy one hex toward the friendly piece.
The destination between them must be empty.

In axial terms, `target = actor + 2 × direction`.

Pull changes a line without spending movement on the acting piece.

#### Vault — cost 3

Choose a friendly piece and one adjacent piece.
Jump the friendly piece over it into the next hex on the same line.
The landing hex must be empty and on the board.

Vault crosses occupied lines and creates push angles unavailable to Dash.

#### Sweep — cost 4

Choose a friendly piece and an adjacent enemy.
Choose either position that rotates the target 60 degrees around the friendly piece.
An on-board destination must be empty.
An off-board destination is legal and causes a ring-out.

Sweep changes the displacement line instead of adding ordinary movement.

#### Relay — cost 4

Swap the positions of your two pieces when their distance is at most two.
Each piece keeps its own remaining baseline move and statuses.

Relay bypasses occupancy and transfers which piece controls a line.
Its value comes from interleaving the swap with each piece's actions.

### Confinement package

#### Block — cost 3

Place a temporary block in an empty hex adjacent to one friendly piece.
Use the standard block duration and two-block limit.

Blocks deny escape cells and can enable Corner.

#### Pin — cost 3

Choose a friendly piece and an adjacent enemy.
Give that enemy Pinned.

Pin restricts escape but does not prevent card movement.

#### Corner — cost 4

Choose a friendly piece and an adjacent enemy.
Record whether it is Pinned before movement.
Push it one hex.
Push it one additional hex when it was Pinned.
Also grant the extra push when its first destination touches your temporary block.
Resolve both hexes separately.
Do not resolve the extra step after a canceled first step or a ring-out.

Corner converts confinement into points.
It prevents the control package from becoming a scoreless defense strategy.

## Market variation

Implement the first curated market before random markets.
Represent cards with strategy tags and explicit synergy links.
Support market files that compose implemented cards without changing engine code.
New card mechanics can still require engine changes.

A later market generator can select ten kingdom piles from a larger library.
It must include at least one scoring conversion for each supported package.
It must not offer isolated setup cards without a compatible payoff.

Do not claim market balance from the first implementation.
Use saved human matches to identify dead cards and dominant purchase patterns.

## Intended strategies

The strategy names describe engines, not player roles.
Every engine must create ring-outs.

### Direct force

Buy Drive, Breaker, and Press.
Keep contact after the first push.
Use repeated displacement before the opponent can reposition.

This engine should score quickly but can become predictable.
Geometry cards can attack its alignment, and cheap movement can escape its pressure.

### Geometry

Buy Pull, Vault, Sweep, and Relay.
Create lines that basic movement cannot create.
Convert those lines into points with Shove or selected force cards.

This engine should offer flexible rescues and unexpected attack angles.
Its cards should provide less raw displacement than the force package.

### Confinement

Buy Block, Pin, and Corner.
Remove likely escape cells before applying displacement.
Use Corner as the scoring conversion.

This engine should reward planning across turns.
It should lose tempo when the opponent escapes through card movement.

### Flexible economy

Buy stronger treasure and selected cards from several packages.
Accept lower combo frequency in exchange for reliable future purchases.

This approach gives the market meaningful cross-package choices.
It also creates tension between tactical density and buying power.

## Human interface

Replace the replay controls with an interactive game surface.
Keep the current board's clear coordinate-free presentation.

Show these elements together:

- Board, pieces, statuses, blocks, score, and active player
- Human hand with card text and selectable card instances
- Remaining baseline moves for both human pieces
- Legal targets and destinations after each selection
- Shared market with costs, pile counts, and affordable states
- Human draw, discard, and played counts
- Public AI zone counts without its hidden hand
- Ordered action history with undo information for the current action phase
- End-action-phase, purchase, and end-turn controls
- AI thinking state and concise AI turn summary

Allow undo during the human action phase.
Store a turn-start snapshot and rebuild the preview after each undo.
Disable undo after the purchase commits or the AI turn starts.

### New game setup

Show an AI strategy selector and editable Markdown textarea.
Load each preset from a tracked file in `strategies/`.
Allow the user to paste or edit any strategy before starting the match.
Save the exact strategy text inside the game record.

Provide initial presets for Direct Force, Geometry, Confinement, and Flexible Economy.
The presets should define purchases, board priorities, acceptable risks, and tie breakers.

## AI behavior

Use ThinHarness because Deckfront already proves the integration pattern.
Default to `openai:gpt-5.6-luna` with low reasoning effort.
Allow model and effort overrides through server environment variables.

The system prompt defines rules and mandatory tactical priorities.
The editable Markdown defines strategic preferences.
The strategy cannot weaken legality, information limits, or win conditions.

Give the AI only this information:

- Complete public board state and action history
- Current score and turn state
- Market cards, prices, and pile counts
- Its own hand and unordered zone contents
- Public counts for the human deck zones
- Generated legal actions for its current decision

Do not reveal the human hand or either shuffled draw order.

### Harness tools

Run each AI turn inside a temporary transaction.
Commit only after every action passes engine validation.

Expose these constrained tools:

- `take_action(action_id)` applies one current legal board action.
- `undo_action()` reverts the last preview action.
- `restart_turn()` restores the AI turn-start snapshot.
- `enter_buy_phase()` closes board actions and auto-plays treasure.
- `buy_card(card_id)` buys one listed affordable card.
- `skip_buy()` records no purchase.
- `commit_turn()` validates and commits the complete turn.

Each successful tool call returns a fresh state briefing and fresh legal actions.
Each failed call returns a specific validation error without changing preview state.

### Tactical safeguard

Create a deterministic search for the maximum points available to the AI during its turn.
Use memoization over game state, unused cards, and remaining baseline moves.
Include required respawn choices in the search.
Calculate the target before the AI selects its first choice.

Maximize AI points first and minimize opponent points second.
Always require an available match-winning line.

Reject `enter_buy_phase()` when the AI scored fewer points than the known maximum.
Tell the AI how many points remain available.
Allow `restart_turn()` after this rejection.

This safeguard prevents missed immediate ring-outs.
The strategy prompt chooses among equally scoring lines and controls purchases.
Stop the match immediately when a searched line reaches five points.

## Application architecture

Use TypeScript for the game engine, server, and browser client.
Use React and Vite for the interactive client.
Use Zod at file, API, and saved-game boundaries.
Use Vitest for engine and integration tests.

Keep the server authoritative.
The browser must never calculate accepted state transitions.
The browser displays legal choices returned by the server.

Use a small Node HTTP server for these responsibilities:

- Create and load games
- Return a human-safe state view
- Apply human actions
- Start and monitor AI turns
- Persist state, seed, strategy, and events
- Export a complete match record

Run the ThinHarness Python bridge as a child process for each AI turn.
Follow Deckfront's existing Python harness and TypeScript CLI pattern.
Let the bridge call a TypeScript preview CLI against temporary snapshots.
Return one validated event sequence to the server.

Save active games under an ignored local data directory.
Use atomic file replacement for each committed action.
A browser refresh must restore the current game.

## State and event model

Store an initial state, committed commands, current state, and state version.
Store the current human or AI turn as a persisted draft command list.
Use the combined game state with these sections:

- Match configuration and random seed
- Active player, phase, score, and winner
- Board pieces, positions, statuses, blocks, and movement usage
- Deck zones, card definitions, supply, money, and buy usage
- Pending card or respawn choice
- AI strategy text and runtime configuration
- Ordered committed events

Every action produces a typed event.
Derive typed events while applying commands.
Rebuild any displayed history state by replaying committed commands from the initial snapshot.
Keep hidden information in the server record.
Redact hidden fields in the human-facing API.

Commit a draft by replaying its commands against its unchanged base version.
Use a per-game lock and atomically replace the saved game.
The Python bridge returns `baseVersion` and command identifiers.
The server never accepts state calculated by the bridge.

Export the full record for debugging.
Also support a redacted export suitable for sharing before match end.

## Error handling

Reject stale client actions with the current state version.
Reject unknown action identifiers and actions from the wrong phase.
Keep AI preview failures outside the committed game.
Show a retry control when the model or bridge fails.
Do not advance the turn after an AI failure.

Record ThinHarness prompts, tool calls, retries, and validation failures in local debug logs.
Do not send hidden human information to those prompts.

## Implementation sequence

### 1. Project foundation and deck engine

- Replace the vanilla setup with TypeScript, Vite, React, Zod, and Vitest.
- Port the required Deckfront deck behavior and its relevant tests.
- Remove unsupported victory cards, action limits, extra buys, and extra draw effects.
- Add the ten-card starting deck and treasure piles.
- Verify shuffling, purchases, cleanup, and card conservation.

Verification: run unit tests, typecheck, lint, and the production build.

### 2. Authoritative board engine

- Define the combined game state and legal action identifiers.
- Implement movement, displacement, occupancy, ring-outs, respawns, and statuses.
- Implement the three basic cards and ten kingdom cards.
- Add invariants for bounds, occupancy, scores, statuses, and card zones.
- Add targeted tests for every card and edge condition.

Verification: run unit tests, property-style invariant tests, typecheck, and lint.

### 3. Combined turn loop and tactical search

- Implement the action, buy, cleanup, and respawn phases.
- Add transactional previews and human undo.
- Add the deterministic maximum-point search.
- Add event logs, seeded replay, persistence, and exports.
- Test full turns and complete five-point matches.

Verification: replay saved fixtures and compare every derived state.

### 4. Interactive server and client

- Add game creation, action, state, undo, and export endpoints.
- Build the interactive board, hand, market, and history panels.
- Highlight only legal targets and destinations.
- Restore an active game after a browser refresh.
- Replace the scripted viewer rather than maintaining both applications.

Verification: run browser tests for one human turn, undo, purchase, and refresh.

### 5. ThinHarness opponent

- Add the Python bridge and constrained turn tools.
- Add Markdown strategy presets and the setup textarea.
- Enforce private information filtering.
- Enforce the deterministic point target before buy phase.
- Add retry and restart behavior for invalid or incomplete AI turns.
- Save full AI traces outside the public game state.

Verification: use a fake model for deterministic integration tests.
Run one opt-in live ThinHarness smoke test.

### 6. Playtest readiness

- Add match duration and purchase telemetry.
- Add clear card reference text in the client.
- Update the README with local and remote run instructions.
- Start the server and expose it through `bb connect`.
- Play at least one complete human versus AI match.
- Inspect the event log for illegal actions and missed immediate points.

Verification: run tests, typecheck, lint, production build, and a live smoke test.

## Required test coverage

Tests must cover these high-risk behaviors:

- Seeded shuffle and discard reshuffle
- Purchase into discard and supply decrement
- Five-card cleanup without extra draw
- Interleaved baseline moves and card plays
- Each card's legal and illegal targets
- Brace, Pin, and block expiration
- Multi-step displacement and blocked destinations
- Every board edge ring-out direction
- Respawn when both anchors are occupied
- Immediate five-point termination
- Undo without state drift
- Human hidden information removal
- AI transactional rollback
- No free trash action inherited from Deckfront
- Pin-to-Corner and Block-to-Corner reachability
- Stale legal action identifiers
- Concurrent commit rejection and crash recovery
- Respawn-aware tactical search
- Exact replay determinism
- Maximum-point search against known tactical fixtures
- Saved-game reload and event replay

## Deferred work

Do not include these features in the first implementation:

- Extra card draw or hand-size changes
- Opponent-turn reactions
- Online multiplayer or accounts
- Radius 3 or radius 4 boards
- Random board terrain
- Permanent piece upgrades
- Damage, health, or conventional attacks
- Automated market generation
- AI access to hidden opponent information
- Production hosting

## Playtest review

Review the first matches using evidence from saved records.
Track points per turn, match duration, purchases, unused cards, and AI retries.

Revisit extra draw only after the fixed hand produces clear deck choices.
Add draw only when a tested card needs it for a specific engine.
Avoid generic `+1 Card` effects because unlimited actions can create full-deck turns.

Review the board size after players use Pull, Vault, Sweep, Block, and Relay.
Increase the board only if these mechanics lack useful legal choices on 19 hexes.
