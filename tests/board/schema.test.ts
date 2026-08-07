import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { neighborCoords } from '../../src/board/coordinates';
import { boardMapSchema, boardStateSchema, coordKey, rotateSkirmishCoord, unitRulesSchema, validateSkirmishMap } from '../../src/board/schema';
import { skirmishArmyState } from '../helpers/skirmish';

describe('Skirmish schemas and assets', () => {
  it('loads the generated map and enforces its rotation invariants', async () => {
    const map = validateSkirmishMap(JSON.parse(await readFile('game/map.json', 'utf8')) as unknown);
    const units = unitRulesSchema.parse(JSON.parse(await readFile('game/units.json', 'utf8')) as unknown);
    expect(map.hexes).toHaveLength(161);
    expect(map.blocked).toHaveLength(18);
    expect(map.keyPoints.map((point) => [point.stat, coordKey(point)])).toEqual([
      ['range', '1,8'], ['attack', '4,8'], ['movement', '7,8']
    ]);
    for (const coord of map.hexes) expect(rotateSkirmishCoord(rotateSkirmishCoord(coord))).toEqual(coord);
    expect(Object.keys(units)).toEqual(['soldier', 'archer']);
  });

  it('rejects incompatible orientation and coordinate systems', () => {
    expect(() => boardMapSchema.parse({ id: 'bad', name: 'Bad', orientation: 'pointy', coordinateSystem: 'odd-column', hexes: [{ col: 0, row: 0 }] })).toThrow('pointy maps require odd-row');
  });

  it('rejects asymmetric terrain and invalid key points with specific paths', async () => {
    const raw = JSON.parse(await readFile('game/map.json', 'utf8')) as Record<string, unknown>;
    const blocked = raw.blocked as Array<{ col: number; row: number }>;
    expect(() => validateSkirmishMap({ ...raw, orientation: 'flat', coordinateSystem: 'odd-column' })).toThrow('Skirmish requires pointy orientation with odd-row coordinates');
    expect(() => validateSkirmishMap({ ...raw, blocked: blocked.slice(1) })).toThrow('blocked must be invariant under rotation');
    const points = raw.keyPoints as Array<Record<string, unknown>>;
    expect(() => validateSkirmishMap({ ...raw, keyPoints: points.map((point) => point.stat === 'attack' ? { ...point, col: 3 } : point) })).toThrow('Attack key point must be at 4,8');
    expect(() => validateSkirmishMap({ ...raw, keyPoints: points.map((point) => point.stat === 'movement' ? { ...point, col: 1 } : point) })).toThrow('Duplicate hex coordinate');
    expect(() => validateSkirmishMap({ ...raw, keyPoints: points.map((point) => point.stat === 'movement' ? { ...point, col: 6 } : point) })).toThrow('Range and movement key points must be a rotation pair');
    expect(() => validateSkirmishMap({ ...raw, keyPoints: points.map((point) => point.stat === 'movement' ? { ...point, stat: 'range' } : point) })).toThrow('one key point for each stat');
    const hexes = raw.hexes as Array<{ col: number; row: number }>;
    expect(() => validateSkirmishMap({ ...raw, hexes: hexes.filter((hex) => hex.col !== 8 || hex.row !== 0) })).toThrow('widths 9 on even rows and 10 on odd rows');
    const deployment = raw.deployment as Array<{ player: string; hexes: Array<{ col: number; row: number }> }>;
    expect(() => validateSkirmishMap({ ...raw, deployment: deployment.map((zone, index) => index === 1 ? { ...zone, hexes: zone.hexes.slice(1) } : zone) })).toThrow('Deployment zones must swap under rotation');
    expect(() => validateSkirmishMap({ ...raw, blocked: [...blocked, { col: 0, row: 0 }, { col: 8, row: 16 }] })).toThrow('Wall occupies reserved hex');
  });

  it('keeps the six intended wall segments disconnected', async () => {
    const map = validateSkirmishMap(JSON.parse(await readFile('game/map.json', 'utf8')) as unknown);
    const walls = new Set(map.blocked.map(coordKey));
    const seen = new Set<string>();
    const segmentSizes: number[] = [];
    for (const wall of map.blocked) {
      if (seen.has(coordKey(wall))) continue;
      const queue = [wall];
      seen.add(coordKey(wall));
      let size = 0;
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]!;
        size += 1;
        for (const neighbor of neighborCoords(current, 'odd-row')) {
          const key = coordKey(neighbor);
          if (walls.has(key) && !seen.has(key)) {
            seen.add(key);
            queue.push(neighbor);
          }
        }
      }
      segmentSizes.push(size);
    }
    expect(segmentSizes.sort((left, right) => left - right)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it('fails old or dead-unit board snapshots loudly', () => {
    const state = skirmishArmyState();
    expect(boardStateSchema.parse(state).units).toHaveLength(10);
    expect(() => boardStateSchema.parse({ ...state, units: [{ ...state.units[0], hp: 0 }, ...state.units.slice(1)] })).toThrow();
    expect(() => boardStateSchema.parse({ ...state, units: [{ ...state.units[0], maxHp: 6 }, ...state.units.slice(1)] })).toThrow();
  });
});
