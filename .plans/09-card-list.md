# Card list

These are the starting values for automated balance experiments, not proven balance.

This document is authoritative for card costs, rules, and values. Where an older document disagrees, this document wins. Archived documents in [archive/](./archive/) hold superseded values and must not be used.

## Existing cards

| Card | Cost | Rule | Implementation status |
| --- | ---: | --- | --- |
| Copper | 0 | Provide 1 money. | Implemented. |
| Silver | 3 | Provide 2 money. | Implemented. |
| Gold | 6 | Provide 3 money. | Implemented. |
| Footwork | 3 | You may move 1 space Left or Right. Draw 1 card. | Implemented at cost 2; update the cost. The move stays optional. |
| Cull | 3 | Trash 1 or 2 cards from Cull itself or your remaining hand. | Implemented. Always available in the initial kingdoms. |
| Muster | 5 | Draw 2 cards. | Implemented. |
| Feint | 3 | At Close, make the opponent Exposed. Exposed adds 2 damage to the next Close attack this turn, then ends. | Implemented. Keep the current rule for the first simulation. |
| Drive | 4 | At Close, deal 2 damage, then move both fighters Left or Right. A blocked move deals 2 more damage. | Implemented. |
| Flurry | 5 | At Close, deal 1 damage for each other Tactical Action played this turn, to a maximum of 5. | Replace the implemented placeholder rule. |
| Aim | 3 | At Near or Far, become Aimed and draw 1 card. | Implemented. |
| Volley | 5 | Deal 2 at Near or 4 at Far. Aimed changes this to 5 or 6. | Implemented at 2/5 and 5/7; update the damage. Aimed is worth more at Near than at Far. This is intended. |

## Tactical Actions

Flurry counts Actions that move a fighter, change a fighter condition, or deal damage. Gaining mana and changing a deck do not count.

Tactical Actions are:

- Footwork, Feint, Drive, Flurry, Aim, and Volley;
- Heavy Blow, Quick Shot, and Steady Shot;
- Ley Step, Arc Bolt, Fireball, and Starfire;
- Step, Strike, and Shot.

Cull, Muster, Stipend, Reclaim, Adapt, Channel, and Prism do not count. A previous Flurry counts for a later Flurry; the resolving Flurry does not count itself.

## First implementation batch

### Deck tools and attacks

| Card | Cost | Rule |
| --- | ---: | --- |
| Stipend | 3 | Draw 1 card. Provide 1 money. |
| Reclaim | 3 | Draw 1 card. You may put one card from your discard pile on top of your deck. |
| Adapt | 4 | Draw 1 card. If your position changed during your turn, draw 1 more. |
| Heavy Blow | 5 | At Close, deal 4 damage. |
| Quick Shot | 3 | At Near or Far, deal 1 damage. Draw 1 card. |
| Steady Shot | 4 | At Near or Far, deal 3 damage. |

Adapt counts any change to your own position during your own turn. Your own Drive counts, because Drive moves you. A position change during the opponent's turn does not count. Moving away and back still counts as a change.

### Mage cards

Mana expires at the end of the Action phase. A spell cannot be played without enough mana.

| Card | Cost | Rule |
| --- | ---: | --- |
| Channel | 3 | Gain 1 mana. Draw 1 card. |
| Ley Step | 3 | Move 1 space Left or Right. Gain 1 mana. |
| Prism | 5 | Gain 2 mana. Draw 1 card, then discard 1 card. |
| Arc Bolt | 3 | Spend 1 mana. Deal 3 damage at any range. |
| Fireball | 5 | Spend 2 mana. Deal 5 damage at any range. |
| Starfire | 6 | Spend 3 mana. Deal 8 damage at any range. |

Starfire is not in any of the five initial kingdoms. Implement and test it, but expect no experiment result for it.

### Future always-available row

Implement these cards, but do not include them in the five initial curated kingdoms.

| Card | Cost | Rule |
| --- | ---: | --- |
| Step | 2 | Move 1 space Left or Right. |
| Strike | 3 | At Close, deal 2 damage. |
| Shot | 3 | At Near or Far, deal 2 damage. |

## Deferred cards

Do not implement these in the first balance-search goal:

- Fresh Start;
- Recruit;
- Reforge;
- Reinforcements;
- Jab;
- Pinpoint.
