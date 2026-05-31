import type { BoardMap, HexCoord } from '../../src/board/schema';

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  size: number;
  margin: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function hexToPixel(coord: HexCoord, size: number, orientation: BoardMap['orientation']): Point {
  if (orientation === 'flat') {
    return {
      x: size * 1.5 * coord.q,
      y: size * Math.sqrt(3) * (coord.r + (Math.abs(coord.q) % 2) * 0.5)
    };
  }
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r
  };
}

export function hexPoints(center: Point, size: number, orientation: BoardMap['orientation']): string {
  const startAngle = orientation === 'flat' ? 0 : -30;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (startAngle + 60 * index);
    return `${center.x + size * Math.cos(angle)},${center.y + size * Math.sin(angle)}`;
  }).join(' ');
}

export function buildLayout(hexes: HexCoord[], orientation: BoardMap['orientation'], size = 42): Layout {
  const margin = size * 1.3;
  const points = hexes.map((coord) => hexToPixel(coord, size, orientation));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    size,
    margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
    offsetX: margin - minX,
    offsetY: margin - minY
  };
}
