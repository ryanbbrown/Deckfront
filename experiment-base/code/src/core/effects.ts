import { evaluateEndGame } from '../config/endgame-expr';
import type { ChosenAction, Effect, GameState, PendingEffect } from './types';
import type { Rng } from './random';
import { drawCards, takeTopCards } from './state';

export function continueEffects(state: GameState, effects: Effect[], effectIndex: number, rng: Rng): void {
  let index = effectIndex;
  while (index < effects.length) {
    const effect = effects[index] as Effect;
    const pending = applyEffect(state, effect, effects, index, rng);
    if (pending) {
      state.pending = pending;
      return;
    }
    index += 1;
  }
  delete state.pending;
  if (evaluateEndGame(state.config.endGame, state)) {
    state.ended = true;
  }
}

export function resolvePending(state: GameState, action: Extract<ChosenAction, { type: 'resolvePending' }>, rng: Rng): void {
  const pending = state.pending;
  if (!pending) {
    throw new Error('No pending effect to resolve');
  }
  const player = state.players[pending.player];
  if (!player) {
    throw new Error('Pending effect references an unknown player');
  }

  if (action.choice === 'skip') {
    finishPending(state, pending, rng);
    return;
  }

  if ((pending.kind === 'discard' || pending.kind === 'trash') && action.choice === 'select') {
    const handIndex = Number(action.handIndex);
    const [card] = player.hand.splice(handIndex, 1);
    if (!card) {
      throw new Error('Selected hand card is not available');
    }
    if (pending.kind === 'discard') {
      player.discard.push(card);
    } else {
      state.trash.push(card);
    }
    pending.remaining -= 1;
    if (pending.remaining <= 0 || player.hand.length === 0) {
      finishPending(state, pending, rng);
    }
    return;
  }

  if (pending.kind === 'lookahead' && action.choice === 'lookahead') {
    const exposed = pending.exposed ?? [];
    const exposedIndex = Number(action.exposedIndex);
    const [card] = exposed.splice(exposedIndex, 1);
    if (!card) {
      throw new Error('Selected exposed card is not available');
    }
    const destination = action.destination;
    if (!pending.choices?.includes(destination)) {
      throw new Error(`Unsupported lookahead destination: ${String(destination)}`);
    }
    if (destination === 'draw') {
      player.hand.push(card);
    } else if (destination === 'discard') {
      player.discard.push(card);
    } else if (destination === 'trash') {
      state.trash.push(card);
    } else if (destination === 'top') {
      player.draw.unshift(card);
    } else {
      throw new Error(`Unsupported lookahead destination: ${String(destination)}`);
    }
    pending.exposed = exposed;
    if (exposed.length === 0) {
      finishPending(state, pending, rng);
    }
    return;
  }

  throw new Error('Pending effect choice does not match the pending effect');
}

function applyEffect(state: GameState, effect: Effect, effects: Effect[], effectIndex: number, rng: Rng): PendingEffect | undefined {
  const player = state.players[state.activePlayer];
  if (!player) {
    throw new Error('Active player is missing');
  }

  if (effect.kind === 'grant') {
    drawCards(player, effect.cards ?? 0, rng);
    player.actions += effect.actions ?? 0;
    player.buys += effect.buys ?? 0;
    player.money += effect.money ?? 0;
    for (const [key, value] of Object.entries(effect.attributes ?? {})) {
      player.attributes[key] = (player.attributes[key] ?? 0) + value;
    }
    player.persistentAttributes ??= {};
    for (const [key, value] of Object.entries(effect.persistentAttributes ?? {})) {
      player.persistentAttributes[key] = (player.persistentAttributes[key] ?? 0) + value;
    }
    return undefined;
  }

  if (effect.kind === 'vp') {
    player.vpCounters += effect.points;
    return undefined;
  }

  if (effect.kind === 'discard' || effect.kind === 'trash') {
    if (player.hand.length === 0) {
      return undefined;
    }
    return {
      player: state.activePlayer,
      effects,
      effectIndex,
      kind: effect.kind,
      remaining: Math.min(effect.count, player.hand.length),
      optional: effect.optional ?? false
    };
  }

  if (effect.kind === 'lookahead') {
    const exposed = takeTopCards(player, effect.count, rng);
    if (exposed.length === 0) {
      return undefined;
    }
    return {
      player: state.activePlayer,
      effects,
      effectIndex,
      kind: 'lookahead',
      remaining: exposed.length,
      optional: effect.optional ?? false,
      exposed,
      choices: effect.choices
    };
  }

  return assertNever(effect);
}

function finishPending(state: GameState, pending: PendingEffect, rng: Rng): void {
  const player = state.players[pending.player];
  if (!player) {
    throw new Error('Pending effect references an unknown player');
  }
  if (pending.kind === 'lookahead' && pending.exposed && pending.exposed.length > 0) {
    player.draw.unshift(...pending.exposed);
  }
  delete state.pending;
  continueEffects(state, pending.effects, pending.effectIndex + 1, rng);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported effect: ${JSON.stringify(value)}`);
}
