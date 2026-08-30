import { CARDS, cardDefinition } from './config';
import { resolveCard } from './kingdom';
import type {
  CardFamily, CardInstance, CardMechanic, CardValues, DirectionChoice, DisabledReasonCode, GameCommand,
  GameEventType, GameState, MovementChoice, PlayerId, RangeBand
} from './types';

export const ARENA_MIN = 1;
export const ARENA_MAX = 6;
export function rangeBand(state: GameState): RangeBand {
  const difference = Math.abs(state.fighters.ochre.position - state.fighters.indigo.position);
  return difference === 0 ? 'Close' : difference === 1 ? 'Near' : 'Far';
}
export function movementChoices(state: GameState, playerId: PlayerId): MovementChoice[] {
  const position = state.fighters[playerId].position;
  return [...(position > ARENA_MIN ? ['left' as const] : []), 'stay', ...(position < ARENA_MAX ? ['right' as const] : [])];
}
export function directionChoices(state: GameState, playerId: PlayerId): MovementChoice[] {
  return movementChoices(state, playerId).filter((movement) => movement !== 'stay');
}
export interface Choice {
  movement?: MovementChoice | undefined; direction?: DirectionChoice | undefined;
  targetCardInstanceIds?: readonly string[] | undefined;
}
export interface EffectContext {
  state: GameState; actorId: PlayerId; targetId: PlayerId; card: CardInstance;
  targetCards: readonly CardInstance[];
  draw(playerId: PlayerId, count: number): void;
  damage(targetId: PlayerId, amount: number, closeDamage: boolean): void;
  rangedDamage(targetId: PlayerId, amount: number): void;
  move(playerId: PlayerId, position: number): void;
  trash(cardInstanceId: string): CardInstance;
  discard(cardInstanceId: string): CardInstance;
  gainMana(amount: number): void; spendMana(amount: number): void;
  requestDiscard(remaining: number): void; requestRecover(): void;
  requestOptionalTrash(): void; requestGain(maxCost: number): void;
  record(type: GameEventType, detail: Record<string, unknown>): void;
}
export interface TargetMetadata {
  minimum: number; maximum: number; zone: 'hand' | 'handOrSelf'; family?: CardFamily | undefined;
}
export interface CardEffect {
  tactical: boolean; choice: 'none' | 'movement' | 'direction' | 'targets'; target?: TargetMetadata | undefined;
  movePrefix: string; movements(state: GameState, playerId: PlayerId): MovementChoice[];
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
const NO_MOVEMENTS = (): MovementChoice[] => [];
const NO_GATE = (): DisabledReasonCode | null => null;
const BASE = { movePrefix: '', movements: NO_MOVEMENTS, gate: NO_GATE, choice: 'none' } as const;
const playAction = (cardInstanceId: string): GameCommand => ({ type: 'playAction', cardInstanceId });
const targeted = (cardInstanceId: string, choice: Choice): GameCommand => ({
  type: 'playTargetedAction', cardInstanceId, targetCardInstanceIds: [...(choice.targetCardInstanceIds ?? [])]
});
function needsClose(state: GameState): DisabledReasonCode | null { return rangeBand(state) === 'Close' ? null : 'NEEDS_CLOSE'; }
function needsRange(state: GameState): DisabledReasonCode | null { return rangeBand(state) === 'Close' ? 'NEEDS_NEAR_OR_FAR' : null; }
function moveActor(context: EffectContext, chosen: DirectionChoice): void {
  const from = context.state.fighters[context.actorId].position;
  context.move(context.actorId, from + (chosen === 'left' ? -1 : 1));
  context.record('move', { movement: chosen, from, to: context.state.fighters[context.actorId].position });
}
function closeAttack(context: EffectContext, amount: number): void { context.damage(context.targetId, amount, true); }
function rangedAttack(context: EffectContext, amount: number): void { context.rangedDamage(context.targetId, amount); }

export const ATTACK_MECHANICS: ReadonlySet<CardMechanic> = new Set([
  'melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush', 'ranged', 'repellingShot',
  'longshot', 'salvageShot', 'precisionShot', 'spell', 'discharge', 'cascade', 'overload',
  'discipline', 'improvise', 'scrap', 'volley'
]);
export function isAttackAction(definitionId: string): boolean {
  return ATTACK_MECHANICS.has(cardDefinition(definitionId).mechanic);
}

const EFFECT_MAP: Record<CardMechanic, CardEffect> = {
  money: { ...BASE, tactical: false, command: playAction, gate: () => 'TREASURE_AUTOPLAYS', resolve: () => { throw new Error('Treasure cards play automatically.'); } },
  footwork: { ...BASE, tactical: true, choice: 'movement', movements: movementChoices,
    command: (cardInstanceId, choice) => ({ type: 'playFootwork', cardInstanceId, movement: choice.movement ?? 'stay' }),
    resolve: (context, values, choice) => { const movement = choice.movement ?? 'stay'; const from = context.state.fighters[context.actorId].position; if (movement !== 'stay') context.move(context.actorId, from + (movement === 'left' ? -1 : 1)); context.record('move', { movement, from, to: context.state.fighters[context.actorId].position }); context.draw(context.actorId, value(values, 'draw')); } },
  cull: { ...BASE, tactical: false, choice: 'targets', target: { minimum: 1, maximum: 2, zone: 'handOrSelf' }, command: targeted,
    resolve: (context) => { for (const card of context.targetCards) context.trash(card.id); } },
  muster: { ...BASE, tactical: false, command: (cardInstanceId) => ({ type: 'playMuster', cardInstanceId }), resolve: (context, values) => context.draw(context.actorId, value(values, 'draw')) },
  feint: { ...BASE, tactical: true, gate: needsClose, command: (cardInstanceId) => ({ type: 'playFeint', cardInstanceId }),
    resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); context.state.fighters[context.targetId].exposed = true; context.record('condition', { condition: 'Exposed', change: 'set', targetId: context.targetId }); } },
  drive: { ...BASE, tactical: true, choice: 'movement', movePrefix: 'Move Both ', gate: needsClose, movements: () => ['left', 'right'],
    command: (cardInstanceId, choice) => ({ type: 'playDrive', cardInstanceId, direction: direction(choice) }),
    resolve: (context, values, choice) => { const chosen = direction(choice); closeAttack(context, value(values, 'damage')); if (context.state.winner) return; const from = context.state.fighters[context.actorId].position; const destination = from + (chosen === 'left' ? -1 : 1); if (destination < ARENA_MIN || destination > ARENA_MAX) { context.record('wallCollision', { targetId: context.targetId, direction: chosen }); context.damage(context.targetId, value(values, 'wallDamage'), false); return; } context.move(context.actorId, destination); context.move(context.targetId, destination); context.record('move', { movement: chosen, from, to: destination, fighters: [context.actorId, context.targetId], source: 'drive' }); } },
  flurry: { ...BASE, tactical: true, gate: needsClose, command: (cardInstanceId) => ({ type: 'playFlurry', cardInstanceId }),
    resolve: (context, values) => { const tactical = context.state.turnState.cardsPlayed.slice(0, -1).filter((id) => EFFECTS[cardDefinition(id).mechanic].tactical).length; closeAttack(context, tactical * value(values, 'perAction')); } },
  aim: { ...BASE, tactical: true, gate: needsRange, command: (cardInstanceId) => ({ type: 'playAim', cardInstanceId }),
    resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); context.state.fighters[context.actorId].aimed = true; context.record('condition', { condition: 'Aimed', change: 'set', targetId: context.actorId }); } },
  volley: { ...BASE, tactical: true, gate: needsRange, command: (cardInstanceId) => ({ type: 'playVolley', cardInstanceId }),
    resolve: (context, values) => rangedAttack(context, value(values, rangeBand(context.state) === 'Near' ? 'near' : 'far')) },
  stipend: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); context.state.players[context.actorId].money += value(values, 'money'); } },
  reclaim: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { if (context.state.players[context.actorId].deck.discard.length) context.requestRecover(); else context.draw(context.actorId, value(values, 'draw')); } },
  adapt: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); if (context.state.players[context.actorId].positionChanged) context.draw(context.actorId, value(values, 'movedDraw')); } },
  melee: { ...BASE, tactical: true, gate: needsClose, command: playAction, resolve: (context, values) => { closeAttack(context, value(values, 'damage')); if (!context.state.winner) context.draw(context.actorId, value(values, 'draw')); } },
  ranged: { ...BASE, tactical: true, gate: needsRange, command: playAction, resolve: (context, values) => { rangedAttack(context, value(values, 'damage')); if (!context.state.winner) context.draw(context.actorId, value(values, 'draw')); } },
  repellingShot: { ...BASE, tactical: true, gate: needsRange, command: playAction,
    resolve: (context, values) => { rangedAttack(context, value(values, rangeBand(context.state) === 'Near' ? 'near' : 'far')); if (context.state.winner) return; const actorPosition = context.state.fighters[context.actorId].position; const targetPosition = context.state.fighters[context.targetId].position; const targetStep = targetPosition > actorPosition ? 1 : -1; const targetDestination = targetPosition + targetStep; if (targetDestination >= ARENA_MIN && targetDestination <= ARENA_MAX) { context.move(context.targetId, targetDestination); context.record('move', { movement: targetStep === 1 ? 'right' : 'left', from: targetPosition, to: targetDestination, playerId: context.targetId, source: 'repellingShot' }); return; } const actorDestination = actorPosition - targetStep; if (actorDestination >= ARENA_MIN && actorDestination <= ARENA_MAX) { context.move(context.actorId, actorDestination); context.record('move', { movement: targetStep === 1 ? 'left' : 'right', from: actorPosition, to: actorDestination, playerId: context.actorId, source: 'repellingShot' }); } } },
  spell: { ...BASE, tactical: true, command: playAction, gate: (state, playerId, values) => state.players[playerId].mana < value(values, 'manaCost') ? 'NEEDS_MANA' : null,
    resolve: (context, values) => { context.spendMana(value(values, 'manaCost')); context.damage(context.targetId, value(values, 'damage'), false); } },
  channel: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { context.gainMana(value(values, 'mana')); context.draw(context.actorId, value(values, 'draw')); } },
  leyStep: { ...BASE, tactical: true, choice: 'direction', movements: directionChoices, command: (cardInstanceId, choice) => ({ type: 'playMoveAction', cardInstanceId, direction: direction(choice) }), resolve: (context, values, choice) => { moveActor(context, direction(choice)); context.gainMana(value(values, 'mana') + (rangeBand(context.state) === 'Far' ? value(values, 'farMana') : 0)); } },
  prism: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { context.gainMana(value(values, 'mana')); context.draw(context.actorId, value(values, 'draw')); context.requestDiscard(value(values, 'discard')); } },
  step: { ...BASE, tactical: true, choice: 'direction', movements: directionChoices, command: (cardInstanceId, choice) => ({ type: 'playMoveAction', cardInstanceId, direction: direction(choice) }), resolve: (context, _values, choice) => moveActor(context, direction(choice)) },
  attune: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { const copies = context.state.turnState.copiesPlayed.attune ?? 1; context.gainMana(value(values, 'mana') + (copies - 1) * value(values, 'perCopy')); context.draw(context.actorId, value(values, 'draw')); } },
  discharge: { ...BASE, tactical: true, command: playAction, resolve: (context, values) => { const mana = context.state.players[context.actorId].mana; context.damage(context.targetId, mana * value(values, 'perMana'), false); context.gainMana(-mana); } },
  cascade: { ...BASE, tactical: true, command: playAction, gate: (state, playerId, values) => state.players[playerId].mana < value(values, 'manaCost') ? 'NEEDS_MANA' : null, resolve: (context, values) => { context.spendMana(value(values, 'manaCost')); context.damage(context.targetId, value(values, 'damage') + (context.state.turnState.spellsPlayed - 1) * value(values, 'perSpell'), false); } },
  overload: { ...BASE, tactical: true, command: playAction, resolve: (context, values) => context.damage(context.targetId, context.state.turnState.manaSpent * value(values, 'perManaSpent'), false) },
  openingStrike: { ...BASE, tactical: true, gate: needsClose, command: playAction, resolve: (context, values) => closeAttack(context, value(values,
    context.state.turnState.cardsPlayed.slice(0, -1).some(isAttackAction) ? 'later' : 'first')) },
  rally: { ...BASE, tactical: true, gate: needsClose, command: playAction, resolve: (context, values) => closeAttack(context, value(values, 'damage') + ((context.state.turnState.copiesPlayed.rally ?? 1) - 1) * value(values, 'perCopy')) },
  bullRush: { ...BASE, tactical: true, choice: 'targets', target: { minimum: 1, maximum: 1, zone: 'hand', family: 'melee' }, gate: needsClose, command: targeted, resolve: (context, values) => { context.discard(context.targetCards[0]!.id); closeAttack(context, value(values, 'damage')); } },
  longshot: { ...BASE, tactical: true, gate: needsRange, command: playAction, resolve: (context) => rangedAttack(context, Math.abs(context.state.fighters[context.actorId].position - context.state.fighters[context.targetId].position)) },
  salvageShot: { ...BASE, tactical: true, choice: 'targets', target: { minimum: 1, maximum: 1, zone: 'hand', family: 'ranged' }, gate: needsRange, command: targeted, resolve: (context, values) => { const target = context.targetCards[0]!; context.discard(target.id); rangedAttack(context, resolveCard(context.state, target.definitionId).cost); if (!context.state.winner) context.draw(context.actorId, value(values, 'draw')); } },
  precisionShot: { ...BASE, tactical: true, gate: needsRange, command: playAction, resolve: (context, values) => rangedAttack(context, value(values, (context.state.turnState.copiesPlayed.precisionShot ?? 1) === 1 ? 'first' : 'later')) },
  regroup: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); context.requestDiscard(value(values, 'discard')); } },
  discipline: { ...BASE, tactical: true, choice: 'targets', target: { minimum: 1, maximum: 1, zone: 'handOrSelf' }, command: targeted, resolve: (context, values) => { context.trash(context.targetCards[0]!.id); context.damage(context.targetId, value(values, 'damage'), false); } },
  sharpen: { ...BASE, tactical: false, command: playAction, resolve: (context, values) => { context.draw(context.actorId, value(values, 'draw')); context.requestOptionalTrash(); } },
  reforge: { ...BASE, tactical: false, choice: 'targets', target: { minimum: 1, maximum: 1, zone: 'handOrSelf' }, command: targeted, resolve: (context, values) => { const target = context.targetCards[0]!; const cost = resolveCard(context.state, target.definitionId).cost; context.trash(target.id); context.requestGain(cost + value(values, 'costBonus')); } },
  scour: { ...BASE, tactical: false, choice: 'targets', target: { minimum: 0, maximum: 2, zone: 'handOrSelf' }, command: targeted, resolve: (context, values) => { for (const target of context.targetCards) context.trash(target.id); context.draw(context.actorId, context.targetCards.length * value(values, 'drawPerTrash')); } },
  improvise: { ...BASE, tactical: true, command: playAction, resolve: (context, values) => context.damage(context.targetId,
    new Set(context.state.turnState.familiesPlayed.filter((family) =>
      family === 'mana' || family === 'melee' || family === 'ranged')).size * value(values, 'perFamily'), false) },
  scrap: { ...BASE, tactical: true, command: playAction, resolve: (context, values) => context.damage(
    context.targetId, context.state.turnState.copiesPlayed.scrap === 1 ? value(values, 'damage') : 0, false
  ) }
};
export const EFFECTS: Readonly<Record<CardMechanic, CardEffect>> = Object.freeze(EFFECT_MAP);
export const TACTICAL_ACTIONS: ReadonlySet<string> = new Set(Object.values(CARDS).filter((card) => EFFECTS[card.mechanic].tactical).map((card) => card.id));
export function isTacticalAction(definitionId: string): boolean { return EFFECTS[cardDefinition(definitionId).mechanic].tactical; }
