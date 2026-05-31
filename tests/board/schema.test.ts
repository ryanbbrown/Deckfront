import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardCardsSchema, boardMapSchema, boardStateSchema, coordKey, unitRulesSchema } from '../../src/board/schema';

describe('board and ruleset schemas', () => {
  it('loads the starter ruleset and board scenario', async () => {
    const cards = boardCardsSchema.parse(await loadJson('rulesets/territory-v1/cards.json'));
    const units = unitRulesSchema.parse(await loadJson('rulesets/territory-v1/units.json'));
    const map = boardMapSchema.parse(await loadJson('rulesets/territory-v1/maps/sketch-v1.json'));
    const state = boardStateSchema.parse(await loadJson('scenarios/sketch-v1.board.json'));

    expect(cards.storm?.effect).toContain('connected hexes');
    expect(units.scout?.movement).toBeGreaterThan(units.guardian?.movement ?? 0);
    expect(state.ruleset).toBe('territory-v1');
    expect(state.map).toBe(map.id);

    const maxRowByColumn = new Map<number, number>();
    for (const hex of map.hexes) {
      maxRowByColumn.set(hex.q, Math.max(maxRowByColumn.get(hex.q) ?? hex.r, hex.r));
    }

    expect(Array.from(maxRowByColumn.entries()).sort(([left], [right]) => left - right)).toEqual([
      [0, 9],
      [1, 8],
      [2, 9],
      [3, 8],
      [4, 9],
      [5, 8],
      [6, 9],
      [7, 8],
      [8, 9],
      [9, 8],
      [10, 9],
      [11, 8],
      [12, 9]
    ]);

    const mapHexes = new Set(map.hexes.map(coordKey));
    for (const unit of state.units) {
      expect(units[unit.type]).toBeDefined();
      expect(mapHexes.has(coordKey(unit))).toBe(true);
    }
    for (const center of state.supplyCenters) {
      expect(mapHexes.has(coordKey(center))).toBe(true);
    }
    for (const homeBase of state.homeBases) {
      for (const hex of homeBase.hexes) {
        expect(mapHexes.has(coordKey(hex))).toBe(true);
      }
    }

    for (const center of state.supplyCenters) {
      expect(center.r).toBeLessThan(maxRowByColumn.get(center.q) ?? -1);
    }

    expect(state.supplyCenters.find((center) => center.id === 'center-northeast')).toMatchObject({ q: 8, r: 1 });
    expect(state.supplyCenters.find((center) => center.id === 'center-center-south')).toMatchObject({ q: 6, r: 8 });

    expect(map.blocked).toContainEqual({ q: 3, r: 5 });

    const playerOneUnits = state.units.filter((unit) => unit.player === 'P1');
    expect(playerOneUnits).toHaveLength(4);
    expect(playerOneUnits.map((unit) => `${unit.type}:${coordKey(unit)}:${unit.hp}`).sort()).toEqual([
      'guardian:11,1:1',
      'marksman:11,0:3',
      'raider:10,1:6',
      'scout:12,1:2'
    ]);
  });

  it('rejects duplicate map coordinates', () => {
    expect(() =>
      boardMapSchema.parse({
        id: 'bad',
        name: 'Bad Map',
        hexes: [
          { q: 0, r: 0 },
          { q: 0, r: 0 }
        ],
        blocked: []
      })
    ).toThrow('Duplicate hex coordinate');
  });
});

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
