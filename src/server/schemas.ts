import { z } from 'zod';
import { coordinateSchema } from '../game/schema';

const playerIdSchema = z.enum(['ochre', 'indigo']);
const pieceIdSchema = z.enum(['ochre-a', 'ochre-b', 'indigo-a', 'indigo-b']);
const cardInstanceSchema = z.object({ id: z.string(), definitionId: z.string() });
const deckSchema = z.object({
  draw: z.array(cardInstanceSchema),
  hand: z.array(cardInstanceSchema),
  discard: z.array(cardInstanceSchema),
  play: z.array(cardInstanceSchema)
});
const playerSchema = z.object({
  id: playerIdSchema,
  deck: deckSchema,
  money: z.number().int().nonnegative(),
  buys: z.number().int().nonnegative(),
  turnsTaken: z.number().int().nonnegative()
});
const pinSchema = z.object({
  sourcePlayerId: playerIdSchema,
  clearAfterTurn: z.number().int().nonnegative()
});
const pieceSchema = z.object({
  id: pieceIdSchema,
  ownerId: playerIdSchema,
  position: coordinateSchema.nullable(),
  needsRespawn: z.boolean(),
  baselineMoves: z.number().int().min(0).max(1),
  braced: z.boolean(),
  pinned: pinSchema.nullable()
});
const blockSchema = z.object({
  id: z.string(),
  ownerId: playerIdSchema,
  position: coordinateSchema,
  clearAfterTurn: z.number().int().nonnegative()
});
const eventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  type: z.string(),
  playerId: playerIdSchema,
  detail: z.record(z.string(), z.unknown())
});

const cardCommand = { cardInstanceId: z.string() };
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('respawn'), pieceId: pieceIdSchema, destination: coordinateSchema }),
  z.object({ type: z.literal('baselineMove'), pieceId: pieceIdSchema, destination: coordinateSchema }),
  z.object({ type: z.literal('playShove'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playDash'), ...cardCommand, pieceId: pieceIdSchema, destination: coordinateSchema }),
  z.object({ type: z.literal('playBrace'), ...cardCommand, pieceId: pieceIdSchema }),
  z.object({ type: z.literal('playCull'), ...cardCommand, trashInstanceId: z.string() }),
  z.object({ type: z.literal('playDrive'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playBreaker'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playPress'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playPull'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playVault'), ...cardCommand, pieceId: pieceIdSchema, jumpedPieceId: pieceIdSchema }),
  z.object({
    type: z.literal('playSweep'), ...cardCommand, actorId: pieceIdSchema,
    targetId: pieceIdSchema, destination: coordinateSchema
  }),
  z.object({ type: z.literal('playRelay'), ...cardCommand }),
  z.object({
    type: z.literal('playBlock'), ...cardCommand, actorId: pieceIdSchema,
    destination: coordinateSchema, replaceBlockId: z.string().optional()
  }),
  z.object({ type: z.literal('playPin'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playCorner'), ...cardCommand, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('enterBuyPhase') }),
  z.object({ type: z.literal('buyCard'), definitionId: z.string() }),
  z.object({ type: z.literal('endTurn') })
]);

export const gameStateSchema = z.object({
  schemaVersion: z.literal(1),
  seed: z.number().int(),
  rngState: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  nextCardSerial: z.number().int().positive(),
  nextBlockSerial: z.number().int().positive(),
  activePlayerId: playerIdSchema,
  phase: z.enum(['respawn', 'action', 'buy', 'ended']),
  scores: z.object({ ochre: z.number().int().nonnegative(), indigo: z.number().int().nonnegative() }),
  winner: playerIdSchema.nullable(),
  players: z.object({ ochre: playerSchema, indigo: playerSchema }),
  pieces: z.object({
    'ochre-a': pieceSchema,
    'ochre-b': pieceSchema,
    'indigo-a': pieceSchema,
    'indigo-b': pieceSchema
  }),
  blocks: z.array(blockSchema),
  supply: z.record(z.string(), z.number().int().nonnegative()),
  trash: z.array(cardInstanceSchema),
  turn: z.object({
    displacedPieceIds: z.array(pieceIdSchema),
    pressSetupPieceIds: z.array(pieceIdSchema),
    actionUses: z.array(z.object({ pieceId: pieceIdSchema, definitionId: z.string() })),
    relayUsed: z.boolean()
  }),
  events: z.array(eventSchema)
});

export const gameRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  completedTurns: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable(),
  humanPlayerId: playerIdSchema,
  aiPlayerId: playerIdSchema,
  strategy: z.object({ presetId: z.string(), markdown: z.string() }),
  aiRuntime: z.object({ model: z.string(), effort: z.string() }),
  aiTurns: z.array(z.object({
    committedRevision: z.number().int().nonnegative(),
    summary: z.string(),
    durationSeconds: z.number().nonnegative()
  })),
  initialState: gameStateSchema,
  committedCommands: z.array(gameCommandSchema),
  committedState: gameStateSchema,
  draft: z.object({
    baseVersion: z.number().int().nonnegative(),
    baseState: gameStateSchema,
    commands: z.array(gameCommandSchema)
  }),
  state: gameStateSchema
});

export const createGameRequestSchema = z.object({
  seed: z.number().int().optional(),
  strategyPresetId: z.string().min(1),
  strategyMarkdown: z.string().min(1).max(50_000)
});

export const actionRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  actionId: z.string().min(1)
});

export const undoRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative()
});
