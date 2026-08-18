import { CARDS, cardDefinition } from './config';
import type {
  CardInstance, CardMechanic, CardValues, DirectionChoice, DisabledReasonCode, GameCommand,
  GameEventType, GameState, MovementChoice, PendingChoiceType, PlayerId, RangeBand
} from './types';

export const ARENA_MIN = 1;
export const ARENA_MAX = 5;

export function rangeBand(state: GameState): RangeBand {
  const difference = Math.abs(state.fighters.ochre.position - state.fighters.indigo.position);
  return difference === 0 ? 'Close' : difference === 1 ? 'Near' : 'Far';
}
export function movementChoices(state: GameState, playerId: PlayerId): MovementChoice[] {
  const position = state.fighters[playerId].position;
  const result: MovementChoice[] = [];
  if (position > ARENA_MIN) result.push('left');
  result.push('stay');
  if (position < ARENA_MAX) result.push('right');
  return result;
}
export function directionChoices(state: GameState, playerId: PlayerId): MovementChoice[] {
  return movementChoices(state, playerId).filter((movement) => movement !== 'stay');
}
export interface Choice {
  movement?: MovementChoice | undefined;
  direction?: DirectionChoice | undefined;
  trashInstanceIds?: readonly string[] | undefined;
}
export interface EffectContext {
  state: GameState;
  actorId: PlayerId;
  targetId: PlayerId;
  card: CardInstance;
  previousActions: readonly string[];
  draw(playerId: PlayerId, count: number): void;
  damage(targetId: PlayerId, amount: number, closeDamage: boolean): void;
  move(playerId: PlayerId, position: number): void;
  trash(cardInstanceId: string): void;
  gainMana(amount: number): void;
  requestChoice(type: PendingChoiceType, remaining: number): void;
  record(type: GameEventType, detail: Record<string, unknown>): void;
}
export interface CardEffect {
  tactical: boolean;
  choice: 'none' | 'movement' | 'direction' | 'trashOneOrTwo';
  movePrefix: string;
  movements(state: GameState, playerId: PlayerId): MovementChoice[];
  command(cardInstanceId: string, choice: Choice): GameCommand;
  gate(state: GameState, playerId: PlayerId, values: CardValues): DisabledReasonCode | null;
  resolve(context: EffectContext, values: CardValues, choice: Choice): void;
}
function value(values: CardValues, key: string): number { return values[key] ?? 0; }
function direction(choice: Choice): DirectionChoice {
  const chosen = choice.direction ?? (choice.movement === 'stay' ? undefined : choice.movement);
  if (!chosen) throw new Error('This card needs a direction.');
  return chosen;
}
function trashTuple(ids: readonly string[] | undefined): [string] | [string, string] {
  const [first, second] = ids ?? [];
  if (!first) throw new Error('Cull needs at least one target.');
  return second ? [first, second] : [first];
}
function needsClose(state: GameState): DisabledReasonCode | null { return rangeBand(state) === 'Close' ? null : 'NEEDS_CLOSE'; }
function needsNearOrFar(state: GameState): DisabledReasonCode | null { return rangeBand(state) === 'Close' ? 'NEEDS_NEAR_OR_FAR' : null; }
function playAction(cardInstanceId: string): GameCommand { return { type: 'playAction', cardInstanceId }; }
function stepAndGainMana(context: EffectContext, values: CardValues, choice: Choice): void {
  const chosen = direction(choice); const from = context.state.fighters[context.actorId].position;
  context.move(context.actorId, from + (chosen === 'left' ? -1 : 1));
  context.record('move', { movement: chosen, from, to: context.state.fighters[context.actorId].position });
  context.gainMana(value(values, 'mana'));
}
const NO_MOVEMENTS = (): MovementChoice[] => [];
const NO_GATE = (): DisabledReasonCode | null => null;
const BASE = { movePrefix: '', movements: NO_MOVEMENTS, gate: NO_GATE, choice: 'none' } as const;

export const EFFECTS: Readonly<Record<CardMechanic, CardEffect>> = Object.freeze({
  money: {
    ...BASE, tactical: false, command: playAction,
    gate: (): DisabledReasonCode => 'TREASURE_AUTOPLAYS',
    resolve: (): void => { throw new Error('Treasure cards play when you end the Action phase.'); }
  },
  footwork: {
    ...BASE, tactical: true, choice: 'movement', movements: movementChoices,
    command: (cardInstanceId, choice) => ({ type: 'playFootwork', cardInstanceId, movement: choice.movement ?? 'stay' }),
    resolve: (context, values, choice) => {
      const movement = choice.movement ?? 'stay'; const from = context.state.fighters[context.actorId].position;
      if (movement !== 'stay') context.move(context.actorId, from + (movement === 'left' ? -1 : 1));
      context.record('move', { movement, from, to: context.state.fighters[context.actorId].position });
      context.draw(context.actorId, value(values, 'draw'));
    }
  },
  cull: {
    ...BASE, tactical: false, choice: 'trashOneOrTwo',
    command: (cardInstanceId, choice) => ({ type: 'playCull', cardInstanceId, trashInstanceIds: trashTuple(choice.trashInstanceIds) }),
    resolve: (context, _values, choice) => { for (const id of choice.trashInstanceIds ?? []) context.trash(id); }
  },
  muster: {
    ...BASE, tactical: false,
    command: (cardInstanceId) => ({ type: 'playMuster', cardInstanceId }),
    resolve: (context, values) => context.draw(context.actorId, value(values, 'draw'))
  },
  feint: {
    ...BASE, tactical: true, gate: needsClose,
    command: (cardInstanceId) => ({ type: 'playFeint', cardInstanceId }),
    resolve: (context) => {
      context.state.fighters[context.targetId].exposed = true;
      context.record('condition', { condition: 'Exposed', change: 'set', targetId: context.targetId });
    }
  },
  drive: {
    ...BASE, tactical: true, choice: 'movement', movePrefix: 'Move Both ', gate: needsClose,
    movements: (): MovementChoice[] => ['left', 'right'],
    command: (cardInstanceId, choice) => ({ type: 'playDrive', cardInstanceId, direction: direction(choice) }),
    resolve: (context, values, choice) => {
      const chosen = direction(choice);
      context.damage(context.targetId, value(values, 'damage'), true);
      if (context.state.winner) return;
      const from = context.state.fighters[context.actorId].position;
      const destination = from + (chosen === 'left' ? -1 : 1);
      if (destination < ARENA_MIN || destination > ARENA_MAX) {
        context.record('wallCollision', { targetId: context.targetId, direction: chosen });
        context.damage(context.targetId, value(values, 'wallDamage'), false);
        return;
      }
      context.move(context.actorId, destination); context.move(context.targetId, destination);
      context.record('move', { movement: chosen, from, to: destination, fighters: [context.actorId, context.targetId], source: 'drive' });
    }
  },
  flurry: {
    ...BASE, tactical: true, gate: needsClose,
    command: (cardInstanceId) => ({ type: 'playFlurry', cardInstanceId }),
    resolve: (context, values) => {
      const tactical = context.previousActions.filter((definitionId) => EFFECTS[cardDefinition(definitionId).mechanic].tactical).length;
      context.damage(context.targetId, Math.min(value(values, 'max'), tactical * value(values, 'perAction')), true);
    }
  },
  aim: {
    ...BASE, tactical: true, gate: needsNearOrFar,
    command: (cardInstanceId) => ({ type: 'playAim', cardInstanceId }),
    resolve: (context, values) => {
      context.state.fighters[context.actorId].aimed = true;
      context.record('condition', { condition: 'Aimed', change: 'set', targetId: context.actorId });
      context.draw(context.actorId, value(values, 'draw'));
    }
  },
  volley: {
    ...BASE, tactical: true, gate: needsNearOrFar,
    command: (cardInstanceId) => ({ type: 'playVolley', cardInstanceId }),
    resolve: (context, values) => {
      const fighter = context.state.fighters[context.actorId]; const near = rangeBand(context.state) === 'Near';
      const amount = fighter.aimed ? value(values, near ? 'aimedNear' : 'aimedFar') : value(values, near ? 'near' : 'far');
      if (fighter.aimed) { fighter.aimed = false; context.record('condition', { condition: 'Aimed', change: 'consumed', targetId: context.actorId }); }
      context.damage(context.targetId, amount, false);
    }
  },
  stipend: {
    ...BASE, tactical: false, command: playAction,
    resolve: (context, values) => {
      context.draw(context.actorId, value(values, 'draw'));
      context.state.players[context.actorId].money += value(values, 'money');
    }
  },
  reclaim: {
    ...BASE, tactical: false, command: playAction,
    resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); context.requestChoice('recover', 1); }
  },
  adapt: {
    ...BASE, tactical: false, command: playAction,
    resolve: (context, values) => {
      context.draw(context.actorId, value(values, 'draw'));
      if (context.state.players[context.actorId].positionChanged) context.draw(context.actorId, value(values, 'movedDraw'));
    }
  },
  melee: {
    ...BASE, tactical: true, gate: needsClose, command: playAction,
    resolve: (context, values) => context.damage(context.targetId, value(values, 'damage'), true)
  },
  ranged: {
    ...BASE, tactical: true, gate: needsNearOrFar, command: playAction,
    resolve: (context, values) => {
      context.damage(context.targetId, value(values, 'damage'), false);
      if (!context.state.winner) context.draw(context.actorId, value(values, 'draw'));
    }
  },
  spell: {
    ...BASE, tactical: true, command: playAction,
    gate: (state, playerId, values) => state.players[playerId].mana < value(values, 'manaCost') ? 'NEEDS_MANA' : null,
    resolve: (context, values) => {
      context.gainMana(-value(values, 'manaCost'));
      context.damage(context.targetId, value(values, 'damage'), false);
    }
  },
  channel: {
    ...BASE, tactical: false, command: playAction,
    resolve: (context, values) => { context.gainMana(value(values, 'mana')); context.draw(context.actorId, value(values, 'draw')); }
  },
  leyStep: {
    ...BASE, tactical: true, choice: 'direction', movements: directionChoices,
    command: (cardInstanceId, choice) => ({ type: 'playMoveAction', cardInstanceId, direction: direction(choice) }),
    resolve: stepAndGainMana
  },
  prism: {
    ...BASE, tactical: false, command: playAction,
    resolve: (context, values) => {
      context.gainMana(value(values, 'mana'));
      context.draw(context.actorId, value(values, 'draw'));
      context.requestChoice('discard', value(values, 'discard'));
    }
  },
  step: {
    ...BASE, tactical: true, choice: 'direction', movements: directionChoices,
    command: (cardInstanceId, choice) => ({ type: 'playMoveAction', cardInstanceId, direction: direction(choice) }),
    resolve: stepAndGainMana
  }
});
export const TACTICAL_ACTIONS: ReadonlySet<string> = new Set(Object.values(CARDS).filter((card) => EFFECTS[card.mechanic].tactical).map((card) => card.id));
export function isTacticalAction(definitionId: string): boolean {
  return EFFECTS[cardDefinition(definitionId).mechanic].tactical;
}
