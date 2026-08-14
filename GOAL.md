# Prototype Brief: Dominion-First Deckbuilder With a Minimal Spatial Game

## Goal

We are exploring a new board game concept that is primarily a **Dominion-style deckbuilder**, but with a small spatial/positional layer that makes the game more directly interactive and gives the deck an interesting external objective.

The intended experience is:

1. At the beginning of a game, players see a fixed shared market selected from a larger card pool.
2. They inspect that setup and form an overarching strategy: which cards synergize, what kind of engine they want to build, what capabilities they want to emphasize, etc.
3. They execute that strategy over the course of the game.
4. A small shared board creates tactical decisions and direct competition between the players.
5. The tactical board should **not overwhelm the deck-building**. The deck-building should remain the main strategic system.

This is deliberately different from the larger game Deckfront, which combines deck-building with a full 5v5 tactical hex skirmish. In Deckfront, troop movement and tactical combat become a major part of the game. Here, we want something significantly simpler and more elegant spatially.

A useful reference for the desired complexity ratio is Gudnak: position matters and pieces move around, but the spatial state is extremely compact. We do **not** want something like Trains, Quest for El Dorado, or a large tactical map where navigating the board becomes one of the main games.

## Strategic design goal

The distinction between **strategy and tactics** is important.

Strategy is the long-term plan created from reading the initial setup:

* Which cards work well together?
* What kind of interaction engine can I build?
* Should I emphasize displacement, mobility, control, consistency, etc.?
* What cards are weak independently but become powerful when combined?
* Does the current spatial setup make certain market strategies more attractive?

Tactics are the local decisions:

* Where should I move now?
* Which piece should I push?
* Should I defend or advance?
* Should I use an ability now or save it?
* How do I respond to the opponent's current position?

The goal is for **the market + the initial board/setup to jointly influence strategy**, while the evolving position determines tactical execution.

We want to avoid cards that effectively dictate tactics, such as "always keep your pieces adjacent for a bonus." The cards should primarily determine **what capabilities your deck has**, while the player remains free to decide how to use those capabilities tactically.

## Current loose direction

Nothing below should be treated as final.

### Board

Start with a very small hexagonal board.

Candidate sizes:

* Radius 3: 19 hexes.
* Radius 4: 37 hexes only if radius 3 proves too constrained.

Do not increase the map merely to make "+1 movement" or "+1 range" upgrades interesting. If the core game needs a large map for its mechanics to work, it is probably drifting back toward Deckfront.

The board can eventually contain a small number of variable elements, but avoid randomizing every hex. A few special spaces, obstacles, goals, or setup elements are preferable.

Board variation should ideally change the **strategic value of different deck builds**, rather than merely create different pathfinding puzzles.

### Pieces

Start with:

* 2 pieces per player.
* Pieces are probably identical initially.
* No HP.
* No conventional attacks.
* No killing through damage.

Positional interaction should be the important thing: pushing, blocking, swapping, pinning, displacement, protecting space, breaking through, etc.

Permanent unit upgrades are **not currently assumed**. Deckfront uses permanent stat development, but this game may be cleaner if the deck itself supplies differentiation.

### Actions

A major working assumption is:

**Do not use Dominion's action limit. Players can play all cards in their hand.**

The interesting constraint should be which cards they chose to put into their deck and how those capabilities can be applied to the board, not whether they happened to draw enough +Action cards.

Similarly, basic board agency should probably not require drawing the appropriate card. Avoid situations where a player draws badly and therefore cannot meaningfully move or participate.

Likely starting rule:

* Pieces have some small amount of baseline movement every turn.
* Cards provide additional leverage: pushes, swaps, special movement, control, etc.

Be careful with unrestricted card draw. If every card can be played and +draw is common, decks may easily become trivial "draw the entire deck" engines. Initially, either omit draw entirely or make it uncommon/conditional. Thinning, cycling, and consistency can still be strategically important.

## Possible board objectives

The board objective is the largest unresolved design question.

We should test several simple objectives before building the actual deck-building system.

### 1. Push-out / Sumo

Pieces cannot take damage.

Players use movement and displacement effects to force opposing pieces off the board.

Possible scoring models:

* A pushed-out piece is permanently removed.
* It respawns and pushing pieces out scores points.
* First player to score X ring-outs wins.

Advantages:

* Very direct competition.
* Position matters enormously on a tiny board.
* Push/pull/swap mechanics naturally matter.
* No combat bookkeeping.

### 2. Breakthrough

Each player is trying to move one of their pieces through a designated section of the opponent's side of the board.

Interaction consists of:

* blocking,
* screening,
* pushing,
* repositioning,
* opening lanes,
* defending lanes.

This creates offensive and defensive roles without HP or conventional combat.

### 3. King / Core Piece

Each player has one particularly important piece.

Potential objective:

* push the enemy Core off the board,
* move your Core to a destination,
* trap or displace the opponent's Core.

The second piece exists primarily to screen, manipulate, protect, and create tactical combinations.

### 4. Shared capture objective

One small objective area exists on the board.

Examples:

* occupy it at the start of your next turn,
* hold it for a full round,
* score repeatedly by controlling it.

This should not become broad area control. The intent is one concrete positional objective, not majority control across regions.

### 5. Neutral relic / ball

A neutral object begins near the center and both players manipulate it.

Potential goals:

* deliver it through an opponent-facing goal,
* bring it onto a scoring hex and hold it,
* move it to one of several targets.

This is worth testing but should not be assumed to be the winner. A "deck-building soccer game" may or may not actually create the strategic experience we want.

## Possible interaction vocabulary

Do not design a full card set yet. Instead, use a small set of prototype abilities to determine whether the board game itself is interesting.

Potential verbs:

* Move
* Dash
* Push
* Pull
* Swap
* Sidestep
* Pin / slow
* Anchor / resist displacement
* Block a hex temporarily
* Move through another piece
* Reposition after pushing
* Redirect a push
* Counter-push

The exact effects do not matter yet. We want to discover which interactions create interesting positional decisions.

## Eventual deck-building philosophy

If the positional kernel works, the deck should create different **interaction engines**.

Deckfront's strategic question is roughly:

> What kind of units do I build?

This game's strategic question could instead be:

> What kind of interaction engine do I build?

Examples of eventual strategic packages might include:

* strong displacement,
* high mobility/repositioning,
* defensive anchoring/control,
* combo-heavy push chains,
* flexible generalist cards,
* highly consistent thin decks,
* setup/payoff combinations.

Card synergy is particularly important because we are removing Dominion's Action/+Action structure.

We want cards where A and B become substantially stronger together.

Examples only:

* One card pushes an enemy.
* Another card triggers or improves after an enemy has already been pushed this turn.
* One card marks a piece Off-Balance.
* Several different cards exploit Off-Balance.
* One card creates a temporary obstacle.
* Another can push pieces through/around obstacles or gains value from them.
* One card enables unusual positioning.
* Another converts that positioning into a stronger displacement effect.

The best strategic setups should emerge from **multiple cards interacting**, rather than a card simply announcing "this is the Push Strategy."

Ultimately, we want a player to inspect a market and think:

> "Because these three cards are present, and because this particular board/setup favors these interactions, I think I can build a strong displacement engine."

The opponent may identify a completely different viable plan.

## What to prototype first

Do **not** implement the full deckbuilder yet.

The first prototype should answer:

> Is the tiny spatial interaction game itself interesting enough that deck-building would be worth layering on top?

Use **prebuilt hands / scripted abilities** rather than decks, shuffling, purchasing, currencies, or markets.

For example:

Player A could simply be given:

* Push
* Swap
* Dash
* Anchor

Player B could be given:

* Pull
* Sidestep
* Block
* Counter-push

These abilities can initially be reusable, once-per-round, or otherwise arbitrarily limited. Their eventual card/economy implementation does not matter yet.

Run short games or manually scripted 5–10 turn sequences.

## Variables that should be easy to change

Build the prototype so these can be adjusted quickly:

* board radius,
* number of pieces per player,
* starting positions,
* baseline movement,
* whether every piece moves each turn,
* objective type,
* respawn/removal rules,
* special hexes,
* available abilities,
* ability cooldown/use restrictions,
* victory threshold.

The point is rapid rules experimentation, not a polished implementation.

## First limit tests

Test these independently as much as possible:

1. **Objective**

   * Push-out
   * Breakthrough
   * King/Core
   * Single capture objective
   * Neutral relic

2. **Board size**

   * Radius 3 first.
   * Radius 4 only if the smaller board clearly lacks enough positional room.

3. **Piece count**

   * 2v2 first.
   * Try 3v3 only if 2v2 cannot generate enough blocking/interference.

4. **Baseline movement**

   * Probably 1 hex per piece per turn as a starting point.
   * Compare all pieces moving each turn versus choosing only one.

5. **Interaction mechanics**

   * Determine which of push/pull/swap/pin/block/etc. actually generate interesting decisions.

6. **Win pressure**

   * Make sure stalling, circling, or permanently defending is not optimal.

7. **State readability**

   * A player should be able to look at the board and understand the tactical situation quickly.

## What success looks like

Do not care much about balance yet.

The prototype succeeds if it repeatedly creates turns where:

* multiple plausible moves exist,
* positioning from previous turns matters,
* the opponent can meaningfully interfere,
* abilities combine in interesting ways,
* offensive and defensive uses of the same capabilities emerge,
* small positional differences matter,
* the state remains easy to read,
* the board creates interesting decisions without consuming more thought than the eventual deck-building layer should.

If the board interaction is boring when both players are simply **given interesting abilities for free**, building an elaborate market and deck system will probably not fix it.

If the positional kernel is fun, then the next step is to convert those abilities into a Dominion-style fixed market and investigate whether different market combinations create genuinely different long-term strategies.
