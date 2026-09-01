import { ARENA_MAX, ARENA_MIN, ATTACK_MECHANICS } from '../game';
import type { CardFamily, CardMechanic, CardValues } from '../game';

// One damage point must outweigh the longest possible arena delay.
const CURRENT_DAMAGE_WEIGHT = ARENA_MAX - ARENA_MIN + 1;

export interface ProfileCard {
  definitionId: string;
  mechanic: CardMechanic;
  values: CardValues;
}

export interface AttackProfileEntry extends ProfileCard { count: number }
export interface AttackProfile {
  attacks: AttackProfileEntry[];
  liveDeckSize: number;
  aimBonus: number;
}

export interface AttackState {
  aimed: boolean;
  aimBonus: number;
  closeBonus?: number;
  tacticalPlayed: number;
  publicFuture: boolean;
  mana?: number;
  manaSpent?: number;
  spellsPlayed?: number;
  attacksPlayed?: number;
  copiesPlayed?: Readonly<Record<string, number>>;
  familiesPlayed?: readonly CardFamily[];
  salvageCost?: number;
  definitionId?: string;
}

function value(values: CardValues, key: string): number { return values[key] ?? 0; }
function distance(left: number, right: number): number { return Math.abs(left - right); }
function aimBonus(state: AttackState): number { return state.aimed || state.publicFuture ? state.aimBonus : 0; }
function closeBonus(state: AttackState): number { return state.closeBonus ?? 0; }

export function printedAttackDamage(
  card: Pick<ProfileCard, 'mechanic' | 'values'>,
  actorPosition: number,
  opponentPosition: number,
  state: AttackState
): number {
  const close = actorPosition === opponentPosition;
  switch (card.mechanic) {
    case 'melee': return close ? value(card.values, 'damage') + closeBonus(state) : 0;
    case 'drive': return close
      ? value(card.values, 'damage') + closeBonus(state)
        + ((actorPosition === ARENA_MIN || actorPosition === ARENA_MAX) ? value(card.values, 'wallDamage') : 0)
      : 0;
    case 'flurry': return (state.publicFuture ? 1 : state.tacticalPlayed) * value(card.values, 'perAction');
    case 'openingStrike': return close
      ? value(card.values, state.publicFuture || (state.attacksPlayed ?? 0) === 0 ? 'first' : 'later') + closeBonus(state)
      : 0;
    case 'rally': return close ? value(card.values, 'damage') + closeBonus(state) : 0;
    case 'bullRush': return close ? value(card.values, 'damage') + closeBonus(state) : 0;
    case 'ranged': return close ? 0 : value(card.values, 'damage') + aimBonus(state);
    case 'repellingShot': return close ? 0 : value(card.values, distance(actorPosition, opponentPosition) === 1 ? 'near' : 'far') + aimBonus(state);
    case 'longshot': return close ? 0 : distance(actorPosition, opponentPosition) + aimBonus(state);
    case 'salvageShot': return close ? 0 : (state.salvageCost ?? 0) + aimBonus(state);
    case 'precisionShot': {
      if (close) return 0;
      const copies = state.definitionId ? state.copiesPlayed?.[state.definitionId] ?? 0 : 0;
      return value(card.values, copies === 0 ? 'first' : 'later') + aimBonus(state);
    }
    case 'spell': return value(card.values, 'damage');
    case 'discharge': return (state.mana ?? 0) * value(card.values, 'perMana');
    case 'cascade': return value(card.values, 'damage') + (state.spellsPlayed ?? 0) * value(card.values, 'perSpell');
    case 'overload': return (state.manaSpent ?? 0) * value(card.values, 'perManaSpent');
    case 'improvise': return new Set((state.familiesPlayed ?? []).filter((family) =>
      family === 'mana' || family === 'melee' || family === 'ranged')).size * value(card.values, 'perFamily');
    case 'discipline': return value(card.values, 'damage');
    case 'scrap': {
      const copies = state.definitionId ? state.copiesPlayed?.[state.definitionId] ?? 0 : 0;
      return copies === 0 ? value(card.values, 'damage') : 0;
    }
    case 'volley': {
      if (close) return 0;
      const near = distance(actorPosition, opponentPosition) === 1;
      return value(card.values, near ? 'near' : 'far') + aimBonus(state);
    }
    default: return 0;
  }
}

export function buildAttackProfile(cards: Iterable<ProfileCard>, aimBonusValue = 0): AttackProfile {
  const profile: AttackProfile = { attacks: [], liveDeckSize: 0, aimBonus: aimBonusValue };
  for (const card of cards) {
    addProfileCard(profile, card);
  }
  return profile;
}

export function addProfileCard(profile: AttackProfile, card: ProfileCard): void {
  profile.liveDeckSize += 1;
  if (!ATTACK_MECHANICS.has(card.mechanic)) return;
  const existing = profile.attacks.find((entry) => entry.definitionId === card.definitionId);
  if (existing) existing.count += 1;
  else profile.attacks.push({ ...card, count: 1 });
}

export function removeProfileCard(profile: AttackProfile, card: ProfileCard): void {
  profile.liveDeckSize -= 1;
  if (!ATTACK_MECHANICS.has(card.mechanic)) return;
  const index = profile.attacks.findIndex((entry) => entry.definitionId === card.definitionId);
  if (index < 0) throw new Error(`Attack profile does not contain ${card.definitionId}.`);
  const entry = profile.attacks[index]!;
  entry.count -= 1;
  if (entry.count === 0) profile.attacks.splice(index, 1);
}

function stepsToBestRange(
  card: AttackProfileEntry, actorPosition: number, opponentPosition: number, profileAimBonus: number
): number {
  let bestDamage = -1;
  let fewestSteps = ARENA_MAX - ARENA_MIN;
  const state = { aimed: false, aimBonus: profileAimBonus, tacticalPlayed: 0, publicFuture: true };
  for (let position = ARENA_MIN; position <= ARENA_MAX; position += 1) {
    const damage = printedAttackDamage(card, position, opponentPosition, state);
    const steps = Math.abs(position - actorPosition);
    if (damage > bestDamage) { bestDamage = damage; fewestSteps = steps; }
    else if (damage === bestDamage && steps < fewestSteps) fewestSteps = steps;
  }
  return fewestSteps;
}

const positionTables = new WeakMap<CardValues, Map<string, Int16Array>>();

function positionTable(card: AttackProfileEntry, profileAimBonus: number): Int16Array {
  let byMechanic = positionTables.get(card.values);
  if (!byMechanic) { byMechanic = new Map(); positionTables.set(card.values, byMechanic); }
  const cacheKey = `${card.mechanic}:${profileAimBonus}`;
  const cached = byMechanic.get(cacheKey);
  if (cached) return cached;
  const table = new Int16Array(ARENA_MAX * ARENA_MAX);
  const state = { aimed: false, aimBonus: profileAimBonus, tacticalPlayed: 0, publicFuture: true };
  for (let actor = ARENA_MIN; actor <= ARENA_MAX; actor += 1) {
    for (let opponent = ARENA_MIN; opponent <= ARENA_MAX; opponent += 1) {
      const current = printedAttackDamage(card, actor, opponent, state);
      table[(actor - 1) * ARENA_MAX + opponent - 1] = current * CURRENT_DAMAGE_WEIGHT
        - stepsToBestRange(card, actor, opponent, profileAimBonus);
    }
  }
  byMechanic.set(cacheKey, table);
  return table;
}

/** Scores printed attack value now, then discounts each attack by the steps to its best range. */
export function profilePositionValue(
  profile: AttackProfile, actorPosition: number, opponentPosition: number
): number {
  let total = 0;
  for (const card of profile.attacks) {
    const count = card.mechanic === 'scrap' ? Math.min(1, card.count) : card.count;
    total += count * positionTable(card, profile.aimBonus)[(actorPosition - 1) * ARENA_MAX + opponentPosition - 1]!;
  }
  return total;
}

/** Returns my normalized position value minus the opponent's, with the common denominator omitted. */
export function publicPositionAdvantage(
  mine: AttackProfile,
  theirs: AttackProfile,
  actorPosition: number,
  opponentPosition: number
): number {
  const mineSize = Math.max(1, mine.liveDeckSize);
  const theirSize = Math.max(1, theirs.liveDeckSize);
  return profilePositionValue(mine, actorPosition, opponentPosition) * theirSize
    - profilePositionValue(theirs, opponentPosition, actorPosition) * mineSize;
}
