import type { BoardCoord, BoardMap } from '../../src/board/schema';

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

type RenderMap = Pick<BoardMap, 'orientation' | 'coordinateSystem'>;

export function hexToPixel(coord: BoardCoord, size: number, map: RenderMap): Point {
  if (map.orientation === 'flat') {
    if (map.coordinateSystem !== 'odd-column') {
      throw new Error(`Unsupported coordinate system: ${map.coordinateSystem}`);
    }
    return {
      x: size * 1.5 * coord.col,
      y: size * Math.sqrt(3) * (coord.row + (Math.abs(coord.col) % 2) * 0.5)
    };
  }
  return {
    x: size * Math.sqrt(3) * (coord.col + coord.row / 2),
    y: size * 1.5 * coord.row
  };
}

export function hexPoints(center: Point, size: number, orientation: BoardMap['orientation']): string {
  const startAngle = orientation === 'flat' ? 0 : -30;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (startAngle + 60 * index);
    return `${center.x + size * Math.cos(angle)},${center.y + size * Math.sin(angle)}`;
  }).join(' ');
}

export function buildLayout(hexes: BoardCoord[], map: RenderMap, size = 42): Layout {
  const margin = size * 1.3;
  const points = hexes.map((coord) => hexToPixel(coord, size, map));
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
