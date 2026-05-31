# Territory Play Notes

This is a brief durable reference for LLM playtests. It is not a complete rulebook.

## Starter Board

- Map: `rulesets/territory-v1/maps/sketch-v1.json`
- Scenario: `scenarios/sketch-v1.board.json`
- Coordinates use `{ "q": number, "r": number }` in the board files.
- The current sketch map is flat-top and uses alternating column heights: 10 / 9 / 10 / 9 / 10 / 9 / 10 / 9 / 10 / 9 / 10 / 9 / 10.

## Home Bases

Home bases are stored in board state under `homeBases` so scenarios can move starting areas without code changes.

- `P1-home`: `10,1`, `11,0`, `12,1`, `11,1`
- `P2-home`: `0,8`, `1,7`, `1,8`, `0,9`

Units start on their player's home-base hexes unless a scenario says otherwise.

## Playtest Convention

The deck CLI produces board-relevant counters as player attributes, such as `damage` and `heal`. Compare the active player's deck state before and after a turn to decide which board updates to make.
