import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import { runPlaytestCli } from '../../src/playtest/main';
import { validateReplayBundle } from '../../src/playtest/run';
import type { BoardState } from '../../src/board/schema';

const tempDirs: string[] = [];

describe('playtest commit-turn', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('commits a structured deck and board turn to the timeline', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');
    const output: string[] = [];

    await runPlaytestCli(
      [
        'commit-turn',
        '--run',
        run,
        '--deck-result',
        results.deckResult,
        '--board-result',
        results.boardResult,
        '--summary',
        'P1 banked board supply.',
        '--reasoning',
        'No board contact was available, so the turn held position.'
      ],
      (line) => output.push(line)
    );

    const timeline = JSON.parse(await readFile(join(run, 'timeline.json'), 'utf8')) as { entries: Array<{ id: string; winEvents?: unknown[] }> };
    expect(output).toContain('Committed replay entry: turn-001');
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]).toMatchObject({ id: 'turn-001', winEvents: [] });
    await expect(validateReplayBundle(join(run, 'timeline.json'), { strict: true, strictDeck: true })).resolves.toMatchObject({ entries: expect.any(Array) });
  });

  it('appends a second committed turn with continuity validation', async () => {
    const run = await makeRun();
    const first = await executeNoopTurn(run, 'turn-001', 'P1');
    await commit(run, first);
    const second = await executeNoopTurn(run, 'turn-002', 'P2');

    await commit(run, second);

    const timeline = JSON.parse(await readFile(join(run, 'timeline.json'), 'utf8')) as { entries: Array<{ id: string; player: string }> };
    expect(timeline.entries).toEqual([
      expect.objectContaining({ id: 'turn-001', player: 'P1' }),
      expect.objectContaining({ id: 'turn-002', player: 'P2' })
    ]);
    await expect(validateReplayBundle(join(run, 'timeline.json'), { strict: true, strictDeck: true })).resolves.toMatchObject({ entries: expect.any(Array) });
  });

  it('rejects mismatched result turn ids without mutating the timeline', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');
    const original = await readFile(join(run, 'timeline.json'), 'utf8');
    const boardResult = JSON.parse(await readFile(results.boardResult, 'utf8')) as Record<string, unknown>;
    await writeJson(results.boardResult, { ...boardResult, turnId: 'turn-999' });

    await expect(commit(run, results)).rejects.toThrow('deck result turn turn-001 does not match board result turn-999');
    await expect(readFile(join(run, 'timeline.json'), 'utf8')).resolves.toBe(original);
  });

  it('rejects tampered deck snapshot paths without mutating the timeline', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');
    const original = await readFile(join(run, 'timeline.json'), 'utf8');
    const deckResult = JSON.parse(await readFile(results.deckResult, 'utf8')) as Record<string, unknown>;
    await writeJson(results.deckResult, { ...deckResult, before: '../outside.deck.json' });

    await expect(commit(run, results)).rejects.toThrow('deck.before must be a relative snapshot path inside the run');
    await expect(readFile(join(run, 'timeline.json'), 'utf8')).resolves.toBe(original);
  });

  it('rejects duplicate entry ids without mutating the timeline', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');
    await commit(run, results);
    const committed = await readFile(join(run, 'timeline.json'), 'utf8');

    await expect(commit(run, results)).rejects.toThrow('timeline already contains entry turn-001');
    await expect(readFile(join(run, 'timeline.json'), 'utf8')).resolves.toBe(committed);
  });

  it('rejects missing summary text through the CLI', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');

    await expect(
      runPlaytestCli(
        [
          'commit-turn',
          '--run',
          run,
          '--deck-result',
          results.deckResult,
          '--board-result',
          results.boardResult,
          '--summary',
          '',
          '--reasoning',
          'Reasoning is present.'
        ],
        () => undefined
      )
    ).rejects.toThrow('Missing value for --summary');
  });

  it('passes strict-win for a no-event committed turn', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');

    await runPlaytestCli(
      [
        'commit-turn',
        '--run',
        run,
        '--deck-result',
        results.deckResult,
        '--board-result',
        results.boardResult,
        '--summary',
        'P1 waited.',
        '--reasoning',
        'No win threat was created.',
        '--strict-win'
      ],
      () => undefined
    );

    await expect(validateReplayBundle(join(run, 'timeline.json'), { strict: true, strictDeck: true, strictWin: true })).resolves.toMatchObject({ entries: expect.any(Array) });
  });

  it('commits supplied win events under strict-win when a threat is created', async () => {
    const run = await makeRun(
      boardState({
        ruleset: 'territory-v1-cost6-damagecap-responsewin',
        units: [
          unit('P1-guardian-1', 'P1', 'guardian', 10, 1),
          unit('P1-marksman-1', 'P1', 'marksman', 11, 0),
          unit('P1-scout-1', 'P1', 'scout', 12, 1),
          unit('P1-raider-1', 'P1', 'raider', 11, 1)
        ]
      })
    );
    const results = await executeNoopTurn(run, 'turn-001', 'P1');
    const winEventsPath = join(run, 'turn-001.win-events.json');
    await writeJson(winEventsPath, [
      {
        type: 'unitLead',
        status: 'created',
        player: 'P1',
        completedTurns: 0,
        playerUnits: 4,
        opponentUnits: 0,
        playerCenters: 0,
        opponentCenters: 0
      }
    ]);

    await runPlaytestCli(
      [
        'commit-turn',
        '--run',
        run,
        '--deck-result',
        results.deckResult,
        '--board-result',
        results.boardResult,
        '--summary',
        'P1 created a unit-lead threat.',
        '--reasoning',
        'The board opened with a large unit lead.',
        '--win-events',
        winEventsPath,
        '--strict-win'
      ],
      () => undefined
    );

    await expect(validateReplayBundle(join(run, 'timeline.json'), { strict: true, strictDeck: true, strictWin: true })).resolves.toMatchObject({ entries: expect.any(Array) });
  });

  it('rejects stale board-after turn state without mutating the timeline', async () => {
    const run = await makeRun();
    const results = await executeNoopTurn(run, 'turn-001', 'P1');
    const original = await readFile(join(run, 'timeline.json'), 'utf8');
    const boardResult = JSON.parse(await readFile(results.boardResult, 'utf8')) as { after: string };
    const afterBoard = JSON.parse(await readFile(join(run, boardResult.after), 'utf8')) as BoardState;
    await writeJson(join(run, boardResult.after), { ...afterBoard, turn: { activePlayer: 'P1', round: 1 } });

    await expect(commit(run, results)).rejects.toThrow('board.after turn is P1 round 1, expected P2 round 1');
    await expect(readFile(join(run, 'timeline.json'), 'utf8')).resolves.toBe(original);
  });
});

async function makeRun(board: BoardState = boardState()): Promise<string> {
  const run = await mkdtemp(join(tmpdir(), 'deckfront-commit-turn-'));
  tempDirs.push(run);
  await writeJson(join(run, 'timeline.json'), { schemaVersion: 1, title: 'Commit Turn Test', entries: [] });
  await writeJson(join(run, 'board.json'), board);
  return run;
}

async function executeNoopTurn(run: string, turnId: string, player: string): Promise<{ deckResult: string; boardResult: string }> {
  const deckAction = join(run, 'actions', `${turnId}.deck.json`);
  const boardAction = join(run, 'actions', `${turnId}.board.json`);
  const deckResult = join(run, 'results', `${turnId}.deck-result.json`);
  const boardResult = join(run, 'results', `${turnId}.board-result.json`);
  await writeJson(deckAction, {
    schemaVersion: 1,
    turnId,
    player,
    actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }]
  });
  await runCli(['deck-turn', '--config', 'tests/fixtures/multi-player.yaml', '--state', join(run, 'deck.json'), '--seed', '1', '--actions', deckAction, '--result', deckResult], () => undefined);
  await writeJson(boardAction, {
    schemaVersion: 1,
    turnId,
    player,
    actions: { movements: [], recruits: [], attacks: [], heals: [], upgrades: [] }
  });
  await runCli(['board-turn', '--state', join(run, 'board.json'), '--deck-result', deckResult, '--actions', boardAction, '--result', boardResult], () => undefined);
  return { deckResult, boardResult };
}

async function commit(run: string, results: { deckResult: string; boardResult: string }): Promise<void> {
  await runPlaytestCli(
    [
      'commit-turn',
      '--run',
      run,
      '--deck-result',
      results.deckResult,
      '--board-result',
      results.boardResult,
      '--summary',
      'Committed turn.',
      '--reasoning',
      'Generated by structured test helpers.'
    ],
    () => undefined
  );
}

function boardState(options: Partial<Pick<BoardState, 'ruleset' | 'units'>> = {}): BoardState {
  return {
    schemaVersion: 1,
    ruleset: options.ruleset ?? 'territory-v1',
    map: 'sketch-v1',
    turn: { activePlayer: 'P1', round: 1 },
    units: options.units ?? [],
    supplyControl: ['center-northwest', 'center-west-south', 'center-center-north', 'center-center', 'center-center-south', 'center-northeast', 'center-east', 'center-southeast'].map(
      (id) => ({ id, controller: null })
    ),
    supply: [
      { player: 'P1', amount: 0 },
      { player: 'P2', amount: 0 }
    ],
    notes: []
  };
}

function unit(id: string, player: string, type: string, col: number, row: number): BoardState['units'][number] {
  const stats: Record<string, { hp: number; attack: number }> = {
    guardian: { hp: 16, attack: 4 },
    raider: { hp: 8, attack: 6 },
    marksman: { hp: 8, attack: 4 },
    scout: { hp: 8, attack: 2 }
  };
  const stat = stats[type];
  if (!stat) {
    throw new Error(`Unknown test unit type: ${type}`);
  }
  return { id, player, type, col, row, hp: stat.hp, maxHp: stat.hp, attack: stat.attack };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
