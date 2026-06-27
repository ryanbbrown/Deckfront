import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { chosenActionSchema } from '../core/actionSchema';
import { applyAction } from '../core/engine';
import { SeededRng } from '../core/random';
import { cloneState } from '../core/state';
import type { ChosenAction, GameState } from '../core/types';

export interface DeckSnapshot {
  schemaVersion: 1;
  rngState: number;
  game: GameState;
}

export const deckTurnInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    turnId: z.string().min(1),
    player: z.string().min(1),
    actions: z.array(chosenActionSchema).min(1)
  })
  .strict();

export const deckTurnResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    turnId: z.string().min(1),
    player: z.string().min(1),
    before: z.string().min(1),
    after: z.string().min(1),
    actions: z.array(chosenActionSchema),
    drawnHand: z.array(z.string()),
    played: z.array(z.string()),
    bought: z.array(z.string()),
    produced: z.record(z.string(), z.number().int())
  })
  .strict();

export type DeckTurnInput = z.infer<typeof deckTurnInputSchema>;
export type DeckTurnResult = z.infer<typeof deckTurnResultSchema>;

export interface ExecuteDeckTurnOptions {
  beforePath: string;
  afterPath: string;
}

export interface ExecutedDeckTurn {
  before: DeckSnapshot;
  after: DeckSnapshot;
  result: DeckTurnResult;
}

export async function readDeckTurnInput(path: string): Promise<DeckTurnInput> {
  return deckTurnInputSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export function executeDeckTurn(snapshot: DeckSnapshot, input: DeckTurnInput, options: ExecuteDeckTurnOptions): ExecutedDeckTurn {
  if (!isCompleteDeckSnapshot(snapshot)) {
    throw new Error('deck.before is not a complete persisted deck snapshot');
  }

  const activePlayerIndex = snapshot.game.activePlayer;
  const startingPlayer = snapshot.game.players[activePlayerIndex];
  if (!startingPlayer) {
    throw new Error('deck.before active player is missing');
  }
  if (startingPlayer.id !== input.player) {
    throw new Error(`deck.before active player is ${startingPlayer.id}, expected ${input.player}`);
  }

  const before: DeckSnapshot = {
    schemaVersion: 1,
    rngState: snapshot.rngState,
    game: cloneState(snapshot.game)
  };
  const rng = SeededRng.fromState(snapshot.rngState);
  let game = cloneState(snapshot.game);
  const drawnHand = [...startingPlayer.hand];
  const played: string[] = [];
  const bought: string[] = [];
  let completed = false;

  for (const action of input.actions) {
    if (completed) {
      throw new Error(`${input.turnId}: deck action appears after the turn is complete`);
    }

    if (action.type === 'playAction') {
      const cardId = game.players[game.activePlayer]?.hand[action.handIndex];
      game = applyAction(game, action, rng);
      if (cardId) {
        played.push(cardId);
      }
    } else {
      game = applyAction(game, action, rng);
      if (action.type === 'buyCard') {
        bought.push(action.cardId);
      }
    }

    if (action.type === 'endTurn' || game.ended) {
      completed = true;
    }
  }

  if (!completed) {
    throw new Error(`${input.turnId}: deck actions did not complete the active player's turn`);
  }

  const after: DeckSnapshot = {
    schemaVersion: 1,
    rngState: rng.snapshot(),
    game
  };

  return {
    before,
    after,
    result: {
      schemaVersion: 1,
      turnId: input.turnId,
      player: input.player,
      before: options.beforePath,
      after: options.afterPath,
      actions: input.actions,
      drawnHand,
      played,
      bought,
      produced: deriveProduced(before.game, after.game, activePlayerIndex)
    }
  };
}

export function isCompleteDeckSnapshot(value: unknown): value is DeckSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DeckSnapshot>;
  return candidate.schemaVersion === 1 && Number.isInteger(candidate.rngState) && isCompleteGameState(candidate.game);
}

function deriveProduced(before: GameState, after: GameState, playerIndex: number): Record<string, number> {
  const player = after.players[playerIndex];
  if (!player) {
    throw new Error('finished deck player is missing');
  }

  const produced: Record<string, number> = {};
  const money = player.money - before.config.setup.initialMoney;
  if (money !== 0) {
    produced.money = money;
  }

  const keys = new Set([...Object.keys(before.config.setup.attributes), ...Object.keys(player.attributes)]);
  for (const key of keys) {
    const value = (player.attributes[key] ?? 0) - (before.config.setup.attributes[key] ?? 0);
    if (value !== 0) {
      produced[key] = value;
    }
  }

  return produced;
}

function isCompleteGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<GameState>;
  return (
    isGameConfigLike(candidate.config) &&
    isRecord(candidate.cards) &&
    Array.isArray(candidate.players) &&
    candidate.players.every(isPlayerStateLike) &&
    Number.isInteger(candidate.activePlayer) &&
    typeof candidate.phase === 'string' &&
    isRecord(candidate.supply) &&
    Array.isArray(candidate.trash) &&
    typeof candidate.ended === 'boolean'
  );
}

function isGameConfigLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { setup?: unknown; cards?: unknown; supply?: unknown; endGame?: unknown };
  return Boolean(candidate.setup) && Array.isArray(candidate.cards) && Array.isArray(candidate.supply) && Boolean(candidate.endGame);
}

function isPlayerStateLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as {
    id?: unknown;
    draw?: unknown;
    hand?: unknown;
    discard?: unknown;
    play?: unknown;
    actions?: unknown;
    buys?: unknown;
    money?: unknown;
    attributes?: unknown;
    persistentAttributes?: unknown;
    vpCounters?: unknown;
    turnsTaken?: unknown;
    freeTrashUsed?: unknown;
  };
  return (
    typeof candidate.id === 'string' &&
    isStringArray(candidate.draw) &&
    isStringArray(candidate.hand) &&
    isStringArray(candidate.discard) &&
    isStringArray(candidate.play) &&
    Number.isInteger(candidate.actions) &&
    Number.isInteger(candidate.buys) &&
    Number.isInteger(candidate.money) &&
    isNumberRecord(candidate.attributes) &&
    isRecord(candidate.persistentAttributes) &&
    Number.isInteger(candidate.vpCounters) &&
    Number.isInteger(candidate.turnsTaken) &&
    typeof candidate.freeTrashUsed === 'boolean'
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((item) => Number.isInteger(item));
}
