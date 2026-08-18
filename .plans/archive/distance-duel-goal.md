# Distance duel goal (archived)

**Superseded by [10-automated-balance-search.md](../10-automated-balance-search.md), [11-search-performance.md](../11-search-performance.md), and [12-repository-cleanup.md](../12-repository-cleanup.md).** This was the product goal before the automated balance search.

Hexdeck tests whether a Dominion-style fixed market can support distinct position strategies on a five-space line arena.

The current experiment compares:

- close pressure through Footwork, Feint, Drive, and wall collisions;
- ranged setup through repeated Footwork, Aim, and Volley.

Deck building is the main strategic system. Fighters can share spaces and move through each other. Position creates direct interaction without becoming a large tactics game. A successful playtest produces ordered multi-card combinations, meaningful starting builds and purchases, real escape from pressure, and viable wins for both strategies.

The approved behavior is in `.plans/05-distance-duel-experiment.md`. The technical implementation is in `.plans/06-distance-duel-technical.md`.
