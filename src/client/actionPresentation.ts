import type { GameCommand, LegalAction, PieceId } from '../game/types';

export function commandCardId(command: GameCommand): string | null {
  return 'cardInstanceId' in command ? command.cardInstanceId : null;
}

export function commandDestination(command: GameCommand): { q: number; r: number } | null {
  return 'destination' in command ? command.destination : null;
}

export function commandPieceIds(command: GameCommand): PieceId[] {
  const ids: PieceId[] = [];
  if ('pieceId' in command) ids.push(command.pieceId);
  if ('actorId' in command) ids.push(command.actorId);
  if ('targetId' in command) ids.push(command.targetId);
  if ('jumpedPieceId' in command) ids.push(command.jumpedPieceId);
  return ids;
}

export function actionsForCard(actions: LegalAction[], cardInstanceId: string): LegalAction[] {
  return actions.filter((action) => commandCardId(action.command) === cardInstanceId);
}

export function baselineActionsForPiece(actions: LegalAction[], pieceId: PieceId): LegalAction[] {
  return actions.filter((action) =>
    action.command.type === 'baselineMove' && action.command.pieceId === pieceId
  );
}
