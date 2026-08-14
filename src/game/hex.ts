import type { Coordinate } from './types';

export const BOARD_RADIUS = 3;

export const DIRECTIONS: readonly Coordinate[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export function add(left: Coordinate, right: Coordinate): Coordinate {
  return { q: left.q + right.q, r: left.r + right.r };
}

export function subtract(left: Coordinate, right: Coordinate): Coordinate {
  return { q: left.q - right.q, r: left.r - right.r };
}

export function scale(coordinate: Coordinate, amount: number): Coordinate {
  return { q: coordinate.q * amount, r: coordinate.r * amount };
}

export function equal(left: Coordinate, right: Coordinate): boolean {
  return left.q === right.q && left.r === right.r;
}

export function key(coordinate: Coordinate): string {
  return `${coordinate.q},${coordinate.r}`;
}

export function distance(left: Coordinate, right: Coordinate): number {
  const delta = subtract(left, right);
  return (Math.abs(delta.q) + Math.abs(delta.r) + Math.abs(delta.q + delta.r)) / 2;
}

export function onBoard(coordinate: Coordinate): boolean {
  return distance({ q: 0, r: 0 }, coordinate) <= BOARD_RADIUS;
}

export function allBoardCoordinates(): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q += 1) {
    const rMinimum = Math.max(-BOARD_RADIUS, -q - BOARD_RADIUS);
    const rMaximum = Math.min(BOARD_RADIUS, -q + BOARD_RADIUS);
    for (let r = rMinimum; r <= rMaximum; r += 1) coordinates.push({ q, r });
  }
  return coordinates;
}

export function directionFromTo(from: Coordinate, to: Coordinate): Coordinate | null {
  const delta = subtract(to, from);
  return DIRECTIONS.find((direction) => equal(direction, delta)) ?? null;
}

export function lineDirection(from: Coordinate, to: Coordinate, requiredDistance: number): Coordinate | null {
  return DIRECTIONS.find((direction) => equal(add(from, scale(direction, requiredDistance)), to)) ?? null;
}

export function rotate60(direction: Coordinate, clockwise: boolean): Coordinate {
  const index = DIRECTIONS.findIndex((candidate) => equal(candidate, direction));
  if (index < 0) throw new Error('Only unit directions can rotate.');
  const offset = clockwise ? 1 : DIRECTIONS.length - 1;
  return DIRECTIONS[(index + offset) % DIRECTIONS.length] as Coordinate;
}
