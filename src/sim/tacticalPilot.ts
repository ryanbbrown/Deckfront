import type { CardMechanic, CardValues, MovementChoice, PendingChoiceType } from '../game';
import { printedAttackDamage, publicPositionAdvantage } from './positionValue';
import type { AttackProfile } from './positionValue';
export { TACTICAL_PILOT_PROTOCOL_VERSION } from './protocolVersions';

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
  actorProfile: AttackProfile;
  opponentProfile: AttackProfile;
}

export type TacticalDecision =
  | { type: 'end' }
  | { type: 'play'; handIndex: number; movement?: MovementChoice | undefined; trashHandIndexes?: readonly number[] | undefined; trashCull?: boolean | undefined }
  | { type: 'discard'; handIndex: number }
  | { type: 'recover'; discardIndex: number | null };

function value(card: PilotCard, key: string): number { return card.values[key] ?? 0; }
function distance(left: number, right: number): number { return Math.abs(left - right); }

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

function currentHandDamageAt(
  view: TacticalView, actorPosition: number, opponentPosition: number, mana: number, tacticalPlayed: number
): number {
  let total = 0;
  let spellDamage: Int16Array | null = null;
  for (const card of view.hand) {
    if (!['melee', 'drive', 'flurry', 'ranged', 'spell', 'volley'].includes(card.mechanic)) continue;
    if (card.mechanic === 'spell') {
      const cost = value(card, 'manaCost');
      if (cost > mana) continue;
      spellDamage ??= new Int16Array(Math.floor(mana) + 1);
      const damage = printedAttackDamage(card, actorPosition, opponentPosition, {
        aimed: view.aimed, tacticalPlayed, publicFuture: false
      });
      for (let available = spellDamage.length - 1; available >= cost; available -= 1) {
        spellDamage[available] = Math.max(spellDamage[available]!, spellDamage[available - cost]! + damage);
      }
      continue;
    }
    total += printedAttackDamage(card, actorPosition, opponentPosition, {
      aimed: view.aimed, tacticalPlayed, publicFuture: false
    });
  }
  return total + (spellDamage?.at(-1) ?? 0);
}

interface MovementResult {
  movement: MovementChoice;
  actorPosition: number;
  opponentPosition: number;
  damage: number;
  positionValue: number;
}

function winsFinalTie(candidate: MovementResult, best: MovementResult): boolean {
  if (candidate.movement === 'stay' || best.movement === 'stay') return candidate.movement === 'stay';
  const candidateDistance = distance(candidate.actorPosition, candidate.opponentPosition);
  const bestDistance = distance(best.actorPosition, best.opponentPosition);
  if (candidateDistance !== bestDistance) return candidateDistance > bestDistance;
  return candidate.movement === 'left' && best.movement !== 'left';
}

function betterMovement(candidate: MovementResult, best: MovementResult | null): boolean {
  if (!best) return true;
  if (candidate.damage !== best.damage) return candidate.damage > best.damage;
  if (candidate.positionValue !== best.positionValue) return candidate.positionValue > best.positionValue;
  return winsFinalTie(candidate, best);
}

function movementResult(card: PilotCard, view: TacticalView, movement: MovementChoice): MovementResult {
  const actorPosition = view.actorPosition + (movement === 'left' ? -1 : movement === 'right' ? 1 : 0);
  const mana = view.mana + (card.mechanic === 'leyStep' ? value(card, 'mana') : 0);
  return {
    movement, actorPosition, opponentPosition: view.opponentPosition,
    damage: currentHandDamageAt(view, actorPosition, view.opponentPosition, mana, view.tacticalPlayed + 1),
    positionValue: publicPositionAdvantage(
      view.actorProfile, view.opponentProfile, actorPosition, view.opponentPosition
    )
  };
}

function bestMovement(card: PilotCard, view: TacticalView): MovementResult {
  let best: MovementResult | null = null;
  for (const movement of card.movements) {
    const candidate = movementResult(card, view, movement);
    if (betterMovement(candidate, best)) best = candidate;
  }
  return best ?? movementResult(card, view, 'stay');
}

function movementImproves(card: PilotCard, view: TacticalView, result: MovementResult): boolean {
  const currentDamage = currentHandDamageAt(
    view, view.actorPosition, view.opponentPosition, view.mana, view.tacticalPlayed
  );
  if (result.damage !== currentDamage) return result.damage > currentDamage;
  const currentPositionValue = publicPositionAdvantage(
    view.actorProfile, view.opponentProfile, view.actorPosition, view.opponentPosition
  );
  return result.positionValue > currentPositionValue;
}

function movementPreservesDamage(view: TacticalView, result: MovementResult): boolean {
  return result.damage >= currentHandDamageAt(
    view, view.actorPosition, view.opponentPosition, view.mana, view.tacticalPlayed
  );
}

function bestDriveDirection(card: PilotCard, view: TacticalView): MovementChoice {
  let best: MovementResult | null = null;
  for (const movement of card.movements) {
    const destination = view.actorPosition + (movement === 'left' ? -1 : 1);
    const collision = destination < 1 || destination > 5;
    const actorPosition = collision ? view.actorPosition : destination;
    const opponentPosition = collision ? view.opponentPosition : destination;
    const candidate: MovementResult = {
      movement, actorPosition, opponentPosition,
      damage: value(card, 'damage') + (view.opponentExposed ? 2 : 0)
        + (collision ? value(card, 'wallDamage') : 0),
      positionValue: publicPositionAdvantage(
        view.actorProfile, view.opponentProfile, actorPosition, opponentPosition
      )
    };
    if (betterMovement(candidate, best)) best = candidate;
  }
  return best?.movement ?? 'left';
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
  if (footwork) return play(footwork, bestMovement(footwork, view).movement);

  const channel = first(view, 'channel');
  if (channel) return play(channel);
  const muster = first(view, 'muster');
  if (muster) return play(muster);
  const stipend = first(view, 'stipend');
  if (stipend) return play(stipend);
  const aim = first(view, 'aim');
  if (aim) return play(aim);

  const adapt = first(view, 'adapt');
  const move = first(view, 'leyStep') ?? first(view, 'step');
  if (adapt && move && !view.positionChanged) {
    const movement = bestMovement(move, view);
    if (movementPreservesDamage(view, movement)) return play(move, movement.movement);
  }
  if (adapt) return play(adapt);

  const prism = first(view, 'prism');
  if (prism && view.hand.length > 1) return play(prism);

  const feint = first(view, 'feint');
  if (feint && !view.opponentExposed && hasCloseAttack(view)) return play(feint);

  const nonFlurryDamage = bestDamage(view, true);
  if (nonFlurryDamage) {
    if (nonFlurryDamage.mechanic === 'drive') {
      return play(nonFlurryDamage, bestDriveDirection(nonFlurryDamage, view));
    }
    return play(nonFlurryDamage);
  }

  const flurry = first(view, 'flurry');
  if (flurry && immediateDamage(flurry, view) > 0) return play(flurry);

  if (move) {
    const movement = bestMovement(move, view);
    if (movementImproves(move, view, movement)) return play(move, movement.movement);
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
