import type { BoardCoord, BoardMap } from './schema';
import { coordKey } from './schema';

export type OddColumnDirection = 'north' | 'northeast' | 'southeast' | 'south' | 'southwest' | 'northwest';
export type OddRowDirection = 'east' | 'northeast' | 'northwest' | 'west' | 'southwest' | 'southeast';
export type HexDirection = OddColumnDirection | OddRowDirection;

const oddColumnDirections: Record<'even' | 'odd', Record<OddColumnDirection, BoardCoord>> = {
  even: { north: { col: 0, row: -1 }, northeast: { col: 1, row: -1 }, southeast: { col: 1, row: 0 }, south: { col: 0, row: 1 }, southwest: { col: -1, row: 0 }, northwest: { col: -1, row: -1 } },
  odd: { north: { col: 0, row: -1 }, northeast: { col: 1, row: 0 }, southeast: { col: 1, row: 1 }, south: { col: 0, row: 1 }, southwest: { col: -1, row: 1 }, northwest: { col: -1, row: 0 } }
};

const oddRowDirections: Record<'even' | 'odd', Record<OddRowDirection, BoardCoord>> = {
  even: { east: { col: 1, row: 0 }, northeast: { col: 1, row: -1 }, northwest: { col: 0, row: -1 }, west: { col: -1, row: 0 }, southwest: { col: 0, row: 1 }, southeast: { col: 1, row: 1 } },
  odd: { east: { col: 1, row: 0 }, northeast: { col: 0, row: -1 }, northwest: { col: -1, row: -1 }, west: { col: -1, row: 0 }, southwest: { col: -1, row: 1 }, southeast: { col: 0, row: 1 } }
};

export const oddColumnHexDirections: OddColumnDirection[] = ['north', 'northeast', 'southeast', 'south', 'southwest', 'northwest'];
export const oddRowHexDirections: OddRowDirection[] = ['east', 'northeast', 'northwest', 'west', 'southwest', 'southeast'];
export const hexDirections = oddRowHexDirections;

export function neighborCoord(coord: BoardCoord, direction: HexDirection, coordinateSystem: BoardMap['coordinateSystem'] = 'odd-row'): BoardCoord {
  const parity = (coordinateSystem === 'odd-row' ? parityOf(coord.row) : parityOf(coord.col)) === 0 ? 'even' : 'odd';
  const table = coordinateSystem === 'odd-row' ? oddRowDirections[parity] : oddColumnDirections[parity];
  const delta = table[direction as keyof typeof table];
  if (!delta) {
    throw new Error(`Direction ${direction} is invalid for ${coordinateSystem}`);
  }
  return { col: coord.col + delta.col, row: coord.row + delta.row };
}

export function neighborCoords(coord: BoardCoord, coordinateSystem: BoardMap['coordinateSystem'] = 'odd-row'): BoardCoord[] {
  const directions = coordinateSystem === 'odd-row' ? oddRowHexDirections : oddColumnHexDirections;
  return directions.map((direction) => neighborCoord(coord, direction, coordinateSystem));
}

export function mapNeighbors(map: BoardMap, coord: BoardCoord, options: { includeBlocked?: boolean } = {}): BoardCoord[] {
  const hexes = new Set(map.hexes.map(coordKey));
  const blocked = new Set(map.blocked.map(coordKey));
  return neighborCoords(coord, map.coordinateSystem).filter((neighbor) => {
    const key = coordKey(neighbor);
    return hexes.has(key) && (options.includeBlocked === true || !blocked.has(key));
  });
}

export function hexDistance(from: BoardCoord, to: BoardCoord, coordinateSystem: BoardMap['coordinateSystem'] = 'odd-row'): number {
  const fromCube = coordinateSystem === 'odd-row' ? oddRowToCube(from) : oddColumnToCube(from);
  const toCube = coordinateSystem === 'odd-row' ? oddRowToCube(to) : oddColumnToCube(to);
  return Math.max(Math.abs(fromCube.x - toCube.x), Math.abs(fromCube.y - toCube.y), Math.abs(fromCube.z - toCube.z));
}

export function mapDistance(map: BoardMap, from: BoardCoord, to: BoardCoord, options: { includeBlocked?: boolean } = {}): number | null {
  const startKey = coordKey(from);
  const targetKey = coordKey(to);
  const hexes = new Set(map.hexes.map(coordKey));
  const blocked = new Set(map.blocked.map(coordKey));
  if (!hexes.has(startKey) || !hexes.has(targetKey) || (options.includeBlocked !== true && (blocked.has(startKey) || blocked.has(targetKey)))) {
    return null;
  }
  const queue: Array<{ coord: BoardCoord; distance: number }> = [{ coord: from, distance: 0 }];
  const seen = new Set([startKey]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    if (coordKey(current.coord) === targetKey) return current.distance;
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

export function lineOfSight(map: BoardMap, from: BoardCoord, to: BoardCoord): boolean {
  const fromPoint = hexCenter(from, map.coordinateSystem);
  const toPoint = hexCenter(to, map.coordinateSystem);
  const endpointKeys = new Set([coordKey(from), coordKey(to)]);
  return !map.blocked.some((wall) => !endpointKeys.has(coordKey(wall)) && segmentEntersOpenHex(fromPoint, toPoint, hexCenter(wall, map.coordinateSystem), map.orientation));
}

function hexCenter(coord: BoardCoord, coordinateSystem: BoardMap['coordinateSystem']): Point {
  if (coordinateSystem === 'odd-row') {
    return { x: Math.sqrt(3) * (coord.col + 0.5 * (1 - parityOf(coord.row))), y: 1.5 * coord.row };
  }
  return { x: 1.5 * coord.col, y: Math.sqrt(3) * (coord.row + 0.5 * parityOf(coord.col)) };
}

interface Point { x: number; y: number }

function segmentEntersOpenHex(from: Point, to: Point, center: Point, orientation: BoardMap['orientation']): boolean {
  const vertices = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * ((orientation === 'pointy' ? -30 : 0) + 60 * index);
    return { x: center.x + Math.cos(angle), y: center.y + Math.sin(angle) };
  });
  let lower = 0;
  let upper = 1;
  const epsilon = 1e-10;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    if (!a || !b) continue;
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    const startCross = edgeX * (from.y - a.y) - edgeY * (from.x - a.x);
    const deltaCross = edgeX * (to.y - from.y) - edgeY * (to.x - from.x);
    if (Math.abs(deltaCross) < epsilon) {
      if (startCross <= epsilon) return false;
      continue;
    }
    const boundary = -startCross / deltaCross;
    if (deltaCross > 0) lower = Math.max(lower, boundary);
    else upper = Math.min(upper, boundary);
  }
  return lower + epsilon < upper && upper > epsilon && lower < 1 - epsilon;
}

function oddColumnToCube(coord: BoardCoord): { x: number; y: number; z: number } {
  const x = coord.col;
  const z = coord.row - (coord.col - parityOf(coord.col)) / 2;
  return { x, y: -x - z, z };
}

function oddRowToCube(coord: BoardCoord): { x: number; y: number; z: number } {
  const x = coord.col - ((coord.row + parityOf(coord.row)) >> 1);
  const z = coord.row;
  return { x, y: -x - z, z };
}

function parityOf(value: number): 0 | 1 {
  return Math.abs(value) % 2 === 0 ? 0 : 1;
}
