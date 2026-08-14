import type { Coordinate, GameCommand, LegalAction, PieceId } from '../game/types';

export function commandCardId(command: GameCommand): string | null {
  return 'cardInstanceId' in command ? command.cardInstanceId : null;
}

export function commandDestination(command: GameCommand): Coordinate | null {
  return 'destination' in command ? command.destination : null;
}

export function commandActorId(command: GameCommand): PieceId | null {
  switch (command.type) {
    case 'baselineMove':
    case 'playDash':
    case 'playBrace':
    case 'playVault': return command.pieceId;
    case 'playShove':
    case 'playDrive':
    case 'playBreaker':
    case 'playPress':
    case 'playPull':
    case 'playSweep':
    case 'playBlock':
    case 'playPin':
    case 'playCorner': return command.actorId;
    default: return null;
  }
}

export function commandTargetId(command: GameCommand): PieceId | null {
  switch (command.type) {
    case 'playShove':
    case 'playDrive':
    case 'playBreaker':
    case 'playPress':
    case 'playPull':
    case 'playSweep':
    case 'playPin':
    case 'playCorner': return command.targetId;
    case 'playVault': return command.jumpedPieceId;
    default: return null;
  }
}

export function actionsForCard(actions: LegalAction[], cardInstanceId: string): LegalAction[] {
  return actions.filter((action) => commandCardId(action.command) === cardInstanceId);
}

export function baselineActionsForPiece(actions: LegalAction[], pieceId: PieceId): LegalAction[] {
  return actions.filter((action) =>
    action.command.type === 'baselineMove' && action.command.pieceId === pieceId
  );
}

export function uniqueActorIds(actions: LegalAction[]): PieceId[] {
  return [...new Set(actions.flatMap((action) => {
    const actor = commandActorId(action.command);
    return actor ? [actor] : [];
  }))];
}

export function uniqueTargetIds(actions: LegalAction[]): PieceId[] {
  return [...new Set(actions.flatMap((action) => {
    const target = commandTargetId(action.command);
    return target ? [target] : [];
  }))];
}
