export type PlayerId = 'ochre' | 'indigo';
export type CardType = 'action' | 'treasure';
export type CardMechanic = 'money' | 'footwork' | 'cull' | 'muster' | 'feint' | 'drive' | 'flurry' | 'aim' | 'volley';
export type Phase = 'startingBuild' | 'action' | 'buy' | 'ended';
export type RangeBand = 'Close' | 'Near' | 'Far';
export type DirectionChoice = 'left' | 'right';
export type MovementChoice = DirectionChoice | 'stay';

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  text: string;
  mechanic: CardMechanic;
  money?: number | undefined;
}
export interface CardInstance { id: string; definitionId: string }
export interface DeckState { draw: CardInstance[]; hand: CardInstance[]; discard: CardInstance[]; play: CardInstance[] }
export interface PlayerState {
  id: PlayerId;
  deck: DeckState;
  money: number;
  firstBuyMoney: number;
  firstBuyPending: boolean;
  startingBuild: string[] | null;
  purchases: string[];
}
export interface FighterState { playerId: PlayerId; position: number; health: number; aimed: boolean; exposed: boolean }
export type GameEventType = 'buildComplete' | 'cardPlayed' | 'move' | 'draw' | 'condition' | 'damage' | 'wallCollision' | 'trash' | 'phase' | 'purchase' | 'turn' | 'victory';
export interface GameEvent { sequence: number; type: GameEventType; playerId: PlayerId; detail: Record<string, unknown> }
export interface GameState {
  schemaVersion: 7;
  seed: number;
  rngState: number;
  version: number;
  nextCardSerial: number;
  activePlayerId: PlayerId;
  selectedFirstPlayerId: PlayerId;
  phase: Phase;
  turn: number;
  winner: PlayerId | null;
  players: Record<PlayerId, PlayerState>;
  fighters: Record<PlayerId, FighterState>;
  supply: Record<string, number>;
  trash: CardInstance[];
  actionsThisTurn: string[];
  events: GameEvent[];
}
export type GameCommand =
  | { type: 'submitStartingBuild'; playerId: PlayerId; definitionIds: string[] }
  | { type: 'playFootwork'; cardInstanceId: string; movement: MovementChoice }
  | { type: 'playCull'; cardInstanceId: string; trashInstanceIds: [string] | [string, string] }
  | { type: 'playMuster'; cardInstanceId: string }
  | { type: 'playFeint'; cardInstanceId: string }
  | { type: 'playDrive'; cardInstanceId: string; direction: DirectionChoice }
  | { type: 'playFlurry'; cardInstanceId: string }
  | { type: 'playAim'; cardInstanceId: string }
  | { type: 'playVolley'; cardInstanceId: string }
  | { type: 'endActionPhase' }
  | { type: 'buyCard'; definitionId: string }
  | { type: 'endBuyPhase' };
export interface LegalAction { id: string; label: string; command: GameCommand }
export type DisabledReasonCode = 'NOT_YOUR_TURN' | 'WRONG_PHASE' | 'TREASURE_AUTOPLAYS' | 'NEEDS_CLOSE' | 'NEEDS_NEAR_OR_FAR';
export interface ActionAvailability {
  cardInstanceId: string;
  enabled: boolean;
  reasonCode: DisabledReasonCode | null;
  reason: string | null;
  selection: 'none' | 'movement' | 'trashOneOrTwo';
  eligibleCardInstanceIds: string[];
  movements: MovementChoice[];
}
