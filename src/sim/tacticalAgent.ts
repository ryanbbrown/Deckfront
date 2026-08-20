import { isTacticalAction, resolveCard } from '../game';
import type { CardInstance, GameState, LegalAction, MovementChoice, PlayerId } from '../game';
import { repairBuild } from './build';
import { actionPhaseMoney } from './search';
import { chooseBuyAction, projectPurchases } from './buy';
import type { Strategy } from './strategy';
import { chooseTacticalAction } from './tacticalPilot';
import type { CullOption, PilotCard, TacticalDecision, TacticalView } from './tacticalPilot';
import type { Agent } from './types';

function movementOf(action: LegalAction): MovementChoice | undefined {
  const command = action.command;
  if ('movement' in command) return command.movement;
  if ('direction' in command) return command.direction;
  return undefined;
}

function availableCard(state: GameState, actions: readonly LegalAction[], card: CardInstance, handIndex: number): PilotCard {
  const definition = resolveCard(state, card.definitionId);
  const cardActions = actions.filter((action) => 'cardInstanceId' in action.command && action.command.cardInstanceId === card.id);
  return {
    handIndex, definitionId: definition.id, mechanic: definition.mechanic, cost: definition.cost,
    money: definition.money ?? 0, values: definition.values ?? {}, enabled: cardActions.length > 0,
    movements: cardActions.map(movementOf).filter((movement): movement is MovementChoice => movement !== undefined)
  };
}

function projectionVector(state: GameState, playerId: PlayerId, strategy: Strategy, copperTrashed: number): readonly number[] {
  const projection = projectPurchases(state, playerId, actionPhaseMoney(state, playerId) - copperTrashed, strategy);
  return [...projection.finite, projection.repeated];
}

function cullOptions(state: GameState, playerId: PlayerId, strategy: Strategy, hand: readonly PilotCard[]): CullOption[] {
  const copper = hand.filter((card) => card.definitionId === 'copper').map((card) => card.handIndex);
  const cull = hand.find((card) => card.definitionId === 'cull');
  if (!cull) return [];
  const deck = state.players[playerId].deck;
  const copperOwned = [...deck.draw, ...deck.hand, ...deck.discard, ...deck.play]
    .filter((card) => card.definitionId === 'copper').length;
  const options: CullOption[] = [{
    trashHandIndexes: [], trashCull: false, copperTrashed: 0,
    purchaseProjection: projectionVector(state, playerId, strategy, 0)
  }];
  for (let count = 0; count <= Math.min(2, copper.length); count += 1) {
    if (count > 0) options.push({
      trashHandIndexes: copper.slice(0, count), trashCull: false, copperTrashed: count,
      purchaseProjection: projectionVector(state, playerId, strategy, count)
    });
    if (count < 2 && copperOwned === 0) options.push({
      trashHandIndexes: copper.slice(0, count), trashCull: true, copperTrashed: count,
      purchaseProjection: projectionVector(state, playerId, strategy, count)
    });
  }
  return options;
}

export function tacticalView(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], strategy: Strategy
): TacticalView {
  const hand = state.players[playerId].deck.hand.map((card, index) => availableCard(state, actions, card, index));
  return {
    hand,
    discard: state.players[playerId].deck.discard.map((card, index) => ({
      discardIndex: index, definitionId: card.definitionId, cost: resolveCard(state, card.definitionId).cost
    })),
    pendingChoice: state.pendingChoice?.type ?? null,
    actorPosition: state.fighters[playerId].position,
    opponentPosition: state.fighters[playerId === 'ochre' ? 'indigo' : 'ochre'].position,
    opponentHealth: state.fighters[playerId === 'ochre' ? 'indigo' : 'ochre'].health,
    aimed: state.fighters[playerId].aimed,
    opponentExposed: state.fighters[playerId === 'ochre' ? 'indigo' : 'ochre'].exposed,
    mana: state.players[playerId].mana,
    positionChanged: state.players[playerId].positionChanged,
    tacticalPlayed: state.actionsThisTurn.filter(isTacticalAction).length,
    cullOptions: cullOptions(state, playerId, strategy, hand)
  };
}

function actionForDecision(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], decision: TacticalDecision
): LegalAction | undefined {
  if (decision.type === 'end') return actions.find((action) => action.command.type === 'endActionPhase');
  if (decision.type === 'recover') {
    const card = decision.discardIndex === null ? null : state.players[playerId].deck.discard[decision.discardIndex];
    return actions.find((action) => action.command.type === 'resolveRecover'
      && action.command.recoverInstanceId === (card?.id ?? null));
  }
  if (decision.type === 'discard') {
    const card = state.players[playerId].deck.hand[decision.handIndex];
    return actions.find((action) => action.command.type === 'resolveDiscard' && action.command.discardInstanceId === card?.id);
  }
  const card = state.players[playerId].deck.hand[decision.handIndex];
  if (!card) return undefined;
  return actions.find((action) => {
    const command = action.command;
    if (!('cardInstanceId' in command) || command.cardInstanceId !== card.id) return false;
    if (decision.movement !== undefined && movementOf(action) !== decision.movement) return false;
    if (command.type !== 'playCull') return decision.trashHandIndexes === undefined;
    const targetIds = [
      ...(decision.trashCull ? [card.id] : []),
      ...(decision.trashHandIndexes ?? []).map((index) => state.players[playerId].deck.hand[index]?.id)
    ].filter((id): id is string => id !== undefined);
    return command.trashInstanceIds.length === targetIds.length
      && command.trashInstanceIds.every((id) => targetIds.includes(id));
  });
}

export function tacticalAgent(strategy: Strategy): Agent {
  return {
    id: strategy.id,
    chooseStartingBuild(state) { return repairBuild(state, strategy.startingBuild); },
    chooseAction(state, playerId, actions) {
      if (state.phase === 'buy') return chooseBuyAction(state, playerId, actions, strategy);
      const decision = chooseTacticalAction(tacticalView(state, playerId, actions, strategy));
      const action = actionForDecision(state, playerId, actions, decision);
      if (action) return action;
      const end = actions.find((candidate) => candidate.command.type === 'endActionPhase');
      if (end) return end;
      throw new Error(`The tactical pilot could not map ${decision.type} to a legal action.`);
    }
  };
}
