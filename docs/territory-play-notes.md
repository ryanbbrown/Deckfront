# Territory Play Notes

This is a brief durable reference for LLM playtests. It is not a complete rulebook.

## Starter Board

- Map: `maps/sketch-v1.json`
- Current sample run: `.games/territory-v1-playtest/board.json`
- Coordinates use `{ "col": number, "row": number }` in the board files.
- The current sketch map is flat-top odd-column offset: columns go west to east, rows go north to south, and odd columns are shifted half a hex south.
- The current sketch map uses alternating column heights: 10 / 9 / 10 / 9 / 10 / 9 / 10 / 9 / 10 / 9 / 10 / 9 / 10.

## Home Bases

Home bases are stored in the map so each map defines its own starting areas.

- `P1-home`: `10,1`, `11,0`, `12,1`, `11,1`
- `P2-home`: `0,8`, `1,7`, `1,8`, `0,9`

Starting units are part of the initial `.games/<run>/board.json` state.

Each unit tracks current `hp`, `maxHp`, and `attack` in board state. Cards that upgrade health or damage modify the specific unit on the board.

## Playtest Convention

The deck CLI produces board-relevant counters as turn attributes, such as `damage` and `heal`. These reset during cleanup, so the current active player's attributes after deck choices are the board resources available for that turn.

Persistent changes belong in board state unless a deck experiment explicitly uses `persistentAttributes`.
