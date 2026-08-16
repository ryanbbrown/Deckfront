# Distance duel experiment

## Status

This is the approved behavior plan for one small playtest. The technical implementation plan lives in `06-distance-duel-technical.md`.

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
7. Players can choose a starting build that expresses an intended strategy and explain how later purchases support or change it.

## Arena

The arena is one line with exactly five spaces:

```text
[1] [2] [3] [4] [5]
```

- Player 1 starts on space 2.
- Player 2 starts on space 3.
- Fighters can share a space.
- Fighters can move onto and past each other.
- Both ends are walls. The walls do not belong to either player.

The starting positions are not perfectly symmetric on a five-space line. Seat-swapped playtests should show whether the difference matters.

### Range

Range is the difference between the fighters' positions:

| Difference between positions | Range |
| --- | --- |
| 0 | Close |
| 1 | Near |
| 2 or more | Far |

For example, two fighters on space 3 are Close. Fighters on spaces 2 and 3 are Near. Fighters on spaces 1 and 3 are Far.

### Movement

- Left moves the active fighter one space toward space 1.
- Right moves the active fighter one space toward space 5.
- A fighter cannot move beyond space 1 or space 5.
- Another fighter never blocks movement.

### Forced movement

- Drive's player chooses Left or Right for the push.
- Push moves only the target one space in the chosen direction.
- If a wall prevents the push, the target suffers the listed collision damage and does not move.
- The actor does not follow the target.

## Objective

Each fighter starts with 20 health. The first player to reduce the opponent to 0 health wins immediately.

Health does not recover unless a later card explicitly says so. The first experiment has no healing cards.

## Turn structure

Players take complete turns. There are no alternating actions inside a turn.

1. Play any number of Action cards from hand, one at a time, in any chosen order.
2. Resolve each card completely before playing another card.
3. Play all Treasure cards.
4. During the player's first buy phase, add any money left from that player's starting build.
5. Buy any number of cards whose total cost does not exceed the available money. Put bought cards in the discard pile.
6. Discard the remaining hand and every played card.
7. Draw five cards.
8. Give the opponent the next complete turn.

Money not spent during a normal buy phase expires at the end of the turn. There is no per-piece card limit, purchase limit, or generic action-point resource. A card can restrict its own timing through range or a condition.

## Conditions

The first experiment uses only two named conditions.

### Exposed

- Exposed increases the next Close damage suffered during the current turn by 2.
- Remove Exposed after the bonus applies.
- Unused Exposed expires at the end of the active player's turn.

### Aimed

- Aimed changes the next Volley played during the current turn.
- At Near range, an Aimed Volley deals 5 damage instead of 2.
- At Far range, an Aimed Volley deals 7 damage instead of 5.
- Remove Aimed after it changes a Volley.
- Unused Aimed expires at the end of the active player's turn.

## Starting build

Before the game, each player receives:

- seven Copper cards, each of which provides 1 money;
- 12 money to spend on any cards from the market.

A player can buy any number of cards during the starting build. Add those cards to the player's seven Copper cards to form the starting deck. The starting deck can contain any number of cards.

Any unspent starting money carries into that player's first buy phase. It does not become part of the deck. Each player completes the starting build without seeing the other player's choices. After both players finish, reveal the completed starting builds, shuffle each deck, and draw five cards.

Starting Copper cards and cards bought during the starting build do not reduce the market piles.

## Base market

Base Treasure piles are available in every game.

| Card | Cost | Ability |
| --- | --- | --- |
| Copper | 0 | Provide 1 money. |
| Silver | 3 | Provide 2 money. |
| Gold | 6 | Provide 3 money. |

A player can buy any number of Copper cards. Adding too many Copper cards will make the player's useful combinations less reliable.

## First action market

The complete first market is visible from the beginning. It does not rotate.

| Card | Cost | Ability | Main role |
| --- | --- | --- | --- |
| Footwork | 2 | Move one space Left or Right, then draw one card. | Shared movement and combo extension. |
| Cull | 3 | Trash exactly two cards. Choose Cull and one card from hand, or choose two cards from hand. Cull cannot trash other cards already played this turn. | Shared deck control. |
| Muster | 5 | Draw two cards. | Shared long-turn engine. |
| Feint | 3 | At Close range, give the opponent Exposed. | Close setup. |
| Drive | 4 | At Close range, deal 2 damage, then push Left or Right. A wall collision deals 2 additional damage. | Close payoff and pressure. |
| Flurry | 5 | At any range, deal 1 damage for each other Action card played this turn, to a maximum of 5 damage. | Shared long-turn payoff. |
| Aim | 3 | At Near or Far range, become Aimed, then draw one card. | Ranged setup and combo extension. |
| Volley | 5 | Deal 2 damage at Near range or 5 damage at Far range. | Ranged payoff. |

Each pile contains ten copies for the first experiment.

## Intended strategy: close pressure

The close player wants to stay adjacent, force the opponent toward a wall, and produce turns such as:

```text
Footwork -> Feint -> Drive -> Flurry
```

One possible starting build is Footwork, Feint, and Drive for 9 money, with 3 money carried into the first buy phase. A player can instead test repeated payoff cards or choose Treasure, draw, or trashing cards. Later purchases should respond to the opponent's deck and position.

The close strategy should be strong after it reaches Close range. It should lose efficiency when it cannot draw movement cards or when the ranged fighter moves through it and creates distance.

## Intended strategy: ranged setup and payoff

The ranged player wants to move through or away from the opponent, create distance, and produce turns such as:

```text
Footwork -> Footwork -> Aim -> Volley
```

One possible starting build is two Footwork, Aim, and Volley for 12 money. A player can instead test repeated Volley cards or choose Treasure, draw, or trashing cards. Later purchases should respond to the opponent's deck and position.

The ranged strategy should deal efficient damage at Far range. At Near range, Aim should make one Volley stronger than two unprepared Volleys. The strategy should lose efficiency when the close player shares its space or when the ranged player draws Volley without movement or Aim.

## Why repeated payoff cards should not be enough

- Drive requires Close range and becomes stronger after Feint or against a wall.
- Flurry requires several earlier Action cards.
- At Near range, Aim plus Volley deals 5 damage while two Volley cards deal 4.
- At Far range, two Volley cards deal more immediate damage than Aim plus Volley, but Aim costs less and draws a card.
- Footwork extends combinations while changing the board state.
- Muster and Cull improve the chance of drawing a complete sequence.

The first balance question is whether these dependencies are strong enough to reward a complete deck plan without making setup cards feel useless alone. Starting builds can include repeated payoff cards so the playtest can compare them directly with complete combinations.

## Future tension: speed or growth

Both position strategies should eventually support two deck-building plans:

- A fast deck buys damage and movement, may trash a small number of weak cards, and tries to win before the opponent's deck improves.
- A growth deck spends early money on Treasure, draw, and trashing. It accepts weaker early turns to buy several cards at once and produce larger combinations later.

Fighter health determines how much time a growth deck has before the fast deck wins. The first experiment does not need to balance this tension, but its rules should leave room for both plans.

## Future market variety

The fixed first market tests whether Close and Ranged work at all. A later version can use a larger card library and select only part of it for each game. The visible market, starting build, opponent's purchases, and current positions should all affect which strategy looks strongest. The first experiment does not need enough cards to test variable markets.

## Human and AI players

The human chooses which strategy prompt the AI receives. The initial prompts tell the AI to play either close pressure or ranged setup and payoff. The prompt guides decisions but does not restrict legal cards, purchases, or actions. Strategy prompts remain easy to edit between games.

The human does not select a strategy through the game rules. The human can build and play any deck. For the first playtests, the human should attempt the strategy opposite the AI prompt.

The human and AI choose their starting builds independently. Neither player sees the other starting build until both builds are complete. Starting builds and later purchases are public after they occur. Hands and draw-pile order remain hidden.

The setup lets the human choose which player takes the first turn.

During its turn, the AI chooses one legal action at a time. It can reconsider after each card draw. It continues until it ends its Action phase, then buys cards one at a time until it ends its buy phase.

## Playtest protocol

Run at least four complete games:

1. The human plays close pressure, the AI prompt specifies ranged setup, and the human takes the first turn.
2. The human plays ranged setup, the AI prompt specifies close pressure, and the human takes the first turn.
3. The human plays close pressure, the AI prompt specifies ranged setup, and the AI takes the first turn.
4. The human plays ranged setup, the AI prompt specifies close pressure, and the AI takes the first turn.

Before each game, record:

- each player's starting build;
- money left for each player's first buy phase;
- each player's reason for the starting build.

For each turn, record:

- hand;
- cards played in order;
- damage dealt;
- starting and ending positions;
- cards bought;
- stated reason for each purchase;
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
- Both players choose starting builds and later purchases that clearly support their stated strategy.
- Both players produce at least one turn with four or more Action cards.
- Repeated Footwork creates a real escape from Close pressure.
- A player who draws a payoff without its setup has a weaker but still understandable turn.
- Neither player can follow one fixed starting build and purchase order without considering the opponent's deck and current position.

Four games cannot establish balance. They can show whether both strategies function and whether the game produces the intended decisions.

## Out of scope for the first experiment

- a larger or symmetric map;
- more than one fighter per player;
- alternating actions;
- a rotating market;
- reactions played during the opponent's turn;
- healing;
- Guard or other defensive conditions;
- poison, Bleed, or other damage-over-time conditions;
- asymmetric starting resources or player powers;
- more than the two intended position strategies;
- full balance between fast and growth decks;
- compatibility with the current ring-out rules or saved games.

## Questions to answer from play, not before it

- Is 20 health too high or too low?
- Do seven starting Copper cards dilute the chosen cards too much or too little?
- Does the 12-money starting build reach useful combinations quickly enough?
- Does carried starting money create a fair first buy phase?
- Do unlimited purchases make Treasure useful without making growth too fast?
- Does Close need more help approaching?
- Does the space 2 and space 3 start give either seat a meaningful wall advantage?
- Does sharing spaces make Close pressure clear and useful?
- Can repeated Footwork create distance often enough for the ranged player to escape?
- Does Footwork help both strategies, or does one strategy value it much more?
- Are Muster and Cull worth buying before another payoff card?
- Does unrestricted Flurry become an automatic purchase for both strategies?
- Is Aimed Volley strong enough at Near range without being too strong at Far range?
- Is Far-range Volley too safe after the ranged engine becomes reliable?
