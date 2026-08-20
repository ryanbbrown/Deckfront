import type { CardMechanic, CardValues } from '../game';

const ARENA_MIN = 1;
const ARENA_MAX = 5;
// One damage point must outweigh the longest possible four-step delay.
const CURRENT_DAMAGE_WEIGHT = ARENA_MAX - ARENA_MIN + 1;

const ATTACK_MECHANICS: ReadonlySet<CardMechanic> = new Set([
  'melee', 'drive', 'flurry', 'ranged', 'repellingShot', 'spell', 'volley'
]);

export interface ProfileCard {
  definitionId: string;
  mechanic: CardMechanic;
  values: CardValues;
}

export interface AttackProfileEntry extends ProfileCard { count: number }
export interface AttackProfile {
  attacks: AttackProfileEntry[];
  liveDeckSize: number;
}

export interface AttackState {
  aimed: boolean;
  tacticalPlayed: number;
  publicFuture: boolean;
}

function value(values: CardValues, key: string): number { return values[key] ?? 0; }
function distance(left: number, right: number): number { return Math.abs(left - right); }

export function printedAttackDamage(
  card: Pick<ProfileCard, 'mechanic' | 'values'>,
  actorPosition: number,
  opponentPosition: number,
  state: AttackState
): number {
  const close = actorPosition === opponentPosition;
  switch (card.mechanic) {
    case 'melee': return close ? value(card.values, 'damage') : 0;
    case 'drive': return close
      ? value(card.values, 'damage')
        + ((actorPosition === ARENA_MIN || actorPosition === ARENA_MAX) ? value(card.values, 'wallDamage') : 0)
      : 0;
    case 'flurry': return close
      ? (state.publicFuture
        ? value(card.values, 'max')
        : Math.min(value(card.values, 'max'), state.tacticalPlayed * value(card.values, 'perAction')))
      : 0;
    case 'ranged': case 'repellingShot': return close ? 0 : value(card.values, 'damage');
    case 'spell': return value(card.values, 'damage');
    case 'volley': {
      if (close) return 0;
      const near = distance(actorPosition, opponentPosition) === 1;
      if (state.publicFuture) {
        return near
          ? Math.max(value(card.values, 'near'), value(card.values, 'aimedNear'))
          : Math.max(value(card.values, 'far'), value(card.values, 'aimedFar'));
      }
      return value(card.values, state.aimed ? (near ? 'aimedNear' : 'aimedFar') : (near ? 'near' : 'far'));
    }
    default: return 0;
  }
}

export function buildAttackProfile(cards: Iterable<ProfileCard>): AttackProfile {
  const profile: AttackProfile = { attacks: [], liveDeckSize: 0 };
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

function stepsToBestRange(card: AttackProfileEntry, actorPosition: number, opponentPosition: number): number {
  let bestDamage = -1;
  let fewestSteps = ARENA_MAX - ARENA_MIN;
  const state = { aimed: false, tacticalPlayed: 0, publicFuture: true };
  for (let position = ARENA_MIN; position <= ARENA_MAX; position += 1) {
    const damage = printedAttackDamage(card, position, opponentPosition, state);
    const steps = Math.abs(position - actorPosition);
    if (damage > bestDamage) { bestDamage = damage; fewestSteps = steps; }
    else if (damage === bestDamage && steps < fewestSteps) fewestSteps = steps;
  }
  return fewestSteps;
}

const positionTables = new WeakMap<CardValues, Map<CardMechanic, Int16Array>>();

function positionTable(card: AttackProfileEntry): Int16Array {
  let byMechanic = positionTables.get(card.values);
  if (!byMechanic) { byMechanic = new Map(); positionTables.set(card.values, byMechanic); }
  const cached = byMechanic.get(card.mechanic);
  if (cached) return cached;
  const table = new Int16Array(ARENA_MAX * ARENA_MAX);
  const state = { aimed: false, tacticalPlayed: 0, publicFuture: true };
  for (let actor = ARENA_MIN; actor <= ARENA_MAX; actor += 1) {
    for (let opponent = ARENA_MIN; opponent <= ARENA_MAX; opponent += 1) {
      const current = printedAttackDamage(card, actor, opponent, state);
      table[(actor - 1) * ARENA_MAX + opponent - 1] = current * CURRENT_DAMAGE_WEIGHT
        - stepsToBestRange(card, actor, opponent);
    }
  }
  byMechanic.set(card.mechanic, table);
  return table;
}

/** Scores printed attack value now, then discounts each attack by the steps to its best range. */
export function profilePositionValue(
  profile: AttackProfile, actorPosition: number, opponentPosition: number
): number {
  let total = 0;
  for (const card of profile.attacks) {
    total += card.count * positionTable(card)[(actorPosition - 1) * ARENA_MAX + opponentPosition - 1]!;
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
