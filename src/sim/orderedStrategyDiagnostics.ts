import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { cardDefinition } from '../game';
import {
  candidateIndexAt, coprimeTraversalConfig, createOrderedCandidateSpace,
  orderedGoldfishCardIds
} from './orderedGoldfishBenchmark';
import {
  ORDERED_PRODUCT_KINGDOM, validateOrderedProductRankedRecord
} from './orderedGoldfishProduct';
import type { OrderedProductRankedRecord } from './orderedGoldfishProduct';
import {
  INFINITE_COUNT, canonicalStrategy, fixedBuyPlan, formatSlot, identify
} from './strategy';
import type { BuySlot, Strategy } from './strategy';
import { compareUtf16 } from './utf16';

export interface OrderedCandidateMembership {
  representable: boolean;
  violations: string[];
  candidateIndex: number | null;
  traversalPosition: number | null;
}

function permutationIndex(cardIds: readonly string[], selected: readonly string[]): number {
  const available = [...cardIds];
  let result = 0;
  for (let position = 0; position < selected.length; position += 1) {
    const selectedIndex = available.indexOf(selected[position]!);
    if (selectedIndex < 0) throw new Error('Selected card is outside the ordered candidate space.');
    let block = 1;
    for (let count = 0; count < selected.length - position - 1; count += 1) {
      block *= available.length - 1 - count;
    }
    result += selectedIndex * block;
    available.splice(selectedIndex, 1);
  }
  return result;
}
function extendedGreatestCommonDivisor(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [divisor, x, y] = extendedGreatestCommonDivisor(b, a % b);
  return [divisor, y, x - (a / b) * y];
}
function traversalPositionForIndex(index: number, total: number): number {
  const traversal = coprimeTraversalConfig(total);
  const [divisor, inverse] = extendedGreatestCommonDivisor(BigInt(traversal.stride), BigInt(total));
  if (divisor !== 1n) throw new Error('Ordered traversal stride has no inverse.');
  const normalizedInverse = (inverse % BigInt(total) + BigInt(total)) % BigInt(total);
  const offset = (BigInt(index) - BigInt(traversal.offset) + BigInt(total)) % BigInt(total);
  const position = Number(offset * normalizedInverse % BigInt(total));
  if (candidateIndexAt(position, total) !== index) throw new Error('Ordered traversal inverse is invalid.');
  return position;
}

export function diagnoseOrderedCandidateMembership(
  strategy: Strategy, kingdomId = ORDERED_PRODUCT_KINGDOM
): OrderedCandidateMembership {
  const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
  const violations: string[] = [];
  if (strategy.startingBuild.length) violations.push(`starting build must be empty (found ${strategy.startingBuild.length} cards)`);
  const activePositions = strategy.buyPlan.flatMap((slot, index) => slot.kind === 'inactive' ? [] : [index]);
  const buys = strategy.buyPlan.flatMap((slot) => slot.kind === 'buy' ? [slot] : []);
  const stopPositions = strategy.buyPlan.flatMap((slot, index) => slot.kind === 'stop' ? [index + 1] : []);
  if (stopPositions.length) violations.push(`stop slots are not allowed (positions ${stopPositions.join(', ')})`);
  if (buys.length !== 5) violations.push(`purchase plan must contain exactly five buy slots (found ${buys.length})`);
  if (activePositions.join('|') !== '0|1|2|3|4') violations.push('the five buy slots must occupy the first five plan positions');
  const duplicateCards = [...new Set(buys.map((slot) => slot.cardId)
    .filter((cardId, index, all) => all.indexOf(cardId) !== index))].sort(compareUtf16);
  if (duplicateCards.length) violations.push(`purchase cards must be distinct (${duplicateCards.join(', ')})`);
  const outside = [...new Set(buys.map((slot) => slot.cardId).filter((cardId) => !space.cardIds.includes(cardId)))];
  if (outside.length) violations.push(`cards are outside the ordered Kingdom 009 space (${outside.join(', ')})`);
  buys.forEach((slot, index) => {
    if (slot.desiredCount === INFINITE_COUNT) violations.push(`buy ${index + 1} uses infinite count 99`);
    else if (index < 3 && (!Number.isSafeInteger(slot.desiredCount)
      || slot.desiredCount < 1 || slot.desiredCount > 4)) {
      violations.push(`buy ${index + 1} count must be from 1 through 4 (found ${slot.desiredCount})`);
    } else if (index >= 3 && slot.desiredCount !== 3) {
      violations.push(`buy ${index + 1} count must equal 3 (found ${slot.desiredCount})`);
    }
  });
  if (buys.length === 5 && buys.reduce((sum, slot) => sum + slot.desiredCount, 0) > 15) {
    violations.push('the five buy counts must sum to at most 15');
  }
  if (violations.length) return { representable: false, violations, candidateIndex: null, traversalPosition: null };
  const quantities = buys.map((slot) => slot.desiredCount);
  const quantityIndex = space.quantityVectors.findIndex((entry) => entry.join('|') === quantities.join('|'));
  if (quantityIndex < 0) return { representable: false,
    violations: ['buy counts are not one of the ordered quantity vectors'], candidateIndex: null,
    traversalPosition: null };
  const index = permutationIndex(space.cardIds, buys.map((slot) => slot.cardId))
    * space.quantityVectors.length + quantityIndex;
  return { representable: true, violations: [], candidateIndex: index,
    traversalPosition: traversalPositionForIndex(index, space.candidateCount) };
}

export interface OrderedAnalog {
  strategy: Strategy;
  changes: string[];
  sourceCardPositions: number[];
}
function orderedSubsequences<T>(values: readonly T[], count: number): Array<{ values: T[]; indexes: number[] }> {
  const result: Array<{ values: T[]; indexes: number[] }> = [];
  const visit = (start: number, held: T[], indexes: number[]): void => {
    if (held.length === count) { result.push({ values: [...held], indexes: [...indexes] }); return; }
    for (let index = start; index <= values.length - (count - held.length); index += 1) {
      visit(index + 1, [...held, values[index]!], [...indexes, index]);
    }
  };
  visit(0, [], []); return result;
}

export function nearestOrderedAnalogs(
  strategy: Strategy, kingdomId = ORDERED_PRODUCT_KINGDOM
): OrderedAnalog[] {
  const cardIds = orderedGoldfishCardIds(kingdomId);
  const legal = new Set(cardIds);
  const buys = strategy.buyPlan.flatMap((slot, index) => slot.kind === 'buy' && legal.has(slot.cardId)
    ? [{ slot, position: index }] : []);
  const unique: Array<{ slot: BuySlot; position: number }> = [];
  const seen = new Set<string>();
  for (const entry of buys) if (!seen.has(entry.slot.cardId)) { seen.add(entry.slot.cardId); unique.push(entry); }
  let orders: Array<{ values: Array<{ slot: BuySlot; position: number }>; indexes: number[] }>;
  if (unique.length >= 5) orders = orderedSubsequences(unique, 5);
  else {
    const filled = [...unique];
    for (const cardId of cardIds) {
      if (filled.length >= 5) break;
      if (!seen.has(cardId)) { seen.add(cardId); filled.push({ slot: { kind: 'buy', cardId, desiredCount: 1 }, position: -1 }); }
    }
    orders = [{ values: filled, indexes: filled.map((_entry, index) => index) }];
  }
  const deduplicated = new Map<string, OrderedAnalog>();
  for (const order of orders) {
    const slots = order.values.map((entry, index): BuySlot => ({ kind: 'buy', cardId: entry.slot.cardId,
      desiredCount: index < 3 ? Math.max(1, Math.min(4,
        entry.slot.desiredCount === INFINITE_COUNT ? 4 : entry.slot.desiredCount)) : 3 }));
    for (let index = 2; slots.reduce((sum, slot) => sum + slot.desiredCount, 0) > 15; index = (index + 2) % 3) {
      if (slots[index]!.desiredCount > 1) slots[index]!.desiredCount -= 1;
    }
    const analog = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan(slots) });
    const membership = diagnoseOrderedCandidateMembership(analog, kingdomId);
    if (!membership.representable) continue;
    const changes: string[] = [];
    if (strategy.startingBuild.length) changes.push('removed starting build');
    if (unique.length > 5) changes.push(`selected 5 of ${unique.length} distinct legal buy cards`);
    if (unique.length < 5) changes.push(`added ${5 - unique.length} deterministic legal buy cards`);
    slots.forEach((slot, index) => {
      const source = order.values[index]!.slot;
      if (slot.desiredCount !== source.desiredCount) changes.push(
        `${slot.cardId} count ${source.desiredCount === INFINITE_COUNT ? '∞' : source.desiredCount} → ${slot.desiredCount}`);
    });
    deduplicated.set(canonicalStrategy(analog), { strategy: analog, changes,
      sourceCardPositions: order.values.map((entry) => entry.position) });
  }
  return [...deduplicated.values()].sort((left, right) => {
    const leftAdded = left.sourceCardPositions.filter((index) => index < 0).length;
    const rightAdded = right.sourceCardPositions.filter((index) => index < 0).length;
    return leftAdded - rightAdded || left.changes.length - right.changes.length
      || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy));
  });
}

interface RankedPart { file: string; startIndex: number; endIndex: number; count: number; sha256: string }
interface SplitRankedManifest { recordCount: number; parts: RankedPart[] }
export interface RankedLookup {
  canonicalStrategy: string;
  displayId: string;
  traversalPosition: number;
  stageOneRank: number;
  rank: number;
  top20000: boolean;
}
export async function lookupSplitRankedStrategies(
  manifestFile: string, queries: ReadonlySet<string>
): Promise<Map<string, RankedLookup>> {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as SplitRankedManifest;
  if (!Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 1 || !Array.isArray(manifest.parts)) {
    throw new Error('Split ranked manifest is invalid.');
  }
  const found = new Map<string, RankedLookup>();
  let expectedStart = 0, total = 0;
  for (const part of manifest.parts) {
    if (part.startIndex !== expectedStart || part.endIndex - part.startIndex !== part.count
      || !/^[0-9a-f]{64}$/.test(part.sha256)) throw new Error('Split ranked part range is invalid.');
    const file = path.resolve(path.dirname(manifestFile), part.file);
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const hash = createHash('sha256'); let count = 0;
    for await (const line of lines) {
      hash.update(`${line}\n`); count += 1;
      const raw = JSON.parse(line) as OrderedProductRankedRecord;
      if (queries.has(raw.canonicalStrategy)) {
        if (!validateOrderedProductRankedRecord(raw) || found.has(raw.canonicalStrategy)) {
          throw new Error('Matched ranked strategy is invalid or duplicated.');
        }
        found.set(raw.canonicalStrategy, { canonicalStrategy: raw.canonicalStrategy,
          displayId: raw.displayId, traversalPosition: raw.traversalPosition,
          stageOneRank: raw.stageOneRank, rank: raw.rank, top20000: raw.rank <= 20_000 });
      }
    }
    if (count !== part.count || hash.digest('hex') !== part.sha256) {
      throw new Error(`Split ranked part failed count or SHA-256 validation: ${part.file}`);
    }
    total += count; expectedStart = part.endIndex;
  }
  if (total !== manifest.recordCount) throw new Error('Split ranked manifest record count differs.');
  return found;
}

export interface StrategyMechanicSummary {
  readablePlan: string;
  cardMechanics: Array<{ cardId: string; mechanic: string; startingBuildCopies: number;
    planPositions: number[] }>;
  acquisitionEvidence: 'not-recorded-score-only-audit';
}
export function strategyMechanicSummary(strategy: Strategy): StrategyMechanicSummary {
  const positions = new Map<string, number[]>();
  strategy.buyPlan.forEach((slot, index) => {
    if (slot.kind === 'buy') positions.set(slot.cardId, [...(positions.get(slot.cardId) ?? []), index + 1]);
  });
  const cards = new Set([...strategy.startingBuild, ...positions.keys()]);
  const activePlan = strategy.buyPlan.filter((slot) => slot.kind !== 'inactive').map(formatSlot);
  return { readablePlan: `build: ${strategy.startingBuild.join(', ') || 'none'}; plan: ${activePlan.join(' → ') || 'none'}`,
    cardMechanics: [...cards].sort(compareUtf16).map((cardId) => ({ cardId,
      mechanic: cardDefinition(cardId).mechanic,
      startingBuildCopies: strategy.startingBuild.filter((held) => held === cardId).length,
      planPositions: positions.get(cardId) ?? [] })),
    acquisitionEvidence: 'not-recorded-score-only-audit' };
}
