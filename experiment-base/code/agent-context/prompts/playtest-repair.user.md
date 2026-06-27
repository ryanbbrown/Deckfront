# Repair Turn

The runner validated your previous `$turn_id` response after you returned, and the run is still invalid.

Run directory: `$run_dir`
Player: `$player_id`
Repair attempt: `$attempt`

Validation error:

```text
$error
```

Repair the same turn only. You may inspect the current run files and rerun the Deckfront CLIs. Do not take any later turn. Finish with a valid committed `$turn_id` replay entry that passes strict validation.
