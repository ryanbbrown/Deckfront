import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { boardMapSchema, boardStateSchema, type BoardState } from '../board/schema';
import type { GameState } from '../core/types';
import { replayTimelineSchema, type ReplayEntry, type ReplayTimeline } from '../replay/schema';

export interface PlaytestRunPaths {
  root: string;
  deckState: string;
  boardState: string;
  timeline: string;
  snapshotsDir: string;
}

export interface TurnSnapshotPaths {
  deckBefore: string;
  deckAfter: string;
  boardBefore: string;
  boardAfter: string;
}

export interface DeckSnapshot {
  schemaVersion: 1;
  rngState: number;
  game: GameState;
}

export interface ValidatedReplayEntry {
  entry: ReplayEntry;
  deckBefore: DeckSnapshot;
  deckAfter: DeckSnapshot;
  boardBefore: BoardState;
  boardAfter: BoardState;
}

export interface ValidatedReplayBundle {
  timeline: ReplayTimeline;
  entries: ValidatedReplayEntry[];
}

export interface InitPlaytestRunOptions {
  root: string;
  ruleset: string;
  map: string;
  players?: string[];
  boardPath?: string;
  unitsPath?: string;
  title?: string;
}

export function playtestRunPaths(root: string): PlaytestRunPaths {
  return {
    root,
    deckState: join(root, 'deck.json'),
    boardState: join(root, 'board.json'),
    timeline: join(root, 'timeline.json'),
    snapshotsDir: join(root, 'snapshots')
  };
}

export function turnSnapshotPaths(root: string, turnId: string): TurnSnapshotPaths {
  const snapshotsDir = playtestRunPaths(root).snapshotsDir;
  return {
    deckBefore: join(snapshotsDir, `${turnId}.before.deck.json`),
    deckAfter: join(snapshotsDir, `${turnId}.after.deck.json`),
    boardBefore: join(snapshotsDir, `${turnId}.before.board.json`),
    boardAfter: join(snapshotsDir, `${turnId}.after.board.json`)
  };
}

export async function initPlaytestRun(options: InitPlaytestRunOptions): Promise<PlaytestRunPaths> {
  const paths = playtestRunPaths(options.root);
  const players = options.players ?? ['P1', 'P2'];
  const map = boardMapSchema.parse(await readJson(join('maps', `${options.map}.json`)));
  const units = options.unitsPath ? boardStateSchema.shape.units.parse(await readJson(options.unitsPath)) : [];
  const boardState = options.boardPath
    ? boardStateSchema.parse(await readJson(options.boardPath))
    : initialBoardState(options, map.id, players, units, map.supplyCenters.map((center) => center.id));
  const timeline: ReplayTimeline = {
    schemaVersion: 1,
    title: options.title ?? `${options.ruleset} ${map.id}`,
    entries: []
  };

  if (boardState.ruleset !== options.ruleset) {
    throw new Error(`Starter board ruleset is ${boardState.ruleset}, expected ${options.ruleset}`);
  }
  if (boardState.map !== map.id) {
    throw new Error(`Starter board map is ${boardState.map}, expected ${map.id}`);
  }

  await mkdir(paths.snapshotsDir, { recursive: true });
  await writeFile(paths.boardState, `${JSON.stringify(boardStateSchema.parse(boardState), null, 2)}\n`);
  await writeFile(paths.timeline, `${JSON.stringify(timeline, null, 2)}\n`);
  return paths;
}

function initialBoardState(options: InitPlaytestRunOptions, mapId: string, players: string[], units: BoardState['units'], supplyCenterIds: string[]): BoardState {
  return {
    schemaVersion: 1,
    ruleset: options.ruleset,
    map: mapId,
    turn: {
      activePlayer: players[0] ?? 'P1',
      round: 1
    },
    units,
    supplyControl: supplyCenterIds.map((id) => ({ id, controller: null })),
    supply: players.map((player) => ({ player, amount: 0 })),
    notes: []
  };
}

export async function validateReplayBundle(timelinePath: string): Promise<ValidatedReplayBundle> {
  const timeline = replayTimelineSchema.parse(await readJson(timelinePath));
  const baseDir = dirname(timelinePath);
  const entries: ValidatedReplayEntry[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const entry of timeline.entries) {
    if (seenIds.has(entry.id)) {
      errors.push(`${entry.id}: duplicate replay entry id`);
      continue;
    }
    seenIds.add(entry.id);

    const loaded = await loadEntrySnapshots(baseDir, entry, errors);
    if (!loaded) {
      continue;
    }

    checkEntryMatchesSnapshots(entry, loaded, errors);
    const previous = entries.at(-1);
    if (previous) {
      checkContinuity(previous, loaded, errors);
    }
    entries.push({ entry, ...loaded });
  }

  if (errors.length > 0) {
    throw new Error(`Invalid replay bundle: ${errors.join('; ')}`);
  }

  return { timeline, entries };
}

async function loadEntrySnapshots(
  baseDir: string,
  entry: ReplayEntry,
  errors: string[]
): Promise<Omit<ValidatedReplayEntry, 'entry'> | undefined> {
  const [deckBefore, deckAfter, boardBefore, boardAfter] = await Promise.all([
    loadDeckSnapshot(resolveSnapshotPath(baseDir, entry.deck.before), `${entry.id} deck.before`, errors),
    loadDeckSnapshot(resolveSnapshotPath(baseDir, entry.deck.after), `${entry.id} deck.after`, errors),
    loadBoardSnapshot(resolveSnapshotPath(baseDir, entry.board.before), `${entry.id} board.before`, errors),
    loadBoardSnapshot(resolveSnapshotPath(baseDir, entry.board.after), `${entry.id} board.after`, errors)
  ]);

  if (!deckBefore || !deckAfter || !boardBefore || !boardAfter) {
    return undefined;
  }

  return { deckBefore, deckAfter, boardBefore, boardAfter };
}

async function loadDeckSnapshot(path: string, label: string, errors: string[]): Promise<DeckSnapshot | undefined> {
  try {
    const value = await readJson(path);
    if (!isDeckSnapshot(value)) {
      errors.push(`${label}: invalid deck snapshot`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`${label}: ${errorMessage(error)}`);
    return undefined;
  }
}

async function loadBoardSnapshot(path: string, label: string, errors: string[]): Promise<BoardState | undefined> {
  try {
    return boardStateSchema.parse(await readJson(path));
  } catch (error) {
    errors.push(`${label}: ${errorMessage(error)}`);
    return undefined;
  }
}

function checkEntryMatchesSnapshots(
  entry: ReplayEntry,
  snapshots: Omit<ValidatedReplayEntry, 'entry'>,
  errors: string[]
): void {
  if (snapshots.boardBefore.turn.activePlayer !== entry.player) {
    errors.push(`${entry.id}: board.before active player is ${snapshots.boardBefore.turn.activePlayer}, expected ${entry.player}`);
  }
  if (snapshots.boardBefore.turn.round !== entry.round) {
    errors.push(`${entry.id}: board.before round is ${snapshots.boardBefore.turn.round}, expected ${entry.round}`);
  }

  const deckActivePlayer = activeDeckPlayerId(snapshots.deckBefore.game);
  if (deckActivePlayer !== entry.player) {
    errors.push(`${entry.id}: deck.before active player is ${deckActivePlayer ?? 'missing'}, expected ${entry.player}`);
  }
}

function checkContinuity(
  previous: ValidatedReplayEntry,
  current: Omit<ValidatedReplayEntry, 'entry'>,
  errors: string[]
): void {
  if (stableJson(previous.deckAfter) !== stableJson(current.deckBefore)) {
    errors.push(`${previous.entry.id}: deck.after does not match the next deck.before`);
  }
  if (stableJson(boardContinuityState(previous.boardAfter)) !== stableJson(boardContinuityState(current.boardBefore))) {
    errors.push(`${previous.entry.id}: board.after does not match the next board.before`);
  }
}

function activeDeckPlayerId(game: GameState): string | undefined {
  return game.players[game.activePlayer]?.id;
}

function boardContinuityState(state: BoardState): Omit<BoardState, 'notes'> {
  const { notes, ...rest } = state;
  return rest;
}

function isDeckSnapshot(value: unknown): value is DeckSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DeckSnapshot>;
  return candidate.schemaVersion === 1 && Number.isInteger(candidate.rngState) && isGameState(candidate.game);
}

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<GameState>;
  return Array.isArray(candidate.players) && Number.isInteger(candidate.activePlayer);
}

function resolveSnapshotPath(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : join(baseDir, path);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
