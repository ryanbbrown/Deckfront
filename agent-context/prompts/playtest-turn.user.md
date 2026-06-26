# Turn Context

Complete exactly one turn now: `$turn_id` for `$player_id`.

Run directory: `$run_dir`

Use Bash only. Do not create probe files. Use only these exact turn artifact paths:

- Deck actions: `$deck_actions`
- Board actions: `$board_actions`
- Win events, if strict commit requires them: `$win_events`
- Terminal win events, if strict commit requires them: `$terminal_win_events`
- Deck result: `$deck_result`
- Board result: `$board_result`

Briefing JSON:

```json
$briefing_json
```

Deck action file shape:

```json
{"schemaVersion":1,"turnId":"$turn_id","player":"$player_id","actions":[]}
```

Use only `briefing.deck.legal` actions, then `endTurn`. Hand indices are live: if you trash, trash before play/draw actions and adjust later `handIndex` values. After `moveToBuy`, buy a useful card if money and buys allow.

Board action file shape:

```json
{"schemaVersion":1,"turnId":"$turn_id","player":"$player_id","actions":{"movements":[],"recruits":[],"attacks":[],"heals":[],"upgrades":[]}}
```

Movement objects: `{"unit":"id","from":{"col":0,"row":0},"to":{"col":0,"row":0}}`.
Recruit objects: `{"unit":"new-id","type":"raider","at":{"col":0,"row":0}}`.
Attack objects: `{"attacker":"id","target":"id","deckDamage":0}`. `board-turn` computes printed attack damage.

Run the turn:

```sh
bun run --silent cli -- deck-turn --config $deck_config --state $deck_state --actions $deck_actions --result $deck_result
bun run --silent cli -- board-turn --state $board_state --deck-result $deck_result --actions $board_actions --result $board_result
bun run --silent playtest -- commit-turn --run $run_dir --deck-result $deck_result --board-result $board_result --summary "<summary>" --reasoning "<reasoning>" --strict-win
bun run --silent validate-run -- --strict --strict-deck --strict-win $timeline
```

If strict commit fails because expected `winEvents` or `terminalWinEvents` do not match, copy the expected JSON array exactly into the matching event file above and retry commit with `--win-events <file>` and/or `--terminal-win-events <file>` plus `--strict-win`.

Stop after one valid committed turn and print the deck line, board line, and rationale.
