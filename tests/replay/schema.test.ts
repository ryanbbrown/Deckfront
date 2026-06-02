import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardStateSchema } from '../../src/board/schema';
import { replayTimelineSchema } from '../../src/replay/schema';

describe('replay timeline schema', () => {
  it('accepts one complete-turn replay entry', () => {
    const timeline = replayTimelineSchema.parse({
      schemaVersion: 1,
      title: 'Sample Replay',
      entries: [
        {
          id: 'turn-001',
          player: 'P1',
          round: 1,
          deck: {
            before: 'snapshots/turn-001.before.deck.json',
            after: 'snapshots/turn-001.after.deck.json',
            drawnHand: ['Copper', 'Zap'],
            played: ['Zap'],
            bought: [],
            produced: { damage: 1 }
          },
          board: {
            before: 'snapshots/turn-001.before.board.json',
            after: 'snapshots/turn-001.after.board.json'
          },
          summary: 'P1 advanced.',
          reasoning: 'Damage had no target, so movement mattered more.'
        }
      ]
    });

    expect(timeline.entries[0]?.deck.produced.damage).toBe(1);
  });

  it('loads the territory playtest timeline from the starter board state', async () => {
    const timeline = replayTimelineSchema.parse(await loadJson('.games/territory-v1-playtest/timeline.json'));
    const starter = boardStateSchema.parse(await loadJson('.games/territory-v1-playtest/snapshots/turn-001.before.board.json'));
    const turnOneAfter = boardStateSchema.parse(await loadJson('.games/territory-v1-playtest/snapshots/turn-001.after.board.json'));
    const turnTwoAfter = boardStateSchema.parse(await loadJson('.games/territory-v1-playtest/snapshots/turn-002.after.board.json'));

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[0]?.board.before).toBe('snapshots/turn-001.before.board.json');
    expect(starter.units.map((unit) => unit.id).sort()).toEqual([
      'P1-guardian-1',
      'P1-marksman-1',
      'P1-raider-1',
      'P1-scout-1',
      'P2-druid-1',
      'P2-marksman-1',
      'P2-scout-1',
      'P2-scout-2'
    ]);
    expect(turnOneAfter.supplyControl.find((center) => center.id === 'center-northeast')?.controller).toBe('P1');
    expect(turnOneAfter.supplyControl.find((center) => center.id === 'center-east')?.controller).toBe('P1');
    expect(turnTwoAfter.supplyControl.find((center) => center.id === 'center-west-south')?.controller).toBe('P2');
  });
});

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
