import { describe, expect, it } from 'vitest';
import { GameConfigSchema } from '../../src/config/schema';
import { testConfig } from '../helpers/config';

describe('GameConfigSchema', () => {
  it('accepts setup cards that are not buyable supply cards', () => {
    const parsed = GameConfigSchema.parse(
      testConfig({
        supply: [{ card: 'estate', count: 8 }]
      })
    );

    expect(parsed.setup.startingDeck).toContain('copper');
    expect(parsed.supply.map((pile) => pile.card)).not.toContain('copper');
  });

  it('rejects unsupported opponent-targeting effects', () => {
    const config = testConfig({
      cards: [
        { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
        { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
        { id: 'province', name: 'Province', type: 'victory', cost: 8, victoryPoints: 6 },
        {
          id: 'attack',
          name: 'Attack',
          type: 'action',
          cost: 5,
          effects: [{ kind: 'discard', target: 'opponent', count: 1 }]
        }
      ] as never
    });

    const result = GameConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('Only self-targeting effects are supported');
  });

  it('accepts temporary and persistent custom attributes', () => {
    const parsed = GameConfigSchema.parse(
      testConfig({
        cards: [
          { id: 'copper', name: 'Copper', type: 'treasure', cost: 0, treasure: 1 },
          { id: 'estate', name: 'Estate', type: 'victory', cost: 2, victoryPoints: 1 },
          { id: 'province', name: 'Province', type: 'victory', cost: 8, victoryPoints: 6 },
          {
            id: 'banner',
            name: 'Banner',
            type: 'action',
            cost: 5,
            effects: [{ kind: 'grant', attributes: { damage: 1 }, persistentAttributes: { renown: 1 } }]
          }
        ],
        supply: [{ card: 'estate', count: 8 }]
      })
    );

    expect(parsed.cards.find((card) => card.id === 'banner')?.effects).toEqual([
      { kind: 'grant', attributes: { damage: 1 }, persistentAttributes: { renown: 1 } }
    ]);
  });

  it('rejects malformed end-game expressions', () => {
    const config = testConfig({ endGame: { gte: ['emptyPiles', -1] } as never });

    expect(() => GameConfigSchema.parse(config)).toThrow();
  });

  it('rejects supply piles that start empty', () => {
    const config = testConfig({ supply: [{ card: 'estate', count: 0 }] });

    expect(() => GameConfigSchema.parse(config)).toThrow();
  });
});
