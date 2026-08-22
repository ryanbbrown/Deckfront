import { isTacticalAction, opponent, resolveCard } from '../game';
import type { CardInstance, GameState, LegalAction, MovementChoice, PlayerId } from '../game';
import { repairBuild } from './build';
import { actionPhaseMoney } from './search';
import { chooseBuyAction, projectPurchases } from './buy';
import type { Strategy } from './strategy';
import { chooseTacticalAction } from './tacticalPilot';
import type { CullOption, PilotCard, TacticalDecision, TacticalView } from './tacticalPilot';
import { buildAttackProfile } from './positionValue';
import type { AttackProfile, ProfileCard } from './positionValue';
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
    handIndex, definitionId: definition.id, mechanic: definition.mechanic, family: definition.family, cost: definition.cost,
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

function attackProfile(state: GameState, playerId: PlayerId): AttackProfile {
  const deck = state.players[playerId].deck;
  function* definitions(): Iterable<ProfileCard> {
    for (const zone of [deck.draw, deck.hand, deck.discard, deck.play]) for (const instance of zone) {
      const card = resolveCard(state, instance.definitionId);
      yield { definitionId: card.id, mechanic: card.mechanic, values: card.values ?? {} };
    }
  }
  return buildAttackProfile(definitions(), resolveCard(state, 'aim').values?.bonus ?? 0);
}

export function tacticalView(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], strategy: Strategy
): TacticalView {
  const hand = state.players[playerId].deck.hand.map((card, index) => availableCard(state, actions, card, index));
  const opponentId = opponent(playerId);
  return {
    hand,
    discard: state.players[playerId].deck.discard.map((card, index) => ({
      discardIndex: index, definitionId: card.definitionId, cost: resolveCard(state, card.definitionId).cost
    })),
    pendingChoice: state.pendingChoice?.type ?? null,
    actorPosition: state.fighters[playerId].position,
    opponentPosition: state.fighters[opponentId].position,
    opponentHealth: state.fighters[opponentId].health,
    aimed: state.fighters[playerId].aimed,
    aimBonus: state.fighters[playerId].aimed ? resolveCard(state, 'aim').values?.bonus ?? 0 : 0,
    opponentExposed: state.fighters[opponentId].exposed,
    opponentExposedBonus: state.fighters[opponentId].exposed ? resolveCard(state, 'feint').values?.bonus ?? 0 : 0,
    mana: state.players[playerId].mana, manaSpent: state.turnState.manaSpent, spellsPlayed: state.turnState.spellsPlayed,
    cardsPlayed: state.turnState.cardsPlayed.length, copiesPlayed: state.turnState.copiesPlayed,
    familiesPlayed: state.turnState.familiesPlayed,
    positionChanged: state.players[playerId].positionChanged,
    tacticalPlayed: state.turnState.cardsPlayed.filter(isTacticalAction).length,
    cullOptions: cullOptions(state, playerId, strategy, hand),
    actorProfile: attackProfile(state, playerId), opponentProfile: attackProfile(state, opponentId)
  };
}

function actionForDecision(
  state: GameState, playerId: PlayerId, actions: readonly LegalAction[], decision: TacticalDecision
): LegalAction | undefined {
  if (decision.type === 'end') return actions.find((action) => action.command.type === 'endActionPhase');
  if (decision.type === 'recover') {
    const card = decision.discardIndex === null ? undefined : state.players[playerId].deck.discard[decision.discardIndex];
    return actions.find((action) => action.command.type === 'resolveRecover' && action.command.recoverInstanceId === card?.id);
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
    if (command.type !== 'playTargetedAction') return decision.targetHandIndexes === undefined;
    if (decision.targetHandIndexes === undefined) return false;
    const targetIds = [
      ...(decision.targetSelf ? [card.id] : []),
      ...decision.targetHandIndexes.map((index) => state.players[playerId].deck.hand[index]?.id)
    ].filter((id): id is string => id !== undefined);
    return command.targetCardInstanceIds.length === targetIds.length
      && command.targetCardInstanceIds.every((id) => targetIds.includes(id));
  });
}

export function tacticalAgent(strategy: Strategy): Agent {
  return {
    id: strategy.id,
    chooseStartingBuild(state) { return repairBuild(state, strategy.startingBuild); },
    chooseAction(state, playerId, actions) {
      if (state.phase === 'buy') return chooseBuyAction(state, playerId, actions, strategy);
      if (state.pendingChoice?.type === 'optionalTrash') {
        return actions.find((action) => action.command.type === 'resolveOptionalTrash' && action.command.trashInstanceId === null)!;
      }
      if (state.pendingChoice?.type === 'gain') {
        const gains = actions.filter((action): action is LegalAction & {
          command: Extract<LegalAction['command'], { type: 'resolveGain' }>
        } => action.command.type === 'resolveGain');
        return [...gains].sort((left, right) =>
          resolveCard(state, right.command.definitionId).cost - resolveCard(state, left.command.definitionId).cost
          || left.command.definitionId.localeCompare(right.command.definitionId))[0]!;
      }
      const decision = chooseTacticalAction(tacticalView(state, playerId, actions, strategy));
      const action = actionForDecision(state, playerId, actions, decision);
      if (action) return action;
      const end = actions.find((candidate) => candidate.command.type === 'endActionPhase');
      if (end) return end;
      throw new Error(`The tactical pilot could not map ${decision.type} to a legal action.`);
    }
  };
}
