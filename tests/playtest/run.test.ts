import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { boardStateSchema } from '../../src/board/schema';
import { replayTimelineSchema } from '../../src/replay/schema';
import { initPlaytestRun, playtestRunPaths, turnSnapshotPaths, validateReplayBundle } from '../../src/playtest/run';
import { runPlaytestCli } from '../../src/playtest/main';

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

  it('initializes a mutable run directory from a ruleset and map', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));

    const paths = await initPlaytestRun({ root, ruleset: 'territory-v1', map: 'sketch-v1', title: 'Fresh Run' });
    const board = boardStateSchema.parse(JSON.parse(await readFile(paths.boardState, 'utf8')) as unknown);
    const timeline = replayTimelineSchema.parse(JSON.parse(await readFile(paths.timeline, 'utf8')) as unknown);

    expect(board.ruleset).toBe('territory-v1');
    expect(board.map).toBe('sketch-v1');
    expect(board.units).toEqual([]);
    expect(board.supplyControl).toHaveLength(8);
    expect(board.supply).toEqual([
      { player: 'P1', amount: 0 },
      { player: 'P2', amount: 0 }
    ]);
    expect(timeline).toEqual({ schemaVersion: 1, title: 'Fresh Run', entries: [] });
  });

  it('runs validate and init through the playtest CLI', async () => {
    const output: string[] = [];
    await runPlaytestCli(['validate', '.games/territory-v1-playtest/timeline.json'], (line) => output.push(line));

    expect(output[0]).toContain('Valid replay bundle');

    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));
    await runPlaytestCli(['init', '--run', root, '--ruleset', 'territory-v1', '--map', 'sketch-v1'], (line) => output.push(line));

    expect(output.at(-1)).toBe(`Initialized playtest run: ${root}`);
  });

  it('initializes from a starter board file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-run-'));

    await runPlaytestCli(
      [
        'init',
        '--run',
        root,
        '--ruleset',
        'territory-v1',
        '--map',
        'sketch-v1',
        '--board',
        '.games/territory-v1-playtest/snapshots/turn-001.before.board.json'
      ],
      () => undefined
    );

    const board = boardStateSchema.parse(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')) as unknown);

    expect(board.units).toHaveLength(8);
    expect(board.units.find((unit) => unit.id === 'P1-guardian-1')?.hp).toBe(16);
    expect(board.units.find((unit) => unit.id === 'P2-druid-1')?.hp).toBe(10);
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
