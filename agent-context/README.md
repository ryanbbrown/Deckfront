# Playtest agent context

The ThinHarness runner snapshots the system prompt and per-turn state under each run's `context/` directory. `game/board-rules.md` is the authoritative board-rule prompt. The TypeScript executor and independent replay validator remain the authority for legality.
