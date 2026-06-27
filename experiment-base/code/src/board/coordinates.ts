import type { BoardCoord, BoardMap } from './schema';
import { coordKey } from './schema';

export type HexDirection = 'north' | 'northeast' | 'southeast' | 'south' | 'southwest' | 'northwest';

const oddColumnDirections: Record<'even' | 'odd', Record<HexDirection, BoardCoord>> = {
  even: {
    north: { col: 0, row: -1 },
    northeast: { col: 1, row: -1 },
    southeast: { col: 1, row: 0 },
    south: { col: 0, row: 1 },
    southwest: { col: -1, row: 0 },
    northwest: { col: -1, row: -1 }
  },
  odd: {
    north: { col: 0, row: -1 },
    northeast: { col: 1, row: 0 },
    southeast: { col: 1, row: 1 },
    south: { col: 0, row: 1 },
    southwest: { col: -1, row: 1 },
    northwest: { col: -1, row: 0 }
  }
};

export const hexDirections: HexDirection[] = ['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'];

export function neighborCoord(coord: BoardCoord, direction: HexDirection, coordinateSystem: BoardMap['coordinateSystem'] = 'odd-column'): BoardCoord {
  assertOddColumn(coordinateSystem);
  const parity = Math.abs(coord.col) % 2 === 0 ? 'even' : 'odd';
  const delta = oddColumnDirections[parity][direction];
  return { col: coord.col + delta.col, row: coord.row + delta.row };
}

export function neighborCoords(coord: BoardCoord, coordinateSystem: BoardMap['coordinateSystem'] = 'odd-column'): BoardCoord[] {
  return hexDirections.map((direction) => neighborCoord(coord, direction, coordinateSystem));
}

export function mapNeighbors(map: BoardMap, coord: BoardCoord, options: { includeBlocked?: boolean } = {}): BoardCoord[] {
  const hexes = new Set(map.hexes.map(coordKey));
  const blocked = new Set(map.blocked.map(coordKey));
  return neighborCoords(coord, map.coordinateSystem).filter((neighbor) => {
    const key = coordKey(neighbor);
    return hexes.has(key) && (options.includeBlocked === true || !blocked.has(key));
  });
}

export function hexDistance(from: BoardCoord, to: BoardCoord, coordinateSystem: BoardMap['coordinateSystem'] = 'odd-column'): number {
  assertOddColumn(coordinateSystem);
  const fromCube = oddColumnToCube(from);
  const toCube = oddColumnToCube(to);
  return Math.max(Math.abs(fromCube.x - toCube.x), Math.abs(fromCube.y - toCube.y), Math.abs(fromCube.z - toCube.z));
}

export function mapDistance(map: BoardMap, from: BoardCoord, to: BoardCoord, options: { includeBlocked?: boolean } = {}): number | null {
  const startKey = coordKey(from);
  const targetKey = coordKey(to);
  const hexes = new Set(map.hexes.map(coordKey));
  const blocked = new Set(map.blocked.map(coordKey));
  if (!hexes.has(startKey) || !hexes.has(targetKey)) {
    return null;
  }
  if (options.includeBlocked !== true && (blocked.has(startKey) || blocked.has(targetKey))) {
    return null;
  }

  const queue: Array<{ coord: BoardCoord; distance: number }> = [{ coord: from, distance: 0 }];
  const seen = new Set<string>([startKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (coordKey(current.coord) === targetKey) {
      return current.distance;
    }
    for (const neighbor of mapNeighbors(map, current.coord, options)) {
      const key = coordKey(neighbor);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ coord: neighbor, distance: current.distance + 1 });
      }
    }
  }

  return null;
}

function oddColumnToCube(coord: BoardCoord): { x: number; y: number; z: number } {
  const x = coord.col;
  const z = coord.row - (coord.col - parity(coord.col)) / 2;
  return { x, y: -x - z, z };
}

function parity(value: number): number {
  return Math.abs(value) % 2;
}

function assertOddColumn(coordinateSystem: BoardMap['coordinateSystem']): void {
  if (coordinateSystem !== 'odd-column') {
    throw new Error(`Unsupported coordinate system: ${coordinateSystem}`);
  }
}
