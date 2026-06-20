import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/main';
import { validateReplayBundle } from '../../src/playtest/run';

const tempDirs: string[] = [];

describe('strict deck replay validation', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('accepts replay entries backed by structured deck actions', async () => {
    const timelinePath = await writeStructuredDeckReplay();

    const bundle = await validateReplayBundle(timelinePath, { strictDeck: true });

    expect(bundle.entries).toHaveLength(1);
  });

  it('rejects placeholder deck snapshots in strict deck mode', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, 'snapshots'), { recursive: true });
    const placeholder = {
      schemaVersion: 1,
      rngState: 1,
      game: { players: [{ id: 'P1' }, { id: 'P2' }], activePlayer: 0 }
    };
    await writeFile(join(dir, 'snapshots', 'turn-001.before.deck.json'), `${JSON.stringify(placeholder, null, 2)}\n`);
    await writeFile(join(dir, 'snapshots', 'turn-001.after.deck.json'), `${JSON.stringify(placeholder, null, 2)}\n`);
    await writeBoardSnapshots(dir);
    await writeTimeline(dir, {
      deck: {
        before: 'snapshots/turn-001.before.deck.json',
        after: 'snapshots/turn-001.after.deck.json',
        drawnHand: [],
        played: [],
        bought: [],
        produced: {},
        actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }]
      }
    });

    await expect(validateReplayBundle(join(dir, 'timeline.json'), { strictDeck: true })).rejects.toThrow('complete deck.before snapshot');
  });

  it('rejects deck summaries that do not match replayed actions', async () => {
    const timelinePath = await writeStructuredDeckReplay({ produced: { money: 2 } });

    await expect(validateReplayBundle(timelinePath, { strictDeck: true })).rejects.toThrow('deck.produced.money is 2, expected 1');
  });
});

async function writeStructuredDeckReplay(deckOverrides: Record<string, unknown> = {}): Promise<string> {
  const dir = await makeTempDir();
  const actionPath = join(dir, 'actions', 'turn-001.deck.json');
  const resultPath = join(dir, 'results', 'turn-001.deck-result.json');
  await mkdir(join(dir, 'actions'), { recursive: true });
  await writeFile(
    actionPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        turnId: 'turn-001',
        player: 'P1',
        actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }]
      },
      null,
      2
    )}\n`
  );
  await runCli(['deck-turn', '--config', 'tests/fixtures/multi-player.yaml', '--state', join(dir, 'deck.json'), '--seed', '1', '--actions', actionPath, '--result', resultPath], () => undefined);
  const deckResult = replayDeckSummary(JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>);
  await writeBoardSnapshots(dir);
  await writeTimeline(dir, { deck: { ...deckResult, ...deckOverrides } });
  return join(dir, 'timeline.json');
}

async function writeBoardSnapshots(dir: string): Promise<void> {
  const before = {
    schemaVersion: 1,
    ruleset: 'territory-v1',
    map: 'sketch-v1',
    turn: { activePlayer: 'P1', round: 1 },
    units: [],
    supplyControl: [],
    supply: [
      { player: 'P1', amount: 0 },
      { player: 'P2', amount: 0 }
    ],
    notes: []
  };
  const after = { ...before, turn: { activePlayer: 'P2', round: 1 } };
  await mkdir(join(dir, 'snapshots'), { recursive: true });
  await writeFile(join(dir, 'snapshots', 'turn-001.before.board.json'), `${JSON.stringify(before, null, 2)}\n`);
  await writeFile(join(dir, 'snapshots', 'turn-001.after.board.json'), `${JSON.stringify(after, null, 2)}\n`);
}

function replayDeckSummary(result: Record<string, unknown>): Record<string, unknown> {
  return {
    before: result.before,
    after: result.after,
    drawnHand: result.drawnHand,
    played: result.played,
    bought: result.bought,
    produced: result.produced,
    actions: result.actions
  };
}

async function writeTimeline(dir: string, entryOverrides: { deck: Record<string, unknown> }): Promise<void> {
  await writeFile(
    join(dir, 'timeline.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        title: 'Structured Deck Replay',
        entries: [
          {
            id: 'turn-001',
            player: 'P1',
            round: 1,
            deck: {
              before: 'snapshots/turn-001.before.deck.json',
              after: 'snapshots/turn-001.after.deck.json',
              drawnHand: [],
              played: [],
              bought: [],
              produced: {},
              ...entryOverrides.deck
            },
            board: {
              before: 'snapshots/turn-001.before.board.json',
              after: 'snapshots/turn-001.after.board.json'
            },
            summary: 'Structured deck turn.',
            reasoning: 'Validator coverage.'
          }
        ]
      },
      null,
      2
    )}\n`
  );
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckfront-deck-validation-'));
  tempDirs.push(dir);
  return dir;
}
