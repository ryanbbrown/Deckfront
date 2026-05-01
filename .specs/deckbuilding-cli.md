# Deckbuilding CLI

## Overview
Deckbuilding CLI is the game rules and interaction domain that allows one or more players to run a Dominion-lite card game entirely in a terminal, with the system automatically rendering full current game state after each state change and presenting a numbered list of all legal actions so humans and AI agents can drive gameplay deterministically, while also keeping a clean state model that can later power a separate view-only frontend.

## User stories
- A user can start a new single-player game so that they can take repeated turns alone without tracking another player.
- A user can start a new multi-player game so that players can alternate turns in one shared terminal session.
- A user can define cards and game setup data in YAML so that custom card sets and variants can be created without changing game logic.
- A user can define initial turn resources such as actions and buys so that rule variants can be configured.
- A user can define additional custom attributes so that non-standard card mechanics can be tracked even if they do not affect turn legality.
- A user can define initial hand size so that opening turns match the intended ruleset.
- A user can define each player's starting deck and separately define which cards are buyable in supply so that setup cards do not need to be purchasable.
- A user can see their full turn state (hand, draw pile size, discard pile size, trash summary, money, actions, buys, and other tracked attributes) so that they can choose legal actions confidently.
- A user can select actions from a numbered list so that both humans and AI agents can interact with the game without parsing free text.
- A user can play action cards that grant cards, actions, buys, money, or arbitrary custom attributes so that a broad set of Dominion-lite effects is supported.
- A user can resolve card effects that require discarding cards so that card costs and tradeoffs are enforced.
- A user can trash cards from hand or other eligible locations so that permanent deck-thinning effects are supported.
- A user can resolve lookahead effects over the top N cards so that they can draw, discard, trash, or reorder cards according to card text.
- A user can transition between phases only when legal so that turn flow remains rules-compliant.
- A user can have treasure value applied in the buy phase without spending actions so that money handling matches Dominion-lite expectations.
- A user can buy cards when they have enough buys and purchasing power so that deck growth behaves as expected.
- A user can end their turn so that cleanup happens and the next player (or next solo turn) starts correctly.
- A user can track victory points for scoring cards, including cards that grant permanent VP counters, so that final scoring reflects full game outcomes.
- When configured end-game conditions are met, the system should stop gameplay and present final scores and winner or ranking.
- When a player has no legal action besides phase transition or turn end, the system should still present those legal options in the numbered list.
- When input is invalid, the system should reject it and re-prompt without corrupting game state.

## Acceptance criteria
### Game setup and configuration
- GIVEN a valid game definition with cards, setup values, buyable supply piles, and end-game conditions, WHEN a game is started, THEN the system initializes all players and piles according to that definition.
- GIVEN a game definition that includes non-buyable starting cards, WHEN a game starts, THEN those cards appear in starting decks without being offered as buy options unless explicitly included in supply.
- GIVEN a game definition with default resources (actions, buys, money) and custom tracked attributes, WHEN a game starts, THEN default resources are initialized with gameplay semantics and custom attributes are initialized for tracking.
- GIVEN a game definition with invalid or missing required fields, WHEN a user attempts to start a game, THEN the system reports a clear validation error and does not start gameplay.
- GIVEN a multi-player game definition, WHEN the game starts, THEN turn order is established and exactly one player is marked active.

### Turn and phase flow
- GIVEN a new turn starts, WHEN the turn state is entered, THEN the system automatically renders current state and the full numbered list of legal actions without requiring a separate request command.
- GIVEN the action phase and at least one legal action play, WHEN legal options are rendered, THEN each legal action appears as a distinct numbered option plus any legal phase-transition option.
- GIVEN zero remaining actions, WHEN legal options are rendered in the action phase, THEN action-card play options are excluded and legal transition options remain.
- GIVEN buy phase begins, WHEN state is rendered, THEN available treasure value from eligible cards is applied to purchasing power without requiring action-phase card plays.
- GIVEN buy phase with at least one buy and enough purchasing power for some supply cards, WHEN legal options are rendered, THEN each purchasable card appears as a numbered option.
- GIVEN buy phase with zero buys, WHEN legal options are rendered, THEN purchase options are excluded and only legal non-purchase options remain.
- GIVEN end-of-turn cleanup is reached, WHEN the player ends turn, THEN played cards and hand are moved to discard as defined, a new hand is drawn, and active player advances.

### State visibility and interaction format
- GIVEN any point during gameplay, WHEN the terminal renders turn state, THEN it includes active player identity, phase, hand contents, resource counters, and deck/discard/trash summaries.
- GIVEN the system presents legal actions, WHEN it renders options, THEN each option has a stable index for that prompt cycle and a human-readable description.
- GIVEN a player selects a valid numeric option, WHEN the command is processed, THEN the matching action resolves exactly once and state is re-rendered with the next legal options.
- GIVEN a player selects an out-of-range or non-numeric option, WHEN the command is processed, THEN state is unchanged and the user receives a retry prompt.
- GIVEN a player attempts to inspect discard pile details or trash details, WHEN the command is processed, THEN the system rejects it because detailed inspection is out of scope for this version.

### Card effect resolution
- GIVEN a card that grants +cards, +actions, +buys, +money, or custom attributes, WHEN the card is played legally, THEN all granted effects are applied for the current turn.
- GIVEN an optional card sub-effect, WHEN that step is reached, THEN the numbered options include at least one explicit skip option such as finishing the remaining effect.
- GIVEN a card that requires discarding one or more cards, WHEN the effect resolves, THEN the player is prompted with only eligible discard choices until requirement is satisfied or the effect's optional skip rule is selected.
- GIVEN a card that trashes cards, WHEN the player chooses eligible cards, THEN those cards move to trash and are removed from future draw/discard cycles.
- GIVEN a lookahead effect over top N cards, WHEN it resolves, THEN only those N cards are exposed for the decision flow and resulting destinations/order match selected legal operations.
- GIVEN draw is required but draw pile is exhausted, WHEN draw resolves, THEN discard is shuffled into draw pile and drawing continues until requirement is met or no cards remain.

### Victory points and game end
- GIVEN cards with victory point values and/or persistent VP counters, WHEN scores are requested, THEN each player total includes all scoring-relevant cards and VP counters owned by that player.
- GIVEN configured end-game condition is met using boolean logic over public game state using simple comparisons combined with AND/OR, WHEN the triggering event completes, THEN gameplay ends immediately after resolving the current action boundary defined by rules.
- GIVEN game end in multi-player mode, WHEN final scores are tied, THEN tie-break follows turn-count parity rules where a player with fewer turns wins and equal turns remains a true tie.
- GIVEN game end, WHEN results are displayed, THEN final scores for all players and winner or tie outcome are shown.

### Scope boundaries for Dominion-lite rules
- GIVEN a card definition that attempts to target or alter another player's state directly, WHEN validation runs, THEN the system rejects the definition as unsupported in this version.
- GIVEN non-attack self-contained action cards, WHEN definitions are valid, THEN they are eligible for gameplay.

## Constraints
- This domain does not include attack interactions, reaction windows, or any effect that requires hidden simultaneous responses from other players.
- This domain does not include networked multiplayer, remote clients, or asynchronous play.
- This domain does not include AI strategy or auto-play decision making beyond enumerating legal actions.
- The system must always enforce legality so users cannot execute impossible actions.
- The numbered action list must reflect all and only currently legal choices at prompt time.
- Game state transitions must be deterministic given the same random seed and same sequence of choices.
- Validation errors must be explicit enough for a user to fix malformed card or setup data.
- The game must support both single-player and local multi-player in the same terminal experience.
- Performance must remain interactive for typical Dominion-lite deck sizes without noticeable command-to-response lag.
- State representation should stay renderer-agnostic so the same state can later drive a separate view-only frontend without changing gameplay authority in the terminal.
- Persistent effects are out of MVP scope except permanent VP counters used for scoring.

## Open questions
- None currently.
