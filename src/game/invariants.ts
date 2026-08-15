import { CARDS } from './config';
import { equal, onBoard } from './hex';
import type { GameState } from './types';

export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const occupied: Array<{ id: string; position: { q: number; r: number } }> = [];
  if (state.schemaVersion !== 2) errors.push('Unsupported game schema.');
  if (state.round.number < 1 || state.round.actionStep < 1) errors.push('Round counters must be positive.');
  if (new Set(state.round.passedPlayerIds).size !== state.round.passedPlayerIds.length) errors.push('A player passed more than once.');
  if (state.phase === 'action' && state.round.passedPlayerIds.includes(state.activePlayerId)) errors.push('A passed player is active.');
  if (state.phase === 'purchase' && state.round.purchaseOrder[state.round.purchaseIndex] !== state.activePlayerId) errors.push('Purchase order and active player differ.');
  for (const piece of Object.values(state.pieces)) {
    if (piece.position) {
      if (!onBoard(piece.position)) errors.push(`${piece.id} is outside the board.`);
      occupied.push({ id: piece.id, position: piece.position });
    } else if (!piece.needsRespawn && !state.winner) errors.push(`${piece.id} has no position and does not need a respawn.`);
    if (piece.position && piece.needsRespawn) errors.push(`${piece.id} is both placed and awaiting respawn.`);
    if (piece.baselineMoves < 0 || piece.baselineMoves > 1) errors.push(`${piece.id} has invalid baseline moves.`);
  }
  for (const block of state.blocks) {
    if (!onBoard(block.position)) errors.push(`${block.id} is outside the board.`);
    if (block.expiresAfterRound !== state.round.number) errors.push(`${block.id} has an invalid expiry round.`);
    occupied.push({ id: block.id, position: block.position });
  }
  for (let left = 0; left < occupied.length; left += 1) for (let right = left + 1; right < occupied.length; right += 1) {
    if (equal(occupied[left]!.position, occupied[right]!.position)) errors.push(`${occupied[left]!.id} overlaps ${occupied[right]!.id}.`);
  }
  for (const playerId of ['ochre', 'indigo'] as const) {
    if (state.blocks.filter((block) => block.ownerId === playerId).length > 2) errors.push(`${playerId} owns more than two blocks.`);
    const player = state.players[playerId];
    if (player.money < 0 || player.buys < 0 || player.buys > 1) errors.push(`${playerId} has invalid resources.`);
  }
  for (const score of Object.values(state.scores)) if (!Number.isInteger(score) || score < 0 || score > 5) errors.push('A player has an invalid score.');
  for (const [cardId, count] of Object.entries(state.supply)) {
    if (!CARDS[cardId]) errors.push(`Supply has unknown card ${cardId}.`);
    if (!Number.isInteger(count) || count < 0) errors.push(`${cardId} has an invalid supply count.`);
  }
  const cards = [...state.trash, ...Object.values(state.players).flatMap((player) => [
    ...player.deck.draw, ...player.deck.hand, ...player.deck.discard, ...player.deck.play
  ])];
  const ids = new Set<string>();
  for (const card of cards) {
    if (!CARDS[card.definitionId]) errors.push(`${card.id} has an unknown definition.`);
    if (ids.has(card.id)) errors.push(`${card.id} appears in more than one zone.`);
    ids.add(card.id);
  }
  if (cards.length !== state.nextCardSerial - 1) errors.push(`Expected ${state.nextCardSerial - 1} physical cards but found ${cards.length}.`);
  if (state.winner && (state.scores[state.winner] < 5 || state.phase !== 'ended')) errors.push('Winner and score do not agree.');
  if (!state.winner && state.phase === 'ended') errors.push('Ended game has no winner.');
  if (state.phase === 'action' && Object.values(state.pieces).some((piece) => piece.ownerId === state.activePlayerId && piece.needsRespawn)) {
    errors.push('Active player has an unresolved respawn.');
  }
  state.events.forEach((event, index) => { if (event.sequence !== index) errors.push(`Event ${index} has the wrong sequence.`); });
  return errors;
}
export function assertInvariants(state: GameState): void {
  const errors = checkInvariants(state);
  if (errors.length) throw new Error(errors.join('\n'));
}
