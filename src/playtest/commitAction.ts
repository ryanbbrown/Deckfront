import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { boardStateSchema } from '../board/schema';
import { replayTimelineSchema, replayWinEventSchema, type ReplayEntry, type ReplayTimeline, type ReplayWinEvent } from '../replay/schema';
import { boardActionResultSchema } from './boardAction';
import { deckTurnResultSchema } from './deckTurn';
import { stepSnapshotPaths, validateReplayBundle } from './run';

export interface CommitActionOptions {
  run: string;
  boardResultPath: string;
  deckResultPath?: string;
  summary: string;
  reasoning: string;
  winEventsPath?: string;
  terminalWinEventsPath?: string;
  strictWin?: boolean;
}

export async function commitAction(options: CommitActionOptions): Promise<ReplayEntry> {
  if (options.summary.trim().length === 0) throw new Error('Missing required --summary text');
  if (options.reasoning.trim().length === 0) throw new Error('Missing required --reasoning text');

  const timelinePath = join(options.run, 'timeline.json');
  const [timeline, boardResult, deckResult, winEvents, terminalWinEvents] = await Promise.all([
    readJsonFile(timelinePath).then((value) => replayTimelineSchema.parse(value)),
    readJsonFile(options.boardResultPath).then((value) => boardActionResultSchema.parse(value)),
    options.deckResultPath ? readJsonFile(options.deckResultPath).then((value) => deckTurnResultSchema.parse(value)) : Promise.resolve(undefined),
    options.winEventsPath ? readWinEvents(options.winEventsPath) : Promise.resolve([]),
    options.terminalWinEventsPath ? readWinEvents(options.terminalWinEventsPath) : Promise.resolve(undefined)
  ]);
  if (timeline.entries.some((entry) => entry.id === boardResult.stepId)) throw new Error(`timeline already contains entry ${boardResult.stepId}`);
  if (boardResult.action.type === 'setup' && !deckResult) throw new Error(`${boardResult.stepId}: setup commit requires a deck result`);
  if (boardResult.action.type === 'activation' && deckResult) throw new Error(`${boardResult.stepId}: activation commit cannot include a deck result`);
  if (deckResult && (deckResult.turnId !== boardResult.stepId || deckResult.player !== boardResult.player)) {
    throw new Error(`deck result does not match board result ${boardResult.stepId}/${boardResult.player}`);
  }

  assertConventionalSnapshotPaths(options.run, boardResult, deckResult);
  const paths = [boardResult.before, boardResult.after, ...(deckResult ? [deckResult.before, deckResult.after] : [])];
  await Promise.all(paths.map((path) => access(join(options.run, path))));
  const boardBefore = boardStateSchema.parse(await readJsonFile(join(options.run, boardResult.before)));
  if (boardBefore.turn.activePlayer !== boardResult.player) {
    throw new Error(`board.before active player is ${boardBefore.turn.activePlayer}, expected ${boardResult.player}`);
  }

  const base = {
    id: boardResult.stepId,
    player: boardResult.player,
    round: boardBefore.turn.round,
    board: { before: boardResult.before, after: boardResult.after },
    winEvents,
    summary: options.summary,
    reasoning: options.reasoning
  };
  const entry: ReplayEntry = boardResult.action.type === 'setup' && deckResult
    ? {
        ...base,
        phase: 'setup',
        deck: {
          before: deckResult.before, after: deckResult.after, drawnHand: deckResult.drawnHand,
          played: deckResult.played, bought: deckResult.bought, produced: deckResult.produced, actions: deckResult.actions
        },
        action: boardResult.action
      }
    : { ...base, phase: 'activation', action: boardResult.action as Extract<ReplayEntry, { phase: 'activation' }>['action'] };
  const candidate: ReplayTimeline = { ...timeline, entries: [...timeline.entries, entry], ...(terminalWinEvents ? { terminalWinEvents } : {}) };

  const tempPath = join(options.run, `.timeline.${boardResult.stepId}.${Date.now()}.tmp.json`);
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
  boardResult: { stepId: string; before: string; after: string },
  deckResult?: { before: string; after: string }
): void {
  const paths = stepSnapshotPaths(run, boardResult.stepId);
  assertSafeSnapshotPath(boardResult.before, relativeSnapshotPath(paths.boardBefore), 'board.before');
  assertSafeSnapshotPath(boardResult.after, relativeSnapshotPath(paths.boardAfter), 'board.after');
  if (deckResult) {
    assertSafeSnapshotPath(deckResult.before, relativeSnapshotPath(paths.deckBefore), 'deck.before');
    assertSafeSnapshotPath(deckResult.after, relativeSnapshotPath(paths.deckAfter), 'deck.after');
  }
}

function assertSafeSnapshotPath(actual: string, expected: string, label: string): void {
  if (isAbsolute(actual) || normalize(actual).startsWith('..')) throw new Error(`${label} must be a relative snapshot path inside the run`);
  if (actual !== expected) throw new Error(`${label} is ${actual}, expected ${expected}`);
}

function relativeSnapshotPath(path: string): string {
  const index = path.lastIndexOf('snapshots/');
  if (index === -1) throw new Error(`Expected snapshot path under snapshots/: ${path}`);
  return path.slice(index);
}

async function readJsonFile(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
async function readWinEvents(path: string): Promise<ReplayWinEvent[]> { return replayWinEventSchema.array().parse(await readJsonFile(path)); }
