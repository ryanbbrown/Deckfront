# Skirmish — Balance and Experiment Questions

Not implementation. These are things to decide by running the game, and they are separated from `docs/skirmish-implementation-plan.md` so that plan stays about mechanics.

The implementation should make every one of these an asset edit rather than a code change: numbers live in `game/`, with no numeric constants in `src/`.

## Draft budget

Proposed at three cards for at most `8` coin. Complicated by disjoint pools — a budget that is fine for a mono-type army may be too thin for a mixed one.

## Army composition

The rules let each player choose their soldier/archer split at setup. For a first batch, leaving it free adds a variance dimension to results you are trying to read signal from; fixing it at `3`–`2` for run 1 and freeing it afterwards would isolate the deck economy from the army composition. Either way this is a run-configuration choice, not a rule.

## The cycling engine has no natural brake

Removing the action limit removes the only bound on self-replacing cards. Cards seen per turn is roughly `5/(1-p)` where `p` is the cycling fraction of the deck, which goes vertical past about `0.75`. The brakes are that money does not cycle and that the threshold upgrade rule is a genuine sink.

Watch condition for run 1: a player reaching a full-deck draw before turn 12 means cycling cards are priced too cheaply.

## Stat lines and card costs

Every number in the rules doc is a proposal — unit stat lines, the twelve pile costs, symbol densities, key point effects.

## Turn cap value

A runner parameter, not a rule. The right value is whatever makes a decisive game the common case without truncating slow ones.

## Retry rates

Worth recording per action shape during harness runs. A high rate on one shape means the prompt and the schema disagree, which is a prompt or schema problem rather than a balance one — but it shows up in the same batch output.
