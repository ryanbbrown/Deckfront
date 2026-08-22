export type PlayerId = 'ochre' | 'indigo';
export type CardType = 'action' | 'treasure';
export type CardFamily = 'treasure' | 'ranged' | 'mana' | 'melee' | 'engine';
export type CardMechanic =
  | 'money' | 'footwork' | 'cull' | 'muster' | 'feint' | 'drive' | 'flurry' | 'aim' | 'volley'
  | 'stipend' | 'reclaim' | 'adapt' | 'melee' | 'ranged' | 'repellingShot' | 'spell' | 'channel'
  | 'leyStep' | 'prism' | 'step' | 'attune' | 'discharge' | 'cascade' | 'overload'
  | 'openingStrike' | 'rally' | 'bullRush' | 'longshot' | 'salvageShot' | 'precisionShot'
  | 'regroup' | 'discipline' | 'sharpen' | 'reforge' | 'scour' | 'improvise' | 'scrap';
export type Phase = 'startingBuild' | 'action' | 'buy' | 'ended';
export type RangeBand = 'Close' | 'Near' | 'Far';
export type DirectionChoice = 'left' | 'right';
export type MovementChoice = DirectionChoice | 'stay';
export type CardValues = Readonly<Record<string, number>>;

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  family: CardFamily;
  cost: number;
  text: string;
  mechanic: CardMechanic;
  money?: number | undefined;
  values?: CardValues | undefined;
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
  mana: number;
  positionChanged: boolean;
  firstBuyMoney: number;
  firstBuyPending: boolean;
  startingBuild: string[] | null;
  purchases: string[];
}
export interface FighterState {
  playerId: PlayerId;
  position: number;
  health: number;
  aimed: boolean;
  exposed: boolean;
}
export interface TurnState {
  cardsPlayed: string[];
  spacesMoved: number;
  manaSpent: number;
  spellsPlayed: number;
  copiesPlayed: Record<string, number>;
  familiesPlayed: CardFamily[];
}
export type PendingChoice =
  | { type: 'discard'; playerId: PlayerId; remaining: number }
  | { type: 'recover'; playerId: PlayerId; remaining: number }
  | { type: 'optionalTrash'; playerId: PlayerId; sourceCardInstanceId: string }
  | { type: 'gain'; playerId: PlayerId; maxCost: number };
export type PendingChoiceType = PendingChoice['type'];

export const GAME_EVENT_TYPES = [
  'buildComplete', 'cardPlayed', 'move', 'draw', 'condition', 'damage', 'wallCollision', 'trash',
  'phase', 'purchase', 'turn', 'victory', 'mana', 'discard', 'recover', 'gain'
] as const;
export type GameEventType = (typeof GAME_EVENT_TYPES)[number];
export interface GameEvent {
  sequence: number;
  type: GameEventType;
  playerId: PlayerId;
  detail: Record<string, unknown>;
}
export interface GameState {
  schemaVersion: 9;
  seed: number;
  rngState: number;
  version: number;
  nextCardSerial: number;
  kingdomId: string;
  startingHealth: number;
  startingDraftEnabled: boolean;
  activePlayerId: PlayerId;
  selectedFirstPlayerId: PlayerId;
  phase: Phase;
  turn: number;
  winner: PlayerId | null;
  players: Record<PlayerId, PlayerState>;
  fighters: Record<PlayerId, FighterState>;
  supply: Record<string, number>;
  trash: CardInstance[];
  turnState: TurnState;
  pendingChoice: PendingChoice | null;
  events: GameEvent[];
}
export type GameCommand =
  | { type: 'submitStartingBuild'; playerId: PlayerId; definitionIds: string[] }
  | { type: 'playFootwork'; cardInstanceId: string; movement: MovementChoice }
  | { type: 'playMuster'; cardInstanceId: string }
  | { type: 'playFeint'; cardInstanceId: string }
  | { type: 'playDrive'; cardInstanceId: string; direction: DirectionChoice }
  | { type: 'playFlurry'; cardInstanceId: string }
  | { type: 'playAim'; cardInstanceId: string }
  | { type: 'playVolley'; cardInstanceId: string }
  | { type: 'playAction'; cardInstanceId: string }
  | { type: 'playMoveAction'; cardInstanceId: string; direction: DirectionChoice }
  | { type: 'playTargetedAction'; cardInstanceId: string; targetCardInstanceIds: string[] }
  | { type: 'resolveDiscard'; discardInstanceId: string }
  | { type: 'resolveRecover'; recoverInstanceId: string }
  | { type: 'resolveOptionalTrash'; trashInstanceId: string | null }
  | { type: 'resolveGain'; definitionId: string }
  | { type: 'endActionPhase' }
  | { type: 'buyCard'; definitionId: string }
  | { type: 'endBuyPhase' };
export type PlayCardCommand = Extract<GameCommand, { cardInstanceId: string }>;
export interface LegalAction {
  id: string;
  label: string;
  command: GameCommand;
}
export type DisabledReasonCode =
  | 'NOT_YOUR_TURN' | 'WRONG_PHASE' | 'TREASURE_AUTOPLAYS' | 'NEEDS_CLOSE' | 'NEEDS_NEAR_OR_FAR'
  | 'NEEDS_MANA' | 'NEEDS_TARGET' | 'RESOLVE_CHOICE_FIRST';
export interface ActionAvailability {
  cardInstanceId: string;
  enabled: boolean;
  reasonCode: DisabledReasonCode | null;
  reason: string | null;
  selection: 'none' | 'movement' | 'direction' | 'targets' | PendingChoiceType;
  eligibleCardInstanceIds: string[];
  movements: MovementChoice[];
  minimumTargets: number;
  maximumTargets: number;
}
export interface CardOverride {
  cost?: number | undefined;
  money?: number | undefined;
  values?: CardValues | undefined;
}
export interface KingdomPile {
  cardId: string;
  count: number;
}
export interface Kingdom {
  id: string;
  name: string;
  startingHealth: number;
  actionPiles: KingdomPile[];
  overrides?: Record<string, CardOverride> | undefined;
}
