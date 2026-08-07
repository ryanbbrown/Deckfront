import { describe, expect, it } from 'vitest';
import { replayTimelineSchema, replayWinEventSchema } from '../../src/replay/schema';

describe('Skirmish replay schema', () => {
  it('accepts ordered activations, typed upgrades, run metadata, and a draw', () => {
    const timeline = replayTimelineSchema.parse({
      schemaVersion: 1,
      title: 'Skirmish test',
      run: { turnCap: 20 },
      entries: [{
        id: 'turn-001', player: 'P1', round: 1,
        deck: { before: 'before.deck.json', after: 'after.deck.json' },
        board: { before: 'before.board.json', after: 'after.board.json' },
        actions: {
          keyPointUpgrades: [{ target: 'a1', stat: 'range', to: 3, keyPoint: 'range' }],
          upgrades: [{ target: 's1', stat: 'attack', to: 2 }],
          activations: [{ unit: 's1', from: { col: 1, row: 1 }, via: { col: 2, row: 1 }, attack: { target: 'e1', damage: 2, targetRemoved: false }, to: { col: 1, row: 1 } }]
        },
        winEvents: [], summary: 'Advanced', reasoning: 'Used the available lane.'
      }],
      terminalWinEvents: [{ type: 'turnCap', outcome: 'draw', player: null, completedTurns: 20, playerUnits: 2, opponentUnits: 2, playerHp: 8, opponentHp: 8 }]
    });
    expect(timeline.entries[0]!.actions!.activations).toHaveLength(1);
    expect(timeline.terminalWinEvents?.[0]?.player).toBeNull();
  });

  it('rejects retired action and win-event shapes', () => {
    expect(() => replayWinEventSchema.parse({ type: 'unitLead', status: 'created', player: 'P1', completedTurns: 1, playerUnits: 5, opponentUnits: 4 })).toThrow();
    expect(() => replayTimelineSchema.parse({ schemaVersion: 1, title: 'Old', entries: [], terminalWinEvents: [], extra: true })).toThrow();
  });
});
