import { z } from 'zod';

export const replayDeckSummarySchema = z
  .object({
    before: z.string().min(1),
    after: z.string().min(1),
    drawnHand: z.array(z.string()).default([]),
    played: z.array(z.string()).default([]),
    bought: z.array(z.string()).default([]),
    produced: z.record(z.string(), z.number().int()).default({})
  })
  .strict();

export const replayBoardSummarySchema = z
  .object({
    before: z.string().min(1),
    after: z.string().min(1)
  })
  .strict();

export const replayEntrySchema = z
  .object({
    id: z.string().min(1),
    player: z.string().min(1),
    round: z.number().int().positive(),
    deck: replayDeckSummarySchema,
    board: replayBoardSummarySchema,
    summary: z.string().min(1),
    reasoning: z.string().min(1)
  })
  .strict();

export const replayTimelineSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1),
    entries: z.array(replayEntrySchema).default([])
  })
  .strict();

export type ReplayEntry = z.infer<typeof replayEntrySchema>;
export type ReplayTimeline = z.infer<typeof replayTimelineSchema>;
