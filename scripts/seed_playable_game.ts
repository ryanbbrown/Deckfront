/**
 * Creates a browser-playable game from a saved kingdom and AI strategy.
 * Run with: npx tsx scripts/seed_playable_game.ts --from .data/games/<id>.json
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createGame, registerKingdom } from '../src/game';
import { cloneGame } from '../src/game/state';
import type { Kingdom, PlayerId } from '../src/game';
import { FileGameRepository } from '../src/server/persistence';
import { formatStrategy } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

const dataDirectory = option('data') ?? path.resolve('.data/games');
const humanPlayerId = (option('seat') ?? 'ochre') as PlayerId;
const baseUrl = option('url') ?? 'http://127.0.0.1:4173';
const fromFile = option('from');
if (!fromFile) throw new Error('--from is required.');

async function writeGame(
  kingdom: Kingdom, strategy: Strategy, training: unknown, seed: number, startingDraftEnabled = true
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const initialState = createGame({ seed, firstPlayerId: 'ochre', kingdomId: kingdom.id, startingDraftEnabled });
  await new FileGameRepository(dataDirectory).create({
    schemaVersion: 16, id, seriesId: id, attemptNumber: 1, previousAttemptId: null, nextAttemptId: null,
    revision: 0, createdAt: now, updatedAt: now, finishedAt: null,
    completedActions: 0, durationSeconds: null, buildProposal: [],
    kingdom, startingDraftEnabled, mode: 'ai', humanPlayerId, aiDifficulty: 'expert',
    aiStrategy: strategy, training: training as { elapsedMs: number; matches: number; strategyId: string },
    initialState: cloneGame(initialState), committedCommands: [], undoHistory: [], state: initialState
  });
  return id;
}

const record = JSON.parse(fs.readFileSync(fromFile, 'utf8')) as {
  kingdom: Kingdom; aiStrategy: Strategy; training: unknown; startingDraftEnabled?: boolean;
};
registerKingdom(record.kingdom);
const id = await writeGame(
  record.kingdom, record.aiStrategy, record.training, Date.now(), record.startingDraftEnabled ?? true
);
console.log(`market: ${record.kingdom.actionPiles.map((pile) => pile.cardId).join(', ')}`);
console.log(formatStrategy(record.aiStrategy));
console.log(`${baseUrl}/rematch.html?game=${id}`);
