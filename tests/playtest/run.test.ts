import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { playtestRunPaths, turnSnapshotPaths, validateReplayBundle } from '../../src/playtest/run';

describe('playtest run helpers', () => {
  it('uses one directory layout for mutable run artifacts', () => {
    expect(playtestRunPaths('.games/example')).toEqual({
      root: '.games/example',
      deckState: '.games/example/deck.json',
      boardState: '.games/example/board.json',
      timeline: '.games/example/timeline.json',
      snapshotsDir: '.games/example/snapshots'
    });

    expect(turnSnapshotPaths('.games/example', 'turn-003')).toEqual({
      deckBefore: '.games/example/snapshots/turn-003.before.deck.json',
      deckAfter: '.games/example/snapshots/turn-003.after.deck.json',
      boardBefore: '.games/example/snapshots/turn-003.before.board.json',
      boardAfter: '.games/example/snapshots/turn-003.after.board.json'
    });
  });

  it('validates the committed territory replay bundle', async () => {
    const bundle = await validateReplayBundle('.games/territory-v1-playtest/timeline.json');

    expect(bundle.entries).toHaveLength(2);
    expect(bundle.entries[0]?.entry.id).toBe('turn-001');
    expect(bundle.entries[1]?.entry.player).toBe('P2');
  });

  it('fails loudly when a timeline references missing snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    const timelinePath = join(root, 'timeline.json');
    await writeFile(
      timelinePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          title: 'Broken Replay',
          entries: [
            {
              id: 'turn-001',
              player: 'P1',
              round: 1,
              deck: {
                before: 'snapshots/turn-001.before.deck.json',
                after: 'snapshots/turn-001.after.deck.json'
              },
              board: {
                before: 'snapshots/turn-001.before.board.json',
                after: 'snapshots/turn-001.after.board.json'
              },
              summary: 'Missing files.',
              reasoning: 'The bundle validator should catch missing snapshot paths.'
            }
          ]
        },
        null,
        2
      )}\n`
    );

    await expect(validateReplayBundle(timelinePath)).rejects.toThrow('Invalid replay bundle');
  });
});
