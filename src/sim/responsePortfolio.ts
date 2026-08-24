import { EFFECTS, SeededRandom, kingdomMarket } from '../game';
import type { CardFamily, CardMechanic, Kingdom } from '../game';
import { ResponsePolicyDomain } from './responsePolicyGrammar';
import { RESPONSE_FINITE_COUNTS } from './responsePolicyGrammar';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const RESPONSE_PORTFOLIO_VERSION = 'response-portfolio-v2';
export type ResponseProposalSource = 'semantic' | 'local' | 'unrestricted';
export type DamageFamily = 'Melee' | 'Ranged' | 'Mage' | 'Engine';

function mechanics(values: readonly CardMechanic[]): ReadonlySet<CardMechanic> {
  return new Set(values);
}

/** Shared damage taxonomy for proposal roles and result reporting. */
export const DAMAGE_MECHANICS_BY_FAMILY: Readonly<Record<DamageFamily, ReadonlySet<CardMechanic>>> = Object.freeze({
  Melee: mechanics(['melee', 'drive', 'flurry', 'openingStrike', 'rally', 'bullRush']),
  Ranged: mechanics(['ranged', 'repellingShot', 'volley', 'longshot', 'salvageShot', 'precisionShot']),
  Mage: mechanics(['spell', 'discharge', 'cascade', 'overload']),
  Engine: mechanics(['discipline', 'improvise', 'scrap'])
});
export const DIRECT_DAMAGE_MECHANICS: ReadonlySet<CardMechanic> = mechanics(
  Object.values(DAMAGE_MECHANICS_BY_FAMILY).flatMap((family) => [...family]));
const TRASH_MECHANICS: ReadonlySet<CardMechanic> = mechanics(['cull', 'discipline', 'sharpen', 'reforge', 'scour']);

export interface DerivedCardRole {
  cardId: string;
  mechanic: CardMechanic;
  family: CardFamily;
  damage: boolean;
  tactical: boolean;
  mana: boolean;
  manaSpender: boolean;
  movement: boolean;
  drawFilter: boolean;
  trashing: boolean;
  economy: boolean;
  requiredMana: boolean;
  requiredFodderFamily: CardFamily | null;
}

export interface ResponseCardRoles {
  cards: Readonly<Record<string, DerivedCardRole>>;
  damage: readonly string[];
  mana: readonly string[];
  movement: readonly string[];
  drawFilter: readonly string[];
  trashing: readonly string[];
  economy: readonly string[];
  familyFodder: Readonly<Partial<Record<CardFamily, readonly string[]>>>;
}

export interface DamageCore {
  id: string;
  cardIds: readonly string[];
  familyShape: 'single' | 'pure' | 'mixed';
}

export interface WeightedResponseParent { strategy: Strategy; weight: number }
export interface SemanticProposalOrigin {
  source: 'semantic';
  coreId: string;
  coreCardIds: string[];
  requiredEnablerIds: string[];
}
export interface LocalProposalOrigin {
  source: 'local';
  parentId: string;
  parentKind: 'support' | 'archive';
  operator: 'count-vector' | 'card' | 'order' | 'insertion' | 'deletion' | 'fallback' | 'unrestricted';
}
export interface UnrestrictedProposalOrigin { source: 'unrestricted' }
export type ResponseProposalOrigin = SemanticProposalOrigin | LocalProposalOrigin | UnrestrictedProposalOrigin;

export interface ResponseProposalDiagnostics {
  version: typeof RESPONSE_PORTFOLIO_VERSION;
  requestedCount: number;
  parentCount: number;
  supportParentCount: number;
  archiveParentCount: number;
  sourceCounts: Record<ResponseProposalSource, number>;
  recipeCoverage: {
    availableCoreIds: string[];
    coveredCoreIds: string[];
    recipesByCore: Record<string, number>;
  };
  duplicateRejections: number;
  proposalHash: string;
}

export interface ResponsePortfolioInput {
  kingdom: Kingdom;
  seed: number;
  count: number;
  excludedCanonical: ReadonlySet<string>;
  parents?: readonly WeightedResponseParent[];
  archiveParents?: readonly Strategy[];
}

export interface ResponsePortfolioResult {
  policies: Strategy[];
  sources: ResponseProposalSource[];
  origins: ResponseProposalOrigin[];
  diagnostics: ResponseProposalDiagnostics;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Derives proposal roles from the resolved card definitions and executable mechanics in one kingdom. */
export function deriveResponseCardRoles(kingdom: Kingdom): ResponseCardRoles {
  const definitions = kingdomMarket(kingdom.id).filter((card) => card.id !== 'copper' && card.cost > 0);
  const cards: Record<string, DerivedCardRole> = {};
  for (const card of definitions) {
    const values = card.values ?? {};
    const effect = EFFECTS[card.mechanic];
    cards[card.id] = {
      cardId: card.id, mechanic: card.mechanic, family: card.family,
      damage: DIRECT_DAMAGE_MECHANICS.has(card.mechanic), tactical: effect.tactical,
      mana: ['mana', 'farMana'].some((key) => (values[key] ?? 0) > 0),
      manaSpender: (values.manaCost ?? 0) > 0,
      movement: effect.choice === 'movement' || effect.choice === 'direction' || card.mechanic === 'repellingShot',
      drawFilter: ['draw', 'movedDraw', 'drawPerTrash', 'discard'].some((key) => (values[key] ?? 0) > 0)
        || card.mechanic === 'reclaim',
      trashing: TRASH_MECHANICS.has(card.mechanic),
      economy: card.type === 'treasure' || (values.money ?? card.money ?? 0) > 0,
      requiredMana: (values.manaCost ?? 0) > 0 || ['discharge', 'overload'].includes(card.mechanic),
      requiredFodderFamily: effect.target?.family ?? null
    };
  }
  const by = (key: keyof Pick<DerivedCardRole,
    'damage' | 'mana' | 'movement' | 'drawFilter' | 'trashing' | 'economy'>) =>
    Object.values(cards).filter((role) => role[key]).map((role) => role.cardId).sort();
  const familyFodder: Partial<Record<CardFamily, readonly string[]>> = {};
  for (const family of ['treasure', 'ranged', 'mana', 'melee', 'engine'] as const) {
    const ids = Object.values(cards).filter((role) => role.family === family).map((role) => role.cardId).sort();
    if (ids.length) familyFodder[family] = Object.freeze(ids);
  }
  return Object.freeze({ cards: Object.freeze(cards), damage: Object.freeze(by('damage')),
    mana: Object.freeze(by('mana')), movement: Object.freeze(by('movement')),
    drawFilter: Object.freeze(by('drawFilter')), trashing: Object.freeze(by('trashing')),
    economy: Object.freeze(by('economy')), familyFodder: Object.freeze(familyFodder) });
}

function requirementGroups(core: DamageCore, roles: ResponseCardRoles): string[][] | null {
  const groups: string[][] = [];
  for (const cardId of core.cardIds) {
    const role = roles.cards[cardId]!;
    if (role.requiredMana) groups.push(roles.mana.filter((id) => id !== cardId));
    if (role.mechanic === 'overload') {
      groups.push(Object.values(roles.cards).filter((entry) => entry.manaSpender && entry.cardId !== cardId)
        .map((entry) => entry.cardId).sort());
    }
    if (role.requiredFodderFamily) {
      groups.push((roles.familyFodder[role.requiredFodderFamily] ?? []).filter((id) => id !== cardId));
    }
    if (role.mechanic === 'improvise') {
      groups.push(Object.values(roles.cards).filter((entry) => entry.cardId !== cardId
        && ['mana', 'melee', 'ranged'].includes(entry.family)).map((entry) => entry.cardId).sort());
    }
    if (role.mechanic === 'flurry') {
      groups.push(Object.values(roles.cards).filter((entry) => entry.cardId !== cardId && entry.tactical)
        .map((entry) => entry.cardId).sort());
    }
  }
  return groups.some((group) => !group.length) ? null : groups;
}

export function responseDamageCores(roles: ResponseCardRoles): DamageCore[] {
  const cards = [...roles.damage].sort();
  const candidates: DamageCore[] = cards.map((cardId) => ({ id: cardId, cardIds: [cardId], familyShape: 'single' }));
  for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
    const cardIds = [cards[left]!, cards[right]!] as const;
    candidates.push({ id: cardIds.join('+'), cardIds,
      familyShape: roles.cards[cardIds[0]]!.family === roles.cards[cardIds[1]]!.family ? 'pure' : 'mixed' });
  }
  return candidates.filter((core) => requirementGroups(core, roles) !== null);
}

export function responsePortfolioAllocation(count: number, hasParents: boolean): Record<ResponseProposalSource, number> {
  if (!Number.isInteger(count) || count < 1) throw new Error('Proposal count must be a positive integer.');
  const weights: Record<ResponseProposalSource, number> = hasParents
    ? { semantic: 60, local: 25, unrestricted: 15 }
    : { semantic: 85, local: 0, unrestricted: 15 };
  const sources: ResponseProposalSource[] = ['semantic', 'local', 'unrestricted'];
  const result = Object.fromEntries(sources.map((source) =>
    [source, Math.floor(count * weights[source] / 100)])) as Record<ResponseProposalSource, number>;
  const remaining = count - sources.reduce((sum, source) => sum + result[source], 0);
  const order = [...sources].sort((left, right) =>
    (count * weights[right] % 100) - (count * weights[left] % 100) || sources.indexOf(left) - sources.indexOf(right));
  for (let index = 0; index < remaining; index += 1) result[order[index]!] += 1;
  return result;
}

function pick<T>(items: readonly T[], random: SeededRandom): T | undefined {
  return items.length ? items[random.nextInt(items.length)] : undefined;
}
function shuffle<T>(items: readonly T[], random: SeededRandom): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = random.nextInt(index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
function finite(cardId: string, count: number): `buy:${string}:${number}` {
  return `buy:${cardId}:${count}`;
}
function policyCardIds(policy: Strategy): Set<string> {
  return new Set(policy.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [slot.cardId] : []));
}

function semanticRecipe(
  core: DamageCore, roles: ResponseCardRoles, domain: ResponsePolicyDomain, random: SeededRandom
): { strategy: Strategy; requiredEnablerIds: string[] } | null {
  const groups = requirementGroups(core, roles);
  if (!groups) return null;
  const requiredEnablerIds = sortedUnique(groups.map((group) => pick(group, random)!));
  const requiredTokens = requiredEnablerIds.filter((id) => !core.cardIds.includes(id));
  const requiredSlots = core.cardIds.length + requiredTokens.length;
  if (requiredSlots > domain.maxPrefixSlots) return null;
  const optionalPool = sortedUnique([...roles.drawFilter, ...roles.movement, ...roles.trashing, ...roles.economy])
    .filter((id) => !core.cardIds.includes(id) && !requiredEnablerIds.includes(id));
  const optionalLimit = Math.min(3, optionalPool.length, domain.maxPrefixSlots - requiredSlots);
  const optionalCount = optionalLimit ? random.nextInt(optionalLimit + 1) : 0;
  const support = [...requiredTokens, ...shuffle(optionalPool, random).slice(0, optionalCount)];
  const damageTokens = core.cardIds.map((cardId) => finite(cardId, 1 + random.nextInt(5)));
  const supportTokens = support.map((cardId) => finite(cardId, 1 + random.nextInt(4)));
  const shape = random.nextInt(3);
  const prefix = shape === 0 ? [...damageTokens, ...supportTokens]
    : shape === 1 ? [...supportTokens, ...damageTokens]
      : [damageTokens[0]!, ...supportTokens, ...damageTokens.slice(1)];
  if (prefix.length > domain.maxPrefixSlots) return null;
  const fallbackCandidates = [...core.cardIds,
    ...roles.drawFilter.filter((id) => !roles.cards[id]!.requiredMana), ...roles.economy];
  const fallback = pick(fallbackCandidates, random) ?? core.cardIds[0]!;
  const strategy = domain.complete(prefix, `floor:${fallback}`);
  const retained = policyCardIds(strategy);
  if ([...core.cardIds, ...requiredEnablerIds].some((id) => !retained.has(id))) return null;
  return { strategy, requiredEnablerIds };
}

function compatibleCards(cardId: string, roles: ResponseCardRoles): string[] {
  const held = roles.cards[cardId];
  if (!held) return [];
  return sortedUnique(Object.values(roles.cards).filter((candidate) => candidate.cardId !== cardId
    && (candidate.family === held.family || candidate.damage && held.damage || candidate.mana && held.mana
      || candidate.movement && held.movement || candidate.drawFilter && held.drawFilter
      || candidate.trashing && held.trashing || candidate.economy && held.economy))
    .map((candidate) => candidate.cardId));
}

interface ParentSeed { strategy: Strategy; kind: 'support' | 'archive'; weight: number }
interface LocalCandidate { strategy: Strategy; operator: LocalProposalOrigin['operator'] }

function validParentSeeds(input: ResponsePortfolioInput, domain: ResponsePolicyDomain): {
  support: ParentSeed[]; archive: ParentSeed[];
} {
  const seen = new Set<string>();
  const valid = (strategy: Strategy): boolean => {
    try { domain.decode(strategy); } catch { return false; }
    const form = canonicalStrategy(strategy);
    if (seen.has(form)) return false;
    seen.add(form); return true;
  };
  const support = (input.parents ?? []).filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0
    && valid(entry.strategy)).map((entry) => ({ ...entry, kind: 'support' as const }))
    .sort((left, right) => right.weight - left.weight || left.strategy.id.localeCompare(right.strategy.id));
  const archive = (input.archiveParents ?? []).filter(valid)
    .map((strategy) => ({ strategy, weight: 0, kind: 'archive' as const }));
  return { support, archive };
}

function countVectorCandidates(parent: Strategy, domain: ResponsePolicyDomain): LocalCandidate[] {
  const decoded = domain.decode(parent);
  const buyIndexes = decoded.prefix.flatMap((token, index) => token.startsWith('buy:') ? [index] : []);
  if (!buyIndexes.length) return [];
  const count = RESPONSE_FINITE_COUNTS.length ** buyIndexes.length;
  const candidates: LocalCandidate[] = [];
  for (let vector = 0; vector < count; vector += 1) {
    let held = vector;
    const prefix = [...decoded.prefix];
    for (const index of buyIndexes) {
      const [, cardId] = prefix[index]!.split(':');
      prefix[index] = finite(cardId!, RESPONSE_FINITE_COUNTS[held % RESPONSE_FINITE_COUNTS.length]!);
      held = Math.floor(held / RESPONSE_FINITE_COUNTS.length);
    }
    candidates.push({ strategy: domain.complete(prefix, decoded.floor), operator: 'count-vector' });
  }
  return candidates;
}

function structuralCandidates(
  parent: Strategy, roles: ResponseCardRoles, domain: ResponsePolicyDomain
): LocalCandidate[] {
  const decoded = domain.decode(parent);
  const candidates: LocalCandidate[] = [];
  const add = (prefix: typeof decoded.prefix, floor: typeof decoded.floor,
    operator: LocalProposalOrigin['operator']): void => {
    candidates.push({ strategy: domain.complete(prefix, floor), operator });
  };
  for (let index = 0; index < decoded.prefix.length; index += 1) {
    const token = decoded.prefix[index]!;
    if (token.startsWith('buy:')) {
      const [, cardId, count] = token.split(':');
      for (const replacement of compatibleCards(cardId!, roles)) {
        const prefix = [...decoded.prefix]; prefix[index] = finite(replacement, Number(count));
        add(prefix, decoded.floor, 'card');
      }
    }
    const deleted = [...decoded.prefix]; deleted.splice(index, 1); add(deleted, decoded.floor, 'deletion');
    if (index + 1 < decoded.prefix.length) {
      const reordered = [...decoded.prefix];
      [reordered[index], reordered[index + 1]] = [reordered[index + 1]!, reordered[index]!];
      add(reordered, decoded.floor, 'order');
    }
  }
  if (decoded.prefix.length < domain.maxPrefixSlots) {
    for (let index = 0; index <= decoded.prefix.length; index += 1) for (const cardId of domain.purchaseIds) {
      for (const desiredCount of RESPONSE_FINITE_COUNTS) {
        const prefix = [...decoded.prefix]; prefix.splice(index, 0, finite(cardId, desiredCount));
        add(prefix, decoded.floor, 'insertion');
      }
    }
  }
  const currentFloor = decoded.floor.slice('floor:'.length);
  for (const cardId of sortedUnique([...roles.damage, ...roles.drawFilter, ...roles.economy])) {
    if (cardId !== currentFloor) add(decoded.prefix, `floor:${cardId}`, 'fallback');
  }
  return candidates;
}

function weightedSeed(parents: readonly ParentSeed[], random: SeededRandom): ParentSeed {
  const total = parents.reduce((sum, parent) => sum + parent.weight, 0);
  if (total <= 0) return parents[random.nextInt(parents.length)]!;
  const point = random.nextInt(0x1000000) / 0x1000000 * total;
  let held = 0;
  for (const parent of parents) { held += parent.weight; if (point < held) return parent; }
  return parents.at(-1)!;
}

function unrestrictedParentMutation(parent: Strategy, domain: ResponsePolicyDomain, random: SeededRandom): Strategy {
  const decoded = domain.decode(parent);
  const length = random.nextInt(domain.maxPrefixSlots + 1);
  const prefix = Array.from({ length }, () => domain.prefixTokens[random.nextInt(domain.prefixTokens.length)]!);
  if (decoded.prefix.length && prefix.length) prefix[random.nextInt(prefix.length)] = decoded.prefix[random.nextInt(decoded.prefix.length)]!;
  const floor = random.nextInt(3) === 0 ? decoded.floor
    : domain.floorTokens[random.nextInt(domain.floorTokens.length)]!;
  return domain.complete(prefix, floor);
}

/** Builds one deterministic semantic/local/unrestricted response-policy portfolio. */
export function proposeResponsePortfolio(input: ResponsePortfolioInput): ResponsePortfolioResult {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw new Error('Proposal seed must be a 32-bit integer.');
  }
  const domain = new ResponsePolicyDomain(input.kingdom.id, { maxActiveSlots: 8,
    allowStopTokens: false, allowNoBuyFloor: false });
  const roles = deriveResponseCardRoles(input.kingdom);
  const cores = responseDamageCores(roles);
  if (!cores.length) throw new Error(`${input.kingdom.id} has no credible purchasable damage path.`);
  const parentSeeds = validParentSeeds(input, domain);
  const parents = [...parentSeeds.support, ...parentSeeds.archive];
  const allocation = responsePortfolioAllocation(input.count, parents.length > 0);
  const random = new SeededRandom(input.seed);
  const forms = new Set(input.excludedCanonical);
  const policies: Strategy[] = [], sources: ResponseProposalSource[] = [], origins: ResponseProposalOrigin[] = [];
  const recipeCounts = Object.fromEntries(cores.map((core) => [core.id, 0])) as Record<string, number>;
  let duplicateRejections = 0;
  const accept = (policy: Strategy, origin: ResponseProposalOrigin): boolean => {
    const form = canonicalStrategy(policy);
    if (forms.has(form)) { duplicateRejections += 1; return false; }
    forms.add(form); policies.push(policy); sources.push(origin.source); origins.push(origin);
    if (origin.source === 'semantic') recipeCounts[origin.coreId] = (recipeCounts[origin.coreId] ?? 0) + 1;
    return true;
  };

  const coreOrder = shuffle(cores, random);
  let coreCursor = 0, semanticAccepted = 0;
  for (let attempts = 0; semanticAccepted < allocation.semantic; attempts += 1) {
    if (attempts >= Math.max(10_000, allocation.semantic * 512)) throw new Error('Semantic recipes exhausted their unique policy space.');
    if (coreCursor > 0 && coreCursor % cores.length === 0) coreOrder.splice(0, coreOrder.length, ...shuffle(cores, random));
    const core = coreOrder[coreCursor % cores.length]!;
    const recipe = semanticRecipe(core, roles, domain, random);
    if (recipe && accept(recipe.strategy, { source: 'semantic', coreId: core.id,
      coreCardIds: [...core.cardIds], requiredEnablerIds: recipe.requiredEnablerIds })) {
      coreCursor += 1; semanticAccepted += 1;
    }
  }

  let localAccepted = 0;
  const acceptLocal = (candidate: LocalCandidate, parent: ParentSeed): void => {
    if (localAccepted >= allocation.local || canonicalStrategy(candidate.strategy) === canonicalStrategy(parent.strategy)) return;
    if (accept(candidate.strategy, { source: 'local', parentId: parent.strategy.id,
      parentKind: parent.kind, operator: candidate.operator })) localAccepted += 1;
  };
  for (const parent of parentSeeds.support) {
    for (const candidate of countVectorCandidates(parent.strategy, domain)) acceptLocal(candidate, parent);
    if (localAccepted >= allocation.local) break;
  }
  for (const group of [parentSeeds.support, parentSeeds.archive]) for (const parent of group) {
    for (const candidate of structuralCandidates(parent.strategy, roles, domain)) acceptLocal(candidate, parent);
    if (localAccepted >= allocation.local) break;
  }
  const unrestrictedSeeds = parentSeeds.support.length ? parentSeeds.support : parentSeeds.archive;
  for (let attempts = 0; localAccepted < allocation.local; attempts += 1) {
    if (attempts >= Math.max(10_000, allocation.local * 1024)) throw new Error('Local mutations exhausted their unique policy space.');
    const parent = parentSeeds.support.length
      ? weightedSeed(unrestrictedSeeds, random) : unrestrictedSeeds[attempts % unrestrictedSeeds.length]!;
    acceptLocal({ strategy: unrestrictedParentMutation(parent.strategy, domain, random), operator: 'unrestricted' }, parent);
  }

  let unrestrictedAccepted = 0;
  for (let attempts = 0; unrestrictedAccepted < allocation.unrestricted; attempts += 1) {
    if (attempts >= Math.max(10_000, allocation.unrestricted * 512)) throw new Error('Uniform proposals exhausted their unique policy space.');
    if (accept(domain.randomComplete(random), { source: 'unrestricted' })) unrestrictedAccepted += 1;
  }
  if (policies.length !== input.count) throw new Error(`Proposal portfolio produced ${policies.length} of ${input.count} policies.`);
  const sourceCounts = {
    semantic: sources.filter((source) => source === 'semantic').length,
    local: sources.filter((source) => source === 'local').length,
    unrestricted: sources.filter((source) => source === 'unrestricted').length
  };
  const coveredCoreIds = cores.filter((core) => (recipeCounts[core.id] ?? 0) > 0).map((core) => core.id);
  const proposalHash = stableHash(policies.map((policy, index) =>
    `${JSON.stringify(origins[index])}:${canonicalStrategy(policy)}`).join('\n'));
  return { policies, sources, origins, diagnostics: {
    version: RESPONSE_PORTFOLIO_VERSION, requestedCount: input.count, parentCount: parents.length,
    supportParentCount: parentSeeds.support.length, archiveParentCount: parentSeeds.archive.length,
    sourceCounts, recipeCoverage: { availableCoreIds: cores.map((core) => core.id), coveredCoreIds, recipesByCore: recipeCounts },
    duplicateRejections, proposalHash
  } };
}
