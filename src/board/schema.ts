import { z } from 'zod';

export const hexCoordSchema = z
  .object({
    col: z.number().int(),
    row: z.number().int()
  })
  .strict();

export type HexCoord = z.infer<typeof hexCoordSchema>;
export type BoardCoord = HexCoord;

export const boardCardSchema = z
  .object({
    name: z.string().min(1),
    effect: z.string().min(1),
    cost: z.number().int().nonnegative()
  })
  .strict();

export const boardCardsSchema = z.record(z.string().min(1), boardCardSchema);
export type BoardCards = z.infer<typeof boardCardsSchema>;

export const unitRulesSchema = z.record(
  z.string().min(1),
  z
    .object({
      role: z.enum(['melee', 'ranged', 'mage']),
      attack: z.number().int().nonnegative(),
      hp: z.number().int().positive(),
      movement: z.number().int().nonnegative(),
      range: z.number().int().positive().optional(),
      heal: z.number().int().nonnegative().optional()
    })
    .strict()
);
export type UnitRules = z.infer<typeof unitRulesSchema>;

export const boardMapSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    orientation: z.enum(['pointy', 'flat']).default('pointy'),
    coordinateSystem: z.enum(['odd-column']).default('odd-column'),
    hexes: z.array(hexCoordSchema).min(1),
    blocked: z.array(hexCoordSchema).default([]),
    supplyCenters: z
      .array(
        z
          .object({
            id: z.string().min(1),
            col: z.number().int(),
            row: z.number().int()
          })
          .strict()
      )
      .default([]),
    homeBases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            player: z.string().min(1),
            hexes: z.array(hexCoordSchema).min(1)
          })
          .strict()
      )
      .default([])
  })
  .strict()
  .superRefine((map, context) => {
    assertUniqueCoords(map.hexes, ['hexes'], context);
    assertUniqueCoords(map.blocked, ['blocked'], context);
    assertUniqueStrings(
      map.supplyCenters.map((center) => center.id),
      ['supplyCenters'],
      'Duplicate supply center id',
      context
    );
    assertUniqueStrings(
      map.homeBases.map((homeBase) => homeBase.id),
      ['homeBases'],
      'Duplicate home base id',
      context
    );

    const hexes = new Set(map.hexes.map(coordKey));
    for (const blocked of map.blocked) {
      if (!hexes.has(coordKey(blocked))) {
        context.addIssue({ code: 'custom', path: ['blocked'], message: `Blocked hex is not in map: ${coordKey(blocked)}` });
      }
    }
    for (const center of map.supplyCenters) {
      if (!hexes.has(coordKey(center))) {
        context.addIssue({ code: 'custom', path: ['supplyCenters'], message: `Supply center is not in map: ${coordKey(center)}` });
      }
    }
    for (const homeBase of map.homeBases) {
      for (const hex of homeBase.hexes) {
        if (!hexes.has(coordKey(hex))) {
          context.addIssue({ code: 'custom', path: ['homeBases'], message: `Home base hex is not in map: ${coordKey(hex)}` });
        }
      }
    }
  });
export type BoardMap = z.infer<typeof boardMapSchema>;

export const boardStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    ruleset: z.string().min(1),
    map: z.string().min(1),
    turn: z
      .object({
        activePlayer: z.string().min(1),
        round: z.number().int().positive()
      })
      .strict(),
    units: z
      .array(
        z
          .object({
            id: z.string().min(1),
            player: z.string().min(1),
            type: z.string().min(1),
            col: z.number().int(),
            row: z.number().int(),
            hp: z.number().int().nonnegative(),
            maxHp: z.number().int().positive(),
            attack: z.number().int().nonnegative()
          })
          .strict()
      )
      .default([]),
    supplyControl: z
      .array(
        z
          .object({
            id: z.string().min(1),
            controller: z.string().min(1).nullable()
          })
          .strict()
      )
      .default([]),
    supply: z
      .array(
        z
          .object({
            player: z.string().min(1),
            amount: z.number().int().nonnegative()
          })
          .strict()
      )
      .default([]),
    notes: z.array(z.string()).default([])
  })
  .strict()
  .superRefine((state, context) => {
    assertUniqueStrings(
      state.units.map((unit) => unit.id),
      ['units'],
      'Duplicate unit id',
      context
    );
    assertUniqueStrings(
      state.supplyControl.map((center) => center.id),
      ['supplyControl'],
      'Duplicate supply control id',
      context
    );
    assertUniqueStrings(
      state.supply.map((supply) => supply.player),
      ['supply'],
      'Duplicate player supply',
      context
    );
  });
export type BoardState = z.infer<typeof boardStateSchema>;

export function coordKey(coord: HexCoord): string {
  return `${coord.col},${coord.row}`;
}

function assertUniqueCoords(coords: HexCoord[], path: Array<string | number>, context: z.RefinementCtx): void {
  assertUniqueStrings(coords.map(coordKey), path, 'Duplicate hex coordinate', context);
}

function assertUniqueStrings(values: string[], path: Array<string | number>, label: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({ code: 'custom', path, message: `${label}: ${value}` });
    }
    seen.add(value);
  }
}
