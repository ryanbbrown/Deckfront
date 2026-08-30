# Card reference

This file lists the current card costs and text used by the game. The source data is [`src/game-data/cards.json`](../src/game-data/cards.json).

- Mana persists between turns. A player can have more than 3 mana during a turn, but keeps at most 3 when the Buy phase ends.
- Close range is distance 0. Near range is distance 1. Far range is distance 2 or more.
- Improvise counts only the Mana, Melee, and Ranged families.
- Only the first Scrap played by a player each turn deals damage. Later Scrap cards remain legal Tactical Actions.

## Treasure

| Card | Cost | Rule |
| --- | ---: | --- |
| Copper | 0 | Provide 1 money. |
| Silver | 3 | Provide 2 money. |
| Gold | 6 | Provide 3 money. |

## Mana

| Card | Cost | Rule |
| --- | ---: | --- |
| Focus | 1 | Gain 1 mana. |
| Channel | 3 | Gain 1 mana. Draw 1 card. |
| Ley Step | 3 | Move 1 space. Gain 1 mana. Gain 1 additional mana if you are at Far range after moving. |
| Attune | 4 | Gain 1 mana. Draw 1 card. Gain 1 additional mana for each other copy of Attune you played this turn. |
| Prism | 5 | Gain 2 mana. Draw 1 card, then discard 1 card. |
| Arc Bolt | 4 | Spend 1 mana. Deal 3 damage at any range. |
| Fireball | 5 | Spend 2 mana. Deal 6 damage at any range. |
| Starfire | 6 | Spend 3 mana. Deal 12 damage at any range. |
| Discharge | 4 | Deal 2 damage at any range for each mana you have. Lose all mana. |
| Cascade | 5 | Spend 1 mana. Deal 4 damage at any range. Deal 2 additional damage for each other spell you played this turn. |
| Overload | 5 | Deal 3 damage at any range for each mana you spent this turn. |

## Melee

| Card | Cost | Rule |
| --- | ---: | --- |
| Feint | 5 | At Close range, draw 1 card. Each Close-range attack you make this turn deals 1 additional damage. |
| Jab | 3 | At Close range, deal 2 damage. Draw 1 card. |
| Strike | 3 | At Close range, deal 3 damage. |
| Drive | 4 | At Close range, deal 3 damage. Then move both fighters 1 space so they remain Close. If a wall blocks the move, neither fighter moves and the attack deals 2 additional damage. |
| Heavy Blow | 5 | At Close range, deal 6 damage. |
| Opening Strike | 3 | At Close range, deal 4 damage if this is the first attack you played this turn. Otherwise deal 1 damage. |
| Rally | 3 | At Close range, deal 2 damage. Deal 2 additional damage for each other copy of Rally you played this turn. |
| Bull Rush | 3 | At Close range, discard 1 Melee card: deal 7 damage. |
| Flurry | 5 | At Close range, deal 1 damage for each other Tactical Action played this turn. |

## Ranged

| Card | Cost | Rule |
| --- | ---: | --- |
| Aim | 5 | At Near or Far range, draw 1 card. Add 2 damage to the next ranged attack you make this turn. |
| Peppering Shot | 3 | At Near or Far range, deal 1 damage. Draw 1 card. |
| Steady Shot | 3 | At Near or Far range, deal 2 damage. |
| Repelling Shot | 4 | At Far range, deal 2 damage. At Near range, deal 1 damage. Move the opponent 1 space farther away. If they cannot move, move yourself 1 space farther away instead. |
| Longshot | 3 | At Near or Far range, deal damage equal to the distance between you and your opponent. |
| Volley | 5 | At Near range, deal 2 damage. At Far range, deal 4 damage. |
| Salvage Shot | 4 | At Near or Far range, discard 1 Ranged card: deal damage equal to its cost. Draw 1 card. |
| Precision Shot | 5 | At Near or Far range, deal 4 damage. Each other copy of Precision Shot you play this turn deals 2 damage instead. |

## Engine

| Card | Cost | Rule |
| --- | ---: | --- |
| Step | 2 | Move 1 space. |
| Footwork | 3 | You may move 1 space. Draw 1 card. |
| Stipend | 3 | Draw 1 card. Provide 1 money. |
| Reclaim | 3 | Put 1 card from your discard pile into your hand. If your discard pile is empty, draw 1 card. |
| Regroup | 3 | Draw 2 cards. Discard 1 card. |
| Adapt | 4 | Draw 1 card. If your position changed this turn, draw 1 more. |
| Muster | 5 | Draw 2 cards. |
| Regiment | 7 | Draw 3 cards. |
| Discipline | 2 | Trash 1 card from your hand. Deal 1 damage at any range. |
| Cull | 3 | Trash 1 or 2 cards from your hand. |
| Sharpen | 3 | Draw 1 card. You may trash 1 card from your hand. |
| Reforge | 4 | Trash 1 card from your hand. Gain a card costing up to 3 more than it. |
| Scour | 5 | Trash up to 2 cards from your hand. Draw 1 card for each card trashed. |
| Improvise | 5 | Deal 2 damage at any range for each different Mana, Melee, or Ranged family you played this turn. |
| Scrap | 0 | Starter-only. The first Scrap you play each turn deals 1 damage at any range. Scrap is not a market pile. |
