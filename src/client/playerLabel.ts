import type { PlayerId } from '../game';
import type { GameView } from '../shared/api';

type PlayerLabelGame = Pick<GameView, 'mode' | 'aiPlayerId'>;

export function playerLabel(game: PlayerLabelGame, playerId: PlayerId): string {
  if (game.mode === 'ai') return playerId === game.aiPlayerId ? 'AI' : 'P1';
  return playerId === 'ochre' ? 'Player 1' : 'Player 2';
}

export function playerShortLabel(game: PlayerLabelGame, playerId: PlayerId): string {
  if (game.mode === 'ai') return playerLabel(game, playerId);
  return playerId === 'ochre' ? 'P1' : 'P2';
}
