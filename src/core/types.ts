export type PlayerId = string;
export type CardId = string;
export type Zone = 'draw' | 'hand' | 'discard' | 'play' | 'trash';
export type Phase = 'action' | 'buy' | 'cleanup';

export type CardType = 'action' | 'treasure' | 'victory';

export type Effect =
  | GrantEffect
  | DiscardEffect
  | TrashEffect
  | LookaheadEffect
  | VpCounterEffect;

export interface GrantEffect {
  kind: 'grant';
  target?: 'self';
  cards?: number;
  actions?: number;
  buys?: number;
  money?: number;
  attributes?: Record<string, number>;
}

export interface DiscardEffect {
  kind: 'discard';
  target?: 'self';
  count: number;
  optional?: boolean;
}

export interface TrashEffect {
  kind: 'trash';
  target?: 'self';
  count: number;
  optional?: boolean;
}

export interface LookaheadEffect {
  kind: 'lookahead';
  target?: 'self';
  count: number;
  choices: Array<'draw' | 'discard' | 'trash' | 'top'>;
  optional?: boolean;
}

export interface VpCounterEffect {
  kind: 'vp';
  target?: 'self';
  points: number;
}

export interface CardDefinition {
  id: CardId;
  name: string;
  type: CardType;
  cost: number;
  effects?: Effect[];
  treasure?: number;
  victoryPoints?: number;
}

export type Metric = 'emptyPiles' | 'provincePileEmpty';
export type ComparableValue = number | boolean | string;

export type BoolExpr =
  | { and: BoolExpr[] }
  | { or: BoolExpr[] }
  | { eq: [Metric, ComparableValue] }
  | { gte: [Metric, number] };

export interface GameConfig {
  players: number;
  setup: {
    initialActions: number;
    initialBuys: number;
    initialMoney: number;
    handSize: number;
    startingDeck: CardId[];
    attributes: Record<string, number>;
  };
  cards: CardDefinition[];
  supply: Array<{ card: CardId; count: number }>;
  endGame: BoolExpr;
}

export interface PlayerState {
  id: PlayerId;
  draw: CardId[];
  hand: CardId[];
  discard: CardId[];
  play: CardId[];
  actions: number;
  buys: number;
  money: number;
  attributes: Record<string, number>;
  vpCounters: number;
  turnsTaken: number;
}

export interface PendingEffect {
  player: number;
  effects: Effect[];
  effectIndex: number;
  kind: 'discard' | 'trash' | 'lookahead';
  remaining: number;
  optional: boolean;
  exposed?: CardId[];
  choices?: Array<'draw' | 'discard' | 'trash' | 'top'>;
}

export interface GameState {
  config: GameConfig;
  cards: Record<CardId, CardDefinition>;
  players: PlayerState[];
  activePlayer: number;
  phase: Phase;
  supply: Record<CardId, number>;
  trash: CardId[];
  pending?: PendingEffect;
  ended: boolean;
}

export type PendingChoice =
  | { choice: 'skip' }
  | { choice: 'select'; handIndex: number }
  | { choice: 'lookahead'; exposedIndex: number; destination: 'draw' | 'discard' | 'trash' | 'top' };

export type ChosenAction =
  | { type: 'playAction'; handIndex: number }
  | { type: 'moveToBuy' }
  | { type: 'buyCard'; cardId: CardId }
  | { type: 'endTurn' }
  | ({ type: 'resolvePending' } & PendingChoice);

export interface LegalAction {
  action: ChosenAction;
  description: string;
}
