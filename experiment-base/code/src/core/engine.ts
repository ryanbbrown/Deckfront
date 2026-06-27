import { evaluateEndGame } from '../config/endgame-expr';
import type { ChosenAction, GameState } from './types';
import type { Rng } from './random';
import { listLegalActions } from './legalActions';
import { autoPlayTreasures } from './treasure';
import { cloneState, drawCards, resetTurnResources } from './state';
import { continueEffects, resolvePending } from './effects';

export function applyAction(state: GameState, action: ChosenAction, rng: Rng): GameState {
  const next = cloneState(state);
  if (next.ended) {
    return next;
  }
  assertActionIsLegal(next, action);
  if (action.type === 'resolvePending') {
    resolvePending(next, action, rng);
    return next;
  }
  if (next.pending) {
    throw new Error('Pending effect must be resolved before taking another action');
  }

  const player = next.players[next.activePlayer];
  if (!player) {
    throw new Error('Active player is missing');
  }

  if (action.type === 'playAction') {
    if (next.phase !== 'action') {
      throw new Error('Action cards can only be played in the action phase');
    }
    if (player.actions <= 0) {
      throw new Error('No actions remaining');
    }
    const [cardId] = player.hand.splice(action.handIndex, 1);
    const card = cardId ? next.cards[cardId] : undefined;
    if (!card || card.type !== 'action') {
      throw new Error('Selected card is not a playable action');
    }
    player.actions -= 1;
    player.play.push(card.id);
    continueEffects(next, card.effects ?? [], 0, rng);
    return next;
  }

  if (action.type === 'trashCard') {
    if (next.phase !== 'action') {
      throw new Error('Cards can only be trashed before the buy phase');
    }
    if (player.freeTrashUsed === true) {
      throw new Error('Free trash has already been used this turn');
    }
    if (player.play.length > 0) {
      throw new Error('Free trash must happen before playing cards this turn');
    }
    const [cardId] = player.hand.splice(action.handIndex, 1);
    if (!cardId) {
      throw new Error('Selected hand card is not available');
    }
    player.freeTrashUsed = true;
    next.trash.push(cardId);
    return next;
  }

  if (action.type === 'moveToBuy') {
    if (next.phase !== 'action') {
      throw new Error('Can only move to buy phase from action phase');
    }
    next.phase = 'buy';
    autoPlayTreasures(next, player);
    return next;
  }

  if (action.type === 'buyCard') {
    if (next.phase !== 'buy') {
      throw new Error('Cards can only be bought in the buy phase');
    }
    const card = next.cards[action.cardId];
    if (!card) {
      throw new Error(`Unknown card: ${action.cardId}`);
    }
    if ((next.supply[action.cardId] ?? 0) <= 0) {
      throw new Error(`Supply pile is empty: ${action.cardId}`);
    }
    if (player.buys <= 0) {
      throw new Error('No buys remaining');
    }
    if (player.money < card.cost) {
      throw new Error(`Not enough money to buy ${card.name}`);
    }
    player.buys -= 1;
    player.money -= card.cost;
    player.discard.push(card.id);
    next.supply[card.id] = (next.supply[card.id] ?? 0) - 1;
    if (evaluateEndGame(next.config.endGame, next)) {
      player.turnsTaken += 1;
      next.ended = true;
    }
    return next;
  }

  if (action.type === 'endTurn') {
    cleanupAndAdvance(next, rng);
    if (evaluateEndGame(next.config.endGame, next)) {
      next.ended = true;
    }
    return next;
  }

  return assertNever(action);
}

function cleanupAndAdvance(state: GameState, rng: Rng): void {
  const player = state.players[state.activePlayer];
  if (!player) {
    throw new Error('Active player is missing');
  }
  player.discard.push(...player.hand, ...player.play);
  player.hand = [];
  player.play = [];
  player.turnsTaken += 1;
  drawCards(player, state.config.setup.handSize, rng);
  state.activePlayer = (state.activePlayer + 1) % state.players.length;
  const nextPlayer = state.players[state.activePlayer];
  if (!nextPlayer) {
    throw new Error('Next player is missing');
  }
  resetTurnResources(nextPlayer, state.config);
  state.phase = 'action';
}

function assertActionIsLegal(state: GameState, action: ChosenAction): void {
  const isLegal = listLegalActions(state).some((legalAction) => actionsEqual(legalAction.action, action));
  if (!isLegal) {
    throw new Error(`Illegal action: ${JSON.stringify(action)}`);
  }
}

function actionsEqual(left: ChosenAction, right: ChosenAction): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === 'playAction' && right.type === 'playAction') {
    return left.handIndex === right.handIndex;
  }
  if (left.type === 'trashCard' && right.type === 'trashCard') {
    return left.handIndex === right.handIndex;
  }
  if (left.type === 'moveToBuy' && right.type === 'moveToBuy') {
    return true;
  }
  if (left.type === 'buyCard' && right.type === 'buyCard') {
    return left.cardId === right.cardId;
  }
  if (left.type === 'endTurn' && right.type === 'endTurn') {
    return true;
  }
  if (left.type === 'resolvePending' && right.type === 'resolvePending') {
    if (left.choice !== right.choice) {
      return false;
    }
    if (left.choice === 'skip' && right.choice === 'skip') {
      return true;
    }
    if (left.choice === 'select' && right.choice === 'select') {
      return left.handIndex === right.handIndex;
    }
    if (left.choice === 'lookahead' && right.choice === 'lookahead') {
      return left.exposedIndex === right.exposedIndex && left.destination === right.destination;
    }
  }
  return false;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported action: ${JSON.stringify(value)}`);
}
