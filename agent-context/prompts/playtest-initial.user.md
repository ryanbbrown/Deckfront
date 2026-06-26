# Player Session Context

You are `$player_id` in this Deckfront playtest.

Run directory: `$run_dir`
Ruleset: `$ruleset`
Map: `$map`
Deck config: `$deck_config`
Board rules: `$board_rules`
Unit rules: `$units_file`
Map file: `$map_file`

Your strategy:

```text
$player_strategy
```

Opponent: `$opponent_id`

Opponent strategy:

```text
$opponent_strategy
```

Initial deck drafts:

```text
$drafts
```

Starting units:

```text
$starting_units
```

Target length: play to a legal winner when possible, or until the runner stops the game.

Before your first move, read the board rules, deck config, unit rules, and map file listed above. Use them with the compact turn briefing. Do not read experiment goal, rubric, or evaluation files.

## Turn Artifact Convention

Use Bash for turn execution.

For turn id `<turn-id>`, use these exact files:

- Deck actions: `$run_dir/actions/<turn-id>.deck.json`
- Board actions: `$run_dir/actions/<turn-id>.board.json`
- Win events, if strict commit requires them: `$run_dir/actions/<turn-id>.win-events.json`
- Terminal win events, if strict commit requires them: `$run_dir/actions/<turn-id>.terminal-win-events.json`
- Deck result: `$run_dir/results/<turn-id>.deck.result.json`
- Board result: `$run_dir/results/<turn-id>.board.result.json`

Deck action file shape:

```json
{"schemaVersion":1,"turnId":"<turn-id>","player":"$player_id","actions":[]}
```

Use only actions listed in the current turn briefing under `deck.legal`, then `endTurn`. Hand indices are live: if you trash, trash before play/draw actions and adjust later `handIndex` values. After `moveToBuy`, buy a useful card if money and buys allow.

Board action file shape:

```json
{"schemaVersion":1,"turnId":"<turn-id>","player":"$player_id","actions":{"movements":[],"recruits":[],"attacks":[],"heals":[],"upgrades":[]}}
```

Movement objects: `{"unit":"id","from":{"col":0,"row":0},"to":{"col":0,"row":0}}`.
Recruit objects: `{"unit":"new-id","type":"raider","at":{"col":0,"row":0}}`.
Attack objects: `{"attacker":"id","target":"id","deckDamage":0}`. `board-turn` computes printed attack damage.

Run each turn with this sequence:

```sh
bun run --silent cli -- deck-turn --config $deck_config --state $run_dir/deck.json --actions $run_dir/actions/<turn-id>.deck.json --result $run_dir/results/<turn-id>.deck.result.json
bun run --silent cli -- board-turn --state $run_dir/board.json --deck-result $run_dir/results/<turn-id>.deck.result.json --actions $run_dir/actions/<turn-id>.board.json --result $run_dir/results/<turn-id>.board.result.json
bun run --silent playtest -- commit-turn --run $run_dir --deck-result $run_dir/results/<turn-id>.deck.result.json --board-result $run_dir/results/<turn-id>.board.result.json --summary "<summary>" --reasoning "<reasoning>" --strict-win
bun run --silent validate-run -- --strict --strict-deck --strict-win $run_dir/timeline.json
```

If strict commit fails because expected `winEvents` or `terminalWinEvents` do not match, copy the expected JSON array exactly into the matching event file and retry commit with `--win-events <file>` and/or `--terminal-win-events <file>` plus `--strict-win`.
