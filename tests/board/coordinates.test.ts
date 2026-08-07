import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { hexDistance, lineOfSight, mapNeighbors, neighborCoord, oddRowHexDirections } from '../../src/board/coordinates';
import { boardMapSchema, coordKey, validateSkirmishMap } from '../../src/board/schema';

describe('Skirmish coordinate helpers', () => {
  it('uses reciprocal odd-row neighbors on both parities', async () => {
    const map = validateSkirmishMap(JSON.parse(await readFile('game/map.json', 'utf8')) as unknown);
    const opposites = { east: 'west', northeast: 'southwest', northwest: 'southeast', west: 'east', southwest: 'northeast', southeast: 'northwest' } as const;
    for (const origin of [{ col: 4, row: 4 }, { col: 4, row: 5 }]) {
      expect(mapNeighbors(map, origin, { includeBlocked: true })).toHaveLength(6);
      for (const direction of oddRowHexDirections) {
        const neighbor = neighborCoord(origin, direction, 'odd-row');
        expect(neighborCoord(neighbor, opposites[direction], 'odd-row')).toEqual(origin);
      }
    }
  });

  it('matches hand-computed odd-row distances across parities and corners', () => {
    expect(hexDistance({ col: 0, row: 0 }, { col: 8, row: 0 }, 'odd-row')).toBe(8);
    expect(hexDistance({ col: 4, row: 4 }, { col: 5, row: 5 }, 'odd-row')).toBe(1);
    expect(hexDistance({ col: 4, row: 5 }, { col: 5, row: 6 }, 'odd-row')).toBe(2);
    expect(hexDistance({ col: 0, row: 0 }, { col: 8, row: 16 }, 'odd-row')).toBe(16);
  });

  it('blocks sight through wall interiors but not along edges or vertices', async () => {
    const skirmish = validateSkirmishMap(JSON.parse(await readFile('game/map.json', 'utf8')) as unknown);
    expect(hexDistance({ col: 6, row: 6 }, { col: 5, row: 8 }, 'odd-row')).toBe(2);
    expect(lineOfSight(skirmish, { col: 6, row: 6 }, { col: 5, row: 8 })).toBe(false);

    const map = boardMapSchema.parse({
      id: 'los', name: 'LOS', orientation: 'pointy', coordinateSystem: 'odd-row',
      hexes: Array.from({ length: 7 }, (_, row) => Array.from({ length: row % 2 === 0 ? 5 : 6 }, (_, col) => ({ col, row }))).flat(),
      blocked: [{ col: 1, row: 3 }], keyPoints: [], deployment: []
    });
    expect(lineOfSight(map, { col: 0, row: 0 }, { col: 4, row: 2 })).toBe(true);
    for (const from of map.hexes) {
      for (const to of map.hexes) expect(lineOfSight(map, from, to)).toBe(lineOfSight(map, to, from));
    }
    expect(new Set(mapNeighbors(map, { col: 1, row: 2 }, { includeBlocked: true }).map(coordKey)).has('1,3')).toBe(true);
  });

  it('keeps exact edge and shared-vertex grazes clear with every adjacent wall present', () => {
    const edgeMap = boardMapSchema.parse({
      id: 'edge-graze', name: 'Edge graze', orientation: 'pointy', coordinateSystem: 'odd-row',
      hexes: [{ col: 4, row: 8 }, { col: 4, row: 10 }, { col: 4, row: 9 }, { col: 5, row: 9 }],
      blocked: [{ col: 4, row: 9 }, { col: 5, row: 9 }], keyPoints: [], deployment: []
    });
    expect(lineOfSight(edgeMap, { col: 4, row: 8 }, { col: 4, row: 10 })).toBe(true);

    const vertexMap = boardMapSchema.parse({
      id: 'vertex-graze', name: 'Vertex graze', orientation: 'pointy', coordinateSystem: 'odd-row',
      hexes: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 1, row: 1 }, { col: 2, row: 1 }],
      blocked: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 1, row: 1 }], keyPoints: [], deployment: []
    });
    expect(lineOfSight(vertexMap, { col: 0, row: 0 }, { col: 2, row: 1 })).toBe(true);
  });
});
