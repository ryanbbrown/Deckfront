export type PlayerId = 'ochre' | 'indigo';
export type PieceId = 'ochre-a' | 'ochre-b' | 'indigo-a' | 'indigo-b';
export type CardType = 'action' | 'treasure';
export type CardMechanic =
  | 'money'
  | 'shove'
  | 'dash'
  | 'brace'
  | 'cull'
  | 'drive'
  | 'breaker'
  | 'press'
  | 'pull'
  | 'vault'
  | 'sweep'
  | 'relay'
  | 'block'
  | 'pin'
  | 'corner';

export interface Coordinate {
  q: number;
  r: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  text: string;
  mechanic: CardMechanic;
  money?: number | undefined;
  tags: string[];
  synergy: string[];
}

export interface CardInstance {
  id: string;
  definitionId: string;
}

export interface DeckState {
  draw: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  play: CardInstance[];
}

export interface PlayerState {
  id: PlayerId;
  deck: DeckState;
  money: number;
  buys: number;
  turnsTaken: number;
}

export interface PinStatus {
  sourcePlayerId: PlayerId;
  clearAfterTurn: number;
}

export interface PieceState {
  id: PieceId;
  ownerId: PlayerId;
  position: Coordinate | null;
  needsRespawn: boolean;
  baselineMoves: number;
  braced: boolean;
  pinned: PinStatus | null;
}

export interface TemporaryBlock {
  id: string;
  ownerId: PlayerId;
  position: Coordinate;
  clearAfterTurn: number;
}

export type Phase = 'respawn' | 'action' | 'buy' | 'ended';

export interface TurnState {
  displacedPieceIds: PieceId[];
  pressSetupPieceIds: PieceId[];
  actionUses: Array<{ pieceId: PieceId; definitionId: string }>;
  relayUsed: boolean;
}

export type GameEventType =
  | 'baselineMove'
  | 'block'
  | 'brace'
  | 'braceCanceledDisplacement'
  | 'cardPlayed'
  | 'cull'
  | 'dash'
  | 'displacement'
  | 'endTurn'
  | 'enterBuyPhase'
  | 'follow'
  | 'pin'
  | 'purchase'
  | 'relay'
  | 'respawn'
  | 'ringOut'
  | 'vault';

export interface GameEvent {
  sequence: number;
  type: GameEventType;
  playerId: PlayerId;
  detail: Record<string, unknown>;
}

export interface GameState {
  schemaVersion: 1;
  seed: number;
  rngState: number;
  version: number;
  nextCardSerial: number;
  nextBlockSerial: number;
  activePlayerId: PlayerId;
  phase: Phase;
  scores: Record<PlayerId, number>;
  winner: PlayerId | null;
  players: Record<PlayerId, PlayerState>;
  pieces: Record<PieceId, PieceState>;
  blocks: TemporaryBlock[];
  supply: Record<string, number>;
  trash: CardInstance[];
  turn: TurnState;
  events: GameEvent[];
}

export type GameCommand =
  | { type: 'respawn'; pieceId: PieceId; destination: Coordinate }
  | { type: 'baselineMove'; pieceId: PieceId; destination: Coordinate }
  | { type: 'playShove'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'playDash'; cardInstanceId: string; pieceId: PieceId; destination: Coordinate }
  | { type: 'playBrace'; cardInstanceId: string; pieceId: PieceId }
  | { type: 'playCull'; cardInstanceId: string; trashInstanceId: string }
  | { type: 'playDrive'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'playBreaker'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'playPress'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'playPull'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'playVault'; cardInstanceId: string; pieceId: PieceId; jumpedPieceId: PieceId }
  | { type: 'playSweep'; cardInstanceId: string; actorId: PieceId; targetId: PieceId; destination: Coordinate }
  | { type: 'playRelay'; cardInstanceId: string }
  | { type: 'playBlock'; cardInstanceId: string; actorId: PieceId; destination: Coordinate; replaceBlockId?: string }
  | { type: 'playPin'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'playCorner'; cardInstanceId: string; actorId: PieceId; targetId: PieceId }
  | { type: 'enterBuyPhase' }
  | { type: 'buyCard'; definitionId: string }
  | { type: 'endTurn' };

export interface LegalAction {
  id: string;
  label: string;
  command: GameCommand;
}

export interface TurnPreview {
  baseState: GameState;
  commands: GameCommand[];
  state: GameState;
}

export interface SearchResult {
  points: number;
  actions: LegalAction[];
  exploredStates: number;
}
