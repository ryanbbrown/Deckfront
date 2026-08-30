import { ARENA_MAX, ARENA_MIN } from '../game';
import type { CardFamily, CardMechanic, CardValues, MovementChoice, PendingChoiceType } from '../game';
import { printedAttackDamage, publicPositionAdvantage } from './positionValue';
import type { AttackProfile } from './positionValue';
export { TACTICAL_PILOT_PROTOCOL_VERSION } from './protocolVersions';

export interface PilotCard {
  handIndex: number;
  definitionId: string;
  mechanic: CardMechanic;
  family: CardFamily;
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
  scrapTrashed: number;
  purchaseProjection: readonly number[];
}

export interface DiscardOption {
  handIndex: number;
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
  aimBonus: number;
  opponentExposed: boolean;
  opponentExposedBonus: number;
  mana: number;
  manaSpent: number;
  spellsPlayed: number;
  attacksPlayed: number;
  copiesPlayed: Readonly<Record<string, number>>;
  familiesPlayed: readonly CardFamily[];
  positionChanged: boolean;
  tacticalPlayed: number;
  cullOptions: readonly CullOption[];
  discardOptions: readonly DiscardOption[];
  actorProfile: AttackProfile;
  opponentProfile: AttackProfile;
}

export type TacticalDecision =
  | { type: 'end' }
  | { type: 'play'; handIndex: number; movement?: MovementChoice | undefined; targetHandIndexes?: readonly number[] | undefined; targetSelf?: boolean | undefined }
  | { type: 'discard'; handIndex: number }
  | { type: 'recover'; discardIndex: number | null };

function value(card: PilotCard, key: string): number { return card.values[key] ?? 0; }
function distance(left: number, right: number): number { return Math.abs(left - right); }

function immediateDamage(card: PilotCard, view: TacticalView): number {
  switch (card.mechanic) {
    case 'melee': return value(card, 'damage') + view.opponentExposedBonus;
    case 'drive': return value(card, 'damage') + view.opponentExposedBonus
      + ((view.actorPosition === ARENA_MIN || view.actorPosition === ARENA_MAX) ? value(card, 'wallDamage') : 0);
    case 'flurry': return view.tacticalPlayed * value(card, 'perAction') + view.opponentExposedBonus;
    case 'openingStrike': return value(card, view.attacksPlayed === 0 ? 'first' : 'later') + view.opponentExposedBonus;
    case 'rally': return value(card, 'damage') + (view.copiesPlayed[card.definitionId] ?? 0) * value(card, 'perCopy') + view.opponentExposedBonus;
    case 'bullRush': return value(card, 'damage') + view.opponentExposedBonus;
    case 'ranged': return value(card, 'damage') + view.aimBonus;
    case 'repellingShot': return value(card, distance(view.actorPosition, view.opponentPosition) === 1 ? 'near' : 'far') + view.aimBonus;
    case 'longshot': return distance(view.actorPosition, view.opponentPosition) + view.aimBonus;
    case 'salvageShot': return Math.max(0, ...view.hand.filter((candidate) => candidate.handIndex !== card.handIndex && candidate.family === 'ranged').map((candidate) => candidate.cost)) + view.aimBonus;
    case 'precisionShot': return value(card, (view.copiesPlayed[card.definitionId] ?? 0) === 0 ? 'first' : 'later') + view.aimBonus;
    case 'spell': return value(card, 'damage');
    case 'discharge': return view.mana * value(card, 'perMana');
    case 'cascade': return value(card, 'damage') + view.spellsPlayed * value(card, 'perSpell');
    case 'overload': return view.manaSpent * value(card, 'perManaSpent');
    case 'discipline': return value(card, 'damage');
    case 'scrap': return (view.copiesPlayed.scrap ?? 0) === 0 ? value(card, 'damage') : 0;
    case 'improvise': return new Set(view.familiesPlayed.filter((family) =>
      family === 'mana' || family === 'melee' || family === 'ranged')).size * value(card, 'perFamily');
    case 'volley': {
      const near = distance(view.actorPosition, view.opponentPosition) === 1;
      return value(card, near ? 'near' : 'far') + view.aimBonus;
    }
    default: return 0;
  }
}

function attackState(card: PilotCard, view: TacticalView, mana: number, tacticalPlayed: number) {
  return {
    aimed: view.aimed, aimBonus: view.aimBonus, closeBonus: view.opponentExposedBonus,
    tacticalPlayed, publicFuture: false, mana, manaSpent: view.manaSpent,
    spellsPlayed: view.spellsPlayed, attacksPlayed: view.attacksPlayed,
    copiesPlayed: view.copiesPlayed, familiesPlayed: view.familiesPlayed,
    definitionId: card.definitionId,
    salvageCost: Math.max(0, ...view.hand.filter((candidate) =>
      candidate.handIndex !== card.handIndex && candidate.family === 'ranged').map((candidate) => candidate.cost))
  };
}

function currentHandDamageAt(
  view: TacticalView, actorPosition: number, opponentPosition: number, mana: number, tacticalPlayed: number
): number {
  let total = 0;
  let spellDamage: Int16Array | null = null;
  let scrapAvailable = (view.copiesPlayed.scrap ?? 0) === 0;
  for (const card of view.hand) {
    if (!['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush', 'ranged', 'repellingShot',
      'longshot', 'salvageShot', 'precisionShot', 'spell', 'discharge', 'cascade', 'overload', 'discipline', 'improvise', 'scrap', 'volley']
      .includes(card.mechanic)) continue;
    if (card.mechanic === 'spell' || card.mechanic === 'cascade') {
      const cost = value(card, 'manaCost');
      if (cost > mana) continue;
      spellDamage ??= new Int16Array(Math.floor(mana) + 1);
      const damage = printedAttackDamage(card, actorPosition, opponentPosition,
        attackState(card, view, mana, tacticalPlayed));
      for (let available = spellDamage.length - 1; available >= cost; available -= 1) {
        spellDamage[available] = Math.max(spellDamage[available]!, spellDamage[available - cost]! + damage);
      }
      continue;
    }
    const state = attackState(card, view, mana, tacticalPlayed);
    if (card.mechanic === 'scrap') {
      if (!scrapAvailable) state.copiesPlayed = { ...view.copiesPlayed, scrap: 1 };
      scrapAvailable = false;
    }
    total += printedAttackDamage(card, actorPosition, opponentPosition, state);
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

function repellingPositions(view: TacticalView): Pick<MovementResult, 'actorPosition' | 'opponentPosition'> {
  const targetStep = view.opponentPosition > view.actorPosition ? 1 : -1;
  const targetDestination = view.opponentPosition + targetStep;
  if (targetDestination >= ARENA_MIN && targetDestination <= ARENA_MAX) {
    return { actorPosition: view.actorPosition, opponentPosition: targetDestination };
  }
  const actorDestination = view.actorPosition - targetStep;
  return actorDestination >= ARENA_MIN && actorDestination <= ARENA_MAX
    ? { actorPosition: actorDestination, opponentPosition: view.opponentPosition }
    : { actorPosition: view.actorPosition, opponentPosition: view.opponentPosition };
}

function repellingImproves(view: TacticalView): boolean {
  const positions = repellingPositions(view);
  const currentDamage = currentHandDamageAt(
    view, view.actorPosition, view.opponentPosition, view.mana, view.tacticalPlayed
  );
  const nextDamage = currentHandDamageAt(
    view, positions.actorPosition, positions.opponentPosition, view.mana, view.tacticalPlayed + 1
  );
  if (nextDamage !== currentDamage) return nextDamage > currentDamage;
  return publicPositionAdvantage(
    view.actorProfile, view.opponentProfile, positions.actorPosition, positions.opponentPosition
  ) > publicPositionAdvantage(
    view.actorProfile, view.opponentProfile, view.actorPosition, view.opponentPosition
  );
}

function bestDriveDirection(card: PilotCard, view: TacticalView): MovementChoice {
  let best: MovementResult | null = null;
  for (const movement of card.movements) {
    const destination = view.actorPosition + (movement === 'left' ? -1 : 1);
    const collision = destination < ARENA_MIN || destination > ARENA_MAX;
    const actorPosition = collision ? view.actorPosition : destination;
    const opponentPosition = collision ? view.opponentPosition : destination;
    const candidate: MovementResult = {
      movement, actorPosition, opponentPosition,
      damage: value(card, 'damage') + view.opponentExposedBonus
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
      || (purchase === 0 && option.scrapTrashed > best.scrapTrashed)
      || (purchase === 0 && option.scrapTrashed === best.scrapTrashed && option.copperTrashed > best.copperTrashed)
      || (purchase === 0 && option.scrapTrashed === best.scrapTrashed
        && option.copperTrashed === best.copperTrashed && option.trashCull && !best.trashCull)) best = option;
  }
  return best;
}

function retainedHandValue(view: TacticalView, discardedHandIndex: number): number {
  let total = 0;
  let usefulScraps = (view.copiesPlayed.scrap ?? 0) === 0 ? 1 : 0;
  for (const card of view.hand) {
    if (card.handIndex === discardedHandIndex) continue;
    const damage = card.mechanic === 'scrap'
      ? (usefulScraps-- > 0 ? value(card, 'damage') : 0)
      : immediateDamage(card, view);
    total += damage * 100
      + (value(card, 'draw') + (card.mechanic === 'adapt' && view.positionChanged ? value(card, 'movedDraw') : 0)) * 30
      + value(card, 'mana') * 15 + card.money * 20 + card.cost;
  }
  return total;
}

function pickDiscard(view: TacticalView): TacticalDecision {
  let best = view.hand[0];
  let bestProjection = best
    ? view.discardOptions.find((option) => option.handIndex === best!.handIndex)?.purchaseProjection ?? []
    : [];
  let bestHandValue = best ? retainedHandValue(view, best.handIndex) : 0;
  for (const card of view.hand.slice(1)) {
    const projection = view.discardOptions.find((option) => option.handIndex === card.handIndex)?.purchaseProjection ?? [];
    const purchase = compareProjection(projection, bestProjection);
    const handValue = retainedHandValue(view, card.handIndex);
    if (purchase > 0 || (purchase === 0 && handValue > bestHandValue)) {
      best = card; bestProjection = projection; bestHandValue = handValue;
    }
  }
  return best ? { type: 'discard', handIndex: best.handIndex } : { type: 'end' };
}

function first(view: TacticalView, mechanic: CardMechanic): PilotCard | undefined {
  return view.hand.find((card) => card.enabled && card.mechanic === mechanic);
}

export function fixedTargetSelection(
  card: PilotCard, hand: readonly PilotCard[]
): Pick<Extract<TacticalDecision, { type: 'play' }>, 'targetHandIndexes' | 'targetSelf'> | null {
  if (card.mechanic === 'bullRush' || card.mechanic === 'salvageShot') {
    const family = card.mechanic === 'bullRush' ? 'melee' : 'ranged';
    const targets = hand.filter((candidate) =>
      candidate.handIndex !== card.handIndex && candidate.family === family);
    const target = card.mechanic === 'salvageShot'
      ? [...targets].sort((left, right) => right.cost - left.cost
        || left.definitionId.localeCompare(right.definitionId)
        || left.handIndex - right.handIndex)[0]
      : targets[0];
    return { targetHandIndexes: target ? [target.handIndex] : [], targetSelf: false };
  }
  if (card.mechanic === 'discipline' || card.mechanic === 'reforge') {
    const target = hand.find((candidate) => candidate.definitionId === 'scrap')
      ?? hand.find((candidate) => candidate.definitionId === 'copper');
    return target
      ? { targetHandIndexes: [target.handIndex], targetSelf: false }
      : { targetHandIndexes: [], targetSelf: true };
  }
  if (card.mechanic === 'scour') {
    const targets = [
      ...hand.filter((candidate) => candidate.definitionId === 'scrap'),
      ...hand.filter((candidate) => candidate.definitionId === 'copper')
    ].slice(0, 2);
    return { targetHandIndexes: targets.map((candidate) => candidate.handIndex), targetSelf: false };
  }
  return null;
}

function play(card: PilotCard, movement?: MovementChoice, hand?: readonly PilotCard[]): TacticalDecision {
  const targets = hand ? fixedTargetSelection(card, hand) : null;
  return movement === undefined
    ? { type: 'play', handIndex: card.handIndex, ...targets }
    : { type: 'play', handIndex: card.handIndex, movement, ...targets };
}

function hasCloseAttack(view: TacticalView): boolean {
  return view.hand.some((card) => card.enabled && ['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush'].includes(card.mechanic));
}

function bestDamage(view: TacticalView, omitFlurry: boolean): PilotCard | undefined {
  let best: PilotCard | undefined;
  let bestDamage = -1;
  for (const card of view.hand) {
    if (!card.enabled || !['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush', 'ranged', 'repellingShot',
      'longshot', 'salvageShot', 'precisionShot', 'spell', 'discharge', 'cascade', 'overload', 'discipline', 'improvise', 'scrap', 'volley']
      .includes(card.mechanic)) continue;
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
    for (const card of view.discard) if (best && (card.cost > best.cost
      || (card.cost === best.cost && card.definitionId.localeCompare(best.definitionId) < 0))) best = card;
    return { type: 'recover', discardIndex: best?.discardIndex ?? null };
  }
  if (view.pendingChoice === 'discard') return pickDiscard(view);

  const volley = first(view, 'volley');
  if (view.aimed && volley) return play(volley);

  const reclaim = first(view, 'reclaim');
  if (reclaim && view.discard.length > 0) return play(reclaim);

  const footwork = first(view, 'footwork');
  if (footwork) return play(footwork, bestMovement(footwork, view).movement);

  const channel = first(view, 'channel') ?? first(view, 'attune');
  if (channel) return play(channel);
  const muster = first(view, 'muster') ?? first(view, 'regroup');
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

  const repellingShot = first(view, 'repellingShot');
  if (repellingShot && repellingImproves(view)) return play(repellingShot);

  if (view.hand.some((card) => card.definitionId === 'scrap')) {
    const discipline = first(view, 'discipline');
    if (discipline) return play(discipline, undefined, view.hand);
    const cull = first(view, 'cull');
    const cullOption = cull ? bestCull(view) : null;
    if (cull && cullOption?.scrapTrashed) return {
      type: 'play', handIndex: cull.handIndex,
      targetHandIndexes: cullOption.trashHandIndexes, targetSelf: false
    };
    for (const mechanic of ['sharpen', 'scour', 'reforge'] as const) {
      const card = first(view, mechanic);
      if (card) return play(card, undefined, view.hand);
    }
  }

  const nonFlurryDamage = bestDamage(view, true);
  if (nonFlurryDamage) {
    if (nonFlurryDamage.mechanic === 'drive') {
      return play(nonFlurryDamage, bestDriveDirection(nonFlurryDamage, view));
    }
    return play(nonFlurryDamage, undefined, view.hand);
  }

  const flurry = first(view, 'flurry');
  if (flurry && immediateDamage(flurry, view) > 0) return play(flurry);

  if (move) {
    const movement = bestMovement(move, view);
    if (movementImproves(move, view, movement)) return play(move, movement.movement);
  }

  const cull = first(view, 'cull');
  const cullOption = cull ? bestCull(view) : null;
  if (cull && cullOption && (cullOption.scrapTrashed > 0 || cullOption.copperTrashed > 0 || cullOption.trashCull)) {
    return {
      type: 'play', handIndex: cull.handIndex,
      targetHandIndexes: cullOption.trashHandIndexes, targetSelf: cullOption.trashCull
    };
  }

  for (const mechanic of ['sharpen', 'scour', 'reforge'] as const) {
    const card = first(view, mechanic); if (card) return play(card, undefined, view.hand);
  }
  if (reclaim) return play(reclaim);
  return { type: 'end' };
}
