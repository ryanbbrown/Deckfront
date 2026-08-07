import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/core/engine';
import { listLegalActions } from '../../src/core/legalActions';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { loadGameConfig } from '../../src/config/loadGameConfig';

describe('Skirmish deck config', () => {
  it('loads twelve market piles and the five symbol lanes', async () => {
    const config = await loadGameConfig('game/deck.yaml');
    expect(config.supply).toHaveLength(12);
    expect(config.setup.draft).toEqual({ baseCard: 'copper', baseCount: 7, maxCards: 3, maxCost: 8 });
    expect(Object.keys(config.setup.attributes)).toEqual(['soldierAttack', 'soldierMovement', 'archerRange', 'archerAttack', 'archerMovement']);
  });

  it('plays every cycling card without decrementing actions and still permits moving to buy', async () => {
    const config = await loadGameConfig('game/deck.yaml');
    const rng = new SeededRng(1);
    let state = setupGame(config, rng);
    const player = state.players[0]!;
    player.hand = Array(6).fill('sparring');
    player.draw = Array(6).fill('copper');
    for (let remaining = 6; remaining > 0; remaining -= 1) {
      expect(listLegalActions(state).some((choice) => choice.action.type === 'moveToBuy')).toBe(true);
      state = applyAction(state, { type: 'playAction', handIndex: 0 }, rng);
    }
    expect(state.players[0]!.actions).toBe(config.setup.initialActions);
    expect(state.players[0]!.attributes.soldierAttack).toBe(6);
  });

  it('spends the ordinary action budget when unlimited actions are disabled', async () => {
    const config = await loadGameConfig('game/deck.yaml');
    config.setup.unlimitedActions = false;
    const rng = new SeededRng(1);
    let state = setupGame(config, rng);
    state.players[0]!.hand = Array(2).fill('sparring');
    state.players[0]!.draw = Array(2).fill('copper');
    state = applyAction(state, { type: 'playAction', handIndex: 0 }, rng);
    expect(listLegalActions(state).some((choice) => choice.action.type === 'playAction')).toBe(false);
    expect(state.players[0]!.actions).toBe(0);
  });

  it('leaves deck end-game evaluation inert because board rules own termination', async () => {
    const config = await loadGameConfig('game/deck.yaml');
    const rng = new SeededRng(1);
    const state = setupGame(config, rng);
    for (const cardId of Object.keys(state.supply)) state.supply[cardId] = 0;
    const next = applyAction(state, { type: 'moveToBuy' }, rng);
    expect(next.ended).toBe(false);
  });
});
