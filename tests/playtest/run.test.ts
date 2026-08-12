import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeBoardAction, loadBoardRulesContext } from '../../src/playtest/boardAction';
import { executeDeckTurn } from '../../src/playtest/deckTurn';
import { expectedTerminalEvents, initPlaytestRun, validateReplayBundle } from '../../src/playtest/run';
import type { ReplayEntry, ReplayTimeline } from '../../src/replay/schema';
import { buildTurnArtifacts, skirmishArmyState } from '../helpers/skirmish';

const tempDirs: string[] = [];

describe('Skirmish replay validation', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('strictly validates real setup and activation state transitions', async () => {
    const root = await buildActivationReplay();
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true, strictDeck: true, strictWin: true })).resolves.toMatchObject({ entries: [{ entry: { phase: 'setup' } }, { entry: { phase: 'setup' } }, { entry: { phase: 'activation' } }] });
  });

  it('detects illegal phase order, duplicate activation, and wrong active player', async () => {
    const phaseRoot = await buildActivationReplay();
    const phaseBoard = await json(join(phaseRoot, 'snapshots/step-003.before.board.json'));
    phaseBoard.turn.phase = 'setup';
    await writeFile(join(phaseRoot, 'snapshots/step-003.before.board.json'), `${JSON.stringify(phaseBoard)}\n`);
    await expect(validateReplayBundle(join(phaseRoot, 'timeline.json'), { strict: true })).rejects.toThrow('board phase is setup, not activation');

    const duplicateRoot = await buildActivationReplay();
    const duplicateBoard = await json(join(duplicateRoot, 'snapshots/step-003.before.board.json'));
    duplicateBoard.turn.activatedUnitIds = ['P1-soldier-1'];
    await writeFile(join(duplicateRoot, 'snapshots/step-003.before.board.json'), `${JSON.stringify(duplicateBoard)}\n`);
    await expect(validateReplayBundle(join(duplicateRoot, 'timeline.json'), { strict: true })).rejects.toThrow('already activated this round');

    const playerRoot = await buildActivationReplay();
    const timeline = await json(join(playerRoot, 'timeline.json'));
    timeline.entries[2].player = 'P2';
    await writeFile(join(playerRoot, 'timeline.json'), `${JSON.stringify(timeline)}\n`);
    await expect(validateReplayBundle(join(playerRoot, 'timeline.json'), { strict: true })).rejects.toThrow('active player is P1, expected P2');
  });

  it('detects an incorrect initiative change', async () => {
    const root = await buildCompletedRoundReplay();
    const afterPath = join(root, 'snapshots/step-012.after.board.json');
    const after = await json(afterPath);
    after.turn.initiativePlayer = 'P1';
    await writeFile(afterPath, `${JSON.stringify(after)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('replayed board action does not match board.after');
  });

  it('strictly rejects an affordable upgrade left unspent', async () => {
    const root = await tempDir();
    const artifacts = await buildTurnArtifacts(root);
    const first = artifacts.timeline.entries[0];
    if (!first || first.phase !== 'setup') throw new Error('test fixture is missing its setup entry');
    first.deck.produced = { soldierAttack: 2 };
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(artifacts.timeline, null, 2)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strict: true })).rejects.toThrow('affordable upgrade remains');
  });

  it('uses completed rounds for elimination and cap outcomes', () => {
    const base = skirmishArmyState();
    expect(expectedTerminalEvents({ ...base, units: base.units.filter((unit) => unit.player === 'P1') }, 4, 20)[0]).toMatchObject({ type: 'elimination', completedRounds: 4, player: 'P1' });
    expect(expectedTerminalEvents(base, 19, 20)).toEqual([]);
    expect(expectedTerminalEvents(base, 20, 20)[0]).toMatchObject({ type: 'turnCap', outcome: 'draw', completedRounds: 20 });
  });

  it('initializes the full round state and validates army setup', async () => {
    const root = await tempDir();
    const unitsPath = join(root, 'units.json');
    await writeFile(unitsPath, `${JSON.stringify(skirmishArmyState().units.map(({ id, player, type, col, row }) => ({ id, player, type, col, row })))}\n`);
    const paths = await initPlaytestRun({ root: join(root, 'run'), ruleset: 'skirmish-v1', map: 'skirmish-v1', unitsPath, turnCap: 12 });
    expect((await json(paths.boardState)).turn).toEqual({ round: 1, phase: 'setup', initiativePlayer: 'P1', activePlayer: 'P1', completedSetupPlayers: [], activatedUnitIds: [] });
    expect((await json(paths.timeline)).run.turnCap).toBe(12);
  });
});

async function buildActivationReplay(): Promise<string> {
  const root = await tempDir();
  const first = await buildTurnArtifacts(root);
  const context = await loadBoardRulesContext();
  const deckTwo = executeDeckTurn(first.deckAfter, { schemaVersion: 1, turnId: 'step-002', player: 'P2', actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }] }, { beforePath: 'snapshots/step-002.before.deck.json', afterPath: 'snapshots/step-002.after.deck.json', nextPlayer: 'P2' });
  const boardTwo = executeBoardAction(first.boardAfter, { schemaVersion: 1, stepId: 'step-002', player: 'P2', action: { type: 'setup', upgrades: [] } }, context, { beforePath: 'snapshots/step-002.before.board.json', afterPath: 'snapshots/step-002.after.board.json' }, deckTwo.result);
  const unit = boardTwo.after.units.find((candidate) => candidate.id === 'P1-soldier-1')!;
  const boardThree = executeBoardAction(boardTwo.after, { schemaVersion: 1, stepId: 'step-003', player: 'P1', action: { type: 'activation', activation: { unit: unit.id, from: { col: unit.col, row: unit.row }, to: { col: unit.col, row: unit.row } } } }, context, { beforePath: 'snapshots/step-003.before.board.json', afterPath: 'snapshots/step-003.after.board.json' });
  const timeline = first.timeline;
  timeline.entries[0]!.id = 'turn-001';
  timeline.entries.push(setupEntry('step-002', 'P2', deckTwo, boardTwo), activationEntry('step-003', 'P1', boardThree));
  await Promise.all([
    write(root, deckTwo.result.before, deckTwo.before), write(root, deckTwo.result.after, deckTwo.after),
    write(root, boardTwo.result.before, boardTwo.before), write(root, boardTwo.result.after, boardTwo.after),
    write(root, boardThree.result.before, boardThree.before), write(root, boardThree.result.after, boardThree.after),
    writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`)
  ]);
  return root;
}

async function buildCompletedRoundReplay(): Promise<string> {
  const root = await buildActivationReplay();
  const context = await loadBoardRulesContext();
  const timeline = await json(join(root, 'timeline.json')) as ReplayTimeline;
  let board = await json(join(root, 'snapshots/step-003.after.board.json'));
  let step = 4;
  while (board.turn.phase === 'activation') {
    const unit = board.units.find((candidate: { player: string; id: string }) => candidate.player === board.turn.activePlayer && !board.turn.activatedUnitIds.includes(candidate.id));
    if (!unit) throw new Error('state machine failed to auto-pass');
    const id = `step-${String(step).padStart(3, '0')}`;
    const executed = executeBoardAction(board, { schemaVersion: 1, stepId: id, player: board.turn.activePlayer, action: { type: 'activation', activation: { unit: unit.id, from: { col: unit.col, row: unit.row }, to: { col: unit.col, row: unit.row } } } }, context, { beforePath: `snapshots/${id}.before.board.json`, afterPath: `snapshots/${id}.after.board.json` });
    timeline.entries.push(activationEntry(id, board.turn.activePlayer, executed));
    await Promise.all([write(root, executed.result.before, executed.before), write(root, executed.result.after, executed.after)]);
    board = executed.after;
    step += 1;
  }
  await writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  return root;
}

function setupEntry(id: string, player: string, deck: ReturnType<typeof executeDeckTurn>, board: ReturnType<typeof executeBoardAction>): ReplayEntry {
  return { id, player, round: 1, phase: 'setup', deck: { before: deck.result.before, after: deck.result.after, drawnHand: deck.result.drawnHand, played: deck.result.played, bought: deck.result.bought, produced: deck.result.produced, actions: deck.result.actions }, board: { before: board.result.before, after: board.result.after }, action: board.result.action as Extract<ReplayEntry, { phase: 'setup' }>['action'], winEvents: [], summary: 'Setup', reasoning: 'Completed setup.' };
}
function activationEntry(id: string, player: string, board: ReturnType<typeof executeBoardAction>): ReplayEntry {
  return { id, player, round: board.before.turn.round, phase: 'activation', board: { before: board.result.before, after: board.result.after }, action: board.result.action as Extract<ReplayEntry, { phase: 'activation' }>['action'], winEvents: [], summary: 'Activated', reasoning: 'Held position.' };
}
async function write(root: string, relative: string, value: unknown): Promise<void> { await writeFile(join(root, relative), `${JSON.stringify(value, null, 2)}\n`); }
async function json(path: string): Promise<any> { return JSON.parse(await readFile(path, 'utf8')); }
async function tempDir(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'deckfront-run-')); tempDirs.push(root); return root; }
