import { SeededRandom } from '../game';
import type { CandidateEvaluation } from './mixtureEvaluation';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';
import type { FloorToken, PrefixToken } from './responsePolicyGrammar';
import { ResponsePolicyDomain } from './responsePolicyGrammar';
import type { TrainingCurvePoint } from './budgetedResponseObjective';

export interface ObjectiveLike {
  readonly budget: number;
  readonly remaining: number;
  readonly blocksConsumed: number;
  readonly matchesConsumed: number;
  readonly curve: readonly TrainingCurvePoint[];
  canEvaluate(candidateCount: number, blocks: number): boolean;
  evaluate(candidates: readonly Strategy[], blocks: number): Promise<CandidateEvaluation[]>;
  aggregate(strategy: Strategy): { mean: number; blocks: number } | null;
}

export type ResponseOptimizerName = 'stratified-beam' | 'uniform-random-racing' | 'discrete-cem' | 'uct-mcts';
export interface ResponseOptimizerResult {
  optimizer: ResponseOptimizerName;
  policy: Strategy;
  trainingMean: number;
  candidateBlocks: number;
  matches: number;
  curve: TrainingCurvePoint[];
  finalists: Strategy[];
  diagnostics: Record<string, unknown>;
}

function ordered(evaluations: readonly CandidateEvaluation[]): CandidateEvaluation[] {
  return [...evaluations].sort((left, right) => right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id));
}

function result(
  optimizer: ResponseOptimizerName, finalists: readonly Strategy[], objective: ObjectiveLike,
  fallbackMean: number, diagnostics: Record<string, unknown>
): ResponseOptimizerResult {
  const policy = finalists[0];
  if (!policy) throw new Error(`${optimizer} produced no finalist.`);
  return { optimizer, policy, finalists: [...finalists],
    trainingMean: objective.aggregate(policy)?.mean ?? fallbackMean,
    candidateBlocks: objective.blocksConsumed, matches: objective.matchesConsumed,
    curve: [...objective.curve], diagnostics };
}

function searchRemaining(objective: ObjectiveLike, searchBudget: number | undefined): number {
  return Math.max(0, Math.min(objective.remaining,
    (searchBudget ?? objective.budget) - objective.blocksConsumed));
}

interface RankedPolicy { strategy: Strategy; mean: number }
function retainRanked(pool: RankedPolicy[], entries: readonly RankedPolicy[], count = 32): void {
  const byForm = new Map(pool.map((entry) => [canonicalStrategy(entry.strategy), entry]));
  for (const entry of entries) {
    const form = canonicalStrategy(entry.strategy);
    const held = byForm.get(form);
    if (!held || entry.mean > held.mean) byForm.set(form, entry);
  }
  pool.splice(0, pool.length, ...[...byForm.values()].sort((left, right) => right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id)).slice(0, count));
}

export interface FinalReraceOptions { candidateCount: number; blocksPerCandidate: number }

/** Selects every optimizer's returned policy on the same reserved training evidence. */
export async function runFinalTrainingRerace(
  objective: ObjectiveLike, search: ResponseOptimizerResult, options: FinalReraceOptions
): Promise<ResponseOptimizerResult> {
  const seen = new Set<string>();
  const candidates = search.finalists.filter((strategy) => {
    const form = canonicalStrategy(strategy);
    if (seen.has(form)) return false;
    seen.add(form); return true;
  }).slice(0, options.candidateCount);
  const blocks = Math.min(options.blocksPerCandidate, Math.floor(objective.remaining / candidates.length));
  if (!candidates.length || blocks < 1) throw new Error(`${search.optimizer} has no budgeted final rerace.`);
  const reraced = ordered(await objective.evaluate(candidates, blocks));
  const best = reraced[0]!;
  return { ...search, policy: best.strategy, finalists: reraced.map((entry) => entry.strategy),
    trainingMean: best.mean, candidateBlocks: objective.blocksConsumed,
    matches: objective.matchesConsumed, curve: [...objective.curve], diagnostics: {
      ...search.diagnostics,
      finalRerace: { blocksPerCandidate: blocks, candidates: reraced.map((entry) => ({
        policyId: entry.strategy.id, mean: entry.mean, matches: entry.matches
      })) }
    } };
}

export interface RandomRacingOptions {
  batchSize?: number;
  roundBlocks?: readonly number[];
  searchBudget?: number;
  excludedCanonical?: ReadonlySet<string>;
}

function racingCost(initial: number, rounds: readonly number[]): number {
  let field = initial;
  let cost = 0;
  for (const blocks of rounds) {
    cost += field * blocks;
    field = field <= 3 ? 1 : Math.max(3, Math.ceil(field / 3));
  }
  return cost;
}

/** Uniformly samples complete policies, then applies successive halving on disjoint block rounds. */
export async function runUniformRandomRacing(
  objective: ObjectiveLike, domain: ResponsePolicyDomain, seed: number, options: RandomRacingOptions = {}
): Promise<ResponseOptimizerResult> {
  const random = new SeededRandom(seed);
  const batchSize = options.batchSize ?? 96;
  const roundBlocks = options.roundBlocks ?? [1, 2, 4, 8];
  const seen = new Set<string>();
  const finalists: RankedPolicy[] = [];
  let races = 0;
  const rounds: { entered: number; blocks: number; survivors: number }[] = [];
  while (searchRemaining(objective, options.searchBudget) > 0) {
    const available = searchRemaining(objective, options.searchBudget);
    let wanted = Math.min(batchSize, available);
    while (wanted > 0 && racingCost(wanted, roundBlocks) > available) wanted -= 1;
    if (!wanted) break;
    const field: Strategy[] = [];
    for (let attempts = 0; field.length < wanted && attempts < wanted * 128; attempts += 1) {
      const policy = domain.randomComplete(random);
      const form = canonicalStrategy(policy);
      if (options.excludedCanonical?.has(form) || seen.has(form)) continue;
      seen.add(form); field.push(policy);
    }
    if (!field.length) break;
    let survivors = field;
    let last: CandidateEvaluation[] = [];
    for (const blocks of roundBlocks) {
      last = ordered(await objective.evaluate(survivors, blocks));
      const keep = last.length <= 3 ? 1 : Math.max(3, Math.ceil(last.length / 3));
      survivors = last.slice(0, keep).map((entry) => entry.strategy);
      rounds.push({ entered: last.length, blocks, survivors: survivors.length });
    }
    retainRanked(finalists, last.map((entry) => ({ strategy: entry.strategy, mean: entry.mean })));
    races += 1;
  }
  if (!finalists.length) throw new Error('Uniform length-then-token sampling could not evaluate a policy.');
  return result('uniform-random-racing', finalists.slice(0, 8).map((entry) => entry.strategy),
    objective, finalists[0]!.mean,
    { sampling: 'uniform-length-then-uniform-tokens', races, uniquePolicies: seen.size, rounds });
}

interface Distribution { values: readonly string[]; probabilities: number[] }

function uniform(values: readonly string[]): Distribution {
  return { values, probabilities: values.map(() => 1 / values.length) };
}

function sampleDistribution(distribution: Distribution, random: SeededRandom): string {
  const point = random.nextInt(0x1000000) / 0x1000000;
  let total = 0;
  for (let index = 0; index < distribution.values.length; index += 1) {
    total += distribution.probabilities[index]!;
    if (point < total) return distribution.values[index]!;
  }
  return distribution.values.at(-1)!;
}

function updateDistribution(
  current: Distribution, observations: readonly string[], smoothing: number, explorationFloor: number
): Distribution {
  const counts = new Map<string, number>();
  for (const value of observations) counts.set(value, (counts.get(value) ?? 0) + 1);
  const empirical = current.values.map((value) => (counts.get(value) ?? 0) / observations.length);
  const probabilities = current.probabilities.map((held, index) =>
    (1 - explorationFloor) * ((1 - smoothing) * held + smoothing * empirical[index]!)
      + explorationFloor / current.values.length);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return { values: current.values, probabilities: probabilities.map((value) => value / total) };
}

export interface CemModelOptions { smoothing?: number; explorationFloor?: number }

/** A length model plus first-order ordered token and terminal-floor dependencies. */
export class DependencyAwareCemModel {
  private lengths: Distribution;
  private readonly prefixes = new Map<string, Distribution>();
  private readonly floors = new Map<string, Distribution>();
  readonly smoothing: number;
  readonly explorationFloor: number;

  constructor(readonly domain: ResponsePolicyDomain, options: CemModelOptions = {}) {
    this.smoothing = options.smoothing ?? 0.35;
    this.explorationFloor = options.explorationFloor ?? 0.03;
    this.lengths = uniform(Array.from({ length: domain.maxPrefixSlots + 1 }, (_unused, index) => String(index)));
  }

  sample(random: SeededRandom): Strategy {
    const length = Number(sampleDistribution(this.lengths, random));
    const prefix: PrefixToken[] = [];
    let previous = '<start>';
    for (let position = 0; position < length; position += 1) {
      const context = this.prefixContext(length, position, previous);
      const token = sampleDistribution(
        this.prefixes.get(context) ?? uniform(this.domain.prefixTokens), random
      ) as PrefixToken;
      prefix.push(token); previous = token;
    }
    const floor = sampleDistribution(
      this.floors.get(this.floorContext(length, previous)) ?? uniform(this.domain.floorTokens), random
    ) as FloorToken;
    return this.domain.complete(prefix, floor);
  }

  update(elites: readonly Strategy[]): void {
    if (!elites.length) throw new Error('CEM needs at least one elite complete policy.');
    const decoded = elites.map((policy) => this.domain.decode(policy));
    this.lengths = updateDistribution(this.lengths, decoded.map((entry) => String(entry.prefix.length)),
      this.smoothing, this.explorationFloor);
    const prefixObservations = new Map<string, string[]>();
    const floorObservations = new Map<string, string[]>();
    for (const entry of decoded) {
      let previous = '<start>';
      for (let position = 0; position < entry.prefix.length; position += 1) {
        const context = this.prefixContext(entry.prefix.length, position, previous);
        const values = prefixObservations.get(context) ?? [];
        values.push(entry.prefix[position]!); prefixObservations.set(context, values);
        previous = entry.prefix[position]!;
      }
      const floorContext = this.floorContext(entry.prefix.length, previous);
      const values = floorObservations.get(floorContext) ?? [];
      values.push(entry.floor); floorObservations.set(floorContext, values);
    }
    for (const [context, values] of prefixObservations) {
      this.prefixes.set(context, updateDistribution(
        this.prefixes.get(context) ?? uniform(this.domain.prefixTokens), values,
        this.smoothing, this.explorationFloor));
    }
    for (const [context, values] of floorObservations) {
      this.floors.set(context, updateDistribution(
        this.floors.get(context) ?? uniform(this.domain.floorTokens), values,
        this.smoothing, this.explorationFloor));
    }
  }

  prefixProbability(length: number, position: number, previous: string, token: PrefixToken): number {
    const distribution = this.prefixes.get(this.prefixContext(length, position, previous))
      ?? uniform(this.domain.prefixTokens);
    return distribution.probabilities[distribution.values.indexOf(token)] ?? 0;
  }

  floorProbability(length: number, previous: string, floor: FloorToken): number {
    const distribution = this.floors.get(this.floorContext(length, previous)) ?? uniform(this.domain.floorTokens);
    return distribution.probabilities[distribution.values.indexOf(floor)] ?? 0;
  }

  private prefixContext(_length: number, position: number, previous: string): string {
    return `${positionBucket(position)}:${previous}`;
  }
  private floorContext(length: number, previous: string): string {
    return `${positionBucket(length)}:${previous}`;
  }
}

function positionBucket(position: number): string {
  return position === 0 ? 'first' : position < 3 ? 'early' : 'late';
}

export interface CemOptions extends CemModelOptions {
  population?: number;
  evaluationBlocks?: number;
  eliteFraction?: number;
  searchBudget?: number;
}

/** Discrete cross-entropy search over complete ordered policies. */
export async function runDiscreteCem(
  objective: ObjectiveLike, domain: ResponsePolicyDomain, seed: number, options: CemOptions = {}
): Promise<ResponseOptimizerResult> {
  const random = new SeededRandom(seed);
  const model = new DependencyAwareCemModel(domain, options);
  const population = options.population ?? 96;
  const evaluationBlocks = options.evaluationBlocks ?? 4;
  const eliteFraction = options.eliteFraction ?? 0.2;
  const finalists: RankedPolicy[] = [];
  let generations = 0;
  const history: { generation: number; population: number; elite: number; best: number }[] = [];
  while (searchRemaining(objective, options.searchBudget) > 0) {
    const available = searchRemaining(objective, options.searchBudget);
    const blocks = Math.min(evaluationBlocks, available);
    const count = Math.min(population, Math.floor(available / blocks));
    if (count < 1) break;
    const policies = Array.from({ length: count }, () => model.sample(random));
    const scored = ordered(await objective.evaluate(policies, blocks));
    const eliteCount = Math.max(1, Math.ceil(scored.length * eliteFraction));
    const elites = scored.slice(0, eliteCount);
    model.update(elites.map((entry) => entry.strategy));
    retainRanked(finalists, scored.map((entry) => ({ strategy: entry.strategy, mean: entry.mean })));
    generations += 1;
    history.push({ generation: generations, population: count, elite: eliteCount, best: scored[0]!.mean });
  }
  if (!finalists.length) throw new Error('CEM could not evaluate a policy.');
  return result('discrete-cem', finalists.slice(0, 8).map((entry) => entry.strategy),
    objective, finalists[0]!.mean,
    { generations, population, evaluationBlocks, eliteFraction,
      smoothing: model.smoothing, explorationFloor: model.explorationFloor, history });
}

interface MctsNode {
  parent: MctsNode | null;
  action: string | null;
  actions: string[];
  children: MctsNode[];
  visits: number;
  value: number;
}
interface PendingRollout { policy: Strategy; path: MctsNode[] }

function lengthOf(actions: readonly string[]): number {
  return Number(actions[0]!.slice('length:'.length));
}
function terminalActions(actions: readonly string[]): boolean {
  return actions.length > 0 && actions.length === lengthOf(actions) + 2;
}
function legalMctsActions(domain: ResponsePolicyDomain, actions: readonly string[]): string[] {
  if (!actions.length) return Array.from({ length: domain.maxPrefixSlots + 1 }, (_unused, index) => `length:${index}`);
  const length = lengthOf(actions);
  return actions.length - 1 < length ? [...domain.prefixTokens] : [...domain.floorTokens];
}
function mctsPolicy(domain: ResponsePolicyDomain, actions: readonly string[]): Strategy {
  const length = lengthOf(actions);
  return domain.complete(actions.slice(1, 1 + length) as PrefixToken[], actions.at(-1)! as FloorToken);
}
function nodePathActions(node: MctsNode): string[] {
  const actions: string[] = [];
  for (let held: MctsNode | null = node; held?.action; held = held.parent) actions.push(held.action);
  return actions.reverse();
}

function selectRollout(root: MctsNode, domain: ResponsePolicyDomain, random: SeededRandom, exploration: number): PendingRollout {
  let node = root;
  let actions = nodePathActions(node);
  while (!terminalActions(actions)) {
    if (!node.actions.length && !node.children.length) node.actions = legalMctsActions(domain, actions);
    if (node.actions.length) {
      const index = random.nextInt(node.actions.length);
      const action = node.actions.splice(index, 1)[0]!;
      const child: MctsNode = { parent: node, action, actions: [], children: [], visits: 0, value: 0 };
      node.children.push(child); node = child; actions = [...actions, action];
      break;
    }
    node = [...node.children].sort((left, right) => {
      const leftUct = left.value / left.visits + exploration * Math.sqrt(Math.log(node.visits + 1) / left.visits);
      const rightUct = right.value / right.visits + exploration * Math.sqrt(Math.log(node.visits + 1) / right.visits);
      return rightUct - leftUct || (left.action ?? '').localeCompare(right.action ?? '');
    })[0]!;
    actions = [...actions, node.action!];
  }
  while (!terminalActions(actions)) {
    const legal = legalMctsActions(domain, actions);
    actions.push(legal[random.nextInt(legal.length)]!);
  }
  const path: MctsNode[] = [];
  for (let held: MctsNode | null = node; held; held = held.parent) path.push(held);
  for (const held of path) { held.visits += 1; held.value += 0.5; }
  return { policy: mctsPolicy(domain, actions), path };
}

export interface MctsOptions {
  batchSize?: number;
  rolloutBlocks?: number;
  exploration?: number;
  searchBudget?: number;
}

/** UCT tree search. Every simulation uses a complete grammar-valid rollout for terminal reward. */
export async function runUctMcts(
  objective: ObjectiveLike, domain: ResponsePolicyDomain, seed: number, options: MctsOptions = {}
): Promise<ResponseOptimizerResult> {
  const random = new SeededRandom(seed);
  const batchSize = options.batchSize ?? 16;
  const rolloutBlocks = options.rolloutBlocks ?? 4;
  const exploration = options.exploration ?? Math.SQRT2;
  const root: MctsNode = { parent: null, action: null, actions: [], children: [], visits: 0, value: 0 };
  const completeVisits = new Map<string, number>();
  const finalists: RankedPolicy[] = [];
  let batches = 0;
  while (searchRemaining(objective, options.searchBudget) > 0) {
    const available = searchRemaining(objective, options.searchBudget);
    const blocks = Math.min(rolloutBlocks, available);
    const count = Math.min(batchSize, Math.floor(available / blocks));
    if (count < 1) break;
    const pending = Array.from({ length: count }, () => selectRollout(root, domain, random, exploration));
    const scored = await objective.evaluate(pending.map((entry) => entry.policy), blocks);
    for (let index = 0; index < pending.length; index += 1) {
      const reward = scored[index]!.mean;
      for (const node of pending[index]!.path) node.value += reward - 0.5;
      const form = canonicalStrategy(pending[index]!.policy);
      completeVisits.set(form, (completeVisits.get(form) ?? 0) + 1);
      const aggregate = objective.aggregate(pending[index]!.policy)!;
      retainRanked(finalists, [{ strategy: pending[index]!.policy, mean: aggregate.mean }]);
    }
    batches += 1;
  }
  if (!finalists.length) throw new Error('MCTS could not evaluate a complete rollout.');
  const best = finalists[0]!;
  return result('uct-mcts', finalists.slice(0, 8).map((entry) => entry.strategy),
    objective, best.mean,
    { rootVisits: root.visits, treeNodes: countNodes(root), completePolicies: completeVisits.size,
      finalistVisits: Object.fromEntries(finalists.slice(0, 8).map((entry) => [entry.strategy.id,
        completeVisits.get(canonicalStrategy(entry.strategy)) ?? 0])),
      batches, batchSize, rolloutBlocks, exploration });
}

function countNodes(root: MctsNode): number {
  return 1 + root.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export interface BeamLaneDomain { id: string; width: number; finalists: number; domain: ResponsePolicyDomain }
export interface BeamOptions {
  lanes: readonly BeamLaneDomain[];
  stageBlocks: readonly number[];
  earlyStopDelta: number;
  earlyStopPatience: number;
  searchBudget?: number;
}
interface BeamEntry { floor: FloorToken; strategy: Strategy; mean: number }

function expandBeam(domain: ResponsePolicyDomain, entry: BeamEntry): BeamEntry[] {
  const decoded = domain.decode(entry.strategy);
  const proposals: BeamEntry[] = [entry];
  if (decoded.prefix.length >= domain.maxPrefixSlots) return proposals;
  for (let index = 0; index <= decoded.prefix.length; index += 1) {
    for (const token of domain.prefixTokens) {
      const prefix = [...decoded.prefix.slice(0, index), token, ...decoded.prefix.slice(index)];
      proposals.push({ floor: entry.floor, strategy: domain.complete(prefix, decoded.floor), mean: 0.5 });
    }
  }
  return proposals;
}

function uniqueBeam(entries: readonly BeamEntry[]): BeamEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const form = canonicalStrategy(entry.strategy);
    if (seen.has(form)) return false;
    seen.add(form); return true;
  });
}

function retainBeam(entries: readonly BeamEntry[], width: number): BeamEntry[] {
  const sorted = [...entries].sort((left, right) => right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id));
  const kept: BeamEntry[] = [];
  const forms = new Set<string>();
  for (const floor of [...new Set(sorted.map((entry) => entry.floor))]) {
    const entry = sorted.find((candidate) => candidate.floor === floor)!;
    if (kept.length < width) { kept.push(entry); forms.add(canonicalStrategy(entry.strategy)); }
  }
  for (const entry of sorted) {
    const form = canonicalStrategy(entry.strategy);
    if (kept.length >= width) break;
    if (!forms.has(form)) { kept.push(entry); forms.add(form); }
  }
  return kept.sort((left, right) => right.mean - left.mean || left.strategy.id.localeCompare(right.strategy.id));
}

/** The current diverse lane beam, interleaved only to let every lane reach the shared budget. */
export async function runStratifiedBeam(
  objective: ObjectiveLike, options: BeamOptions
): Promise<ResponseOptimizerResult> {
  const states = options.lanes.map((lane) => ({ lane,
    beam: lane.domain.floorTokens.map((floor): BeamEntry => ({
      floor, strategy: lane.domain.complete([], floor), mean: 0.5
    })), depth: 0, previousBest: 0.5, stagnant: 0, stopped: false }));
  if (!options.stageBlocks.length) throw new Error('The beam needs stage block counts.');
  const stages: Record<string, unknown>[] = [];
  while (states.some((state) => !state.stopped)) {
    let progressed = false;
    for (const state of states) {
      if (state.stopped) continue;
      if (state.depth >= state.lane.domain.maxPrefixSlots) { state.stopped = true; continue; }
      const candidates = uniqueBeam(state.beam.flatMap((entry) => expandBeam(state.lane.domain, entry)));
      const blocks = options.stageBlocks[Math.min(state.depth, options.stageBlocks.length - 1)]!;
      if (candidates.length * blocks > searchRemaining(objective, options.searchBudget)) {
        state.stopped = true;
        stages.push({ lane: state.lane.id, depth: state.depth + 1, candidates: candidates.length,
          blocks, skippedForBudget: true });
        continue;
      }
      const scored = await objective.evaluate(candidates.map((entry) => entry.strategy), blocks);
      const means = new Map(scored.map((entry) => [canonicalStrategy(entry.strategy), entry.mean]));
      state.beam = retainBeam(candidates.map((entry) => ({ ...entry,
        mean: means.get(canonicalStrategy(entry.strategy))! })), state.lane.width);
      const best = state.beam[0]!;
      state.stagnant = best.mean - state.previousBest < options.earlyStopDelta ? state.stagnant + 1 : 0;
      state.previousBest = best.mean;
      state.depth += 1;
      if (state.depth >= options.stageBlocks.length && state.stagnant >= options.earlyStopPatience) {
        state.stopped = true;
      }
      stages.push({ lane: state.lane.id, depth: state.depth, candidates: candidates.length,
        retained: state.beam.length, blocks, best: best.mean });
      progressed = true;
    }
    if (!progressed) break;
  }
  const finalists = states.flatMap((state) => state.beam.slice(0, state.lane.finalists));
  if (!finalists.length) throw new Error('The stratified beam has no legal floor.');
  return result('stratified-beam', finalists.map((entry) => entry.strategy), objective,
    finalists[0]!.mean,
    { laneConfig: options.lanes.map((entry) => ({ id: entry.id, width: entry.width, finalists: entry.finalists })),
      stageBlocks: options.stageBlocks, earlyStopDelta: options.earlyStopDelta,
      earlyStopPatience: options.earlyStopPatience, stages });
}
