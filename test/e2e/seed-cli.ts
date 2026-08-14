import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { cloneGame } from '../../src/game';
import type { GameState, PieceId } from '../../src/game';
import { startTurn } from '../../src/game/state';
import { FileGameRepository } from '../../src/server/persistence';
import type { GameRecord } from '../../src/server/types';
import { clearHand, gameFor, giveCard, setPosition } from '../helpers';
import type { ScenarioInput } from './fixture';

async function main(): Promise<void> {
  const input = JSON.parse(process.argv[2] ?? '{}') as ScenarioInput;
  const state = gameFor(input.activePlayerId ?? 'ochre');
  clearHand(state, 'ochre');
  for (const cardId of input.cards ?? []) giveCard(state, cardId, 'ochre');
  for (const cardId of input.discardCards ?? []) {
    const card = giveCard(state, cardId, 'ochre');
    state.players.ochre.deck.hand.pop();
    state.players.ochre.deck.discard.push(card);
  }
  for (const cardId of input.playCards ?? []) {
    const card = giveCard(state, cardId, 'ochre');
    state.players.ochre.deck.hand.pop();
    state.players.ochre.deck.play.push(card);
  }
  if (input.aiCards) {
    clearHand(state, 'indigo');
    for (const cardId of input.aiCards) giveCard(state, cardId, 'indigo');
  }
  for (const [pieceId, position] of Object.entries(input.positions ?? {})) {
    setPosition(state, pieceId as PieceId, position);
  }
  if (input.activePlayerId) {
    state.activePlayerId = input.activePlayerId;
    startTurn(state);
  }
  for (const [pieceId, count] of Object.entries(input.baselineMoves ?? {})) {
    state.pieces[pieceId as PieceId].baselineMoves = count;
  }
  for (const pieceId of input.braced ?? []) state.pieces[pieceId as PieceId].braced = true;
  for (const pieceId of input.pinned ?? []) {
    state.pieces[pieceId as PieceId].pinned = { sourcePlayerId: 'ochre', clearAfterTurn: 2 };
  }
  if (input.scores) state.scores = { ...input.scores };
  if (input.blocks) state.blocks = structuredClone(input.blocks);
  if (input.phase) state.phase = input.phase;
  if (input.money !== undefined) state.players[state.activePlayerId].money = input.money;
  if (input.buys !== undefined) state.players[state.activePlayerId].buys = input.buys;
  if (input.supply) Object.assign(state.supply, input.supply);
  if (input.turnsTaken) {
    state.players.ochre.turnsTaken = input.turnsTaken.ochre;
    state.players.indigo.turnsTaken = input.turnsTaken.indigo;
  }
  if (input.pressSetupPieceIds) state.turn.pressSetupPieceIds = input.pressSetupPieceIds as PieceId[];
  if (input.displacedPieceIds) state.turn.displacedPieceIds = input.displacedPieceIds as PieceId[];
  if (input.winner !== undefined) state.winner = input.winner;
  normalizeRespawn(state);
  const id = randomUUID();
  const now = new Date().toISOString();
  const initial = cloneGame(state);
  const record: GameRecord = {
    schemaVersion: 1,
    id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    completedTurns: 0,
    durationSeconds: null,
    humanPlayerId: 'ochre',
    aiPlayerId: 'indigo',
    strategy: { presetId: 'direct-force', markdown: '# Direct force' },
    aiRuntime: process.env.HEXDECK_E2E_LIVE === '1'
      ? {
        model: process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-terra',
        effort: process.env.HEXDECK_AI_EFFORT ?? 'medium'
      }
      : { model: 'fake', effort: 'low' },
    aiTurns: [],
    initialState: initial,
    committedCommands: [],
    committedState: cloneGame(initial),
    draft: { baseVersion: initial.version, baseState: cloneGame(initial), commands: [] },
    state: cloneGame(initial)
  };
  const repository = new FileGameRepository(path.resolve(process.env.HEXDECK_E2E_DATA_DIR ?? '.e2e-data/games'));
  await repository.create(record);
  process.stdout.write(JSON.stringify({ id }));
}

function normalizeRespawn(state: GameState): void {
  for (const piece of Object.values(state.pieces)) piece.needsRespawn = piece.position === null;
}

void main();
