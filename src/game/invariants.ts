import { CARDS, MAX_CARRIED_MANA, MAX_FIRST_BUY_CARRY } from './config';
import { ARENA_MAX, ARENA_MIN } from './effects';
import { ALWAYS_AVAILABLE_ACTION_IDS, ALWAYS_AVAILABLE_COUNT, findKingdom } from './kingdom';
import type { GameState } from './types';

export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  if (state.schemaVersion !== 11) errors.push('Unsupported game schema version.');

  for (const fighter of Object.values(state.fighters)) {
    if (fighter.position < ARENA_MIN || fighter.position > ARENA_MAX) {
      errors.push(`${fighter.playerId} is outside the arena.`);
    }
    if (fighter.health < 0 || fighter.health > state.startingHealth) {
      errors.push(`${fighter.playerId} has invalid health.`);
    }
    if (!Number.isInteger(fighter.aimBonus) || fighter.aimBonus < 0) {
      errors.push(`${fighter.playerId} has invalid Aim bonus.`);
    }
  }

  for (const player of Object.values(state.players)) {
    if (!Number.isInteger(player.mana) || player.mana < 0) {
      errors.push(`${player.id} has invalid mana.`);
    }
    if (!Number.isInteger(player.carriedMana) || player.carriedMana < 0
      || player.carriedMana > MAX_CARRIED_MANA || player.carriedMana > player.mana) {
      errors.push(`${player.id} has invalid carried mana.`);
    }
    if (!Number.isInteger(player.firstBuyMoney) || player.firstBuyMoney < 0
      || player.firstBuyMoney > MAX_FIRST_BUY_CARRY) {
      errors.push(`${player.id} has invalid first-buy money.`);
    }
  }

  if (state.pendingChoice) {
    const pending = state.pendingChoice;
    if (state.phase !== 'action') errors.push('A pending choice exists outside the Action phase.');
    if (pending.playerId !== state.activePlayerId) {
      errors.push('A pending choice belongs to the inactive player.');
    }
    if ((pending.type === 'discard' || pending.type === 'recover')
      && (!Number.isInteger(pending.remaining) || pending.remaining < 1)) {
      errors.push('A pending choice has an invalid remaining count.');
    }
    if (pending.type === 'gain' && (!Number.isInteger(pending.maxCost) || pending.maxCost < 0)) {
      errors.push('A gain choice has an invalid maximum cost.');
    }
    if (pending.type === 'optionalTrash'
      && !state.players[pending.playerId].deck.play.some((card) =>
        card.id === pending.sourceCardInstanceId)) {
      errors.push('An optional trash source is not in play.');
    }
  }

  if (state.phase === 'startingBuild') {
    if (!state.startingDraftEnabled) errors.push('Draft-off game is in starting build.');
    const setupCards = Object.values(state.players).flatMap((player) => [
      ...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play
    ]);
    if (setupCards.length) errors.push('Card instances exist before both starting builds complete.');
  }

  if (!state.startingDraftEnabled && Object.values(state.players).some((player) =>
    player.startingBuild !== null || player.firstBuyPending || player.firstBuyMoney !== 0)) {
    errors.push('Draft-off setup metadata is invalid.');
  }

  const kingdom = findKingdom(state.kingdomId);
  if (!kingdom) {
    errors.push(`Unknown kingdom: ${state.kingdomId}`);
  } else {
    if (state.startingHealth !== kingdom.startingHealth) {
      errors.push('Starting health does not match the kingdom.');
    }
    const piles = new Map<string, number>([
      ...kingdom.actionPiles.map((pile) => [pile.cardId, pile.count] as const),
      ...ALWAYS_AVAILABLE_ACTION_IDS.map((id) => [id, ALWAYS_AVAILABLE_COUNT] as const)
    ]);
    for (const [id, count] of Object.entries(state.supply)) {
      const declared = piles.get(id);
      if (declared === undefined) errors.push(`Supply has invalid card ${id}.`);
      else if (!Number.isInteger(count) || count < 0 || count > declared) {
        errors.push(`${id} has invalid supply count.`);
      }
    }
    for (const id of piles.keys()) {
      if (!(id in state.supply)) errors.push(`Supply is missing ${id}.`);
    }
  }

  if (!Number.isInteger(state.turnState.spacesMoved) || state.turnState.spacesMoved < 0
    || !Number.isInteger(state.turnState.manaSpent) || state.turnState.manaSpent < 0
    || !Number.isInteger(state.turnState.spellsPlayed) || state.turnState.spellsPlayed < 0) {
    errors.push('Turn counters are invalid.');
  }

  const cards = [
    ...state.trash,
    ...Object.values(state.players).flatMap((player) => [
      ...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play
    ])
  ];
  const ids = new Set<string>();
  for (const card of cards) {
    if (!CARDS[card.definitionId]) errors.push(`${card.id} has unknown definition.`);
    if (ids.has(card.id)) errors.push(`${card.id} appears in more than one zone.`);
    ids.add(card.id);
  }
  if (cards.length !== state.nextCardSerial - 1) {
    errors.push(`Expected ${state.nextCardSerial - 1} physical cards but found ${cards.length}.`);
  }
  if (state.winner && (state.phase !== 'ended'
    || state.fighters[state.winner === 'ochre' ? 'indigo' : 'ochre'].health !== 0)) {
    errors.push('Winner does not match health and phase.');
  }
  if (!state.winner && state.phase === 'ended') errors.push('Ended game has no winner.');
  state.events.forEach((event, index) => {
    if (event.sequence !== index) errors.push(`Event ${index} has wrong sequence.`);
  });
  return errors;
}

export function assertInvariants(state: GameState): void {
  const errors = checkInvariants(state);
  if (errors.length) throw new Error(errors.join('\n'));
}
