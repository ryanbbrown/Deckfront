import { z } from 'zod';
import { VALUE_KEYS } from './values';

export const cardDefinitionSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), type: z.enum(['action', 'treasure']),
  family: z.enum(['treasure', 'ranged', 'mana', 'melee', 'engine']),
  cost: z.number().int().nonnegative(), text: z.string(),
  mechanic: z.enum([
    'money', 'footwork', 'cull', 'muster', 'feint', 'drive', 'flurry', 'aim', 'volley',
    'stipend', 'reclaim', 'adapt', 'melee', 'ranged', 'spell', 'channel', 'leyStep', 'prism', 'step'
  ]),
  money: z.number().int().positive().optional(),
  values: z.record(z.string(), z.number()).optional()
});
export const cardLibrarySchema = z.object({ cards: z.array(cardDefinitionSchema).min(1) }).superRefine(({ cards }, context) => {
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) context.addIssue({ code: 'custom', message: `Duplicate card id: ${card.id}` });
    ids.add(card.id);
    if (card.type === 'treasure') {
      if (card.mechanic !== 'money') context.addIssue({ code: 'custom', message: `${card.id} must use money mechanic` });
      if (card.values) context.addIssue({ code: 'custom', message: `${card.id} must not declare values` });
      continue;
    }
    const declared = VALUE_KEYS[card.mechanic];
    if (!declared) { context.addIssue({ code: 'custom', message: `${card.mechanic} declares no value keys` }); continue; }
    if (!card.values) { context.addIssue({ code: 'custom', message: `${card.id} must declare values` }); continue; }
    const expected = [...declared].sort().join(', ');
    const present = Object.keys(card.values).sort().join(', ');
    if (expected !== present) context.addIssue({ code: 'custom', message: `${card.id} must declare exactly these values: ${expected || 'none'}` });
  }
});
export const kingdomSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), startingHealth: z.number().int().positive(),
  actionPiles: z.array(z.object({ cardId: z.string().min(1), count: z.number().int().positive() })).min(1),
  overrides: z.record(z.string(), z.strictObject({
    cost: z.number().int().nonnegative().optional(), money: z.number().int().nonnegative().optional(),
    values: z.record(z.string(), z.number()).optional()
  })).optional()
});
export const kingdomLibrarySchema = z.object({ kingdoms: z.array(kingdomSchema).min(1) });
