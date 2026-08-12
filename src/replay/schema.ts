import { z } from 'zod';
import { chosenActionSchema } from '../core/actionSchema';

export const replayDeckSummarySchema = z.object({
  before: z.string().min(1),
  after: z.string().min(1),
  drawnHand: z.array(z.string()).default([]),
  played: z.array(z.string()).default([]),
  bought: z.array(z.string()).default([]),
  produced: z.record(z.string(), z.number().int()).default({}),
  actions: z.array(chosenActionSchema).optional()
}).strict();

export const replayBoardSummarySchema = z.object({ before: z.string().min(1), after: z.string().min(1) }).strict();

export const replayCoordSchema = z.object({ col: z.number().int(), row: z.number().int() }).strict();

export const replayActivationInputSchema = z.object({
  unit: z.string().min(1),
  from: replayCoordSchema,
  via: replayCoordSchema.optional(),
  attack: z.object({ target: z.string().min(1) }).strict().optional(),
  to: replayCoordSchema
}).strict();

export const replayActivationSchema = z.object({
  unit: z.string().min(1),
  from: replayCoordSchema,
  via: replayCoordSchema.optional(),
  attack: z.object({
    target: z.string().min(1),
    damage: z.number().int().positive(),
    targetRemoved: z.boolean()
  }).strict().optional(),
  to: replayCoordSchema
}).strict();

export const replayUpgradeActionSchema = z.object({
  target: z.string().min(1),
  stat: z.enum(['attack', 'movement', 'range']),
  to: z.number().int().positive()
}).strict();

export const replayKeyPointUpgradeSchema = replayUpgradeActionSchema.extend({
  keyPoint: z.string().min(1)
}).strict();

export const replaySetupActionSchema = z.object({
  type: z.literal('setup'),
  keyPointUpgrades: z.array(replayKeyPointUpgradeSchema).default([]),
  upgrades: z.array(replayUpgradeActionSchema).default([])
}).strict();

export const replayActivationActionSchema = z.object({
  type: z.literal('activation'),
  activation: replayActivationSchema
}).strict();

export const replayBoardActionSchema = z.discriminatedUnion('type', [replaySetupActionSchema, replayActivationActionSchema]);

export const replayWinEventSchema = z.object({
  type: z.enum(['elimination', 'turnCap']),
  outcome: z.enum(['win', 'draw']),
  player: z.string().min(1).nullable(),
  completedRounds: z.number().int().nonnegative(),
  playerUnits: z.number().int().nonnegative(),
  opponentUnits: z.number().int().nonnegative(),
  playerHp: z.number().int().nonnegative(),
  opponentHp: z.number().int().nonnegative()
}).strict();

const replayEntryBaseSchema = z.object({
  id: z.string().min(1),
  player: z.string().min(1),
  round: z.number().int().positive(),
  board: replayBoardSummarySchema,
  winEvents: z.array(replayWinEventSchema).optional(),
  summary: z.string().min(1),
  reasoning: z.string().min(1)
});

const replaySetupEntrySchema = replayEntryBaseSchema.extend({
  phase: z.literal('setup'),
  deck: replayDeckSummarySchema,
  action: replaySetupActionSchema
}).strict();

const replayActivationEntrySchema = replayEntryBaseSchema.extend({
  phase: z.literal('activation'),
  action: replayActivationActionSchema
}).strict();

export const replayEntrySchema = z.discriminatedUnion('phase', [replaySetupEntrySchema, replayActivationEntrySchema]);

export const replayTimelineSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  run: z.object({ turnCap: z.number().int().positive() }).strict().optional(),
  entries: z.array(replayEntrySchema).default([]),
  terminalWinEvents: z.array(replayWinEventSchema).optional()
}).strict();

export type ReplayEntry = z.infer<typeof replayEntrySchema>;
export type ReplayTimeline = z.infer<typeof replayTimelineSchema>;
export type ReplayBoardAction = z.infer<typeof replayBoardActionSchema>;
export type ReplayWinEvent = z.infer<typeof replayWinEventSchema>;
export type ReplayActivationInput = z.infer<typeof replayActivationInputSchema>;
