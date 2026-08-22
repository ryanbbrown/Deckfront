/**
 * Independent staged search for a strategy that exploits one discovery result.
 *
 * This deliberately does not use PSRO's candidate generator. It screens every legal starting build
 * with simple purchase floors, then spends deeper games only on survivors while adding finite and
 * stop slots. The result is broad enough to catch a weak discovery result without repeating the
 * one-off million-strategy Cartesian sweep.
 */
import { STARTING_BUDGET, createGame, resolveCard } from '../src/game';
import { kingdomFacts, repairStrategy } from '../src/sim/mutation';
import type { PairingRunner } from '../src/sim/pairingRunner';
import { INFINITE_COUNT, canonicalStrategy, fixedBuyPlan } from '../src/sim/strategy';
import type { BuyPlanSlot, Strategy } from '../src/sim/strategy';
import { headToHead, headToHeadStream, seedRange } from './headToHead';
import type { HeadToHeadScore } from './headToHead';

export const SCREEN_SEEDS = seedRange(1, 1);
export const LEAD_SEEDS = seedRange(21, 4);
export const EXTEND_SEEDS = seedRange(101, 8);
export const FINAL_SEEDS = seedRange(1001, 100);

const PURCHASE_COUNTS = [1, 2, 4];
const STOP_THRESHOLDS = [2, 3, 4, 5, 6];
const KEEP_SCREEN = 1_000;
const KEEP_LEAD = 300;
const KEEP_EXTEND = 50;

/** Every multiset of market cards the starting budget can pay for. */
export function everyBuild(kingdomId: string): string[][] {
  const probe = createGame({ seed: 1, kingdomId });
  const ordered = [...kingdomFacts(kingdomId).marketIds].sort((left, right) => left.localeCompare(right));
  const builds: string[][] = [];
  const walk = (index: number, left: number, current: string[]): void => {
    if (index === ordered.length) { builds.push([...current]); return; }
    const cardId = ordered[index]!;
    const cost = resolveCard(probe, cardId).cost;
    if (cost <= 0) { walk(index + 1, left, current); return; }
    for (let copies = 0; copies * cost <= left; copies += 1) {
      for (let added = 0; added < copies; added += 1) current.push(cardId);
      walk(index + 1, left - copies * cost, current);
      current.length -= copies;
    }
  };
  walk(0, STARTING_BUDGET, []);
  return builds;
}

export interface SweepResult {
  ranked: (HeadToHeadScore & { interval: { lower: number; upper: number } })[];
  exploitability: number;
  counts: { screened: number; led: number; extended: number; finalists: number };
  matches: number;
}

export type SweepReporter = (message: string) => void;

function activeSlots(strategy: Strategy): BuyPlanSlot[] {
  return strategy.buyPlan.filter((slot) => slot.kind !== 'inactive');
}

function uniqueStrategies(kingdomId: string, proposals: Iterable<Strategy>): Strategy[] {
  const seen = new Set<string>();
  const unique: Strategy[] = [];
  for (const proposal of proposals) {
    const strategy = repairStrategy(kingdomId, proposal);
    const form = canonicalStrategy(strategy);
    if (seen.has(form)) continue;
    seen.add(form);
    unique.push(strategy);
  }
  return unique;
}

export async function sweepAgainst(
  runner: PairingRunner, kingdomId: string, target: Strategy,
  bootstrap: (values: readonly number[]) => { lower: number; upper: number },
  report: SweepReporter = () => {}
): Promise<SweepResult> {
  const { purchaseIds } = kingdomFacts(kingdomId);
  const builds = everyBuild(kingdomId);
  let matches = 0;
  const count = (scores: readonly HeadToHeadScore[]): void => {
    for (const score of scores) matches += score.matches;
  };

  function* floors(): Generator<Strategy> {
    for (const startingBuild of builds) {
      yield repairStrategy(kingdomId, {
        id: '', startingBuild, buyPlan: fixedBuyPlan([{ kind: 'stop', threshold: 0 }])
      });
      for (const cardId of purchaseIds) yield repairStrategy(kingdomId, {
        id: '', startingBuild,
        buyPlan: fixedBuyPlan([{ kind: 'buy', cardId, desiredCount: INFINITE_COUNT }])
      });
    }
  }

  report(`screening ${builds.length} builds x ${purchaseIds.length + 1} simple floors`);
  const screened = await headToHeadStream(runner, kingdomId, floors(), target, SCREEN_SEEDS,
    10_000, KEEP_SCREEN);
  matches += screened.matches;

  const leadProposals: Strategy[] = [];
  for (const entry of screened.best) {
    const floor = activeSlots(entry.strategy);
    leadProposals.push(entry.strategy);
    for (const cardId of purchaseIds) for (const desiredCount of PURCHASE_COUNTS) {
      leadProposals.push({ ...entry.strategy, buyPlan: fixedBuyPlan([
        { kind: 'buy', cardId, desiredCount }, ...floor
      ]) });
    }
  }
  const leads = uniqueStrategies(kingdomId, leadProposals);
  report(`testing one finite slot on ${screened.best.length} survivors (${leads.length} strategies)`);
  const led = await headToHeadStream(runner, kingdomId, leads, target, LEAD_SEEDS,
    10_000, KEEP_LEAD);
  matches += led.matches;

  const extensionProposals: Strategy[] = [];
  for (const entry of led.best) {
    const slots = activeSlots(entry.strategy);
    extensionProposals.push(entry.strategy);
    for (const cardId of purchaseIds) for (const desiredCount of PURCHASE_COUNTS) {
      const buy = { kind: 'buy' as const, cardId, desiredCount };
      extensionProposals.push({ ...entry.strategy, buyPlan: fixedBuyPlan([buy, ...slots]) });
      extensionProposals.push({ ...entry.strategy, buyPlan: fixedBuyPlan([
        slots[0]!, buy, ...slots.slice(1)
      ]) });
    }
    for (const threshold of STOP_THRESHOLDS) {
      const stop = { kind: 'stop' as const, threshold };
      extensionProposals.push({ ...entry.strategy, buyPlan: fixedBuyPlan([stop, ...slots]) });
      extensionProposals.push({ ...entry.strategy, buyPlan: fixedBuyPlan([
        slots[0]!, stop, ...slots.slice(1)
      ]) });
    }
  }
  const extensions = uniqueStrategies(kingdomId, extensionProposals);
  report(`testing a second finite or stop slot on ${led.best.length} survivors (${extensions.length} strategies)`);
  const extended = await headToHeadStream(runner, kingdomId, extensions, target, EXTEND_SEEDS,
    5_000, KEEP_EXTEND);
  matches += extended.matches;

  const finalists = extended.best.map((entry) => entry.strategy);
  report(`confirming ${finalists.length} finalists on ${FINAL_SEEDS.length} held-out seeds`);
  const confirmed = await headToHead(runner, kingdomId, finalists, target, FINAL_SEEDS, 50);
  count(confirmed);

  const ranked = confirmed
    .map((entry) => ({ ...entry, interval: bootstrap(entry.blockScores) }))
    .sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
  return {
    ranked, exploitability: ranked[0]?.mean ?? 0.5, matches,
    counts: { screened: screened.count, led: leads.length,
      extended: extensions.length, finalists: finalists.length }
  };
}
