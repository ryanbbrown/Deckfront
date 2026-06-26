# Playtest Agent Guide

Use this as the base prompt for agents that play games.

## Deck-Building Basics

- Do not buy Copper unless a ruleset gives a specific reason. It is usually the worst buy.
- If the active rules allow start-of-turn trashing, use it to remove weak cards before playing or spending them.
- Prefer buys that improve future turns: stronger money, card draw, extra actions, or useful board counters.
- Avoid terminal-action clog: do not buy many action cards unless the deck has enough extra actions.
- Balance payload and engine. Draw/actions are only useful if they lead to money or board impact.
- Track whether the deck is aiming for early pressure or late scaling; buy consistently with that plan.
- If no good buy exists, buying nothing can be better than adding weak cards.

## Board Play Basics

- Follow the assigned strategy; do not drift into a generic balanced plan unless forced.
- Fight for supply centers, but do not sacrifice units without compensation.
- Track saved board supply in `board.json` under `supply`.
- Track permanent unit upgrades on the specific unit's board-state `attack` and `maxHp` values.
- Record ambiguous rules calls in `.games/<run>/notes.md`.
- Keep board changes legal under the current ruleset and map.
- Read the map coordinate declaration before moving units. For the current odd-column map, use `col,row` movement offsets from `rulesets/territory-v1/board-rules.md`.
- Preserve enough detail in `timeline.json` for later review.
- Add a per-turn `actions` object to every `timeline.json` entry. This is required for strict validation.
- Add a per-turn `winEvents` array to every `timeline.json` entry. This is required for strict win validation. Use an empty array when no start-of-turn win threat is created, cleared, or confirmed.
- Add a root-level `terminalWinEvents` array to `timeline.json` when a pending threat confirms at the next start-of-turn after the final completed board phase. Use this instead of adding a fake no-op turn.
- In `actions.movements`, log each moved unit as `{ "unit": "P1-scout-1", "from": { "col": 12, "row": 1 }, "to": { "col": 9, "row": 2 } }`.
- In `actions.recruits`, log each new unit as `{ "unit": "P2-guardian-3", "type": "guardian", "at": { "col": 0, "row": 8 } }`.
- In `actions.attacks`, log each attack as `{ "attacker": "P1-marksman-1", "target": "P2-scout-1", "damage": 5, "deckDamage": 1, "targetRemoved": false }`.
- In `actions.heals`, log each HP-restoring effect as `{ "target": "P1-guardian-1", "amount": 2, "source": "deck" }` or `{ "healer": "P1-druid-1", "target": "P1-guardian-1", "amount": 1, "source": "unit" }`.
- In `actions.upgrades`, log each permanent stat upgrade as `{ "target": "P1-guardian-1", "attack": 1, "maxHp": 2 }`. Use `attack: 0` or `maxHp: 0` when only one stat changes.
- In `winEvents`, log start-of-turn response-window events as `{ "type": "unitLead", "status": "created", "player": "P1", "completedTurns": 22, "playerUnits": 8, "opponentUnits": 4, "playerCenters": 3, "opponentCenters": 5 }`.
- `winEvents.type` must be one of `unitLead`, `centerMajority`, or `sixCenterDominance`; `status` must be `created`, `cleared`, or `confirmed`.
- `completedTurns` is the number of completed player turns before the current entry starts. For `turn-001`, it is `0`; for `turn-034`, it is `33`.
- Do not rely on prose-only reasoning for pending or confirmed wins. `winEvents` must exactly explain every start-of-turn win threat creation, clear, and confirmation.
- If a game ends before another board phase is played, the final confirmation belongs in `terminalWinEvents` with `completedTurns` equal to the number of completed timeline entries.
- `deckDamage` is the portion of that attack's damage supplied by deck-produced damage counters. Under damage-cap rules, each attacking unit can use at most 1 total deck damage in that turn.
- Deck-sourced healing cannot exceed deck-produced `heal`. Unit-sourced healing must come from a ready active unit with printed `heal`, must be in range, and that unit cannot also attack that turn.
- Permanent stat upgrades cannot exceed deck-produced `upgradeDamage` and `upgradeHealth`. `upgradeHealth` also heals the upgraded unit by the same amount.
- If a unit loses HP or is removed, the attack actions for that turn must exactly explain the loss. Do not rely on prose-only reasoning for kills.
- If a unit gains HP, max HP, or attack, the heal and upgrade actions for that turn must explain the change. Do not rely on prose-only reasoning for healing or upgrades.
- If a unit changes hexes, the movement action for that unit must exactly match its before/after coordinates.
- If a unit is recruited, the recruit action must place it on an empty legal home-base hex.
- Before handing off a completed run, validate with `bun run validate-run -- --strict --strict-win <timeline.json>`.
- Play until a legal game end whenever possible. Do not stop only because 16 completed player turns have passed; turn 16 is a pacing checkpoint, not a stopping condition.
- If a game reaches 40 completed player turns with no winner, stop only if the position appears stalled or no plausible forced progress remains, and document that in notes.

## Required Strategy Assignment

The orchestrator will provide a strategy assignment for each playthrough. It must specify for each player:

- Deck strategy: early damage, economy, engine, healing, control, etc.
- Board strategy: rush centers, preserve units, recruit aggressively, turtle, flank, contest middle, etc.
- Unit priorities: which units to recruit, protect, or trade off.
- Expected tension: what this matchup is meant to test.
- Target length: whether to play to legal winner or use a documented high-turn unresolved cap.
