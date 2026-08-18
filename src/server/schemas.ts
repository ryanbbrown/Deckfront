import { z } from 'zod';

const playerId = z.enum(['ochre', 'indigo']);
const opponentMode = z.enum(['ai', 'local']);
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
  z.object({ type: z.literal('playAim'), ...commandCard }),
  z.object({ type: z.literal('playVolley'), ...commandCard }),
  z.object({ type: z.literal('playAction'), ...commandCard }),
  z.object({ type: z.literal('playMoveAction'), ...commandCard, direction: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('resolveDiscard'), discardInstanceId: z.string() }),
  z.object({ type: z.literal('resolveRecover'), recoverInstanceId: z.string().nullable() }),
  z.object({ type: z.literal('endActionPhase') }),
  z.object({ type: z.literal('buyCard'), definitionId: z.string() }), z.object({ type: z.literal('endBuyPhase') })
]);
const player = z.object({
  id: playerId, deck, money: z.number().int().nonnegative(), mana: z.number().int().nonnegative(),
  positionChanged: z.boolean(), firstBuyMoney: z.number().int().nonnegative(),
  firstBuyPending: z.boolean(), startingBuild: z.array(z.string()).nullable(), purchases: z.array(z.string())
});
const fighter = z.object({ playerId, position: z.number().int().min(1).max(5), health: z.number().int().min(0), aimed: z.boolean(), exposed: z.boolean() });
const pendingChoice = z.object({ type: z.enum(['discard', 'recover']), playerId, remaining: z.number().int().positive() });
const event = z.object({ sequence: z.number().int().nonnegative(), type: z.string(), playerId, detail: z.record(z.string(), z.unknown()) });
const aiTurnRecap = z.object({
  turn: z.number().int().positive(),
  startingHand: z.array(card),
  draws: z.array(z.object({ card, sourceDefinitionId: z.string() })),
  actions: z.array(z.object({
    card, label: z.string(), damage: z.number().int().nonnegative(), movements: z.array(z.string()),
    drawnCardIds: z.array(z.string()), trashed: z.array(card)
  })),
  treasures: z.array(z.object({ card, money: z.number().int().nonnegative() })),
  unplayed: z.array(card),
  purchases: z.array(z.object({ definitionId: z.string(), cost: z.number().int().nonnegative() })),
  startingMoney: z.number().int().nonnegative(), moneyAvailable: z.number().int().nonnegative(),
  unspentMoney: z.number().int().nonnegative(), totalDamage: z.number().int().nonnegative()
});
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
export const gameRecordSchema = z.object({
  schemaVersion: z.literal(8), id: z.string().uuid(), revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  completedActions: z.number().int().nonnegative(), durationSeconds: z.number().nonnegative().nullable(),
  humanPlayerId: playerId, aiPlayerId: playerId, opponentMode, strategy: z.object({ presetId: z.string(), markdown: z.string() }),
  aiRuntime: z.object({ model: z.string(), effort: z.string() }), humanBuildProposal: z.array(z.string()),
  activeAiTurn: aiTurnRecap.nullable(), lastAiTurnRecap: aiTurnRecap.nullable(),
  aiActions: z.array(z.object({
    committedRevision: z.number().int().nonnegative(), turn: z.number().int().nonnegative(), phase,
    decisionIndex: z.number().int().nonnegative(), actionId: z.string(), summary: z.string(),
    durationSeconds: z.number().nonnegative(), fallback: z.boolean().optional()
  })),
  initialState: gameStateSchema, committedCommands: z.array(gameCommandSchema),
  undoCheckpoint: undoCheckpoint.nullable(), state: gameStateSchema
});
export const createGameRequestSchema = z.object({
  seed: z.number().int().optional(), strategyPresetId: z.string().min(1), strategyMarkdown: z.string().min(1).max(50_000),
  firstPlayerId: playerId.default('ochre'), opponentMode: opponentMode.default('ai')
});
export const buildRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), definitionIds: z.array(z.string()).max(1000), complete: z.boolean() });
export const actionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), actionId: z.string().min(1) });
export const revisionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
