import { z } from 'zod';

export const coordinateSchema = z.object({ q: z.number().int(), r: z.number().int() });

export const cardDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['action', 'treasure']),
  cost: z.number().int().nonnegative(),
  text: z.string(),
  mechanic: z.enum([
    'money', 'shove', 'dash', 'brace', 'cull', 'drive', 'breaker', 'press',
    'pull', 'vault', 'sweep', 'relay', 'block', 'pin', 'corner'
  ]),
  money: z.number().int().positive().optional(),
  tags: z.array(z.string()),
  synergy: z.array(z.string())
});

export const cardLibrarySchema = z.object({
  cards: z.array(cardDefinitionSchema).min(1)
}).superRefine(({ cards }, context) => {
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate card id: ${card.id}` });
    }
    ids.add(card.id);
    if (card.type === 'treasure' && card.mechanic !== 'money') {
      context.addIssue({ code: 'custom', message: `${card.id} must use money mechanic` });
    }
  }
});

export const marketSchema = z.object({
  id: z.string().min(1),
  basicPiles: z.array(z.object({ cardId: z.string(), count: z.number().int().positive() })),
  kingdomPiles: z.array(z.object({ cardId: z.string(), count: z.number().int().positive() })).length(10)
});
