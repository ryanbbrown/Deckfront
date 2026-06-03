import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardCardsSchema, boardMapSchema, boardStateSchema, coordKey, unitRulesSchema } from '../../src/board/schema';

describe('board and ruleset schemas', () => {
  it('loads the starter ruleset, map, and playtest board state', async () => {
    const cards = boardCardsSchema.parse(await loadJson('rulesets/territory-v1/cards.json'));
    const units = unitRulesSchema.parse(await loadJson('rulesets/territory-v1/units.json'));
    const map = boardMapSchema.parse(await loadJson('maps/sketch-v1.json'));
    const state = boardStateSchema.parse(await loadJson('.games/territory-v1-playtest/snapshots/turn-001.before.board.json'));

    expect(cards.storm?.effect).toContain('connected hexes');
    expect(units.scout?.movement).toBeGreaterThan(units.guardian?.movement ?? 0);
    expect(state.ruleset).toBe('territory-v1');
    expect(state.map).toBe(map.id);

    const maxRowByColumn = new Map<number, number>();
    for (const hex of map.hexes) {
      maxRowByColumn.set(hex.col, Math.max(maxRowByColumn.get(hex.col) ?? hex.row, hex.row));
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
    for (const center of map.supplyCenters) {
      expect(mapHexes.has(coordKey(center))).toBe(true);
    }
    for (const homeBase of map.homeBases) {
      for (const hex of homeBase.hexes) {
        expect(mapHexes.has(coordKey(hex))).toBe(true);
      }
    }

    for (const center of map.supplyCenters) {
      expect(center.row).toBeLessThan(maxRowByColumn.get(center.col) ?? -1);
    }

    expect(map.coordinateSystem).toBe('odd-column');
    expect(map.supplyCenters.find((center) => center.id === 'center-northeast')).toMatchObject({ col: 8, row: 1 });
    expect(map.supplyCenters.find((center) => center.id === 'center-center-south')).toMatchObject({ col: 6, row: 8 });
    expect(state.supply).toEqual([
      { player: 'P1', amount: 0 },
      { player: 'P2', amount: 0 }
    ]);

    expect(map.blocked).toContainEqual({ col: 3, row: 5 });

    const playerOneUnits = state.units.filter((unit) => unit.player === 'P1');
    expect(playerOneUnits).toHaveLength(4);
    expect(playerOneUnits.map((unit) => `${unit.type}:${coordKey(unit)}:${unit.hp}`).sort()).toEqual([
      'guardian:11,1:16',
      'marksman:11,0:8',
      'raider:10,1:8',
      'scout:12,1:8'
    ]);

    for (const unit of state.units) {
      expect(unit.hp).toBe(units[unit.type]?.hp);
      expect(unit.maxHp).toBe(units[unit.type]?.hp);
      expect(unit.attack).toBe(units[unit.type]?.attack);
    }
  });

  it('rejects duplicate map coordinates', () => {
    expect(() =>
      boardMapSchema.parse({
        id: 'bad',
        name: 'Bad Map',
        hexes: [
          { col: 0, row: 0 },
          { col: 0, row: 0 }
        ],
        blocked: []
      })
    ).toThrow('Duplicate hex coordinate');
  });

  it('rejects duplicate player supply entries', () => {
    expect(() =>
      boardStateSchema.parse({
        schemaVersion: 1,
        ruleset: 'territory-v1',
        map: 'sketch-v1',
        turn: { activePlayer: 'P1', round: 1 },
        supply: [
          { player: 'P1', amount: 0 },
          { player: 'P1', amount: 2 }
        ]
      })
    ).toThrow('Duplicate player supply');
  });
});

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
