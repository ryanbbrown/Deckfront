# Card balance workshop (archived)

**Superseded by [09-card-list.md](../09-card-list.md). Do not take card values from this document.** The approved costs, damage values, Exposed rule, and Flurry rule are all different here. This document is kept only to explain why those values were chosen.

## Status

These are workshop notes and test values, not proven balance.

Current play suggests:

- Melee and ranged can both work.
- Fast damage and slower engine growth can both work.
- The AI is good enough for balance tests. Do not tune it now.
- Starting health may later vary from 20 to 35, so balance cannot assume every game has 20 health.

## Test scope and long-term cards

A card can belong in the long-term library without belonging in the next test. Add related cards in small batches so each playtest gives a clear result.

### Test soon

- Stipend
- Reclaim
- Adapt
- Revised Volley
- Revised Exposed and Flurry
- Heavy Blow
- Quick Shot
- One simple ranged attack that works at Near or Far

### Test as a separate mage batch

- Channel
- Ley Step
- Prism
- Arc Bolt
- Fireball
- Starfire

### Keep for the long-term library

- Fresh Start
- Recruit
- Reforge
- A gain-to-hand or early-buy card
- More strict-range melee and ranged cards

### Do not keep

- Cash Out
- Pursuit, because Footwork already does the same job at Near range
- Disengage, because it overlaps too much with Footwork
- Corner in its current form

## Volley

Volley currently costs 5 and deals:

- 2 damage at Near;
- 5 damage at Far;
- 5 damage at Near when Aimed;
- 7 damage at Far when Aimed.

The concern is not only its damage at 20 health. Volley gives high damage at the range that is safest from Close attacks, and repeated Volley may need too little setup. The same values will feel different at 20, 30, and 35 health.

Small nerf options:

1. Keep cost 5. Deal 2 at Near or 4 at Far. Aimed changes this to 5 or 6.
2. Keep the current damage and raise the cost from 5 to 6.
3. Keep normal damage at 2 or 4, but let Aimed add a fixed 2 damage.

**Proposal — starting test:** Test option 1 at more than one health value. It weakens safe Far damage while keeping a large Near payoff for Aim.

## General deck-building cards

Hexdeck can adapt Dominion's deck-building effects, but not all of its turn economy. Hexdeck already allows unlimited Action plays and unlimited affordable buys, so +Actions and +Buys have no value. This also makes clean deck flow stronger than it is in Dominion.

Muster is the current Laboratory-like card: it costs 5 and draws two cards. Cull fills the general trashing role.

| Card | Cost | Proposed effect | Status |
| --- | --- | --- | --- |
| Stipend | 3 | Draw 1 card. Provide 1 money. | Test soon and keep long term. |
| Fresh Start | 3 | Discard any number of cards, then draw that many. | Keep long term; do not test yet. |
| Reclaim | 3 | Draw 1 card. You may put one card from your discard pile on top of your deck. | Test soon and keep long term. |
| Recruit | 4 | Gain a card costing up to 3 into your discard pile. | Keep long term; test later. |
| Reforge | 4 | Trash a card from your hand. Gain a card costing up to 2 more. | Keep long term; test later. |
| Adapt | 4 | Draw 1 card. If your position changed this turn, draw 1 more. | Test soon and keep long term. |

Fresh Start is valid, but unlimited Actions make good hands easier to play already. It may not add enough to the first balance test.

Reclaim directly supports the main game idea: planning a future combination. It also creates useful choices about when to discard or play a card.

### Recruit and Reforge

A normal gain-to-discard card may be less exciting here than Workshop is in Dominion. Gaining is one step removed from winning: the player must later draw and play a damage card. That delay can make Recruit too slow during a damage race.

Reforge has a clearer deck-improvement role because it replaces a weak card instead of only adding another card. However, neither card is needed to test melee, ranged, or mage balance.

**Proposal:** Keep both in the long-term library and test Reforge first when deck growth receives its own test.

A more distinct future card could gain directly to hand:

| Card | Cost | Proposed effect |
| --- | --- | --- |
| Reinforcements | 6 | Gain an Action costing up to 4 into your hand. You may play it this turn. |

This creates immediate combo fodder, but it is also a flexible tutor and permanently adds a card each time it is played. Test it alone and at a high cost.

Another future design could let a player spend money and buy a card during the Action phase, then play it at once. That design changes when Treasure and money become available, so it should not enter the first card test.

## Always-available market

A fully random market can fail if it has no damage or no movement. Dominion does not have this problem because Treasure and Victory cards always provide a path to the end of the game. Hexdeck needs its own always-available base row.

**Proposal — base row:**

| Card | Cost | Proposed effect | Purpose |
| --- | --- | --- | --- |
| Copper, Silver, Gold | Current costs | Provide money. | Every deck can grow. |
| Step | 2 | Move 1 space Left or Right. | Every deck can change range. |
| Strike | 3 | At Close, deal 2 damage. | Every market has basic melee damage. |
| Shot | 3 | At Near or Far, deal 2 damage. | Every market has basic ranged damage. |

Footwork can then be a stronger card that appears only in some markets. Its draw plus movement is strong enough to feel different from Step.

A later market builder can also enforce card roles:

- If spells appear, include enough mana producers.
- Include at least one useful deck-flow card.
- Do not require every random market to support every strategy.

## Mage track

Mage attacks use mana instead of a range requirement. Melee attacks require Close. Ranged attacks require Near or Far. Mage attacks can work at any range, but need mana cards first.

The rules can say that mana expires at the end of the Action phase. Cards should say only “gain mana” or “spend mana.” A future persistent form can use a separate term such as “store mana.”

A spell cannot be played without enough mana. It does not get fallback draw or another effect. Dead spells are part of the deck-building risk, just as a melee attack can be dead at the wrong range.

### Mana producers

| Card | Cost | Proposed effect |
| --- | --- | --- |
| Channel | 2 | Gain 1 mana. Draw 1 card. |
| Ley Step | 3 | Move 1 space Left or Right. Gain 1 mana. |
| Prism | 4 | Gain 2 mana. Draw 1 card, then discard 1 card. |

These three producers have enough value to support a combo without being blank when no spell appears.

### Spells

The first numbers should make mage attacks stronger than standalone melee or ranged attacks because mana requires extra cards. Their range flexibility is also valuable, so the numbers still need direct playtests.

| Card | Cost | Proposed effect |
| --- | --- | --- |
| Arc Bolt | 3 | Spend 1 mana. Deal 4 damage at any range. |
| Fireball | 4 | Spend 2 mana. Deal 6 damage at any range. |
| Starfire | 5 | Spend 3 mana. Deal 8 damage at any range. |

Possible combinations:

- Channel -&gt; Arc Bolt deals 4 without checking range.
- Channel -&gt; Ley Step -&gt; Fireball changes position, then deals 6.
- Channel -&gt; Prism -&gt; Starfire filters the hand, then deals 8.

**Proposal:** Start with the 4/6/8 damage ladder. Test it at several health values and compare the number of setup cards, not only the final damage card. Force Wave can remain a later control-spell idea, but it does not belong in the first mage package.

## Melee cards and Exposed

Footwork already handles the basic approach role. Melee needs direct Close damage and rewards for playing several attacks.

| Card | Cost | Proposed effect | Status |
| --- | --- | --- | --- |
| Jab | 3 | At Close, deal 1 damage. Draw 1 card. | Later test; melee equivalent of Quick Shot. |
| Heavy Blow | 5 | At Close, deal 4 damage. | Test soon. |

Heavy Blow is intentionally simple. It tests whether reliable Close damage is useful beside Drive's movement and wall effect.

Current Exposed adds 2 damage to one Close attack, then disappears. That often makes Feint worse than buying another attack.

**Proposal — revised Exposed:** Each later attack played this turn deals 1 additional damage. Exposed still expires at the end of the turn. This rewards a chain of attacks instead of one large hit. The first test should record whether two or three follow-up attacks occur often enough to justify Feint.

## Ranged cards

Footwork already handles basic escape and range changes. Ranged cards should differ through draw, stable damage, and strict Far payoffs.

| Card | Cost | Proposed effect | Status |
| --- | --- | --- | --- |
| Quick Shot | 3 | At Near or Far, deal 1 damage. Draw 1 card. | Test soon. |
| Steady Shot | 4 | At Near or Far, deal 3 damage. | Test soon. |
| Pinpoint | 5 | At Far, deal 5 damage. | Keep long term; test after Volley. |

Steady Shot does the same damage at Near and Far. Pinpoint has a strict Far requirement and does not use Aimed. Its value depends on the final Volley numbers.

## Flurry

The current placeholder rule is:

> Deal 1 damage for each other Action played this turn, to a maximum of 5.

It works at every range and counts every Action. This makes it generic damage for any large engine.

Focused options:

1. At Close, deal 1 damage for each other Action played this turn, to a maximum of 5.
2. At Close, deal 2 damage plus 1 for each other Close attack played this turn, to a maximum of 5.
3. At Close, deal 1 damage for each Close attack played this turn, then draw 1 card.

**Proposal — starting test:** Use option 2. It gives Flurry a melee identity and rewards an attack chain rather than every engine card. Flurry is one attack, so revised Exposed adds 1 damage once, not once per point of Flurry damage.

## Variable starting health

Visible starting health from 20 to 35 remains a future game variant. Do not implement it in this card batch.

- Lower health can favor fast damage.
- Higher health can give Treasure, deck flow, and mana engines more time to grow.
- Balance tests should use at least one low and one high health value.
- Variable health should create strategic variety, not hide a card that dominates at every value.

## Next workshop decisions

- Confirm the first Volley test at 2/4 damage and 5/6 while Aimed.
- Confirm Stipend, Reclaim, and Adapt for the first deck-tool batch.
- Decide whether Reforge or Recruit receives the first later deck-growth test.
- Confirm Step, Strike, and Shot as the base-row concept.
- Confirm that normal mana expires each Action phase.
- Adjust the first mage damage ladder if 4/6/8 looks too high or too low.
- Confirm revised Exposed and the Close-attack version of Flurry.
- Decide which health values to use for the first comparison games.**Couldn’t sync tabs**