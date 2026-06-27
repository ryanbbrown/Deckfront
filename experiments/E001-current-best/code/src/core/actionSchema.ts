import { z } from 'zod';
import type { ChosenAction } from './types';

export const chosenActionSchema: z.ZodType<ChosenAction> = z.union([
  z.object({ type: z.literal('playAction'), handIndex: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('trashCard'), handIndex: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('moveToBuy') }).strict(),
  z.object({ type: z.literal('buyCard'), cardId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
  z.object({ type: z.literal('resolvePending'), choice: z.literal('skip') }).strict(),
  z.object({ type: z.literal('resolvePending'), choice: z.literal('select'), handIndex: z.number().int().nonnegative() }).strict(),
  z
    .object({
      type: z.literal('resolvePending'),
      choice: z.literal('lookahead'),
      exposedIndex: z.number().int().nonnegative(),
      destination: z.enum(['draw', 'discard', 'trash', 'top'])
    })
    .strict()
]);
