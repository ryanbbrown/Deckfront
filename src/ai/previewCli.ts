import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyAction, cloneGame, findMaximumPoints, listLegalActions, replayCommands } from '../game';
import type { GameCommand, GameState, PlayerId } from '../game';
import { gameStateSchema } from '../server/schemas';
import { updateAiBriefing } from './briefing';

interface PrivateSnapshot {
  schemaVersion: 1;
  gameId: string;
  baseRevision: number;
  aiPlayerId: PlayerId;
  state: GameState;
}

interface PreviewSession {
  schemaVersion: 1;
  gameId: string;
  baseRevision: number;
  aiPlayerId: PlayerId;
  initialScore: number;
  maximumPoints: number;
  baseState: GameState;
  state: GameState;
  commands: GameCommand[];
  buyDecisionMade: boolean;
  committed: boolean;
}

async function main(): Promise<void> {
  const [operation, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!operation) throw new Error('Missing preview operation.');
  if (operation === 'init') {
    const snapshotPath = requiredPath(args, 'snapshot');
    const sessionPath = requiredPath(args, 'session');
    const raw = JSON.parse(await readFile(snapshotPath, 'utf8')) as PrivateSnapshot;
    const state = gameStateSchema.parse(raw.state) as GameState;
    if (state.activePlayerId !== raw.aiPlayerId) throw new Error('Snapshot does not contain an active AI turn.');
    const search = findMaximumPoints(state);
    const session: PreviewSession = {
      schemaVersion: 1,
      gameId: raw.gameId,
      baseRevision: raw.baseRevision,
      aiPlayerId: raw.aiPlayerId,
      initialScore: state.scores[raw.aiPlayerId],
      maximumPoints: search.points,
      baseState: cloneGame(state),
      state,
      commands: [],
      buyDecisionMade: false,
      committed: false
    };
    await saveSession(sessionPath, session);
    output(success(session));
    return;
  }

  const sessionPath = requiredPath(args, 'session');
  const session = await loadSession(sessionPath);
  if (session.committed) {
    output({ ok: false, error: 'Turn is already committed.' });
    return;
  }
  try {
    if (operation === 'take-action') takeAction(session, requiredValue(args, 'action-id'));
    else if (operation === 'undo') undo(session);
    else if (operation === 'restart') restart(session);
    else if (operation === 'enter-buy') enterBuy(session);
    else if (operation === 'buy') buy(session, requiredValue(args, 'card-id'));
    else if (operation === 'skip-buy') skipBuy(session);
    else if (operation === 'commit') commit(session);
    else throw new Error(`Unknown preview operation: ${operation}`);
    await saveSession(sessionPath, session);
    output(success(session));
  } catch (error) {
    output({
      ok: false,
      error: error instanceof Error ? error.message : 'Preview action failed.',
      briefing: briefing(session)
    });
  }
}

function takeAction(session: PreviewSession, id: string): void {
  const selected = listLegalActions(session.state).find((action) => action.id === id);
  if (!selected) throw new Error('Unknown or stale action identifier.');
  if (['enterBuyPhase', 'buyCard', 'endTurn'].includes(selected.command.type)) {
    throw new Error('Use the dedicated buy-phase tools for this action.');
  }
  session.state = applyAction(session.state, selected.id);
  session.commands.push(selected.command);
}

function undo(session: PreviewSession): void {
  if (session.commands.length === 0) throw new Error('No preview action is available to undo.');
  session.commands.pop();
  session.state = replayCommands(session.baseState, session.commands);
  session.buyDecisionMade = session.commands.some((command) => command.type === 'buyCard');
}

function restart(session: PreviewSession): void {
  session.state = cloneGame(session.baseState);
  session.commands = [];
  session.buyDecisionMade = false;
}

function enterBuy(session: PreviewSession): void {
  const scored = session.state.scores[session.aiPlayerId] - session.initialScore;
  if (scored < session.maximumPoints) {
    throw new Error(
      `You scored ${scored}, but ${session.maximumPoints} point(s) are available. Restart or continue the tactical line.`
    );
  }
  const selected = listLegalActions(session.state).find((action) => action.command.type === 'enterBuyPhase');
  if (!selected) throw new Error('The action phase cannot enter the buy phase now.');
  session.state = applyAction(session.state, selected.id);
  session.commands.push(selected.command);
}

function buy(session: PreviewSession, cardId: string): void {
  if (session.buyDecisionMade) throw new Error('A buy decision was already made.');
  const selected = listLegalActions(session.state).find(
    (action) => action.command.type === 'buyCard' && action.command.definitionId === cardId
  );
  if (!selected) throw new Error(`${cardId} is not an affordable card.`);
  session.state = applyAction(session.state, selected.id);
  session.commands.push(selected.command);
  session.buyDecisionMade = true;
}

function skipBuy(session: PreviewSession): void {
  if (session.state.phase !== 'buy') throw new Error('Enter the buy phase before skipping a purchase.');
  if (session.buyDecisionMade) throw new Error('A buy decision was already made.');
  session.buyDecisionMade = true;
}

function commit(session: PreviewSession): void {
  if (session.state.winner) {
    session.committed = true;
    return;
  }
  if (session.state.phase !== 'buy') throw new Error('Enter the buy phase before committing the turn.');
  if (!session.buyDecisionMade) throw new Error('Buy a card or explicitly skip the purchase.');
  const endTurn = listLegalActions(session.state).find((action) => action.command.type === 'endTurn');
  if (!endTurn) throw new Error('The turn cannot end from the current state.');
  session.state = applyAction(session.state, endTurn.id);
  session.commands.push(endTurn.command);
  session.committed = true;
}

function briefing(session: PreviewSession) {
  return updateAiBriefing(
    session.state,
    session.aiPlayerId,
    session.maximumPoints,
    session.initialScore
  );
}

function success(session: PreviewSession) {
  return {
    ok: true,
    committed: session.committed,
    baseRevision: session.baseRevision,
    commands: session.committed ? session.commands : undefined,
    briefing: briefing(session)
  };
}

async function loadSession(file: string): Promise<PreviewSession> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as PreviewSession;
  raw.baseState = gameStateSchema.parse(raw.baseState) as GameState;
  raw.state = gameStateSchema.parse(raw.state) as GameState;
  return raw;
}

async function saveSession(file: string, session: PreviewSession): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(session), 'utf8');
  await rename(temporary, file);
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('Preview arguments must use --name value pairs.');
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

function requiredValue(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function requiredPath(args: Record<string, string>, name: string): string {
  return path.resolve(requiredValue(args, name));
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
