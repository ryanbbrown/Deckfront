import { describe, expect, it } from 'vitest';
import { playerLabel, playerShortLabel } from '../src/client/playerLabel';

describe('player labels', () => {
  it('calls the human P1 and the opponent AI regardless of turn order', () => {
    const humanFirst = { mode: 'ai', aiPlayerId: 'indigo' } as const;
    const aiFirst = { mode: 'ai', aiPlayerId: 'ochre' } as const;
    expect(playerLabel(humanFirst, 'ochre')).toBe('P1');
    expect(playerLabel(humanFirst, 'indigo')).toBe('AI');
    expect(playerLabel(aiFirst, 'ochre')).toBe('AI');
    expect(playerLabel(aiFirst, 'indigo')).toBe('P1');
    expect(playerShortLabel(humanFirst, 'ochre')).toBe('P1');
    expect(playerShortLabel(humanFirst, 'indigo')).toBe('AI');
    expect(playerShortLabel(aiFirst, 'ochre')).toBe('AI');
    expect(playerShortLabel(aiFirst, 'indigo')).toBe('P1');
  });

  it('keeps numbered player names in local games', () => {
    const game = { mode: 'local', aiPlayerId: null } as const;
    expect(playerLabel(game, 'ochre')).toBe('Player 1');
    expect(playerLabel(game, 'indigo')).toBe('Player 2');
    expect(playerShortLabel(game, 'ochre')).toBe('P1');
    expect(playerShortLabel(game, 'indigo')).toBe('P2');
  });
});
