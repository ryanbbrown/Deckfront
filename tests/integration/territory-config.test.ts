import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardCardsSchema } from '../../src/board/schema';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';

describe('territory-v1 deck config', () => {
  it('contains the board ruleset cards as playable deck cards', async () => {
    const boardCards = boardCardsSchema.parse(JSON.parse(await readFile('rulesets/territory-v1/cards.json', 'utf8')));
    const config = await loadGameConfig('examples/territory-v1.yaml');

    expect(new Set(config.cards.map((card) => card.id))).toEqual(new Set(Object.keys(boardCards)));
    expect(config.players).toBe(2);
  });

  it('accumulates board-facing effects as player attributes', async () => {
    const config = await loadGameConfig('examples/territory-v1.yaml');
    const rng = new SeededRng(1);
    const state = setupGame(config, rng);
    const zap = listLegalActions(state).find((action) => action.description === 'Play Zap');

    expect(zap).toBeDefined();

    const next = applyAction(state, zap!.action, rng);
    const player = next.players[next.activePlayer];

    expect(player?.attributes.damage).toBe(1);
    expect(player?.actions).toBe(1);
  });
});
