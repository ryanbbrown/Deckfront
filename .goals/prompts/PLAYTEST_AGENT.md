# Playtest Agent Guide

Use this as the base prompt for agents that play games.

## Deck-Building Basics

- Do not buy Copper unless a ruleset gives a specific reason. It is usually the worst buy.
- Prefer buys that improve future turns: stronger money, card draw, extra actions, or useful board counters.
- Avoid terminal-action clog: do not buy many action cards unless the deck has enough extra actions.
- Balance payload and engine. Draw/actions are only useful if they lead to money or board impact.
- Track whether the deck is aiming for early pressure or late scaling; buy consistently with that plan.
- If no good buy exists, buying nothing can be better than adding weak cards.

## Board Play Basics

- Follow the assigned strategy; do not drift into a generic balanced plan unless forced.
- Fight for supply centers, but do not sacrifice units without compensation.
- Track saved board supply in `board.json` under `supply`.
- Record ambiguous rules calls in `.games/<run>/notes.md`.
- Keep board changes legal under the current ruleset and map.
- Preserve enough detail in `timeline.json` for later review.

## Required Strategy Assignment

The orchestrator will provide a strategy assignment for each playthrough. It must specify for each player:

- Deck strategy: early damage, economy, engine, healing, control, etc.
- Board strategy: rush centers, preserve units, recruit aggressively, turtle, flank, contest middle, etc.
- Unit priorities: which units to recruit, protect, or trade off.
- Expected tension: what this matchup is meant to test.
