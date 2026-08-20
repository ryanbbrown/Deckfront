import type { CardMechanic, CardValues, MovementChoice, PendingChoiceType } from '../game';

export interface PilotCard {
  handIndex: number;
  definitionId: string;
  mechanic: CardMechanic;
  cost: number;
  money: number;
  values: CardValues;
  enabled: boolean;
  movements: readonly MovementChoice[];
}

export interface CullOption {
  trashHandIndexes: readonly number[];
  trashCull: boolean;
  copperTrashed: number;
  purchaseProjection: readonly number[];
}

export interface TacticalView {
  hand: readonly PilotCard[];
  discard: readonly { discardIndex: number; cost: number; definitionId: string }[];
  pendingChoice: PendingChoiceType | null;
  actorPosition: number;
  opponentPosition: number;
  opponentHealth: number;
  aimed: boolean;
  opponentExposed: boolean;
  mana: number;
  positionChanged: boolean;
  tacticalPlayed: number;
  cullOptions: readonly CullOption[];
}

export type TacticalDecision =
  | { type: 'end' }
  | { type: 'play'; handIndex: number; movement?: MovementChoice | undefined; trashHandIndexes?: readonly number[] | undefined; trashCull?: boolean | undefined }
  | { type: 'discard'; handIndex: number }
  | { type: 'recover'; discardIndex: number | null };

function value(card: PilotCard, key: string): number { return card.values[key] ?? 0; }
function distance(left: number, right: number): number { return Math.abs(left - right); }
function isClose(left: number, right: number): boolean { return distance(left, right) === 0; }

function immediateDamage(card: PilotCard, view: TacticalView): number {
  switch (card.mechanic) {
    case 'melee': return value(card, 'damage') + (view.opponentExposed ? 2 : 0);
    case 'drive': return value(card, 'damage') + (view.opponentExposed ? 2 : 0)
      + ((view.actorPosition === 1 || view.actorPosition === 5) ? value(card, 'wallDamage') : 0);
    case 'flurry': return Math.min(value(card, 'max'), view.tacticalPlayed * value(card, 'perAction'))
      + (view.opponentExposed ? 2 : 0);
    case 'ranged': return value(card, 'damage');
    case 'spell': return value(card, 'damage');
    case 'volley': {
      const near = distance(view.actorPosition, view.opponentPosition) === 1;
      return value(card, view.aimed ? (near ? 'aimedNear' : 'aimedFar') : (near ? 'near' : 'far'));
    }
    default: return 0;
  }
}

function potentialAt(view: TacticalView, actorPosition: number): number {
  const close = isClose(actorPosition, view.opponentPosition);
  let total = 0;
  for (const card of view.hand) {
    if (card.mechanic === 'melee' && close) total += value(card, 'damage');
    else if (card.mechanic === 'drive' && close) total += value(card, 'damage');
    else if (card.mechanic === 'flurry' && close) total += Math.min(value(card, 'max'), (view.tacticalPlayed + 1) * value(card, 'perAction'));
    else if (card.mechanic === 'ranged' && !close) total += value(card, 'damage');
    else if (card.mechanic === 'volley' && !close) {
      const near = distance(actorPosition, view.opponentPosition) === 1;
      total += value(card, view.aimed ? (near ? 'aimedNear' : 'aimedFar') : (near ? 'near' : 'far'));
    } else if (card.mechanic === 'spell' && view.mana >= value(card, 'manaCost')) total += value(card, 'damage');
  }
  return total;
}

function bestMovement(card: PilotCard, view: TacticalView): MovementChoice {
  let best = card.movements[0] ?? 'stay';
  let bestPotential = -1;
  for (const movement of card.movements) {
    const next = view.actorPosition + (movement === 'left' ? -1 : movement === 'right' ? 1 : 0);
    const potential = potentialAt(view, next);
    if (potential > bestPotential) { best = movement; bestPotential = potential; continue; }
  }
  return best;
}

function compareProjection(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function bestCull(view: TacticalView): CullOption | null {
  let best: CullOption | null = null;
  for (const option of view.cullOptions) {
    if (!best) { best = option; continue; }
    const purchase = compareProjection(option.purchaseProjection, best.purchaseProjection);
    if (purchase > 0
      || (purchase === 0 && option.copperTrashed > best.copperTrashed)
      || (purchase === 0 && option.copperTrashed === best.copperTrashed && option.trashCull && !best.trashCull)) best = option;
  }
  return best;
}

function discardValue(card: PilotCard, view: TacticalView): number {
  if (card.mechanic === 'money') return card.money * 20;
  return immediateDamage(card, view) * 100
    + (value(card, 'draw') + (card.mechanic === 'adapt' && view.positionChanged ? value(card, 'movedDraw') : 0)) * 30
    + value(card, 'mana') * 15 + value(card, 'money') * 20 + card.cost;
}

function pickDiscard(view: TacticalView): TacticalDecision {
  let best = view.hand[0];
  for (const card of view.hand) if (best && discardValue(card, view) < discardValue(best, view)) best = card;
  return best ? { type: 'discard', handIndex: best.handIndex } : { type: 'end' };
}

function first(view: TacticalView, mechanic: CardMechanic): PilotCard | undefined {
  return view.hand.find((card) => card.enabled && card.mechanic === mechanic);
}

function play(card: PilotCard, movement?: MovementChoice): TacticalDecision {
  return movement === undefined
    ? { type: 'play', handIndex: card.handIndex }
    : { type: 'play', handIndex: card.handIndex, movement };
}

function hasCloseAttack(view: TacticalView): boolean {
  return view.hand.some((card) => card.enabled && ['melee', 'drive', 'flurry'].includes(card.mechanic));
}

function bestDamage(view: TacticalView, omitFlurry: boolean): PilotCard | undefined {
  let best: PilotCard | undefined;
  let bestDamage = -1;
  for (const card of view.hand) {
    if (!card.enabled || !['melee', 'drive', 'flurry', 'ranged', 'spell', 'volley'].includes(card.mechanic)) continue;
    if (omitFlurry && card.mechanic === 'flurry') continue;
    const damage = immediateDamage(card, view);
    if (damage > bestDamage) { best = card; bestDamage = damage; }
  }
  return best;
}

/** Selects one action from visible state. The caller applies it, updates the view, and asks again. */
export function chooseTacticalAction(view: TacticalView): TacticalDecision {
  if (view.pendingChoice === 'recover') {
    let best = view.discard[0];
    for (const card of view.discard) if (best && card.cost > best.cost) best = card;
    return { type: 'recover', discardIndex: best?.discardIndex ?? null };
  }
  if (view.pendingChoice === 'discard') return pickDiscard(view);

  const volley = first(view, 'volley');
  if (view.aimed && volley) return play(volley);

  const reclaim = first(view, 'reclaim');
  if (reclaim && view.discard.length > 0) return play(reclaim);

  const footwork = first(view, 'footwork');
  if (footwork) return play(footwork, bestMovement(footwork, view));

  const channel = first(view, 'channel');
  if (channel) return play(channel);
  const muster = first(view, 'muster');
  if (muster) return play(muster);
  const stipend = first(view, 'stipend');
  if (stipend) return play(stipend);
  const quickShot = view.hand.find((card) => card.enabled && card.mechanic === 'ranged' && value(card, 'draw') > 0);
  if (quickShot) return play(quickShot);

  const aim = first(view, 'aim');
  if (aim) return play(aim);

  const adapt = first(view, 'adapt');
  const move = first(view, 'leyStep') ?? first(view, 'step');
  if (adapt && move && !view.positionChanged) return play(move, bestMovement(move, view));
  if (adapt) return play(adapt);

  const prism = first(view, 'prism');
  if (prism && view.hand.length > 1) return play(prism);

  const feint = first(view, 'feint');
  if (feint && !view.opponentExposed && hasCloseAttack(view)) return play(feint);

  const nonFlurryDamage = bestDamage(view, true);
  if (nonFlurryDamage) {
    if (nonFlurryDamage.mechanic === 'drive') {
      const direction: MovementChoice = view.actorPosition === 1 ? 'left' : view.actorPosition === 5 ? 'right'
        : view.actorPosition <= 3 ? 'left' : 'right';
      return play(nonFlurryDamage, direction);
    }
    return play(nonFlurryDamage);
  }

  const flurry = first(view, 'flurry');
  if (flurry && immediateDamage(flurry, view) > 0) return play(flurry);

  if (move) {
    const movement = bestMovement(move, view);
    const next = view.actorPosition + (movement === 'left' ? -1 : movement === 'right' ? 1 : 0);
    const gainsPosition = potentialAt(view, next) > potentialAt(view, view.actorPosition);
    const gainsMana = move.mechanic === 'leyStep'
      && view.hand.some((card) => card.mechanic === 'spell' && value(card, 'manaCost') > view.mana
        && value(card, 'manaCost') <= view.mana + value(move, 'mana'));
    if (gainsPosition || gainsMana) return play(move, movement);
  }

  const cull = first(view, 'cull');
  const cullOption = cull ? bestCull(view) : null;
  if (cull && cullOption && (cullOption.copperTrashed > 0 || cullOption.trashCull)) {
    return {
      type: 'play', handIndex: cull.handIndex,
      trashHandIndexes: cullOption.trashHandIndexes, trashCull: cullOption.trashCull
    };
  }

  if (reclaim) return play(reclaim);
  return { type: 'end' };
}
