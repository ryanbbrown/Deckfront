# Plan: Dominion-lite Deckbuilding CLI Implementation

Spec: .specs/deckbuilding-cli.md

## Overview
We will build a deterministic TypeScript CLI game engine with YAML-defined content, a strict turn-state machine, and an action-enumeration loop that supports both interactive terminal play and scripted replay inputs.
The architecture will separate pure game logic from rendering and input adapters so the same state can later feed a view-only frontend without changing gameplay authority.

## Steps

### 1. Bootstrap project skeleton and boundaries
Establish the TypeScript/Vitest/Bun workspace, define module boundaries, and lock deterministic execution primitives before game logic starts.

```ts
// src/core/types.ts
export type PlayerId = string;
export type Zone = 'draw' | 'hand' | 'discard' | 'play' | 'trash';
export type Phase = 'action' | 'buy' | 'cleanup';
```

Files to create or modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/types.ts`, `src/core/random.ts`, `src/cli/main.ts`.

**Verify:** `bun install`, `bun test`, `bun run src/cli/main.ts --help`.

### 2. Define YAML schema and validation pipeline
Implement config loading and validation for cards, setup, supply, and end-game rules, including rejection of opponent-targeting effects.

```ts
// src/config/loadGameConfig.ts
import { parse } from 'yaml';
const raw = parse(await Bun.file(path).text());
const config = GameConfigSchema.parse(raw); // runtime validation
```

```yaml
# examples/minimal-game.yaml
endGame:
  and:
    - gte: ["emptyPiles", 3]
    - eq: ["provincePileEmpty", true]
```

Files to create or modify: `src/config/loadGameConfig.ts`, `src/config/schema.ts`, `src/config/endgame-expr.ts`, `examples/minimal-game.yaml`, `tests/config/*.test.ts`.

**Verify:** `bun test tests/config`, and a failing fixture with invalid effect targeting another player should produce a validation error.

### 3. Build immutable core state model and deterministic engine ops
Create pure state transition functions for setup, draw/shuffle, zone movement, counters, and turn ownership.

```ts
// src/core/engine.ts
export function applyAction(state: GameState, action: ChosenAction, rng: Rng): GameState {
  // pure transition only; no IO
}
```

Files to create or modify: `src/core/state.ts`, `src/core/engine.ts`, `src/core/zones.ts`, `src/core/scoring.ts`, `tests/core/engine.test.ts`.

**Verify:** `bun test tests/core` with fixed seed snapshots proving identical outcomes for identical action sequences.

### 4. Implement legal action generator and effect resolver
Implement the legal-action enumerator for action/buy/cleanup phases, optional-subeffect skipping, discard/trash/lookahead decisions, and automatic treasure contribution in buy phase.

```ts
// src/core/legalActions.ts
export function listLegalActions(state: GameState): LegalAction[] {
  // returns exactly legal options for current prompt cycle
}
```

Files to create or modify: `src/core/legalActions.ts`, `src/core/effects.ts`, `src/core/treasure.ts`, `tests/core/legal-actions.test.ts`, `tests/core/effects.test.ts`.

**Verify:** `bun test tests/core -t "legal actions"` and golden cases asserting stable option ordering and no illegal options.

### 5. Add end-game evaluator and tie-break policy
Implement boolean expression evaluation (simple comparisons + AND/OR over public game state), scoring with VP counters, and tie-break by turns taken.

```ts
// src/core/endgame.ts
export type BoolExpr = { and?: BoolExpr[]; or?: BoolExpr[]; eq?: [Metric, Value]; gte?: [Metric, number] };
```

Files to create or modify: `src/core/endgame.ts`, `src/core/scoring.ts`, `tests/core/endgame.test.ts`.

**Verify:** `bun test tests/core -t "endgame|tiebreak|score"`.

### 6. Build CLI adapters for interactive and scripted modes
Create terminal loop adapters that render state, print numbered options, accept numeric choice, and optionally consume scripted inputs for deterministic replay tests.

```ts
// src/cli/modes.ts
interface InputAdapter { nextChoice(): Promise<number>; }
class InteractiveInputAdapter implements InputAdapter {}
class ScriptedInputAdapter implements InputAdapter {}
```

Files to create or modify: `src/cli/main.ts`, `src/cli/render.ts`, `src/cli/modes.ts`, `tests/cli/scripted-session.test.ts`.

**Verify:** `bun run src/cli/main.ts --config examples/minimal-game.yaml --seed 123` and `bun run src/cli/main.ts --config examples/minimal-game.yaml --script examples/script.txt --seed 123`.

### 7. Add integration fixtures and regression harness
Create scenario fixtures that run full turn cycles for single-player and multi-player, assert deterministic transcripts, and protect against action-enumeration regressions.

Files to create or modify: `tests/integration/single-player.test.ts`, `tests/integration/multi-player.test.ts`, `tests/fixtures/*.yaml`, `tests/fixtures/*.script`.

**Verify:** `bun test tests/integration` and transcript diffs are stable for fixed seeds.

## Test Strategy

### 1. Schema and rule validation tests
- **Purpose**: Verify only valid YAML configs enter runtime and that scope boundaries are enforced early.
- **Tests**: Required field checks, unsupported opponent-targeting effects, malformed end-game expressions, non-buyable starter cards, and supply definitions.
- **How**: Fixture-driven Vitest tests on `loadGameConfig` + schema parse errors.
- **DOES NOT**: Prove runtime card resolution correctness after parsing.

### 2. Pure engine property and scenario tests
- **Purpose**: Verify deterministic and legal state transitions in core logic.
- **Tests**: Draw/shuffle behavior, phase transitions, counter updates, effect resolution, optional-skip flows, and legal-action completeness/exclusivity.
- **How**: Vitest unit tests with fixed seeds plus focused scenario snapshots.
- **Likely misses**: Renderer formatting issues are not caught by these tests.

### 3. CLI transcript tests (scripted mode)
- **Purpose**: Verify end-to-end behavior from rendered options to applied actions and next render cycle.
- **Tests**: Full turn loops, invalid numeric input retry, multi-player alternation, end-game stop conditions, and tie-break output.
- **How**: Run CLI in scripted mode and assert normalized output transcripts.
- **Manual check**: Yes; quick interactive smoke play to confirm UX readability.

## Spec Coverage Map

- `Game setup and configuration` -> `Schema and rule validation tests`, `Pure engine property and scenario tests`
- `Turn and phase flow` -> `Pure engine property and scenario tests`, `CLI transcript tests (scripted mode)`
- `State visibility and interaction format` -> `CLI transcript tests (scripted mode)`
- `Card effect resolution` -> `Pure engine property and scenario tests`, `CLI transcript tests (scripted mode)`
- `Victory points and game end` -> `Pure engine property and scenario tests`, `CLI transcript tests (scripted mode)`
- `Scope boundaries for Dominion-lite rules` -> `Schema and rule validation tests`

## Considerations
A Bun-first runtime is fast and simple for local CLI iteration, but using Node-compatible TypeScript patterns where possible reduces lock-in if runtime changes later.
A small structured boolean DSL in YAML is safer than evaluating string expressions, easier to validate, and easier to diff in tests.
Legal-action ordering must be explicitly specified (for example by phase then source-card then target index) to avoid flaky tests and confusing UX.
Scripted mode should share the exact same execution path as interactive mode except input source to prevent divergence.
