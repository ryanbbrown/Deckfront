import { z } from 'zod';
import { GAME_EVENT_TYPES, MAX_CARRIED_MANA, MAX_FIRST_BUY_CARRY, RANDOM_KINGDOM_SIZE, VARIABLE_ACTION_IDS } from '../game';
import type { GameEventType } from '../game';
import { kingdomSchema } from '../game/schema';
import { AI_DIFFICULTIES } from '../shared/api';

const playerId = z.enum(['ochre', 'indigo']);
const card = z.object({ id: z.string(), definitionId: z.string() });
const deck = z.object({
  draw: z.array(card),
  hand: z.array(card),
  discard: z.array(card),
  play: z.array(card)
});
const phase = z.enum(['startingBuild', 'action', 'buy', 'ended']);
const commandCard = { cardInstanceId: z.string() };

export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('submitStartingBuild'), playerId, definitionIds: z.array(z.string()) }),
  z.object({ type: z.literal('playFootwork'), ...commandCard, movement: z.enum(['left', 'right', 'stay']) }),
  z.object({ type: z.literal('playMuster'), ...commandCard }),
  z.object({ type: z.literal('playFeint'), ...commandCard }),
  z.object({ type: z.literal('playDrive'), ...commandCard, direction: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('playFlurry'), ...commandCard }),
  z.object({ type: z.literal('playAim'), ...commandCard }),
  z.object({ type: z.literal('playVolley'), ...commandCard }),
  z.object({ type: z.literal('playAction'), ...commandCard }),
  z.object({ type: z.literal('playMoveAction'), ...commandCard, direction: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('playTargetedAction'), ...commandCard, targetCardInstanceIds: z.array(z.string()) }),
  z.object({ type: z.literal('resolveDiscard'), discardInstanceId: z.string() }),
  z.object({ type: z.literal('resolveRecover'), recoverInstanceId: z.string() }),
  z.object({ type: z.literal('resolveOptionalTrash'), trashInstanceId: z.string().nullable() }),
  z.object({ type: z.literal('resolveGain'), definitionId: z.string() }),
  z.object({ type: z.literal('endActionPhase') }),
  z.object({ type: z.literal('buyCard'), definitionId: z.string() }),
  z.object({ type: z.literal('endBuyPhase') })
]);

const player = z.object({
  id: playerId,
  deck,
  money: z.number().int().nonnegative(),
  mana: z.number().int().nonnegative(),
  carriedMana: z.number().int().min(0).max(MAX_CARRIED_MANA),
  positionChanged: z.boolean(),
  firstBuyMoney: z.number().int().min(0).max(MAX_FIRST_BUY_CARRY),
  firstBuyPending: z.boolean(),
  startingBuild: z.array(z.string()).nullable(),
  purchases: z.array(z.string())
});
const fighter = z.object({
  playerId,
  position: z.number().int().min(1).max(6),
  health: z.number().int().nonnegative(),
  aimBonus: z.number().int().nonnegative(),
  exposed: z.boolean()
});
const pendingChoice = z.discriminatedUnion('type', [
  z.object({ type: z.literal('discard'), playerId, remaining: z.number().int().positive() }),
  z.object({ type: z.literal('recover'), playerId, remaining: z.number().int().positive() }),
  z.object({ type: z.literal('optionalTrash'), playerId, sourceCardInstanceId: z.string() }),
  z.object({ type: z.literal('gain'), playerId, maxCost: z.number().int().nonnegative() })
]);
const eventPlayerDetailKeys: Partial<Record<GameEventType, string>> = {
  buildComplete: 'playerId',
  condition: 'targetId',
  damage: 'targetId',
  wallCollision: 'targetId',
  turn: 'activePlayerId',
  victory: 'winner'
};
const event = z.object({
  sequence: z.number().int().nonnegative(),
  type: z.enum(GAME_EVENT_TYPES),
  playerId,
  detail: z.record(z.string(), z.unknown())
}).superRefine((value, context) => {
  const detailPlayerKey = eventPlayerDetailKeys[value.type];
  if (detailPlayerKey && !playerId.safeParse(value.detail[detailPlayerKey]).success) {
    context.addIssue({
      code: 'custom', path: ['detail', detailPlayerKey],
      message: 'Event detail contains an invalid player id.'
    });
  }
  if (value.type === 'move' && value.detail.fighters !== undefined
    && !z.array(playerId).safeParse(value.detail.fighters).success) {
    context.addIssue({
      code: 'custom', path: ['detail', 'fighters'],
      message: 'Event detail contains invalid fighter ids.'
    });
  }
});
const turnState = z.object({
  cardsPlayed: z.array(z.string()),
  spacesMoved: z.number().int().nonnegative(),
  manaSpent: z.number().int().nonnegative(),
  spellsPlayed: z.number().int().nonnegative(),
  copiesPlayed: z.record(z.string(), z.number().int().positive()),
  familiesPlayed: z.array(z.enum(['treasure', 'ranged', 'mana', 'melee', 'engine']))
});

export const gameStateSchema = z.object({
  schemaVersion: z.literal(11),
  seed: z.number().int(),
  rngState: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  nextCardSerial: z.number().int().positive(),
  kingdomId: z.string().min(1),
  startingHealth: z.number().int().positive(),
  startingDraftEnabled: z.boolean(),
  activePlayerId: playerId,
  selectedFirstPlayerId: playerId,
  phase,
  turn: z.number().int().nonnegative(),
  winner: playerId.nullable(),
  players: z.object({ ochre: player, indigo: player }),
  fighters: z.object({ ochre: fighter, indigo: fighter }),
  supply: z.record(z.string(), z.number().int().nonnegative()),
  trash: z.array(card),
  turnState,
  pendingChoice: pendingChoice.nullable(),
  events: z.array(event)
});

const undoHistoryEntry = z.object({
  committedCommandCount: z.number().int().nonnegative(),
  completedActions: z.number().int().nonnegative(),
  finishedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().nonnegative().nullable()
});
const buyPlanSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inactive') }),
  z.object({ kind: z.literal('buy'), cardId: z.string(), desiredCount: z.number().int().positive() }),
  z.object({ kind: z.literal('stop'), threshold: z.number().int().nonnegative() })
]);
const strategySchema = z.object({
  id: z.string().min(1),
  startingBuild: z.array(z.string()),
  buyPlan: z.array(buyPlanSlotSchema).length(10)
});
const trainingSchema = z.object({
  elapsedMs: z.number().nonnegative(),
  matches: z.number().int().nonnegative(),
  strategyId: z.string().min(1)
});

export const gameRecordSchema = z.object({
  schemaVersion: z.literal(15),
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  completedActions: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable(),
  buildProposal: z.array(z.string()),
  kingdom: kingdomSchema,
  startingDraftEnabled: z.boolean(),
  mode: z.enum(['local', 'ai']),
  aiDifficulty: z.enum(AI_DIFFICULTIES).nullable(),
  humanPlayerId: playerId.nullable(),
  aiStrategy: strategySchema.nullable(),
  training: trainingSchema.nullable(),
  initialState: gameStateSchema,
  committedCommands: z.array(gameCommandSchema),
  undoHistory: z.array(undoHistoryEntry),
  state: gameStateSchema
}).superRefine((record, context) => {
  const metadata = [record.humanPlayerId, record.aiDifficulty, record.aiStrategy, record.training];
  if ((record.mode === 'ai' && metadata.some((value) => value === null))
    || (record.mode === 'local' && metadata.some((value) => value !== null))) {
    context.addIssue({ code: 'custom', message: 'Game mode metadata is inconsistent.' });
  }
  if (record.state.kingdomId !== record.kingdom.id
    || record.initialState.kingdomId !== record.kingdom.id) {
    context.addIssue({ code: 'custom', message: 'Saved states do not use the persisted kingdom.' });
  }
  if (record.startingDraftEnabled !== record.state.startingDraftEnabled
    || record.startingDraftEnabled !== record.initialState.startingDraftEnabled) {
    context.addIssue({ code: 'custom', message: 'Draft configuration is inconsistent.' });
  }
  if (record.aiStrategy && record.training?.strategyId !== record.aiStrategy.id) {
    context.addIssue({ code: 'custom', message: 'Training metadata does not match the selected strategy.' });
  }
});

export const createGameRequestSchema = z.object({
  seed: z.number().int().optional(),
  mode: z.enum(['local', 'ai']),
  startingDraftEnabled: z.boolean().default(false),
  humanPlayerId: playerId.optional(),
  aiDifficulty: z.enum(AI_DIFFICULTIES).optional(),
  variableCardIds: z.array(z.string())
}).strict().superRefine((input, context) => {
  if (input.variableCardIds.length !== RANDOM_KINGDOM_SIZE
    || new Set(input.variableCardIds).size !== RANDOM_KINGDOM_SIZE
    || input.variableCardIds.some((id) => !VARIABLE_ACTION_IDS.includes(id))) {
    context.addIssue({
      code: 'custom',
      message: `variableCardIds must contain ${RANDOM_KINGDOM_SIZE} unique variable actions.`
    });
  }
  if ((input.mode === 'ai') !== (input.humanPlayerId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'humanPlayerId is required only for AI games.' });
  }
  if (input.mode === 'local' && input.aiDifficulty !== undefined) {
    context.addIssue({ code: 'custom', message: 'aiDifficulty is allowed only for AI games.' });
  }
});

export const buildRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  definitionIds: z.array(z.string()).max(1000),
  complete: z.boolean()
});
export const actionRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  actionId: z.string().min(1)
});
export const revisionRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
