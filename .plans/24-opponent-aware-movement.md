# Opponent-aware movement

## Goal

Make movement account for both players' public decks. Preserve current-turn damage and buying decisions. Do not inspect either hidden draw order. Keep fast-simulator throughput well above half of the current baseline.

Current fast-simulator baseline on the Apple M4 Pro is 19,881 median games per second across 75,000 fixed matches. The same command must measure the implementation.

## Behavior

- Current-turn lethal damage, damage, and planned purchases remain more important than future position.
- When those results are equal, prefer the position that keeps more future attack value for the active player and less future attack value for the opponent.
- Estimate future attack value from public cards owned by each player, divided by that player's deck size. Do not use either hidden draw order or exact future hand.
- Close attacks contribute only at Close range. Drive includes its wall bonus only when both fighters are Close at a wall.
- Steady Shot contributes at Near and Far range. Volley uses its best printed Near or Far value, including Aim.
- Mage damage does not change with position. A Mage strategy therefore moves away from Melee when it can do so without losing a more important result.
- A Ranged strategy moves from Close to enable attacks and prefers Far for Volley. If Steady Shot deals the same damage at Near and Far, the opponent's public deck breaks the tie.
- A strategy does not buy movement automatically. Strategy generation still decides whether Step, Footwork, or Ley Step belongs in the deck.

## Implementation

- Put position scoring behind one small shared interface used by the full Action-phase search and the compact tactical pilot.
- Pass compact public attack profiles into the tactical pilot. Avoid copying full decks into each movement choice.
- Compare current-hand attack potential first and public-deck position value second when the tactical pilot chooses a movement direction.
- Play Step or Ley Step when the selected movement improves current-hand attack potential, enables needed mana, or improves public-deck position value.
- Preserve deterministic tie-breaking and hidden-information rules.

## Smoke checks

- Prove through the production movement interface that Mage with Step moves away from a Melee deck.
- Prove that Ranged with Steady Shot prefers Far over Near against Melee when current damage is equal.
- Prove that Volley still prefers Far because its current damage is higher there.
- Prove that Melee still prefers Close and that mixed decks make a deterministic trade-off.
- Cover arena walls, equal scores, no movement card, and movement that would reduce current damage.
- Run compact-kernel matches on at least two kingdoms and confirm no aborts, invalid states, or action loops.
- Repeat the 75,000-match baseline command. Stop and optimize before balance testing if median throughput falls below 13,250 games per second. This limit prevents a slowdown of 1.5 times or worse and is stricter than the user's 2-to-3-times concern.
- If behavior and speed pass, run the existing focused simulator tests, full tests, typecheck, lint, simulator build, and production build.

## Balance check after implementation

- Keep Drive at 2 base damage and 2 wall damage.
- Rerun the same 20 Melee-heavy tuning kingdoms.
- Compare Melee, Ranged, and Mage distribution with the saved Drive-2 baseline.
- Do not run the other tuning or validation kingdoms until the user reviews the 20-kingdom result.
