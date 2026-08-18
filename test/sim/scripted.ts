import type { DirectionChoice, GameCommand, GameState, LegalAction, MovementChoice, PlayerId } from '../../src/game';
import type { Agent } from '../../src/sim/types';

/** A play preference: a definition id, optionally pinned to one movement or direction choice. */
export interface ScriptedPlay { cardId: string; movement?: MovementChoice; direction?: DirectionChoice }
export type PlayPreference = string | ScriptedPlay;

export interface ScriptedOptions {
  id?: string;
  builds?: Partial<Record<PlayerId, readonly string[]>>;
  play?: readonly PlayPreference[];   // definition ids, best first
  buy?: readonly string[];            // definition ids, best first
  observe?: (state: GameState, playerId: PlayerId) => void;
}

function endOf(actions: readonly LegalAction[], type: 'endActionPhase' | 'endBuyPhase'): LegalAction {
  const found = actions.find((action) => action.command.type === type);
  if (!found) throw new Error(`The scripted agent was not offered ${type}.`);
  return found;
}
function matches(preference: PlayPreference, command: GameCommand, hand: ReadonlyMap<string, string>): boolean {
  const wanted = typeof preference === 'string' ? { cardId: preference } : preference;
  if (!('cardInstanceId' in command)) return false;
  if (hand.get(command.cardInstanceId) !== wanted.cardId) return false;
  if ('movement' in wanted && wanted.movement !== undefined) {
    if (!('movement' in command) || command.movement !== wanted.movement) return false;
  }
  if ('direction' in wanted && wanted.direction !== undefined) {
    if (!('direction' in command) || command.direction !== wanted.direction) return false;
  }
  return true;
}

/**
 * A test agent driven by a fixed preference list. It reads no field that identifies the first
 * player, so a first-player check that uses it proves something.
 */
export function scriptedAgent(options: ScriptedOptions = {}): Agent {
  const plays = options.play ?? [];
  const buys = options.buy ?? [];
  return {
    id: options.id ?? 'scripted',
    chooseStartingBuild(_state, playerId) { return [...(options.builds?.[playerId] ?? [])]; },
    chooseAction(state, playerId, actions) {
      options.observe?.(state, playerId);
      if (state.phase === 'buy') {
        for (const cardId of buys) {
          const found = actions.find((action) => action.command.type === 'buyCard' && action.command.definitionId === cardId);
          if (found) return found;
        }
        return endOf(actions, 'endBuyPhase');
      }
      if (state.pendingChoice) return actions[0]!;
      const hand = new Map(state.players[playerId].deck.hand.map((card) => [card.id, card.definitionId]));
      for (const preference of plays) {
        const found = actions.find((action) => matches(preference, action.command, hand));
        if (found) return found;
      }
      return endOf(actions, 'endActionPhase');
    }
  };
}
