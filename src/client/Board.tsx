import { allBoardCoordinates, key } from '../game/hex';
import type { Coordinate, PieceId } from '../game/types';
import type { SafeGameView } from '../shared/api';

interface BoardProps {
  game: SafeGameView;
  actorIds: Set<PieceId>;
  targetIds: Set<PieceId>;
  destinations: Set<string>;
  replacementBlockIds: Set<string>;
  selectedPieceId: PieceId | null;
  onPieceClick: (pieceId: PieceId) => void;
  onHexClick: (coordinate: Coordinate) => void;
  onBlockClick: (blockId: string) => void;
}

const SIZE = 49;
const CENTER = { x: 320, y: 290 };
const BOARD_COORDINATES = allBoardCoordinates();

function center(coordinate: Coordinate): { x: number; y: number } {
  return {
    x: CENTER.x + SIZE * Math.sqrt(3) * (coordinate.q + coordinate.r / 2),
    y: CENTER.y + SIZE * 1.5 * coordinate.r
  };
}

function polygonPoints(coordinate: Coordinate): string {
  const point = center(coordinate);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);
    return `${point.x + SIZE * Math.cos(angle)},${point.y + SIZE * Math.sin(angle)}`;
  }).join(' ');
}

export function Board({
  game, actorIds, targetIds, destinations, replacementBlockIds, selectedPieceId,
  onPieceClick, onHexClick, onBlockClick
}: BoardProps) {
  return (
    <svg className="board" viewBox="0 0 640 580" role="img" aria-label="37 hex game board">
      <g className="hexes">
        {BOARD_COORDINATES.map((coordinate) => {
          const destination = destinations.has(key(coordinate));
          return (
            <polygon
              key={key(coordinate)}
              points={polygonPoints(coordinate)}
              className={destination ? 'hex hex--legal' : 'hex'}
              onClick={destination ? () => onHexClick(coordinate) : undefined}
              role={destination ? 'button' : undefined}
              data-hex={key(coordinate)}
              aria-label={`Hex ${key(coordinate)}${destination ? ', legal destination' : ''}`}
            />
          );
        })}
      </g>
      {game.blocks.map((block) => {
        const point = center(block.position);
        return (
          <g
            key={block.id}
            transform={`translate(${point.x} ${point.y})`}
            className={`block block--${block.ownerId}${replacementBlockIds.has(block.id) ? ' block--legal' : ''}`}
            role={replacementBlockIds.has(block.id) ? 'button' : undefined}
            aria-label={`Block at ${key(block.position)}${replacementBlockIds.has(block.id) ? ', legal replacement' : ''}`}
            data-block-id={block.id}
            data-position={key(block.position)}
            data-owner-id={block.ownerId}
            onClick={replacementBlockIds.has(block.id) ? () => onBlockClick(block.id) : undefined}
          >
            <rect x="-22" y="-22" width="44" height="44" rx="8" />
            <text y="6">▦</text>
          </g>
        );
      })}
      {Object.values(game.pieces).map((piece) => {
        if (!piece.position) return null;
        const point = center(piece.position);
        const legalActor = actorIds.has(piece.id);
        const legalTarget = targetIds.has(piece.id);
        const selected = selectedPieceId === piece.id;
        const selectable = legalActor || legalTarget;
        const side = piece.ownerId === game.humanPlayerId ? 'Your' : 'AI';
        const letter = piece.id.endsWith('a') ? 'A' : 'B';
        const role = legalActor ? 'legal actor' : legalTarget ? 'legal target' : '';
        return (
          <g
            key={piece.id}
            transform={`translate(${point.x} ${point.y})`}
            className={`piece piece--${piece.ownerId}${legalActor ? ' piece--actor' : ''}${legalTarget ? ' piece--target' : ''}${selected ? ' piece--selected' : ''}`}
            onClick={selectable ? () => onPieceClick(piece.id) : undefined}
            role={selectable ? 'button' : undefined}
            aria-label={`${side} piece ${letter}${role ? `, ${role}` : ''}`}
            data-piece-id={piece.id}
            data-position={key(piece.position)}
            data-owner-id={piece.ownerId}
            data-braced={String(piece.braced)}
            data-pinned={String(piece.pinned)}
            data-baseline-moves={piece.baselineMoves}
          >
            <circle r="30" />
            <text className="piece__name" y="6">{piece.id.endsWith('a') ? 'A' : 'B'}</text>
            {piece.braced && <text className="piece__status" x="24" y="-20">◆</text>}
            {piece.pinned && <text className="piece__status" x="24" y="27">×</text>}
            {piece.ownerId === game.humanPlayerId && (
              <text className="piece__move" x="-27" y="-23">{piece.baselineMoves ? '●' : '○'}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
