# Skirmish Rules Draft

> **Historical draft:** This document is superseded and is not gameplay authority. The current rules and values are defined by `game/board-rules.md`, `game/units.json`, `game/deck.yaml`, and `game/run.yaml`.

Working spec for the next generation of Deckfront. This is a scratch document for iteration, not a committed ruleset. Nothing here is implemented yet.

The previous generation (territory control with recruiting, supply centers, and income) is a different game and is being retired. Nothing in this document should be read as a variant of it.

## Design Intent

Two players, five units each, no reinforcements. Your deck permanently upgrades individual units. You win by killing everything the opponent has.

The deck stays relevant for the entire game because every card pays out each time it is drawn. Cards are never consumed, never attached, and never converted into one-time board effects. Improving deck density and draw keeps mattering on the last turn as much as the first.

### What version 1 has to answer

Is it actually viable to build meaningfully different units — a very fast soldier, a very long-ranged archer, a hard-hitting brawler — or does the upgrade economy collapse into one correct build?

Everything else is subordinate to that question. Version 1 is deliberately thin: no interaction cards, no terrain manipulation, no conditional cards. A dozen or so cards total. It will feel sparse to play. That is correct for a tuning experiment, because a wider pool would make it impossible to tell whether a build won on its merits or on card draw.

## Units

Two types. Stats below are provisional starting points, not settled values — they are the first thing to tune.

| | Soldier | Archer |
|---|---|---|
| HP | 4 | 3 |
| Attack | 1 | 1 |
| Range | 1 | 2 |
| Movement | 4 | 2 |

The soldier is the mobile one and the archer is the emplaced one. This is deliberately inverted from convention: the archer's defense is position, walls, and line of sight rather than mobility, and the soldier is the unit that closes, strikes, and disengages. Movement needs a real spread between them — if the two are within one point of each other, the soldier can never dictate an engagement.

Every unit is a distinct, persistent object with its own stats. Two soldiers that started identical will diverge as you upgrade them.

## Army Setup

Each player has exactly five units and chooses the distribution between soldiers and archers at setup.

There is no recruiting, no reinforcement, and no revival. A dead unit is gone for the rest of the game, and every upgrade invested in it is gone with it.

Players also draft starting cards before turn one, as in the previous generation. Budget and available cards are open.

## The Board

A hex map, smaller than the previous generation's. Dimensions to be supplied.

**Walls** occupy hexes. They block movement and they block line of sight.

There are no supply centers, no home bases, no board income, and no board-side money. The map's only job is to create the geometry that positioning decisions happen inside.

## Turn Structure

Players alternate full turns.

1. **Trash.** Optionally trash one card from hand.
2. **Play.** Play every card drawn. Cards produce money and upgrade symbols.
3. **Buy.** Spend money on cards from the supply.
4. **Upgrade.** Spend symbols on permanent stat raises.
5. **Activate.** Activate each of your units, one at a time, in any order.
6. **Check for a winner.**

Symbols and money do not carry between turns.

## Deck

**There are no actions.** You play every card you draw. Draw is therefore the only engine axis and has to be priced expensively to compensate.

This means Village and similar action-splitting cards have no function and do not exist. It also means deck thinning is the main way to raise quality, so trashing carries more weight than it does in a conventional deckbuilder — hence the start-of-turn trash, carried over from the previous generation.

Cards are never consumed by producing symbols. A card that gives one attack symbol gives one attack symbol every single time it is drawn, forever.

### Card categories in version 1

- **Money.** Conventional treasure.
- **Symbol cards.** Produce attack, movement, or range symbols. Two shapes: a cheap cycling version that draws a card and produces one symbol, and a terminal version that produces more symbols and does not replace itself.
- **Draw.** Expensive. The engine axis.
- **Trashing.** Deck thinning.

Symbol cards are **type-specific**: a card produces symbols usable only on soldiers, or only on archers. This is what lets each unit type have an affordable lane toward its signature stat and expensive lanes off it. Pricing and symbol density per lane are open, and are the main balance dial (see Known Tensions).

Joint cards — covering two stats, or usable on either unit type — are the intended answer to the deck fragmentation that type-specific piles create, and are the only efficient purchase for a mixed army. Whether any appear in version 1 is open.

## Upgrades

Upgrades are permanent, apply to one specific unit, and are lost when that unit dies.

**Raising a stat to value V costs V symbols of that type, spent in a single turn.** An archer at 1 attack pays 2 symbols to reach 2. A soldier already at 2 attack pays 3 to reach 3. Symbols do not accumulate across turns; anything unspent is lost.

A given stat on a given unit can only be raised by 1 per turn. Stacking 5 attack symbols on one archer still only raises it from 1 to 2, and the surplus is wasted.

Within one turn you may pay for as many separate raises as your symbols allow, as long as each is a different stat or a different unit. Four attack symbols will raise attack from 1 to 2 on two different units.

Upgradeable stats are **attack, movement, and range**.

**Soldiers cannot upgrade range.** This is a hard constraint, not a pricing decision, and it is what stops the two unit types from converging into one.

Max HP is not upgradeable in version 1. See Open Questions.

## Combat

A unit may attack once per activation.

**Activation is move, attack, move, drawing on a single shared movement budget.** A soldier with movement 4 can advance 2, attack, and withdraw 2. It cannot move 4, attack, and then move 4 again. This makes hit-and-run real while keeping it a genuine tradeoff: retreating far means approaching short.

An attack deals damage equal to the attacker's attack value. Ranged attacks additionally require **line of sight**: an unobstructed straight line from the center of the attacker's hex to the center of the target's hex. The line is blocked if it passes through the interior of a wall hex. Grazing a hex edge or touching a vertex does not block. This tiebreak needs to be settled in code rather than left to interpretation, because it will come up constantly and two players will otherwise resolve it differently every turn.

Damage persists between turns. There is no healing in version 1, so all damage is permanent and every unit only ever gets closer to death.

A unit at 0 HP is removed from the game permanently.

## Winning

**Eliminate all five enemy units.**

Because there are no reinforcements, you cannot win passively — the win condition is defined entirely in terms of the opponent's army, so at some point you have to go and fight.

### Clock

The game also ends when three supply piles are empty, using the existing end-game trigger. If nobody has been eliminated by then, the winner is decided by most units remaining, then by total remaining HP. This exists so that refusing to engage is a losing line rather than a draw.

The pile count and the tiebreak order are both open.

## Known Tensions And Risks

These are the things most likely to break. They should be watched in the first runs rather than discovered later.

**The cost curve fights specialization.** Because a raise costs the value being reached, taking one stat from base B up by k steps costs roughly quadratically in k. An archer going from range 2 to range 5 pays 3 + 4 + 5 = 12 symbols. Meanwhile that same archer can raise its *low* stats cheaply — movement from 2 to 3 costs only 3. So the arithmetic quietly pushes every unit toward being well-rounded, which is the opposite of the stated design goal.

The release valve is type-specific card pricing: the archer's range cards need to be cheap in coin and dense in symbols to offset the high threshold, and its attack cards expensive and thin. If the first runs come back with everyone building identical generalists, this pricing is the dial to turn, not the threshold rule.

**Convergence on movement.** "Soldiers cannot upgrade range" blocks convergence in one direction only. Nothing stops archers from cheaply buying movement — their base is low, so it is cheap — until they are as mobile as soldiers and strictly better. A mirror constraint on the soldier side is probably needed. Open.

**Turtling.** This version has no supply centers and no interaction cards, which is the most stalemate-prone configuration this design can have. Nothing pulls the armies into contact except the win condition and the deck clock. If the first runs show both sides hiding behind walls and upgrading indefinitely, that is not a tuning failure — it is evidence that interaction cards are structural rather than flavor, and they should be pulled forward.

**Investment loss is a cliff, not a slope.** Losing a heavily upgraded unit is catastrophic and unrecoverable. This may produce excellent drama or paralytic risk aversion. The countervailing force is that deck output is independent of how many units you have, so losing units concentrates your upgrades into fewer bodies — three units at attack 2 beat five at attack 1. That is the built-in rubber band, and it is the main reason kill-them-all is viable as a win condition despite being snowbally on paper. It also means over-concentrating into a single super unit loses, since one monster cannot kill five things while five things focus it.

## Open Questions

1. **Max HP and healing.** With no healing there is no way to return to max HP, so an upgradeable max HP is incoherent. The candidate fix is a regen rule — a unit that neither moves nor attacks recovers 1 HP — which restores meaning to max HP without adding healing cards or a shield mechanic. Deliberately deferred.
2. **Exact stat lines.** The table above is provisional.
3. **Card prices and symbol densities per lane.** The primary balance dial.
4. **Map dimensions and wall density.**
5. **A mirror anti-convergence constraint** for soldiers, matching "melee cannot upgrade range."
6. **Joint cards in version 1, or later.**
7. **Starting draft budget and card availability.**
8. **Deck exhaustion threshold and tiebreak order.**
9. **Activation order** — can activations be interleaved with upgrades, or are all upgrades applied before any unit activates?

## Deferred To Later Versions

Not rejected, just not in version 1.

- **Interaction cards.** The intended variety layer, and the main reason the card pool can grow without becoming permutations of the same three symbols. Candidates: movement taxes around your units, pinning a unit for a turn, denying upgrades to a target unit, blocking line of sight with smoke, compelling a unit to move toward you, and conventional deck attacks like discard. Direct damage from cards is excluded on purpose — it would let a player ignore their units and just spam damage.
- **Terrain manipulation cards.** Creating and destroying walls. Cool, but an addition rather than a core mechanic.
- **Board-conditional symbol cards.** Symbols gated on board state. Probably a late diversity addition rather than a core mechanic, and hard to get right — the conditions have to be genuinely restrictive to be interesting.
- **Promotion.** Paying a large pile of symbols to transform a unit into something better. A sink for large turns and a way to give the game a tech arc.
- **Revival.** Restoring a fallen unit at high cost. Held in reserve in case attrition proves too one-directional.
- **A healer unit type.** Cut from version 1 because healing directly opposes the only win path, and a zero-attack unit is a free fifth of the opponent's win condition.

## Rejected

Recorded so they do not get re-proposed.

- **Attachments** — cards that leave the deck to become permanent unit traits. Rejected because an attachment is a one-time conversion of deck value into board value: once played, that card has stopped participating in the game. Enough of them and the deck becomes a launch vehicle you discard, and the game turns into a skirmish game with a deckbuilding prologue. The general principle this establishes: **card effects must be repeatable on draw, not one-time conversions.** Every future card idea should be run through that filter.
- **A shield or defense mechanic** as the answer to max HP. Too strong given how low attack values are.
- **Healing cards** as the answer to max HP. Too strong, and they work against the win condition.
