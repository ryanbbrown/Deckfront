import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { boardStateSchema } from '../board/schema';
import { replayTimelineSchema, replayWinEventSchema, type ReplayEntry, type ReplayTimeline, type ReplayWinEvent } from '../replay/schema';
import { boardTurnResultSchema } from './boardTurn';
import { deckTurnResultSchema } from './deckTurn';
import { turnSnapshotPaths, validateReplayBundle } from './run';

export interface CommitTurnOptions {
  run: string;
  deckResultPath: string;
  boardResultPath: string;
  summary: string;
  reasoning: string;
  winEventsPath?: string;
  terminalWinEventsPath?: string;
  strictWin?: boolean;
}

export async function commitTurn(options: CommitTurnOptions): Promise<ReplayEntry> {
  if (options.summary.trim().length === 0) {
    throw new Error('Missing required --summary text');
  }
  if (options.reasoning.trim().length === 0) {
    throw new Error('Missing required --reasoning text');
  }

  const timelinePath = join(options.run, 'timeline.json');
  const [timeline, deckResult, boardResult, winEvents, terminalWinEvents] = await Promise.all([
    readJsonFile(timelinePath).then((value) => replayTimelineSchema.parse(value)),
    readJsonFile(options.deckResultPath).then((value) => deckTurnResultSchema.parse(value)),
    readJsonFile(options.boardResultPath).then((value) => boardTurnResultSchema.parse(value)),
    options.winEventsPath ? readWinEvents(options.winEventsPath) : Promise.resolve([]),
    options.terminalWinEventsPath ? readWinEvents(options.terminalWinEventsPath) : Promise.resolve(undefined)
  ]);

  if (deckResult.turnId !== boardResult.turnId) {
    throw new Error(`deck result turn ${deckResult.turnId} does not match board result ${boardResult.turnId}`);
  }
  if (deckResult.player !== boardResult.player) {
    throw new Error(`deck result player ${deckResult.player} does not match board result player ${boardResult.player}`);
  }
  if (timeline.entries.some((entry) => entry.id === deckResult.turnId)) {
    throw new Error(`timeline already contains entry ${deckResult.turnId}`);
  }

  assertConventionalSnapshotPaths(options.run, deckResult.turnId, deckResult, boardResult);
  await Promise.all([deckResult.before, deckResult.after, boardResult.before, boardResult.after].map((path) => access(join(options.run, path))));

  const boardBefore = boardStateSchema.parse(await readJsonFile(join(options.run, boardResult.before)));
  if (boardBefore.turn.activePlayer !== deckResult.player) {
    throw new Error(`board.before active player is ${boardBefore.turn.activePlayer}, expected ${deckResult.player}`);
  }

  const entry: ReplayEntry = {
    id: deckResult.turnId,
    player: deckResult.player,
    round: boardBefore.turn.round,
    deck: {
      before: deckResult.before,
      after: deckResult.after,
      drawnHand: deckResult.drawnHand,
      played: deckResult.played,
      bought: deckResult.bought,
      produced: deckResult.produced,
      actions: deckResult.actions
    },
    board: {
      before: boardResult.before,
      after: boardResult.after
    },
    actions: boardResult.actions,
    winEvents,
    summary: options.summary,
    reasoning: options.reasoning
  };
  const candidate: ReplayTimeline = {
    ...timeline,
    entries: [...timeline.entries, entry],
    ...(terminalWinEvents ? { terminalWinEvents } : {})
  };

  const tempPath = join(options.run, `.timeline.${deckResult.turnId}.${Date.now()}.tmp.json`);
  try {
    await writeFile(tempPath, `${JSON.stringify(candidate, null, 2)}\n`);
    await validateReplayBundle(tempPath, { strict: true, strictDeck: true, strictWin: options.strictWin ?? false });
    await writeFile(timelinePath, `${JSON.stringify(candidate, null, 2)}\n`);
  } finally {
    await rm(tempPath, { force: true });
  }

  return entry;
}

function assertConventionalSnapshotPaths(
  run: string,
  turnId: string,
  deckResult: { before: string; after: string },
  boardResult: { before: string; after: string }
): void {
  const paths = turnSnapshotPaths(run, turnId);
  const expected = {
    deckBefore: relativeSnapshotPath(paths.deckBefore),
    deckAfter: relativeSnapshotPath(paths.deckAfter),
    boardBefore: relativeSnapshotPath(paths.boardBefore),
    boardAfter: relativeSnapshotPath(paths.boardAfter)
  };

  assertSafeSnapshotPath(deckResult.before, expected.deckBefore, 'deck.before');
  assertSafeSnapshotPath(deckResult.after, expected.deckAfter, 'deck.after');
  assertSafeSnapshotPath(boardResult.before, expected.boardBefore, 'board.before');
  assertSafeSnapshotPath(boardResult.after, expected.boardAfter, 'board.after');
}

function assertSafeSnapshotPath(actual: string, expected: string, label: string): void {
  if (isAbsolute(actual) || normalize(actual).startsWith('..')) {
    throw new Error(`${label} must be a relative snapshot path inside the run`);
  }
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, expected ${expected}`);
  }
}

function relativeSnapshotPath(path: string): string {
  const index = path.lastIndexOf('snapshots/');
  if (index === -1) {
    throw new Error(`Expected snapshot path under snapshots/: ${path}`);
  }
  return path.slice(index);
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function readWinEvents(path: string): Promise<ReplayWinEvent[]> {
  const value = await readJsonFile(path);
  return replayWinEventSchema.array().parse(value);
}
