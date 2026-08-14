import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAction, findMaximumPoints, listLegalActions, replayCommands } from '../src/game/index';
import { distance } from '../src/game/hex';
import type { GameCommand, GameState, LegalAction, PlayerId } from '../src/game/types';
import { ThinHarnessAiRunner } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runName = process.env.HEXDECK_PLAYTEST_NAME ?? new Date().toISOString().replaceAll(':', '-');
const runDirectory = path.resolve(process.env.HEXDECK_PLAYTEST_DIR ?? path.join(projectRoot, '.data/live-playtests', runName));
const model = process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-terra';
const effort = process.env.HEXDECK_AI_EFFORT ?? 'medium';
const seed = Number.parseInt(process.env.HEXDECK_PLAYTEST_SEED ?? '0', 10);

interface TurnAudit {
  playerId: PlayerId;
  turnNumber: number;
  maximumPoints: number;
  scoredPoints: number;
  retries: number;
  commands: GameCommand[];
}

async function main(): Promise<void> {
  await mkdir(runDirectory, { recursive: true });
  const service = new GameService(
    new FileGameRepository(path.join(runDirectory, 'games')),
    { model, effort }
  );
  const strategy = await readFile(path.join(projectRoot, 'strategies/direct-force.md'), 'utf8');
  let view = await service.create({ seed, strategyPresetId: 'direct-force', strategyMarkdown: strategy });
  const runner = new ThinHarnessAiRunner({
    projectRoot,
    traceDirectory: path.join(runDirectory, 'traces'),
    model,
    effort,
    timeoutMilliseconds: 240_000
  });
  const audit: TurnAudit[] = [];
  const started = performance.now();

  while (!view.winner) {
    if (audit.length >= 60) throw new Error('Live match exceeded 60 turns.');
    const before = await service.getRecord(view.id);
    const maximumPoints = findMaximumPoints(before.state).points;
    const initialScore = before.state.scores[before.state.activePlayerId];
    if (before.state.activePlayerId === before.humanPlayerId) {
      const commands = await playHumanTurn(service, before.id);
      view = await service.get(before.id);
      audit.push({
        playerId: before.humanPlayerId,
        turnNumber: audit.length + 1,
        maximumPoints,
        scoredPoints: view.scores[before.humanPlayerId] - initialScore,
        retries: 0,
        commands
      });
    } else {
      let retries = 0;
      for (;;) {
        try {
          const result = await runner.run(before);
          view = await service.commitAiTurn(
            before.id,
            result.baseRevision,
            result.commands,
            result.summary,
            result.durationSeconds
          );
          audit.push({
            playerId: before.aiPlayerId,
            turnNumber: audit.length + 1,
            maximumPoints,
            scoredPoints: view.scores[before.aiPlayerId] - initialScore,
            retries,
            commands: result.commands
          });
          break;
        } catch (error) {
          retries += 1;
          if (retries >= 3) throw error;
        }
      }
    }
    const latest = audit.at(-1)!;
    if (latest.scoredPoints < latest.maximumPoints) {
      throw new Error(`Turn ${latest.turnNumber} missed ${latest.maximumPoints - latest.scoredPoints} available point(s).`);
    }
    process.stdout.write(
      `Turn ${latest.turnNumber}: ${latest.playerId} scored ${latest.scoredPoints}; ${view.scores.ochre}-${view.scores.indigo}.\n`
    );
  }

  const record = await service.getRecord(view.id);
  const replayed = replayCommands(record.initialState, record.committedCommands);
  if (JSON.stringify(replayed) !== JSON.stringify(record.committedState)) {
    throw new Error('Final command replay diverged from the saved state.');
  }
  const summary = {
    schemaVersion: 1,
    gameId: record.id,
    model,
    effort,
    seed,
    wallDurationSeconds: Math.round((performance.now() - started) / 100) / 10,
    savedDurationSeconds: record.durationSeconds,
    completedTurns: record.completedTurns,
    cleanupTurns: {
      ochre: record.state.players.ochre.turnsTaken,
      indigo: record.state.players.indigo.turnsTaken
    },
    finalScore: record.state.scores,
    winner: record.state.winner,
    purchases: record.state.events
      .filter((event) => event.type === 'purchase')
      .map((event) => ({ playerId: event.playerId, definitionId: event.detail.definitionId })),
    aiRetries: audit.filter((turn) => turn.playerId === record.aiPlayerId).reduce((sum, turn) => sum + turn.retries, 0),
    missedPointTurns: audit.filter((turn) => turn.scoredPoints < turn.maximumPoints).map((turn) => turn.turnNumber),
    commandReplayMatches: true,
    audit
  };
  await writeFile(path.join(runDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function playHumanTurn(service: GameService, id: string): Promise<GameCommand[]> {
  const commands: GameCommand[] = [];
  let record = await service.getRecord(id);
  while (record.state.phase === 'respawn') {
    const action = listLegalActions(record.state)[0];
    if (!action) throw new Error('Human has no legal respawn.');
    await service.applyHumanAction(id, record.revision, action.id);
    commands.push(action.command);
    record = await service.getRecord(id);
  }

  const scoring = findMaximumPoints(record.state);
  for (const action of scoring.actions) {
    const view = await service.applyHumanAction(id, record.revision, action.id);
    commands.push(action.command);
    if (view.winner) return commands;
    record = await service.getRecord(id);
  }

  if (scoring.points === 0) {
    for (let choice = 0; choice < 12; choice += 1) {
      const selected = chooseStrategicAction(record.state);
      if (!selected) break;
      await service.applyHumanAction(id, record.revision, selected.id);
      commands.push(selected.command);
      record = await service.getRecord(id);
    }
  }

  let action = listLegalActions(record.state).find((candidate) => candidate.command.type === 'enterBuyPhase');
  if (!action) throw new Error('Human cannot enter the buy phase.');
  await service.applyHumanAction(id, record.revision, action.id);
  commands.push(action.command);
  record = await service.getRecord(id);

  action = choosePurchase(record.state);
  if (action) {
    await service.applyHumanAction(id, record.revision, action.id);
    commands.push(action.command);
    record = await service.getRecord(id);
  }
  action = listLegalActions(record.state).find((candidate) => candidate.command.type === 'endTurn');
  if (!action) throw new Error('Human cannot end the turn.');
  await service.applyHumanAction(id, record.revision, action.id);
  commands.push(action.command);
  return commands;
}

function chooseStrategicAction(state: GameState): LegalAction | null {
  const actions = listLegalActions(state).filter((action) => action.command.type !== 'enterBuyPhase');
  if (actions.length === 0) return null;
  const current = boardValue(state, state.activePlayerId);
  const ranked = actions.map((action) => ({
    action,
    value: boardValue(applyAction(state, action.id), state.activePlayerId)
  })).sort((left, right) => right.value - left.value || left.action.id.localeCompare(right.action.id));
  const best = ranked[0];
  return best && best.value > current + 0.01 ? best.action : null;
}

function boardValue(state: GameState, playerId: PlayerId): number {
  const friendly = Object.values(state.pieces).filter((piece) => piece.ownerId === playerId && piece.position);
  const enemy = Object.values(state.pieces).filter((piece) => piece.ownerId !== playerId && piece.position);
  const contact = friendly.reduce((sum, piece) => sum + Math.max(
    0,
    4 - Math.min(...enemy.map((target) => distance(piece.position!, target.position!)))
  ), 0);
  const enemyEdge = enemy.reduce((sum, piece) => sum + edgeDepth(piece.position!), 0);
  const friendlyEdge = friendly.reduce((sum, piece) => sum + edgeDepth(piece.position!), 0);
  const statuses = friendly.filter((piece) => piece.braced).length * 0.3
    + enemy.filter((piece) => piece.pinned).length * 0.4
    + state.blocks.filter((block) => block.ownerId === playerId).length * 0.2;
  return state.scores[playerId] * 100 + contact * 2 + enemyEdge * 2 - friendlyEdge * 0.5 + statuses;
}

function edgeDepth(position: { q: number; r: number }): number {
  return Math.max(Math.abs(position.q), Math.abs(position.r), Math.abs(position.q + position.r));
}

function choosePurchase(state: GameState): LegalAction | null {
  const priorities = [
    'press', 'corner', 'breaker', 'sweep', 'drive', 'shove', 'pull', 'pin',
    'block', 'vault', 'dash', 'brace', 'cull', 'gold', 'silver', 'copper'
  ];
  const buys = listLegalActions(state).filter((action) => action.command.type === 'buyCard');
  return buys.sort((left, right) => {
    const leftId = left.command.type === 'buyCard' ? left.command.definitionId : '';
    const rightId = right.command.type === 'buyCard' ? right.command.definitionId : '';
    return priorities.indexOf(leftId) - priorities.indexOf(rightId);
  })[0] ?? null;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
