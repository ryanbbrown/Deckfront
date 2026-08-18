# Key decisions (archived)

**Superseded. Do not use this document for any decision.** Several statements below are now wrong: starting health is configurable, Flurry works only at Close, and the save schema is version 8. The current sources are [09-card-list.md](../09-card-list.md), [10-automated-balance-search.md](../10-automated-balance-search.md), and [README.md](../../README.md).

- The arena is one line with five spaces and one fighter per player.
- Fighters start on spaces 2 and 3 with 20 health.
- Players take complete turns and can play any number of Action cards.
- Players can buy any number of affordable cards in each Buy phase.
- Each player privately spends up to 12 money before the game and carries unused money into the first Buy phase.
- Starting decks contain seven Copper plus selected starting cards.
- Close, Near, and Far use position differences of 0, 1, and 2 or more.
- Fighters can share spaces and move through each other.
- Footwork moves Left or Right. Drive pushes Left or Right and does not follow.
- The first experiment has Exposed and Aimed, but no Guard.
- Flurry works at every range.
- The AI uses an editable strategy prompt and chooses one server-validated decision at a time.
- Player actions commit immediately. One global Undo control restores the latest player action.
- The server owns a complete AI turn, so it continues without an open browser.
- Saved games use schema version 6. Older saves and rules are not compatible.
