import { finalResults } from '../core/scoring';
import type { GameState, LegalAction } from '../core/types';

export function renderState(state: GameState, actions: LegalAction[]): string {
  if (state.ended) {
    return renderResults(state);
  }
  const player = state.players[state.activePlayer];
  if (!player) {
    throw new Error('Active player is missing');
  }
  const lines: string[] = [];
  lines.push(`Active: ${player.id}`);
  lines.push(`Phase: ${state.phase}`);
  lines.push(`Hand: ${player.hand.map((cardId) => state.cards[cardId]?.name ?? cardId).join(', ') || '(empty)'}`);
  lines.push(`Draw: ${player.draw.length} | Discard: ${player.discard.length} | Trash: ${trashSummary(state)}`);
  lines.push(`Actions: ${player.actions} | Buys: ${player.buys} | Money: ${player.money} | VP: ${player.vpCounters}`);
  const attributes = Object.entries(player.attributes);
  if (attributes.length > 0) {
    lines.push(`Attributes: ${attributes.map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  if (state.pending?.kind === 'lookahead') {
    lines.push(`Exposed: ${(state.pending.exposed ?? []).map((cardId) => state.cards[cardId]?.name ?? cardId).join(', ')}`);
  }
  lines.push('Options:');
  actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.description}`);
  });
  return lines.join('\n');
}

export function renderResults(state: GameState): string {
  const results = finalResults(state);
  const lines = ['Game over', 'Scores:'];
  for (const score of results.scores) {
    lines.push(`${score.playerId}: ${score.score} (${score.turnsTaken} turns)`);
  }
  if (results.winners.length === 1) {
    lines.push(`Winner: ${results.winners[0]?.playerId}`);
  } else {
    lines.push(`Tie: ${results.winners.map((winner) => winner.playerId).join(', ')}`);
  }
  return lines.join('\n');
}

function trashSummary(state: GameState): string {
  if (state.trash.length === 0) {
    return '(empty)';
  }
  const counts = new Map<string, number>();
  for (const cardId of state.trash) {
    const name = state.cards[cardId]?.name ?? cardId;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => `${name} x${count}`).join(', ');
}
