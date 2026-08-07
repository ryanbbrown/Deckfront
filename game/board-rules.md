# Skirmish board rules

Two players deploy five soldiers and archers each. P1 deploys on row 0 and P2 on row 16. A unit's submitted setup stats must match `game/units.json`.

Each turn, resolve free key-point upgrades, spend symbols on upgrades, then activate units. A unit can activate at most once. An activation has `from`, optional `via`, optional `attack`, and `to`. The unit moves from `from` to `via`, may attack there, then moves to `to`; the two movement distances share its movement budget. If `via` is omitted, it equals `from`. All occupied hexes block movement and neither `via` nor `to` may be occupied.

An attack targets an enemy within the attacker's current range and deals its current attack as damage. Attacks beyond range 1 require clear line of sight. Walls block movement and line of sight, but sight grazing a wall edge or vertex remains clear. Units do not block sight. Units at 0 HP are removed immediately.

Upgrades have `{ target, stat, to }`. `to` must be exactly one above the current stat and costs `to` symbols from the unit type's matching lane. A given unit stat can rise only once each turn, including a key-point upgrade. Soldiers cannot upgrade range. Symbols do not carry over.

At the start of a turn, a unit on a key point gains one point in that point's stat for free. Soldiers standing on the range point deny it but receive no upgrade.

The game ends when one player has no units. The absolute turn cap counts completed player turns, not rounds. At that cap, compare units remaining, then total HP; an exact tie is a draw.
