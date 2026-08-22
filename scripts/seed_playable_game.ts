/**
 * Creates games you can play in the browser against a chosen strategy, skipping the usual training
 * step so the opponent is exactly the deck plan you asked for.
 *
 * Two modes:
 *
 *   --train 3            trains fresh random kingdoms and seeds the HIGHEST-WEIGHT equilibrium
 *                        strategy from each, rather than a weighted sample from the support
 *   --from <game.json>   reuses the kingdom and strategy from a saved game, so the same deck plan
 *                        can be replayed against a different Action-phase policy
 *
 * Print the links, start the server, and open them. The page at `/rematch.html?game=<id>` points the
 * app at a specific game, because the client otherwise loads whichever game is in local storage.
 *
 *   npx tsx scripts/seed_playable_game.ts --train 3
 *   npx tsx scripts/seed_playable_game.ts --from .data/games/<id>.json
 *   npm run dev
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { SeededRandom, VARIABLE_ACTION_IDS, createGame, randomKingdom, registerKingdom } from '../src/game';
import { cloneGame } from '../src/game/state';
import type { Kingdom, PlayerId } from '../src/game';
import { FileGameRepository } from '../src/server/persistence';
import { ACTION_CAP_PER_TURN, EXPERIMENT_DEFAULTS, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { runPsro } from '../src/sim/psro';
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
const limits = EXPERIMENT_DEFAULTS.full;

async function writeGame(kingdom: Kingdom, strategy: Strategy, training: unknown, seed: number): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const startingDraftEnabled = true;
  const initialState = createGame({ seed, firstPlayerId: 'ochre', kingdomId: kingdom.id, startingDraftEnabled });
  await new FileGameRepository(dataDirectory).create({
    schemaVersion: 13, id, revision: 0, createdAt: now, updatedAt: now, finishedAt: null,
    completedActions: 0, durationSeconds: null, buildProposal: [],
    kingdom, startingDraftEnabled, mode: 'ai', humanPlayerId, aiDifficulty: 'expert',
    aiStrategy: strategy, training: training as { elapsedMs: number; matches: number; strategyId: string },
    initialState: cloneGame(initialState), committedCommands: [], undoHistory: [], state: initialState
  });
  return id;
}

function pickCards(random: SeededRandom): string[] {
  const pool = [...VARIABLE_ACTION_IDS];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = random.nextInt(index + 1);
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  return pool.slice(0, 10);
}

const links: string[] = [];
const fromFile = option('from');

if (fromFile) {
  const record = JSON.parse(fs.readFileSync(fromFile, 'utf8')) as {
    kingdom: Kingdom; aiStrategy: Strategy; training: unknown;
  };
  registerKingdom(record.kingdom);
  const id = await writeGame(record.kingdom, record.aiStrategy, record.training, Date.now());
  console.log(`market: ${record.kingdom.actionPiles.map((pile) => pile.cardId).join(', ')}`);
  console.log(formatStrategy(record.aiStrategy));
  links.push(`${baseUrl}/rematch.html?game=${id}`);
} else {
  const count = Number(option('train') ?? '3');
  for (let index = 0; index < count; index += 1) {
    const seed = 0x51a7c000 + index * 7919;
    const kingdom = randomKingdom(`random-${randomUUID()}`, pickCards(new SeededRandom(seed)));
    registerKingdom(kingdom);

    const started = Date.now();
    const runner = new WorkerPairingRunner(
      limits.workers, new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']
    );
    let result;
    try {
      result = await runPsro({
        kingdomId: kingdom.id, seed, restarts: limits.restarts,
        initialStrategies: limits.initialStrategies, candidates: limits.candidates,
        iterations: limits.iterations, seeds: limits.seeds,
        unionIterations: limits.unionIterations, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
        actionCapPerTurn: ACTION_CAP_PER_TURN,
        searchDeadline: started + limits.deadlineMinutes * 60_000,
        finalDeadline: started + limits.deadlineMinutes * 60_000
      }, runner);
    } finally { await runner.close(); }

    if (!result.equilibrium) { console.log(`kingdom ${index + 1}: no equilibrium, skipped`); continue; }
    const weights = result.equilibrium.weights;
    const ranked = result.strategies
      .map((strategy) => ({ strategy, weight: weights[strategy.id] ?? 0 }))
      .sort((left, right) => right.weight - left.weight || left.strategy.id.localeCompare(right.strategy.id));
    const top = ranked[0]!;
    const elapsed = Date.now() - started;
    const id = await writeGame(kingdom, top.strategy,
      { elapsedMs: elapsed, matches: result.matches, strategyId: top.strategy.id }, Date.now() + index);

    console.log(`\n=== kingdom ${index + 1} ===`);
    console.log(`market: ${kingdom.actionPiles.map((pile) => pile.cardId).join(', ')}`);
    console.log(`support: ${ranked.filter((entry) => entry.weight > 1e-6).length} of ${ranked.length}`
      + ` strategies, ${result.matches} matches, ${(elapsed / 1000).toFixed(0)}s`);
    console.log(`top weights: ${ranked.slice(0, 4).map((entry) => `${(entry.weight * 100).toFixed(1)}%`).join('  ')}`);
    console.log(formatStrategy(top.strategy));
    links.push(`${baseUrl}/rematch.html?game=${id}`);
  }
}

console.log(`\nyou play ${humanPlayerId}. Start the server with \`npm run dev\`, then open:`);
for (const link of links) console.log(`  ${link}`);
