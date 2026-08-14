import { useMemo } from 'react';
import { allBoardCoordinates, key } from '../game/hex';
import type { Coordinate, LegalAction, PieceId } from '../game/types';
import type { SafeGameView } from '../shared/api';
import { commandDestination, commandPieceIds } from './actionPresentation';

interface BoardProps {
  game: SafeGameView;
  candidateActions: LegalAction[];
  selectedPieceId: PieceId | null;
  onPieceClick: (pieceId: PieceId) => void;
  onHexClick: (coordinate: Coordinate) => void;
}

const SIZE = 49;
const CENTER = { x: 300, y: 250 };

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
  game, candidateActions, selectedPieceId, onPieceClick, onHexClick
}: BoardProps) {
  const destinations = useMemo(() => new Set(candidateActions.flatMap((action) => {
    const destination = commandDestination(action.command);
    return destination ? [key(destination)] : [];
  })), [candidateActions]);
  const referencedPieces = useMemo(() => new Set(candidateActions.flatMap(
    (action) => commandPieceIds(action.command)
  )), [candidateActions]);

  return (
    <svg className="board" viewBox="0 0 600 500" role="img" aria-label="19 hex game board">
      <g className="hexes">
        {allBoardCoordinates().map((coordinate) => {
          const destination = destinations.has(key(coordinate));
          return (
            <polygon
              key={key(coordinate)}
              points={polygonPoints(coordinate)}
              className={destination ? 'hex hex--legal' : 'hex'}
              onClick={destination ? () => onHexClick(coordinate) : undefined}
              aria-label={`Hex ${key(coordinate)}${destination ? ', legal destination' : ''}`}
            />
          );
        })}
      </g>
      {game.blocks.map((block) => {
        const point = center(block.position);
        return (
          <g key={block.id} transform={`translate(${point.x} ${point.y})`} className={`block block--${block.ownerId}`}>
            <rect x="-22" y="-22" width="44" height="44" rx="8" />
            <text y="6">▦</text>
          </g>
        );
      })}
      {Object.values(game.pieces).map((piece) => {
        if (!piece.position) return null;
        const point = center(piece.position);
        const legalPiece = referencedPieces.has(piece.id);
        const selected = selectedPieceId === piece.id;
        const selectable = legalPiece || (
          game.activePlayerId === game.humanPlayerId
          && piece.ownerId === game.humanPlayerId
          && piece.baselineMoves > 0
        );
        return (
          <g
            key={piece.id}
            transform={`translate(${point.x} ${point.y})`}
            className={`piece piece--${piece.ownerId}${legalPiece ? ' piece--legal' : ''}${selected ? ' piece--selected' : ''}`}
            onClick={selectable ? () => onPieceClick(piece.id) : undefined}
            role={selectable ? 'button' : undefined}
            aria-label={`${piece.id}${legalPiece ? ', legal choice' : ''}`}
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
