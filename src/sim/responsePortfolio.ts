import { EFFECTS, SeededRandom, kingdomMarket } from '../game';
import type { CardDefinition, CardFamily, Kingdom } from '../game';
import { ResponsePolicyDomain } from './responsePolicyGrammar';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const RESPONSE_PORTFOLIO_VERSION = 'response-portfolio-v1';
export type ResponseProposalSource = 'semantic' | 'local' | 'unrestricted';

export interface DerivedCardRole {
  cardId: string;
  family: CardFamily;
  damage: boolean;
  mana: boolean;
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

export interface ResponseProposalDiagnostics {
  version: typeof RESPONSE_PORTFOLIO_VERSION;
  requestedCount: number;
  parentCount: number;
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
  parents?: readonly Strategy[];
}

export interface ResponsePortfolioResult {
  policies: Strategy[];
  sources: ResponseProposalSource[];
  diagnostics: ResponseProposalDiagnostics;
}

const DAMAGE_MECHANICS = new Set([
  'melee', 'drive', 'flurry', 'ranged', 'volley', 'repellingShot', 'spell', 'discharge', 'cascade',
  'overload', 'openingStrike', 'rally', 'bullRush', 'longshot', 'salvageShot', 'precisionShot',
  'discipline', 'improvise', 'scrap'
]);
const TRASH_MECHANICS = new Set(['cull', 'discipline', 'sharpen', 'reforge', 'scour']);
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
      cardId: card.id,
      family: card.family,
      damage: DAMAGE_MECHANICS.has(card.mechanic),
      mana: ['mana', 'farMana'].some((key) => (values[key] ?? 0) > 0),
      movement: effect.choice === 'movement' || effect.choice === 'direction' || card.mechanic === 'repellingShot',
      drawFilter: ['draw', 'movedDraw', 'drawPerTrash', 'discard'].some((key) => (values[key] ?? 0) > 0)
        || card.mechanic === 'reclaim',
      trashing: TRASH_MECHANICS.has(card.mechanic),
      economy: card.type === 'treasure' || (values.money ?? card.money ?? 0) > 0,
      requiredMana: (values.manaCost ?? 0) > 0 || ['discharge', 'overload'].includes(card.mechanic),
      requiredFodderFamily: effect.target?.family ?? null
    };
  }
  const by = (key: keyof Pick<DerivedCardRole, 'damage' | 'mana' | 'movement' | 'drawFilter' | 'trashing' | 'economy'>) =>
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

export function responseDamageCores(roles: ResponseCardRoles): DamageCore[] {
  const cards = [...roles.damage].sort();
  const cores: DamageCore[] = cards.map((cardId) => ({ id: cardId, cardIds: [cardId], familyShape: 'single' }));
  for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
    const cardIds = [cards[left]!, cards[right]!] as const;
    cores.push({ id: cardIds.join('+'), cardIds,
      familyShape: roles.cards[cardIds[0]]!.family === roles.cards[cardIds[1]]!.family ? 'pure' : 'mixed' });
  }
  return cores;
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

function compatibleCards(cardId: string, roles: ResponseCardRoles): string[] {
  const held = roles.cards[cardId];
  if (!held) return [];
  const matching = Object.values(roles.cards).filter((candidate) => candidate.cardId !== cardId
    && (candidate.family === held.family
      || candidate.damage && held.damage || candidate.mana && held.mana || candidate.movement && held.movement
      || candidate.drawFilter && held.drawFilter || candidate.trashing && held.trashing
      || candidate.economy && held.economy)).map((candidate) => candidate.cardId);
  return sortedUnique(matching);
}

function requiredEnablers(core: DamageCore, roles: ResponseCardRoles, definitions: ReadonlyMap<string, CardDefinition>): string[] {
  const required: string[] = [];
  for (const cardId of core.cardIds) {
    const role = roles.cards[cardId]!;
    const definition = definitions.get(cardId)!;
    if (role.requiredMana) {
      const mana = roles.mana.filter((id) => !core.cardIds.includes(id));
      const chosen = mana[0]; if (chosen) required.push(chosen);
    }
    if (definition.mechanic === 'overload') {
      const spender = roles.damage.find((id) => (definitions.get(id)?.values?.manaCost ?? 0) > 0);
      if (spender) required.push(spender);
    }
    if (role.requiredFodderFamily) {
      const fodder = roles.familyFodder[role.requiredFodderFamily]?.find((id) => id !== cardId)
        ?? roles.familyFodder[role.requiredFodderFamily]?.[0];
      if (fodder) required.push(fodder);
    }
    if (definition.mechanic === 'improvise') {
      const fodder = Object.values(roles.cards).find((entry) =>
        ['mana', 'melee', 'ranged'].includes(entry.family) && entry.cardId !== cardId)?.cardId;
      if (fodder) required.push(fodder);
    }
    if (definition.mechanic === 'flurry') {
      const action = roles.damage.find((id) => id !== cardId);
      if (action) required.push(action);
    }
  }
  return sortedUnique(required);
}

function semanticRecipe(
  core: DamageCore, roles: ResponseCardRoles, definitions: ReadonlyMap<string, CardDefinition>,
  domain: ResponsePolicyDomain, random: SeededRandom
): Strategy {
  const required = requiredEnablers(core, roles, definitions);
  const optionalPool = sortedUnique([...roles.drawFilter, ...roles.movement, ...roles.trashing, ...roles.economy])
    .filter((id) => !core.cardIds.includes(id) && !required.includes(id));
  const optionalCount = optionalPool.length ? random.nextInt(Math.min(3, optionalPool.length) + 1) : 0;
  const optional = shuffle(optionalPool, random).slice(0, optionalCount);
  const support = [...required, ...optional];
  const damageTokens = core.cardIds.map((cardId) => finite(cardId, 1 + random.nextInt(5)));
  const supportTokens = support.map((cardId) => finite(cardId, 1 + random.nextInt(4)));
  const shape = random.nextInt(3);
  let prefix = shape === 0 ? [...damageTokens, ...supportTokens]
    : shape === 1 ? [...supportTokens, ...damageTokens]
      : [damageTokens[0]!, ...supportTokens, ...damageTokens.slice(1)];
  if (prefix.length > domain.maxPrefixSlots) prefix = prefix.slice(0, domain.maxPrefixSlots);
  const fallbackCandidates = [...core.cardIds,
    ...roles.drawFilter.filter((id) => !roles.cards[id]!.requiredMana),
    ...roles.economy];
  const fallback = pick(fallbackCandidates, random) ?? core.cardIds[0]!;
  return domain.complete(prefix, `floor:${fallback}`);
}

function localMutation(
  parent: Strategy, roles: ResponseCardRoles, domain: ResponsePolicyDomain, random: SeededRandom
): Strategy | null {
  let decoded: ReturnType<ResponsePolicyDomain['decode']>;
  try { decoded = domain.decode(parent); } catch { return null; }
  const prefix = [...decoded.prefix];
  const operation = random.nextInt(6);
  if (operation === 0) {
    const buys = prefix.flatMap((token, index) => token.startsWith('buy:') ? [index] : []);
    const index = pick(buys, random); if (index === undefined) return null;
    const [kind, cardId, raw] = prefix[index]!.split(':');
    let count = 1 + random.nextInt(5); if (count === Number(raw)) count = count % 5 + 1;
    prefix[index] = `${kind}:${cardId}:${count}` as typeof prefix[number];
  } else if (operation === 1) {
    const buys = prefix.flatMap((token, index) => token.startsWith('buy:') ? [index] : []);
    const index = pick(buys, random); if (index === undefined) return null;
    const [, cardId, count] = prefix[index]!.split(':');
    const replacement = pick(compatibleCards(cardId!, roles), random); if (!replacement) return null;
    prefix[index] = finite(replacement, Number(count));
  } else if (operation === 2) {
    if (prefix.length < 2) return null;
    const index = random.nextInt(prefix.length - 1);
    [prefix[index], prefix[index + 1]] = [prefix[index + 1]!, prefix[index]!];
  } else if (operation === 3) {
    if (prefix.length >= domain.maxPrefixSlots) return null;
    const anchor = prefix.length ? prefix[random.nextInt(prefix.length)]!.split(':')[1] : undefined;
    const candidates = anchor ? compatibleCards(anchor, roles) : roles.damage;
    const cardId = pick(candidates.length ? candidates : domain.purchaseIds, random); if (!cardId) return null;
    prefix.splice(random.nextInt(prefix.length + 1), 0, finite(cardId, 1 + random.nextInt(5)));
  } else if (operation === 4) {
    if (!prefix.length) return null;
    prefix.splice(random.nextInt(prefix.length), 1);
  } else {
    const current = decoded.floor.slice('floor:'.length);
    const candidates = sortedUnique([...roles.damage, ...roles.drawFilter, ...roles.economy]).filter((id) => id !== current);
    const replacement = pick(candidates, random); if (!replacement) return null;
    decoded = { ...decoded, floor: `floor:${replacement}` };
  }
  return domain.complete(prefix, decoded.floor);
}

function validParents(parents: readonly Strategy[], domain: ResponsePolicyDomain): Strategy[] {
  const seen = new Set<string>();
  return parents.filter((parent) => {
    try { domain.decode(parent); } catch { return false; }
    const form = canonicalStrategy(parent);
    if (seen.has(form)) return false;
    seen.add(form); return true;
  });
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
  const parents = validParents(input.parents ?? [], domain);
  const allocation = responsePortfolioAllocation(input.count, parents.length > 0);
  const random = new SeededRandom(input.seed);
  const definitions = new Map(kingdomMarket(input.kingdom.id).map((card) => [card.id, card]));
  const forms = new Set(input.excludedCanonical);
  const policies: Strategy[] = [], sources: ResponseProposalSource[] = [];
  const recipeCounts = Object.fromEntries(cores.map((core) => [core.id, 0])) as Record<string, number>;
  let duplicateRejections = 0;
  const accept = (policy: Strategy, source: ResponseProposalSource, core?: DamageCore): boolean => {
    const form = canonicalStrategy(policy);
    if (forms.has(form)) { duplicateRejections += 1; return false; }
    forms.add(form); policies.push(policy); sources.push(source);
    if (core) recipeCounts[core.id] = (recipeCounts[core.id] ?? 0) + 1;
    return true;
  };

  const coreOrder = shuffle(cores, random);
  let coreCursor = 0, semanticAccepted = 0;
  for (let attempts = 0; semanticAccepted < allocation.semantic; attempts += 1) {
    if (attempts >= Math.max(10_000, allocation.semantic * 512)) throw new Error('Semantic recipes exhausted their unique policy space.');
    if (coreCursor > 0 && coreCursor % cores.length === 0) coreOrder.splice(0, coreOrder.length, ...shuffle(cores, random));
    const core = coreOrder[coreCursor % cores.length]!;
    if (accept(semanticRecipe(core, roles, definitions, domain, random), 'semantic', core)) {
      coreCursor += 1; semanticAccepted += 1;
    }
  }

  const localPool = [...parents];
  let localAccepted = 0;
  for (let attempts = 0; localAccepted < allocation.local; attempts += 1) {
    if (attempts >= Math.max(10_000, allocation.local * 1024)) throw new Error('Local mutations exhausted their unique policy space.');
    const parent = localPool[random.nextInt(localPool.length)]!;
    const child = localMutation(parent, roles, domain, random);
    if (child && canonicalStrategy(child) !== canonicalStrategy(parent) && accept(child, 'local')) {
      localPool.push(child); localAccepted += 1;
    }
  }

  let unrestrictedAccepted = 0;
  for (let attempts = 0; unrestrictedAccepted < allocation.unrestricted; attempts += 1) {
    if (attempts >= Math.max(10_000, allocation.unrestricted * 512)) throw new Error('Uniform proposals exhausted their unique policy space.');
    if (accept(domain.randomComplete(random), 'unrestricted')) unrestrictedAccepted += 1;
  }
  if (policies.length !== input.count) throw new Error(`Proposal portfolio produced ${policies.length} of ${input.count} policies.`);
  const sourceCounts = {
    semantic: sources.filter((source) => source === 'semantic').length,
    local: sources.filter((source) => source === 'local').length,
    unrestricted: sources.filter((source) => source === 'unrestricted').length
  };
  const coveredCoreIds = cores.filter((core) => (recipeCounts[core.id] ?? 0) > 0).map((core) => core.id);
  const proposalHash = stableHash(policies.map((policy, index) =>
    `${sources[index]}:${canonicalStrategy(policy)}`).join('\n'));
  return { policies, sources, diagnostics: {
    version: RESPONSE_PORTFOLIO_VERSION, requestedCount: input.count, parentCount: parents.length,
    sourceCounts, recipeCoverage: { availableCoreIds: cores.map((core) => core.id), coveredCoreIds, recipesByCore: recipeCounts },
    duplicateRejections, proposalHash
  } };
}
