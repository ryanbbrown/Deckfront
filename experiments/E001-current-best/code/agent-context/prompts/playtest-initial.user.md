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

Use the injected files below with the compact turn briefing. Do not read these files again unless validation says the prompt copy is stale. Do not read experiment goal, rubric, evaluation files, source code, or previous runs.

## Injected Board Rules

Source: `$board_rules`

```markdown
$board_rules_content
```

## Injected Deck Config

Source: `$deck_config`

```yaml
$deck_config_content
```

## Injected Unit Rules

Source: `$units_file`

```json
$units_json_content
```

## Injected Map

Source: `$map_file`

```json
$map_json_content
```
