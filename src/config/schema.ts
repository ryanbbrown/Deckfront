import { z } from 'zod';

const metricSchema = z.enum(['emptyPiles', 'provincePileEmpty']);
const comparableSchema = z.union([z.number(), z.boolean(), z.string()]);

export type RawBoolExpr = z.infer<typeof boolExprSchema>;

export const boolExprSchema: z.ZodType =
  z.lazy(() =>
    z.union([
      z.object({ and: z.array(boolExprSchema).min(1) }).strict(),
      z.object({ or: z.array(boolExprSchema).min(1) }).strict(),
      z.object({ eq: z.tuple([metricSchema, comparableSchema]) }).strict(),
      z.object({ gte: z.tuple([metricSchema, z.number().int().nonnegative()]) }).strict()
    ])
  );

const targetSchema = z
  .string()
  .optional()
  .superRefine((target, context) => {
    if (target !== undefined && target !== 'self') {
      context.addIssue({
        code: 'custom',
        message: 'Only self-targeting effects are supported'
      });
    }
  })
  .transform((target) => target as 'self' | undefined);

const effectSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('grant'),
      target: targetSchema,
      cards: z.number().int().nonnegative().optional(),
      actions: z.number().int().nonnegative().optional(),
      buys: z.number().int().nonnegative().optional(),
      money: z.number().int().nonnegative().optional(),
      attributes: z.record(z.string(), z.number().int()).optional(),
      persistentAttributes: z.record(z.string(), z.number().int()).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('discard'),
      target: targetSchema,
      count: z.number().int().positive(),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('trash'),
      target: targetSchema,
      count: z.number().int().positive(),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('lookahead'),
      target: targetSchema,
      count: z.number().int().positive(),
      choices: z.array(z.enum(['draw', 'discard', 'trash', 'top'])).min(1),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('vp'),
      target: targetSchema,
      points: z.number().int()
    })
    .strict()
]);

export const GameConfigSchema = z
  .object({
    players: z.number().int().positive().default(1),
    setup: z
      .object({
        initialActions: z.number().int().nonnegative().default(1),
        initialBuys: z.number().int().nonnegative().default(1),
        initialMoney: z.number().int().nonnegative().default(0),
        handSize: z.number().int().positive().default(5),
        startingDeck: z.array(z.string()).min(1),
        attributes: z.record(z.string(), z.number().int()).default({})
      })
      .strict(),
    cards: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            type: z.enum(['action', 'treasure', 'victory']),
            cost: z.number().int().nonnegative(),
            effects: z.array(effectSchema).optional(),
            treasure: z.number().int().nonnegative().optional(),
            victoryPoints: z.number().int().optional()
          })
          .strict()
      )
      .min(1),
    supply: z.array(z.object({ card: z.string().min(1), count: z.number().int().positive() }).strict()).min(1),
    endGame: boolExprSchema
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set<string>();
    for (const card of config.cards) {
      if (ids.has(card.id)) {
        context.addIssue({ code: 'custom', path: ['cards'], message: `Duplicate card id: ${card.id}` });
      }
      ids.add(card.id);
    }

    for (const card of config.setup.startingDeck) {
      if (!ids.has(card)) {
        context.addIssue({ code: 'custom', path: ['setup', 'startingDeck'], message: `Unknown starting card: ${card}` });
      }
    }

    const supplyIds = new Set<string>();
    for (const pile of config.supply) {
      if (!ids.has(pile.card)) {
        context.addIssue({ code: 'custom', path: ['supply'], message: `Unknown supply card: ${pile.card}` });
      }
      if (supplyIds.has(pile.card)) {
        context.addIssue({ code: 'custom', path: ['supply'], message: `Duplicate supply pile: ${pile.card}` });
      }
      supplyIds.add(pile.card);
    }
  });
