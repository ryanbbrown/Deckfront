import { z } from 'zod';

export const hexCoordSchema = z.object({ col: z.number().int(), row: z.number().int() }).strict();
export type HexCoord = z.infer<typeof hexCoordSchema>;
export type BoardCoord = HexCoord;

export const boardCardSchema = z.object({
  name: z.string().min(1),
  effect: z.string().min(1),
  cost: z.number().int().nonnegative()
}).strict();
export const boardCardsSchema = z.record(z.string().min(1), boardCardSchema);
export type BoardCards = z.infer<typeof boardCardsSchema>;

export const unitRulesSchema = z.record(
  z.string().min(1),
  z.object({
    role: z.enum(['melee', 'ranged']),
    attack: z.number().int().nonnegative(),
    hp: z.number().int().positive(),
    movement: z.number().int().nonnegative(),
    range: z.number().int().positive(),
    canUpgradeRange: z.boolean()
  }).strict()
);
export type UnitRules = z.infer<typeof unitRulesSchema>;

const keyPointSchema = z.object({
  id: z.string().min(1),
  stat: z.enum(['attack', 'movement', 'range']),
  col: z.number().int(),
  row: z.number().int()
}).strict();

const deploymentSchema = z.object({
  player: z.string().min(1),
  hexes: z.array(hexCoordSchema).min(1)
}).strict();

export const boardMapSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  orientation: z.enum(['pointy', 'flat']).default('pointy'),
  coordinateSystem: z.enum(['odd-column', 'odd-row']).default('odd-row'),
  hexes: z.array(hexCoordSchema).min(1),
  blocked: z.array(hexCoordSchema).default([]),
  keyPoints: z.array(keyPointSchema).default([]),
  deployment: z.array(deploymentSchema).default([])
}).strict().superRefine((map, context) => {
  if ((map.orientation === 'flat') !== (map.coordinateSystem === 'odd-column')) {
    context.addIssue({
      code: 'custom',
      path: ['coordinateSystem'],
      message: `${map.orientation} maps require ${map.orientation === 'flat' ? 'odd-column' : 'odd-row'} coordinates`
    });
  }
  assertUniqueCoords(map.hexes, ['hexes'], context);
  assertUniqueCoords(map.blocked, ['blocked'], context);
  assertUniqueCoords(map.keyPoints, ['keyPoints'], context);
  assertUniqueStrings(map.keyPoints.map((point) => point.id), ['keyPoints'], 'Duplicate key point id', context);
  assertUniqueStrings(map.deployment.map((zone) => zone.player), ['deployment'], 'Duplicate deployment player', context);

  const hexes = new Set(map.hexes.map(coordKey));
  for (const [label, coords] of [
    ['blocked', map.blocked],
    ['keyPoints', map.keyPoints],
    ['deployment', map.deployment.flatMap((zone) => zone.hexes)]
  ] as const) {
    for (const coord of coords) {
      if (!hexes.has(coordKey(coord))) {
        context.addIssue({ code: 'custom', path: [label], message: `${label} hex is not in map: ${coordKey(coord)}` });
      }
    }
  }
});
export type BoardMap = z.infer<typeof boardMapSchema>;

const boardUnitSchema = z.object({
  id: z.string().min(1),
  player: z.string().min(1),
  type: z.string().min(1),
  col: z.number().int(),
  row: z.number().int(),
  hp: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  movement: z.number().int().nonnegative(),
  range: z.number().int().positive()
}).strict();

export const boardStateSchema = z.object({
  schemaVersion: z.literal(1),
  ruleset: z.string().min(1),
  map: z.string().min(1),
  players: z.tuple([z.string().min(1), z.string().min(1)]),
  turn: z.object({ activePlayer: z.string().min(1), round: z.number().int().positive() }).strict(),
  units: z.array(boardUnitSchema).default([]),
  notes: z.array(z.string()).default([])
}).strict().superRefine((state, context) => {
  assertUniqueStrings(state.players, ['players'], 'Duplicate player', context);
  assertUniqueStrings(state.units.map((unit) => unit.id), ['units'], 'Duplicate unit id', context);
  if (!state.players.includes(state.turn.activePlayer)) {
    context.addIssue({ code: 'custom', path: ['turn', 'activePlayer'], message: 'Active player is not in players' });
  }
  for (const unit of state.units) {
    if (!state.players.includes(unit.player)) {
      context.addIssue({ code: 'custom', path: ['units'], message: `Unit ${unit.id} belongs to unknown player ${unit.player}` });
    }
  }
});
export type BoardState = z.infer<typeof boardStateSchema>;

const skirmishMapSchema = boardMapSchema.superRefine((map, context) => {
  if (map.orientation !== 'pointy' || map.coordinateSystem !== 'odd-row') {
    context.addIssue({ code: 'custom', path: ['coordinateSystem'], message: 'Skirmish requires pointy orientation with odd-row coordinates' });
  }
  const expectedHexes = new Set<string>();
  for (let row = 0; row <= 16; row += 1) {
    for (let col = 0; col < skirmishRowWidth(row); col += 1) {
      expectedHexes.add(`${col},${row}`);
    }
  }
  const actualHexes = new Set(map.hexes.map(coordKey));
  if (actualHexes.size !== expectedHexes.size || [...expectedHexes].some((key) => !actualHexes.has(key))) {
    context.addIssue({ code: 'custom', path: ['hexes'], message: 'Skirmish rows must be 0..16 with widths 9 on even rows and 10 on odd rows' });
  }

  assertRotationInvariant(map.hexes, ['hexes'], context);
  assertRotationInvariant(map.blocked, ['blocked'], context);

  const players = map.deployment.map((zone) => zone.player);
  if (players.length !== 2) {
    context.addIssue({ code: 'custom', path: ['deployment'], message: 'Skirmish requires exactly two deployment zones' });
  } else {
    const first = map.deployment[0];
    const second = map.deployment[1];
    if (first && second) {
      const rotatedFirst = new Set(first.hexes.map((hex) => coordKey(rotateSkirmishCoord(hex))));
      const secondHexes = new Set(second.hexes.map(coordKey));
      if (!setsEqual(rotatedFirst, secondHexes)) {
        context.addIssue({ code: 'custom', path: ['deployment'], message: 'Deployment zones must swap under rotation' });
      }
    }
  }

  const deploymentKeys = map.deployment.flatMap((zone) => zone.hexes.map(coordKey));
  if (new Set(deploymentKeys).size !== deploymentKeys.length) {
    context.addIssue({ code: 'custom', path: ['deployment'], message: 'Deployment zones must not overlap' });
  }

  const blocked = new Set(map.blocked.map(coordKey));
  for (const coord of [...map.keyPoints, ...map.deployment.flatMap((zone) => zone.hexes)]) {
    if (blocked.has(coordKey(coord))) {
      context.addIssue({ code: 'custom', path: map.keyPoints.includes(coord as never) ? ['keyPoints'] : ['deployment'], message: `Wall occupies reserved hex ${coordKey(coord)}` });
    }
  }

  const stats = new Set(map.keyPoints.map((point) => point.stat));
  if (map.keyPoints.length !== 3 || stats.size !== 3 || map.keyPoints.some((point) => point.row !== 8)) {
    context.addIssue({ code: 'custom', path: ['keyPoints'], message: 'Skirmish requires one key point for each stat on row 8' });
  }
  const range = map.keyPoints.find((point) => point.stat === 'range');
  if (!range || range.col !== 4 || range.row !== 8) {
    context.addIssue({ code: 'custom', path: ['keyPoints'], message: 'Range key point must be at 4,8' });
  }
  const attack = map.keyPoints.find((point) => point.stat === 'attack');
  const movement = map.keyPoints.find((point) => point.stat === 'movement');
  if (!attack || !movement || coordKey(rotateSkirmishCoord(attack)) !== coordKey(movement)) {
    context.addIssue({ code: 'custom', path: ['keyPoints'], message: 'Attack and movement key points must be a rotation pair' });
  }
});

export function validateSkirmishMap(value: unknown): BoardMap {
  return skirmishMapSchema.parse(value);
}

export function skirmishRowWidth(row: number): number {
  return Math.abs(row) % 2 === 0 ? 9 : 10;
}

export function rotateSkirmishCoord(coord: HexCoord): HexCoord {
  return { row: 16 - coord.row, col: skirmishRowWidth(coord.row) - 1 - coord.col };
}

export function coordKey(coord: HexCoord): string {
  return `${coord.col},${coord.row}`;
}

function assertRotationInvariant(coords: HexCoord[], path: Array<string | number>, context: z.RefinementCtx): void {
  const keys = new Set(coords.map(coordKey));
  if (coords.some((coord) => !keys.has(coordKey(rotateSkirmishCoord(coord))))) {
    context.addIssue({ code: 'custom', path, message: `${String(path[0])} must be invariant under rotation` });
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function assertUniqueCoords(coords: HexCoord[], path: Array<string | number>, context: z.RefinementCtx): void {
  assertUniqueStrings(coords.map(coordKey), path, 'Duplicate hex coordinate', context);
}

function assertUniqueStrings(values: readonly string[], path: Array<string | number>, label: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({ code: 'custom', path, message: `${label}: ${value}` });
    }
    seen.add(value);
  }
}
