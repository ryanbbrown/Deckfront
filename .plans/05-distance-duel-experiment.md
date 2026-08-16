# Distance duel experiment

## Status

This is a shared design draft. It defines one small playtest, not an approved implementation plan.

## Goal

Test whether a fixed deck-building market can support two different planned strategies:

- close pressure;
- ranged setup and payoff.

Each player should choose a strategy from the visible market, buy cards that make the strategy more reliable, and produce stronger card combinations as the game continues.

The first experiment does not need a large card pool. It needs two understandable strategies that can both win and that produce different turns.

## What this experiment must prove

1. Complete player turns preserve satisfying card combinations.
2. Card order matters because cards create and consume conditions.
3. Buying several related cards is better than buying the strongest isolated effect.
4. Close pressure can trap and damage an opponent.
5. A ranged player can escape pressure and rebuild distance.
6. Neither strategy wins mainly by buying repeated copies of one payoff card.
7. Players can state their intended strategy by the end of their second purchase.

## Arena

The arena is one line with exactly five spaces:

```text
[1] [2] [3] [4] [5]
```

- Player 1 starts on space 2.
- Player 2 starts on space 4.
- Fighters cannot share a space.
- Fighters cannot pass each other through normal movement.
- Vault is the only card in this experiment that can change the fighters' order.
- Both ends are walls. The walls do not belong to either player.

### Range

Range describes the number of spaces between the fighters:

| Difference between positions | Range |
|---:|---|
| 1 | Close |
| 2 | Mid |
| 3 or 4 | Far |

For example, fighters on spaces 2 and 3 are Close. Fighters on spaces 1 and 5 are Far.

### Movement

- Advance moves the active fighter one empty space toward the opponent.
- Withdraw moves the active fighter one empty space away from the opponent.
- A fighter cannot move beyond space 1 or space 5.
- After the fighters change sides through Vault, Advance and Withdraw still use their current relative positions. They do not use an owned side of the arena.

### Forced movement

- Push moves the target one space directly away from the actor.
- If the target moves, Follow moves the actor into the target's previous space.
- If a wall prevents a push, the target suffers the listed collision damage and does not move.
- A push and follow leaves the fighters Close.

This rule lets a pressured fighter use `Vault`, cross the opponent, and then use `Footwork` to Withdraw toward open space.

## Objective

Each fighter starts with 20 health. The first player to reduce the opponent to 0 health wins immediately.

Health does not recover unless a later card explicitly says so. The first experiment has no healing cards.

## Turn structure

Players take complete turns. There are no alternating actions inside a turn.

1. Play any number of Action cards from hand, one at a time, in any chosen order.
2. Resolve each card completely before playing another card.
3. Play all Treasure cards.
4. Buy up to one card.
5. Discard the remaining hand and every played card.
6. Draw five cards.
7. Give the opponent the next complete turn.

There is no per-piece card limit and no generic action-point resource. A card can restrict its own timing through range or a condition.

## Conditions

The first experiment uses only three named conditions.

### Guard

- Guard reduces the next damage the fighter would suffer by the listed amount.
- Remove Guard after it reduces damage.
- Unused Guard expires at the start of its owner's next turn.
- Guard does not prevent forced movement.

### Exposed

- Exposed increases the next Close damage suffered during the current turn by 2.
- Remove Exposed after the bonus applies.
- Unused Exposed expires at the end of the active player's turn.

### Aimed

- Aimed increases the next ranged attack played during the current turn by 2 damage.
- A ranged attack is an attack that requires Mid or Far range.
- Remove Aimed after the bonus applies.
- Unused Aimed expires at the end of the active player's turn.

## Starting deck

Each player starts with the same ten cards:

| Count | Card | Ability |
|---:|---|---|
| 6 | Copper | Provide 1 money. |
| 2 | Step | Advance or Withdraw one space. |
| 1 | Jab | At Close range, deal 1 damage. |
| 1 | Brace | Gain 2 Guard. |

Starting cards are not market piles unless the market lists them separately.

## Base market

Base Treasure piles are available in every game.

| Card | Cost | Ability |
|---|---:|---|
| Copper | 0 | Provide 1 money. |
| Silver | 3 | Provide 2 money. |
| Gold | 6 | Provide 3 money. |

## First action market

The complete first market is visible from the beginning. It does not rotate.

| Card | Cost | Ability | Main role |
|---|---:|---|---|
| Footwork | 2 | Advance or Withdraw one space, then draw one card. | Shared movement and combo extension. |
| Brace | 2 | Gain 3 Guard. | Shared defense. |
| Cull | 3 | Trash exactly two cards. Cull can be one of them. | Shared deck control. |
| Muster | 5 | Draw two cards. | Shared long-turn engine. |
| Feint | 3 | At Close range, give the opponent Exposed. | Close setup. |
| Drive | 4 | At Close range, deal 2 damage, then push and follow. A wall collision deals 2 additional damage. | Close payoff and pressure. |
| Flurry | 5 | At Close range, deal 1 damage for each other Action card played this turn, to a maximum of 5 damage. | Close finisher. |
| Vault | 3 | At Close range, jump over the opponent into the empty space directly beyond it, then draw one card. | Ranged escape and combo extension. |
| Aim | 3 | At Mid or Far range, become Aimed, then draw one card. | Ranged setup. |
| Volley | 5 | Deal 2 damage at Mid range or 5 damage at Far range. | Ranged payoff. |

Each pile contains ten copies for the first experiment.

## Intended strategy: close pressure

The close player wants to stay adjacent, force the opponent toward a wall, and produce turns such as:

```text
Footwork -> Feint -> Drive -> Flurry
```

Likely purchases:

1. Footwork or Feint;
2. Drive;
3. Flurry;
4. Muster or Cull to make the combination more reliable.

The close strategy should be strong after it reaches Close range. It should lose efficiency when it cannot draw approach cards or when Vault changes the fighters' order.

## Intended strategy: ranged setup and payoff

The ranged player wants to cross the opponent when trapped, create distance, and produce turns such as:

```text
Vault -> Footwork to Withdraw -> Aim -> Volley
```

Likely purchases:

1. Vault or Footwork;
2. Aim;
3. Volley;
4. Muster or Cull to make the combination more reliable.

The ranged strategy should deal efficient damage at Far range. It should lose efficiency when the close player stays adjacent or when the ranged player draws Volley without movement or Aim.

## Why repeated payoff cards should not be enough

- Drive requires Close range and becomes stronger after Feint or against a wall.
- Flurry requires several earlier Action cards.
- Volley requires Mid or Far range and becomes stronger after Aim.
- Vault and Footwork extend combinations while changing the board state.
- Muster and Cull improve the chance of drawing a complete sequence.

The first balance question is whether these dependencies are strong enough to reward a complete deck plan without making setup cards feel useless alone.

## Playtest protocol

Run at least four complete games:

1. Player 1 uses close pressure; Player 2 uses ranged setup.
2. Swap strategies without changing the starting player.
3. Close pressure starts again with the other player taking the first turn.
4. Swap strategies again.

For each turn, record:

- hand;
- cards played in order;
- damage dealt;
- starting and ending positions;
- purchase;
- stated reason for the purchase;
- intended next combination.

After each game, record:

- winner and remaining health;
- number of turns;
- each player's purchases;
- largest combination;
- turns where a player had no useful line;
- whether either player abandoned the assigned strategy;
- whether repeated Drive or repeated Volley was better than buying setup and engine cards.

## Initial success criteria

The experiment is promising when all of these are true:

- Each strategy wins at least one of the four seat-swapped games.
- Most damage after the opening turns comes from sequences of at least two related Action cards.
- Both players make purchases that clearly support their stated strategy.
- Both players produce at least one turn with four or more Action cards.
- Vault plus withdrawal creates a real escape from wall pressure.
- A player who draws a payoff without its setup has a weaker but still understandable turn.
- Neither player can follow one fixed purchase order without considering the opponent's deck and current position.

Four games cannot establish balance. They can show whether both strategies function and whether the game produces the intended decisions.

## Out of scope for the first experiment

- a larger map;
- more than one fighter per player;
- alternating actions;
- a rotating market;
- reactions played during the opponent's turn;
- healing;
- poison, Bleed, or other damage-over-time conditions;
- asymmetric starting decks;
- more than the two intended strategies;
- compatibility with the current ring-out rules or saved games.

## Questions to answer from play, not before it

- Is 20 health too high or too low?
- Does Close need more help approaching?
- Is Vault available often enough for the ranged player to escape?
- Does Footwork help both strategies, or does one strategy value it much more?
- Does Brace create a useful timing decision or only delay the game?
- Are Muster and Cull worth buying before another payoff card?
- Does Flurry reward a long combination without becoming the only close finisher?
- Is Far-range Volley too safe after the ranged engine becomes reliable?
