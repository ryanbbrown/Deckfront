import { z } from 'zod';
import { MAX_FIRST_BUY_CARRY, RANDOM_KINGDOM_SIZE, VARIABLE_ACTION_IDS } from '../game';
import { kingdomSchema } from '../game/schema';

const playerId = z.enum(['ochre', 'indigo']);
const card = z.object({ id: z.string(), definitionId: z.string() });
const deck = z.object({ draw: z.array(card), hand: z.array(card), discard: z.array(card), play: z.array(card) });
const phase = z.enum(['startingBuild', 'action', 'buy', 'ended']);
const commandCard = { cardInstanceId: z.string() };
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('submitStartingBuild'), playerId, definitionIds: z.array(z.string()) }),
  z.object({ type: z.literal('playFootwork'), ...commandCard, movement: z.enum(['left', 'right', 'stay']) }),
  z.object({ type: z.literal('playCull'), ...commandCard, trashInstanceIds: z.union([z.tuple([z.string()]), z.tuple([z.string(), z.string()])]) }),
  z.object({ type: z.literal('playMuster'), ...commandCard }), z.object({ type: z.literal('playFeint'), ...commandCard }),
  z.object({ type: z.literal('playDrive'), ...commandCard, direction: z.enum(['left', 'right']) }), z.object({ type: z.literal('playFlurry'), ...commandCard }),
  z.object({ type: z.literal('playAim'), ...commandCard }), z.object({ type: z.literal('playVolley'), ...commandCard }),
  z.object({ type: z.literal('playAction'), ...commandCard }),
  z.object({ type: z.literal('playMoveAction'), ...commandCard, direction: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('resolveDiscard'), discardInstanceId: z.string() }),
  z.object({ type: z.literal('resolveRecover'), recoverInstanceId: z.string().nullable() }),
  z.object({ type: z.literal('endActionPhase') }),
  z.object({ type: z.literal('buyCard'), definitionId: z.string() }), z.object({ type: z.literal('endBuyPhase') })
]);
const player = z.object({
  id: playerId, deck, money: z.number().int().nonnegative(), mana: z.number().int().nonnegative(),
  positionChanged: z.boolean(), firstBuyMoney: z.number().int().min(0).max(MAX_FIRST_BUY_CARRY),
  firstBuyPending: z.boolean(), startingBuild: z.array(z.string()).nullable(), purchases: z.array(z.string())
});
const fighter = z.object({ playerId, position: z.number().int().min(1).max(5), health: z.number().int().nonnegative(), aimed: z.boolean(), exposed: z.boolean() });
const pendingChoice = z.object({ type: z.enum(['discard', 'recover']), playerId, remaining: z.number().int().positive() });
const event = z.object({ sequence: z.number().int().nonnegative(), type: z.string(), playerId, detail: z.record(z.string(), z.unknown()) });
export const gameStateSchema = z.object({
  schemaVersion: z.literal(8), seed: z.number().int(), rngState: z.number().int().nonnegative(), version: z.number().int().nonnegative(),
  nextCardSerial: z.number().int().positive(), kingdomId: z.string().min(1), startingHealth: z.number().int().positive(),
  activePlayerId: playerId, selectedFirstPlayerId: playerId, phase,
  turn: z.number().int().nonnegative(), winner: playerId.nullable(), players: z.object({ ochre: player, indigo: player }),
  fighters: z.object({ ochre: fighter, indigo: fighter }), supply: z.record(z.string(), z.number().int().nonnegative()),
  trash: z.array(card), actionsThisTurn: z.array(z.string()), pendingChoice: pendingChoice.nullable(), events: z.array(event)
});
const undoCheckpoint = z.object({
  committedCommandCount: z.number().int().nonnegative(), completedActions: z.number().int().nonnegative(),
  finishedAt: z.string().datetime().nullable(), durationSeconds: z.number().nonnegative().nullable()
});
const strategySchema = z.object({
  id: z.string().min(1), startingBuild: z.array(z.string()),
  buyAgenda: z.array(z.object({ cardId: z.string(), desiredCount: z.number().int().positive() })),
  repeatPurchase: z.string().min(1)
});
const trainingSchema = z.object({
  elapsedMs: z.number().nonnegative(), matches: z.number().int().nonnegative(), strategyId: z.string().min(1)
});
export const gameRecordSchema = z.object({
  schemaVersion: z.literal(10), id: z.string().uuid(), revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  completedActions: z.number().int().nonnegative(), durationSeconds: z.number().nonnegative().nullable(),
  buildProposal: z.array(z.string()), kingdom: kingdomSchema, mode: z.enum(['local', 'ai']),
  humanPlayerId: playerId.nullable(), aiStrategy: strategySchema.nullable(), training: trainingSchema.nullable(),
  initialState: gameStateSchema, committedCommands: z.array(gameCommandSchema),
  undoCheckpoint: undoCheckpoint.nullable(), state: gameStateSchema
}).superRefine((record, context) => {
  const metadata = [record.humanPlayerId, record.aiStrategy, record.training];
  if ((record.mode === 'ai' && metadata.some((value) => value === null))
    || (record.mode === 'local' && metadata.some((value) => value !== null))) {
    context.addIssue({ code: 'custom', message: 'Game mode metadata is inconsistent.' });
  }
  if (record.state.kingdomId !== record.kingdom.id || record.initialState.kingdomId !== record.kingdom.id) {
    context.addIssue({ code: 'custom', message: 'Saved states do not use the persisted kingdom.' });
  }
  if (record.aiStrategy && record.training?.strategyId !== record.aiStrategy.id) {
    context.addIssue({ code: 'custom', message: 'Training metadata does not match the selected strategy.' });
  }
});
export const createGameRequestSchema = z.object({
  seed: z.number().int().optional(), mode: z.enum(['local', 'ai']),
  humanPlayerId: playerId.optional(), variableCardIds: z.array(z.string())
}).strict().superRefine((input, context) => {
  if (input.variableCardIds.length !== RANDOM_KINGDOM_SIZE || new Set(input.variableCardIds).size !== RANDOM_KINGDOM_SIZE
    || input.variableCardIds.some((id) => !VARIABLE_ACTION_IDS.includes(id))) {
    context.addIssue({ code: 'custom', message: `variableCardIds must contain ${RANDOM_KINGDOM_SIZE} unique variable actions.` });
  }
  if ((input.mode === 'ai') !== (input.humanPlayerId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'humanPlayerId is required only for AI games.' });
  }
});
export const buildRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), definitionIds: z.array(z.string()).max(1000), complete: z.boolean() });
export const actionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), actionId: z.string().min(1) });
export const revisionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
