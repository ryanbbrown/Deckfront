> **Superseded:** Use [12-repository-cleanup.md](../12-repository-cleanup.md) for the current repository and browser scope. Use [09-card-list.md](../09-card-list.md), [10-automated-balance-search.md](../10-automated-balance-search.md), and [11-search-performance.md](../11-search-performance.md) for current game and simulator decisions.

# Per-piece card use

## Rule

Each friendly piece can use each named action once during its turn.

- Track the selected friendly actor for Shove, Drive, Breaker, Press, Pull, Sweep, Block, Pin, and Corner.
- Track the moved friendly piece for Dash and Vault.
- Track the friendly recipient for Brace.
- Limit Relay to one play per turn.
- Do not limit Cull or treasure cards.
- Reset all use limits when the next turn starts.
- Keep duplicate cards playable when another friendly piece can use them legally.

## User interface

- Do not present a piece as an actor after it uses that named action.
- Keep another legal friendly piece selectable for a duplicate card.
- Explain when a duplicate card has no remaining legal actor.
- Keep Relay unavailable after its first play during the turn.

## Verification

- Add engine tests for every action classification and the turn reset.
- Add browser tests for every actor-limited action card.
- Add browser tests for Relay's turn limit and unrestricted Cull duplicates.
- Add a browser test for Drive, Relay, then Drive with the other piece.
- Run unit tests, typecheck, lint, build, the coverage manifest, and the full browser suite.
