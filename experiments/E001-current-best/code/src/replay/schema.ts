import { z } from 'zod';
import { chosenActionSchema } from '../core/actionSchema';

export const replayDeckSummarySchema = z
  .object({
    before: z.string().min(1),
    after: z.string().min(1),
    drawnHand: z.array(z.string()).default([]),
    played: z.array(z.string()).default([]),
    bought: z.array(z.string()).default([]),
    produced: z.record(z.string(), z.number().int()).default({}),
    actions: z.array(chosenActionSchema).optional()
  })
  .strict();

export const replayBoardSummarySchema = z
  .object({
    before: z.string().min(1),
    after: z.string().min(1)
  })
  .strict();

const replayCoordSchema = z
  .object({
    col: z.number().int(),
    row: z.number().int()
  })
  .strict();

export const replayMovementActionSchema = z
  .object({
    unit: z.string().min(1),
    from: replayCoordSchema,
    to: replayCoordSchema
  })
  .strict();

export const replayRecruitActionSchema = z
  .object({
    unit: z.string().min(1),
    type: z.string().min(1),
    at: replayCoordSchema
  })
  .strict();

export const replayAttackActionSchema = z
  .object({
    attacker: z.string().min(1),
    target: z.string().min(1),
    damage: z.number().int().positive(),
    deckDamage: z.number().int().nonnegative().default(0),
    targetRemoved: z.boolean().default(false)
  })
  .strict();

export const replayHealActionSchema = z
  .object({
    target: z.string().min(1),
    amount: z.number().int().positive(),
    source: z.enum(['deck', 'unit']),
    healer: z.string().min(1).optional()
  })
  .strict();

export const replayUpgradeActionSchema = z
  .object({
    target: z.string().min(1),
    attack: z.number().int().nonnegative().default(0),
    maxHp: z.number().int().nonnegative().default(0)
  })
  .strict();

export const replayBoardActionsSchema = z
  .object({
    movements: z.array(replayMovementActionSchema).default([]),
    recruits: z.array(replayRecruitActionSchema).default([]),
    attacks: z.array(replayAttackActionSchema).default([]),
    heals: z.array(replayHealActionSchema).default([]),
    upgrades: z.array(replayUpgradeActionSchema).default([])
  })
  .strict();

export const replayWinEventSchema = z
  .object({
    type: z.enum(['unitLead', 'centerMajority', 'sixCenterDominance']),
    status: z.enum(['created', 'cleared', 'confirmed']),
    player: z.string().min(1),
    completedTurns: z.number().int().nonnegative(),
    playerUnits: z.number().int().nonnegative(),
    opponentUnits: z.number().int().nonnegative(),
    playerCenters: z.number().int().nonnegative().optional(),
    opponentCenters: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).optional()
  })
  .strict();

export const replayEntrySchema = z
  .object({
    id: z.string().min(1),
    player: z.string().min(1),
    round: z.number().int().positive(),
    deck: replayDeckSummarySchema,
    board: replayBoardSummarySchema,
    actions: replayBoardActionsSchema.optional(),
    winEvents: z.array(replayWinEventSchema).optional(),
    summary: z.string().min(1),
    reasoning: z.string().min(1)
  })
  .strict();

export const replayTimelineSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1),
    entries: z.array(replayEntrySchema).default([]),
    terminalWinEvents: z.array(replayWinEventSchema).optional()
  })
  .strict();

export type ReplayEntry = z.infer<typeof replayEntrySchema>;
export type ReplayTimeline = z.infer<typeof replayTimelineSchema>;
export type ReplayBoardActions = z.infer<typeof replayBoardActionsSchema>;
export type ReplayWinEvent = z.infer<typeof replayWinEventSchema>;
