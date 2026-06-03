import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { hexDistance, mapDistance, mapNeighbors, neighborCoord, neighborCoords } from '../../src/board/coordinates';
import { boardMapSchema } from '../../src/board/schema';

describe('board coordinate helpers', () => {
  it('uses odd-column neighbor directions', () => {
    expect(neighborCoord({ col: 4, row: 4 }, 'north')).toEqual({ col: 4, row: 3 });
    expect(neighborCoord({ col: 4, row: 4 }, 'northeast')).toEqual({ col: 5, row: 3 });
    expect(neighborCoord({ col: 4, row: 4 }, 'southeast')).toEqual({ col: 5, row: 4 });
    expect(neighborCoord({ col: 4, row: 4 }, 'south')).toEqual({ col: 4, row: 5 });
    expect(neighborCoord({ col: 4, row: 4 }, 'southwest')).toEqual({ col: 3, row: 4 });
    expect(neighborCoord({ col: 4, row: 4 }, 'northwest')).toEqual({ col: 3, row: 3 });

    expect(neighborCoord({ col: 5, row: 4 }, 'north')).toEqual({ col: 5, row: 3 });
    expect(neighborCoord({ col: 5, row: 4 }, 'northeast')).toEqual({ col: 6, row: 4 });
    expect(neighborCoord({ col: 5, row: 4 }, 'southeast')).toEqual({ col: 6, row: 5 });
    expect(neighborCoord({ col: 5, row: 4 }, 'south')).toEqual({ col: 5, row: 5 });
    expect(neighborCoord({ col: 5, row: 4 }, 'southwest')).toEqual({ col: 4, row: 5 });
    expect(neighborCoord({ col: 5, row: 4 }, 'northwest')).toEqual({ col: 4, row: 4 });
  });

  it('measures hex distance independent of map gaps', () => {
    expect(hexDistance({ col: 4, row: 4 }, { col: 5, row: 3 })).toBe(1);
    expect(hexDistance({ col: 5, row: 4 }, { col: 6, row: 5 })).toBe(1);
    expect(hexDistance({ col: 10, row: 1 }, { col: 8, row: 1 })).toBe(2);
  });

  it('filters map neighbors and path distance through active map hexes', async () => {
    const map = boardMapSchema.parse(JSON.parse(await readFile('maps/sketch-v1.json', 'utf8')) as unknown);

    expect(neighborCoords({ col: 3, row: 5 })).toContainEqual({ col: 3, row: 4 });
    expect(mapNeighbors(map, { col: 3, row: 5 })).not.toContainEqual({ col: 3, row: 5 });
    expect(mapDistance(map, { col: 10, row: 1 }, { col: 8, row: 1 })).toBe(2);
    expect(mapDistance(map, { col: 0, row: 2 }, { col: 0, row: 3 })).toBeNull();
    expect(mapDistance(map, { col: 0, row: 2 }, { col: 0, row: 3 }, { includeBlocked: true })).toBe(1);
  });
});
