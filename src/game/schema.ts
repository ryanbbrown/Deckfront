import { z } from 'zod';

export const cardDefinitionSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), type: z.enum(['action', 'treasure']),
  cost: z.number().int().nonnegative(), text: z.string(),
  mechanic: z.enum(['money', 'footwork', 'cull', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley']),
  money: z.number().int().positive().optional()
});
export const cardLibrarySchema = z.object({ cards: z.array(cardDefinitionSchema).min(1) }).superRefine(({ cards }, context) => {
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) context.addIssue({ code: 'custom', message: `Duplicate card id: ${card.id}` });
    ids.add(card.id);
    if (card.type === 'treasure' && card.mechanic !== 'money') context.addIssue({ code: 'custom', message: `${card.id} must use money mechanic` });
  }
});
export const marketSchema = z.object({
  id: z.string().min(1),
  actionPiles: z.array(z.object({ cardId: z.string(), count: z.number().int().positive() })).length(8)
});
