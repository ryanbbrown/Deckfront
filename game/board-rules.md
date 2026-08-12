# Skirmish board rules

Two players deploy five soldiers and archers each. P1 deploys on row 0 and P2 on row 16. A unit's submitted setup stats must match `game/units.json`.

Each round has setup and activation phases. Both players complete a deck turn and upgrades during setup. Initiative order determines setup order. Players then alternate single-unit activations. Each surviving unit activates at most once. Pass automatically when a player has no unactivated unit. Initiative changes after each completed round.

An activation has `from`, optional `via`, optional `attack`, and `to`. The unit moves from `from` to `via`, may attack there, then moves to `to`. Both movement distances share its movement budget. All occupied hexes block movement.

An attack targets an enemy within the attacker's current range and deals its current attack as damage. Attacks beyond range 1 require clear line of sight. Walls block movement and line of sight, but sight grazing a wall edge or vertex remains clear. Units do not block sight. Units at 0 HP are removed immediately.

Upgrades have `{ target, stat, to }`. `to` must be exactly one above the current stat and costs `to` symbols from the unit type's matching lane. A given unit stat can rise only once each setup, including a key-point upgrade. Soldiers cannot upgrade range. Symbols do not carry over.

During setup, a unit on a key point gains one point in that point's stat for free. Soldiers standing on the range point deny it but receive no upgrade.

The game ends when one player has no units. The game cap counts completed rounds. At that cap, compare units remaining, then total HP. An exact tie is a draw.
