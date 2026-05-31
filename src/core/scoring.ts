import type { CardDefinition, CardId, GameState, PlayerState } from './types';

export interface PlayerScore {
  playerId: string;
  score: number;
  turnsTaken: number;
}

export interface Results {
  scores: PlayerScore[];
  winners: PlayerScore[];
}

export function scorePlayer(player: PlayerState, cards: Record<CardId, CardDefinition>): number {
  const ownedCards = [...player.draw, ...player.hand, ...player.discard, ...player.play];
  return ownedCards.reduce((total, cardId) => total + (cards[cardId]?.victoryPoints ?? 0), player.vpCounters);
}

export function finalResults(state: GameState): Results {
  const scores = state.players.map((player) => ({
    playerId: player.id,
    score: scorePlayer(player, state.cards),
    turnsTaken: player.turnsTaken
  }));
  const highestScore = Math.max(...scores.map((score) => score.score));
  const highScorers = scores.filter((score) => score.score === highestScore);
  const fewestTurns = Math.min(...highScorers.map((score) => score.turnsTaken));
  const winners = highScorers.filter((score) => score.turnsTaken === fewestTurns);
  return { scores, winners };
}
