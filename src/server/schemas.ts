import { z } from 'zod';

const playerIdSchema = z.enum(['ochre', 'indigo']);
const pieceIdSchema = z.enum(['ochre-a', 'ochre-b', 'indigo-a', 'indigo-b']);
const coordinateSchema = z.object({ q: z.number().int(), r: z.number().int() });
const cardInstanceSchema = z.object({ id: z.string(), definitionId: z.string() });
const deckSchema = z.object({
  draw: z.array(cardInstanceSchema), hand: z.array(cardInstanceSchema),
  discard: z.array(cardInstanceSchema), play: z.array(cardInstanceSchema)
});
const commandCard = { cardInstanceId: z.string() };

export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('baselineMove'), pieceId: pieceIdSchema, destination: coordinateSchema }),
  z.object({ type: z.literal('playShove'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playDash'), ...commandCard, pieceId: pieceIdSchema, destination: coordinateSchema }),
  z.object({ type: z.literal('playBrace'), ...commandCard, pieceId: pieceIdSchema }),
  z.object({ type: z.literal('playCull'), ...commandCard, trashInstanceIds: z.tuple([z.string(), z.string()]) }),
  z.object({ type: z.literal('playDrive'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playBreaker'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playPress'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playPull'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playVault'), ...commandCard, pieceId: pieceIdSchema, jumpedPieceId: pieceIdSchema }),
  z.object({ type: z.literal('playSweep'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema, destination: coordinateSchema }),
  z.object({ type: z.literal('playRelay'), ...commandCard }),
  z.object({ type: z.literal('playBlock'), ...commandCard, actorId: pieceIdSchema, destination: coordinateSchema, replaceBlockId: z.string().optional() }),
  z.object({ type: z.literal('playPin'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('playCorner'), ...commandCard, actorId: pieceIdSchema, targetId: pieceIdSchema }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('buyCard'), definitionId: z.string() }),
  z.object({ type: z.literal('skipPurchase') })
]);

const playerSchema = z.object({
  id: playerIdSchema, deck: deckSchema, money: z.number().int().nonnegative(),
  buys: z.number().int().min(0).max(1), roundsCompleted: z.number().int().nonnegative()
});
const pieceSchema = z.object({
  id: pieceIdSchema, ownerId: playerIdSchema, position: coordinateSchema.nullable(),
  needsRespawn: z.boolean(), baselineMoves: z.number().int().min(0).max(1),
  braced: z.boolean(), pinned: z.object({ sourcePlayerId: playerIdSchema }).nullable()
});
const blockSchema = z.object({
  id: z.string(), ownerId: playerIdSchema, position: coordinateSchema,
  expiresAfterRound: z.number().int().positive()
});
const eventSchema = z.object({
  sequence: z.number().int().nonnegative(), type: z.string(), playerId: playerIdSchema,
  detail: z.record(z.string(), z.unknown())
});
const roundSchema = z.object({
  number: z.number().int().positive(), startingPlayerId: playerIdSchema,
  passedPlayerIds: z.array(playerIdSchema), purchaseOrder: z.array(playerIdSchema),
  purchaseIndex: z.number().int().nonnegative(), actionStep: z.number().int().positive(),
  displacedPieceIds: z.array(pieceIdSchema), pressSetupPieceIds: z.array(pieceIdSchema),
  relayUsed: z.object({ ochre: z.boolean(), indigo: z.boolean() })
});
export const gameStateSchema = z.object({
  schemaVersion: z.literal(2), seed: z.number().int(), rngState: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(), nextCardSerial: z.number().int().positive(),
  nextBlockSerial: z.number().int().positive(), activePlayerId: playerIdSchema,
  phase: z.enum(['action', 'purchase', 'ended']), round: roundSchema,
  scores: z.object({ ochre: z.number().int().nonnegative(), indigo: z.number().int().nonnegative() }),
  winner: playerIdSchema.nullable(), players: z.object({ ochre: playerSchema, indigo: playerSchema }),
  pieces: z.object({ 'ochre-a': pieceSchema, 'ochre-b': pieceSchema, 'indigo-a': pieceSchema, 'indigo-b': pieceSchema }),
  blocks: z.array(blockSchema), supply: z.record(z.string(), z.number().int().nonnegative()),
  trash: z.array(cardInstanceSchema), events: z.array(eventSchema)
});
export const gameRecordSchema = z.object({
  schemaVersion: z.literal(2), id: z.string().uuid(), revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  completedActions: z.number().int().nonnegative(), durationSeconds: z.number().nonnegative().nullable(),
  humanPlayerId: playerIdSchema, aiPlayerId: playerIdSchema,
  strategy: z.object({ presetId: z.string(), markdown: z.string() }),
  aiRuntime: z.object({ model: z.string(), effort: z.string() }),
  aiActions: z.array(z.object({
    committedRevision: z.number().int().nonnegative(), round: z.number().int().positive(),
    actionStep: z.number().int().positive(), actionId: z.string(), summary: z.string(),
    durationSeconds: z.number().nonnegative()
  })),
  initialState: gameStateSchema, committedCommands: z.array(gameCommandSchema),
  committedState: gameStateSchema,
  draft: z.object({ baseVersion: z.number().int().nonnegative(), baseState: gameStateSchema, command: gameCommandSchema.nullable() }),
  state: gameStateSchema
});

export const createGameRequestSchema = z.object({
  seed: z.number().int().optional(), strategyPresetId: z.string().min(1),
  strategyMarkdown: z.string().min(1).max(50_000)
});
export const actionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), actionId: z.string().min(1) });
export const revisionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
