import { createGame, listActionAvailability, listLegalActions, submitStartingBuild } from '../game';
import { applyLegalAction } from '../game/engine';
import type { GameState, PlayerId } from '../game';
import { accumulate, createAccumulator, finishTelemetry } from './telemetry';
import type { DeadDrawSnapshot } from './telemetry';
import { ActionSearchOverflowError } from './types';
import type { MatchConfig, MatchOutcome, MatchReason, MatchResult } from './types';

// `createGame` makes ochre active and `submitBuild` requires the active player, so builds are always
// ochre then indigo. `firstPlayerId` decides who acts on turn 1, not who builds first.
const BUILD_ORDER: readonly PlayerId[] = ['ochre', 'indigo'];

/**
 * Called with every state an applied action produces, including the one that ends the match. It is a
 * parameter rather than a `MatchConfig` field because `MatchResult.config` is stored and compared,
 * and a function there would not survive that.
 */
export type MatchObserver = (state: GameState) => void;

export function runMatch(config: MatchConfig, onState?: MatchObserver): MatchResult {
  let state = createGame({
    seed: config.seed, firstPlayerId: config.firstPlayerId,
    kingdomId: config.kingdomId, swapSides: config.swapSides
  });

  const startingBuild: Record<PlayerId, string[]> = { ochre: [], indigo: [] };
  for (const playerId of BUILD_ORDER) {
    const build = config.agents[playerId].chooseStartingBuild(state, playerId);
    startingBuild[playerId] = [...build];
    state = submitStartingBuild(state, playerId, build);
  }

  let accumulator = createAccumulator(startingBuild);
  accumulator = accumulate(accumulator, { events: state.events, completedTurns: state.turn - 1 });

  let outcome: MatchOutcome = 'draw';
  let reason: MatchReason = 'turnLimit';
  let actionsInTurn = 0;

  try {
    for (;;) {
      const playerId = state.activePlayerId;
      const agent = config.agents[playerId];
      const actions = listLegalActions(state);
      if (!actions.length) throw new Error(`No legal action is available in phase ${state.phase}.`);

      const chosen = agent.chooseAction(state, playerId, actions);
      // The agent's own object is never read past its id. An offered id carrying a different command
      // would otherwise pick the wrong snapshot while the engine applied the canonical command.
      const action = actions.find((candidate) => candidate.id === chosen.id);
      if (!action) throw new Error(`Agent ${agent.id} returned an action it was not offered: ${chosen.id}`);

      // Both snapshots must be read before the action applies: `endActionPhase` clears the reason
      // codes and `endBuyPhase` zeroes the money.
      let deadDraws: DeadDrawSnapshot | undefined;
      let unspentMoney: { playerId: PlayerId; amount: number } | undefined;
      if (action.command.type === 'endActionPhase') {
        deadDraws = { playerId, state, availability: listActionAvailability(state, playerId) };
      } else if (action.command.type === 'endBuyPhase') {
        unspentMoney = { playerId, amount: state.players[playerId].money };
      }

      const eventsBefore = state.events.length;
      const turnBefore = state.turn;
      state = applyLegalAction(state, action);
      accumulator = accumulate(accumulator, {
        events: state.events.slice(eventsBefore), completedTurns: state.turn - 1, deadDraws, unspentMoney
      });
      onState?.(state);
      actionsInTurn += 1;

      if (state.winner || state.phase === 'ended') { outcome = state.winner ?? 'draw'; reason = 'victory'; break; }
      if (actionsInTurn > config.actionCapPerTurn) { outcome = 'draw'; reason = 'actionCap'; break; }
      if (state.turn > config.turnLimitPerPlayer * 2) { outcome = 'draw'; reason = 'turnLimit'; break; }
      // Reset after the cap check, so the action that ends a turn counts toward the turn it ended.
      if (state.turn !== turnBefore) actionsInTurn = 0;
    }
  } catch (error) {
    if (!(error instanceof ActionSearchOverflowError)) throw error;
    outcome = 'aborted'; reason = 'actionSearchOverflow';
  }

  return {
    config: {
      kingdomId: config.kingdomId, seed: config.seed, firstPlayerId: config.firstPlayerId,
      swapSides: config.swapSides, turnLimitPerPlayer: config.turnLimitPerPlayer,
      actionCapPerTurn: config.actionCapPerTurn,
      agentIds: { ochre: config.agents.ochre.id, indigo: config.agents.indigo.id }
    },
    outcome,
    reason,
    turns: state.turn - 1,
    telemetry: finishTelemetry(accumulator, state)
  };
}
