import { kingdomFacts } from './mutation';
import { StableHashAccumulator, canonicalStrategy, fixedBuyPlan, identify, stableHash } from './strategy';
import type { Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export const ORDERED_GOLDFISH_RUNG_COUNT = 5;
export const ORDERED_GOLDFISH_DEFAULT_KINGDOM = 'deep-beam-tuning-009';
export const ORDERED_GOLDFISH_DEFAULT_LIMIT = 100_000;
export const ORDERED_GOLDFISH_DEFAULT_WORKERS = 10;
export const ORDERED_GOLDFISH_DEFAULT_SHUFFLES = 1;
export const ORDERED_GOLDFISH_DEFAULT_CHUNK_SIZE = 250;
export const ORDERED_GOLDFISH_TURN_LIMIT = 30;
export const ORDERED_GOLDFISH_ACTION_CAP = 200;
export const ORDERED_GOLDFISH_SEED_BASE = 4_100_000;
export const ORDERED_GOLDFISH_STRIDE_SEED = 0x9e37_79b1;
export const ORDERED_GOLDFISH_OFFSET_SEED = 0x85eb_ca6b;

export interface OrderedGoldfishCliOptions {
  kingdomId: string;
  limit: number;
  workers: number;
  shuffles: number;
  chunkSize: number;
  scorer: 'original' | 'lean' | 'rust';
  startPosition: number;
}

export interface CoprimeTraversalConfig {
  strideSeed: number;
  offsetSeed: number;
  stride: number;
  offset: number;
}

export interface OrderedCandidateSpace {
  cardIds: readonly string[];
  quantityVectors: readonly (readonly number[])[];
  skeletonCount: number;
  candidateCount: number;
  candidateAt(index: number): Strategy;
}

function nonnegativeInteger(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a nonnegative integer.`);
  return value;
}

function positiveInteger(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

export function parseOrderedGoldfishArgs(args: readonly string[]): OrderedGoldfishCliOptions {
  const values = new Map<string, string>();
  const supported = new Set(['kingdom', 'limit', 'count', 'workers', 'shuffles', 'chunk-size', 'scorer',
    'start-position']);
  for (let index = 0; index < args.length; index += 2) {
    const token = args[index]!;
    if (!token.startsWith('--') || !supported.has(token.slice(2))) {
      throw new Error(`Unknown ordered goldfish option: ${token}`);
    }
    const name = token.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
    if (values.has(name)) throw new Error(`--${name} can be specified only once.`);
    values.set(name, value);
  }
  if (values.has('limit') && values.has('count')) throw new Error('Use either --limit or --count, not both.');
  const scorer = values.get('scorer') ?? 'original';
  if (!['original', 'lean', 'rust'].includes(scorer)) throw new Error('--scorer must be original, lean, or rust.');
  return {
    kingdomId: values.get('kingdom') ?? ORDERED_GOLDFISH_DEFAULT_KINGDOM,
    limit: positiveInteger('limit', values.get('limit') ?? values.get('count') ?? String(ORDERED_GOLDFISH_DEFAULT_LIMIT)),
    workers: positiveInteger('workers', values.get('workers') ?? String(ORDERED_GOLDFISH_DEFAULT_WORKERS)),
    shuffles: positiveInteger('shuffles', values.get('shuffles') ?? String(ORDERED_GOLDFISH_DEFAULT_SHUFFLES)),
    chunkSize: positiveInteger('chunk-size', values.get('chunk-size') ?? String(ORDERED_GOLDFISH_DEFAULT_CHUNK_SIZE)),
    scorer: scorer as OrderedGoldfishCliOptions['scorer'],
    startPosition: nonnegativeInteger('start-position', values.get('start-position') ?? '0')
  };
}

export function orderedGoldfishQuantityVectors(): readonly (readonly number[])[] {
  const vectors: Array<readonly number[]> = [];
  for (let first = 1; first <= 4; first += 1) {
    for (let second = 1; second <= 4; second += 1) {
      for (let third = 1; third <= 4; third += 1) {
        const vector = [first, second, third, 3, 3];
        if (vector.reduce((sum, value) => sum + value, 0) <= 15) vectors.push(Object.freeze(vector));
      }
    }
  }
  return Object.freeze(vectors);
}

export function orderedPermutationCount(cardCount: number, rungCount = ORDERED_GOLDFISH_RUNG_COUNT): number {
  if (!Number.isSafeInteger(cardCount) || !Number.isSafeInteger(rungCount)
    || cardCount < rungCount || rungCount < 1) throw new Error('Ordered permutation dimensions are invalid.');
  let count = 1;
  for (let index = 0; index < rungCount; index += 1) count *= cardCount - index;
  if (!Number.isSafeInteger(count)) throw new Error('Ordered permutation count exceeds the safe integer range.');
  return count;
}

function orderedPermutationAt(cardIds: readonly string[], permutationIndex: number): string[] {
  const available = [...cardIds];
  const selected: string[] = [];
  let remainder = permutationIndex;
  for (let position = 0; position < ORDERED_GOLDFISH_RUNG_COUNT; position += 1) {
    const remainingSlots = ORDERED_GOLDFISH_RUNG_COUNT - position - 1;
    const blockSize = remainingSlots ? orderedPermutationCount(available.length - 1, remainingSlots) : 1;
    const selectedIndex = Math.floor(remainder / blockSize);
    remainder %= blockSize;
    selected.push(available.splice(selectedIndex, 1)[0]!);
  }
  return selected;
}

export function orderedGoldfishCardIds(kingdomId: string): string[] {
  return [...kingdomFacts(kingdomId).purchaseIds].sort(compareUtf16);
}

export function createOrderedCandidateSpace(inputCardIds: readonly string[]): OrderedCandidateSpace {
  const cardIds = [...inputCardIds].sort(compareUtf16);
  if (cardIds.length < ORDERED_GOLDFISH_RUNG_COUNT || new Set(cardIds).size !== cardIds.length) {
    throw new Error('Ordered goldfish candidates need at least five unique card IDs.');
  }
  const quantityVectors = orderedGoldfishQuantityVectors();
  const skeletonCount = orderedPermutationCount(cardIds.length);
  const candidateCount = skeletonCount * quantityVectors.length;
  return Object.freeze({ cardIds: Object.freeze(cardIds), quantityVectors, skeletonCount, candidateCount,
    candidateAt(index: number): Strategy {
      if (!Number.isSafeInteger(index) || index < 0 || index >= candidateCount) {
        throw new Error(`Candidate index must be from 0 through ${candidateCount - 1}.`);
      }
      const cardOrder = orderedPermutationAt(cardIds, Math.floor(index / quantityVectors.length));
      const quantities = quantityVectors[index % quantityVectors.length]!;
      return identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan(cardOrder.map((cardId, position) =>
        ({ kind: 'buy' as const, cardId, desiredCount: quantities[position]! }))) });
    }
  });
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left, b = right;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function coprimeTraversalConfig(total: number): CoprimeTraversalConfig {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('Traversal total must be a positive integer.');
  let stride = ORDERED_GOLDFISH_STRIDE_SEED % total;
  if (stride === 0) stride = 1;
  while (greatestCommonDivisor(stride, total) !== 1) stride += 1;
  return { strideSeed: ORDERED_GOLDFISH_STRIDE_SEED, offsetSeed: ORDERED_GOLDFISH_OFFSET_SEED,
    stride, offset: ORDERED_GOLDFISH_OFFSET_SEED % total };
}

export function candidateIndexAt(position: number, total: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position >= total) {
    throw new Error(`Traversal position must be from 0 through ${total - 1}.`);
  }
  const config = coprimeTraversalConfig(total);
  return Number((BigInt(config.offset) + BigInt(position) * BigInt(config.stride)) % BigInt(total));
}

export function* representativeCandidateIndices(
  total: number, limit: number, startPosition = 0
): Generator<number> {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(startPosition)
    || startPosition < 0 || startPosition + limit > total) {
    throw new Error('Traversal range must be inside the candidate count.');
  }
  if (limit === 0) return;
  const traversal = coprimeTraversalConfig(total);
  let candidate = candidateIndexAt(startPosition, total);
  for (let offset = 0; offset < limit; offset += 1) {
    yield candidate;
    candidate += traversal.stride;
    if (candidate >= total) candidate %= total;
  }
}

export function candidateChecksum(strategies: readonly Strategy[]): string {
  return stableHash(strategies.map(canonicalStrategy).join('\n'));
}

export function candidateChecksumFromIterable(strategies: Iterable<Strategy>): string {
  const digest = new StableHashAccumulator();
  let first = true;
  for (const strategy of strategies) {
    if (!first) digest.update('\n');
    digest.update(canonicalStrategy(strategy));
    first = false;
  }
  return digest.digest();
}
