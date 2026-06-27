# Experiments

Experiments are isolated copies of the mutable Deckfront game code. Run playthroughs from an experiment's `code/` directory, not from the repo root.

Create a new experiment from the canonical base:

```sh
uv run scripts/experiment.py create --id E002-my-hypothesis --from-base --hypothesis "Describe the design question."
```

Create a new experiment from a previous experiment:

```sh
uv run scripts/experiment.py create --id E003-next-variant --from-experiment E002-my-hypothesis --hypothesis "Describe the variant."
```

Each experiment contains:

- `experiment.yaml`: source and hypothesis.
- `code/`: copied mutable runtime code, prompts, playthrough scripts, and one `game/` definition.
- `code/game/`: the experiment's board rules, deck config, cards, units, and map.
- `runs/`: playthrough outputs for that experiment.
- `evaluation.md`: notes and scoring for the experiment.
