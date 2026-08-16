import { CARDS } from './config';
import type { GameState } from './types';

export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  if (state.schemaVersion !== 5) errors.push('Unsupported game schema version.');
  for (const fighter of Object.values(state.fighters)) {
    if (fighter.position < 1 || fighter.position > 5) errors.push(`${fighter.playerId} is outside the arena.`);
    if (fighter.health < 0 || fighter.health > 20) errors.push(`${fighter.playerId} has invalid health.`);
  }
  if (state.phase === 'startingBuild') {
    const cards = Object.values(state.players).flatMap((player) => [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play]);
    if (cards.length) errors.push('Card instances exist before both starting builds complete.');
  }
  for (const [id, count] of Object.entries(state.supply)) {
    if (!CARDS[id] || CARDS[id].type !== 'action') errors.push(`Supply has invalid card ${id}.`);
    if (!Number.isInteger(count) || count < 0 || count > 10) errors.push(`${id} has invalid supply count.`);
  }
  const cards = [...state.trash, ...Object.values(state.players).flatMap((player) => [...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play])];
  const ids = new Set<string>();
  for (const card of cards) {
    if (!CARDS[card.definitionId]) errors.push(`${card.id} has unknown definition.`);
    if (ids.has(card.id)) errors.push(`${card.id} appears in more than one zone.`);
    ids.add(card.id);
  }
  if (cards.length !== state.nextCardSerial - 1) errors.push(`Expected ${state.nextCardSerial - 1} physical cards but found ${cards.length}.`);
  if (state.winner && (state.phase !== 'ended' || state.fighters[state.winner === 'ochre' ? 'indigo' : 'ochre'].health !== 0)) errors.push('Winner does not match health and phase.');
  if (!state.winner && state.phase === 'ended') errors.push('Ended game has no winner.');
  state.events.forEach((event, index) => { if (event.sequence !== index) errors.push(`Event ${index} has wrong sequence.`); });
  return errors;
}
export function assertInvariants(state: GameState): void {
  const errors = checkInvariants(state);
  if (errors.length) throw new Error(errors.join('\n'));
}
