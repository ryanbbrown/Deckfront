import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { kingdomSchema } from '../src/game/schema';
import { BudgetedResponseObjective } from '../src/sim/budgetedResponseObjective';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../src/sim/experimentConfig';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { ResponsePolicyDomain } from '../src/sim/responsePolicyGrammar';
import {
  runDiscreteCem, runFinalTrainingRerace, runStratifiedBeam, runUctMcts,
  runUniformRandomRacing
} from '../src/sim/responseOptimizers';
import type {
  BeamLaneDomain, ResponseOptimizerName, ResponseOptimizerResult
} from '../src/sim/responseOptimizers';
import { deepBeamSuite } from '../src/sim/deepBeamSuite';
import { rulesFingerprint } from '../src/sim/rulesFingerprint';
import { STRATIFIED_BEAM_LANES } from '../src/sim/stratifiedBeam';
import { canonicalStrategy, stableHash } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import { laneGrammar } from './beam_draft_off';

const DEFAULT_BUDGET = 60_000;
const DEFAULT_CONFIRMATION_BLOCKS = 200;
const OPTIMIZERS: readonly ResponseOptimizerName[] = [
  'stratified-beam', 'uniform-random-racing', 'discrete-cem', 'uct-mcts'
];
const TRAINING_CURVE_MINIMUM_BLOCKS = 1;
const FINAL_RERACE = Object.freeze({ candidateCount: 8, blocksPerCandidate: 500, reservedBlocks: 4_000 });
const OPTIMIZER_CONFIG = Object.freeze({
  'stratified-beam': { lanes: STRATIFIED_BEAM_LANES, stageBlocks: [1, 2, 4],
    earlyStopDelta: 0.002, earlyStopPatience: 2 },
  'uniform-random-racing': { sampling: 'uniform-length-then-uniform-tokens',
    batchSize: 96, roundBlocks: [1, 2, 4, 8] },
  'discrete-cem': { population: 96, evaluationBlocks: 4, eliteFraction: 0.2,
    smoothing: 0.35, explorationFloor: 0.03 },
  'uct-mcts': { batchSize: 16, rolloutBlocks: 4, exploration: Math.SQRT2 }
});

const strategySchema = z.object({
  id: z.string().min(1), startingBuild: z.array(z.string()).length(0),
  buyPlan: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('inactive') }),
    z.object({ kind: z.literal('buy'), cardId: z.string(), desiredCount: z.number().int().positive() }),
    z.object({ kind: z.literal('stop'), threshold: z.number().int().nonnegative() })
  ])).length(10)
});
const curvePointSchema = z.object({ candidateBlocks: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(), bestMean: z.number(), policyId: z.string() });
const restartResultSchema = z.object({
  restart: z.number().int().nonnegative(), optimizerSeed: z.number().int().nonnegative(),
  trainingScheduleSeed: z.number().int().nonnegative(), candidateBlocks: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(), bestPolicy: strategySchema, bestTrainingMean: z.number(),
  curve: z.array(curvePointSchema), finalists: z.array(strategySchema).min(1),
  diagnostics: z.record(z.string(), z.unknown())
});
const optimizerResultSchema = z.object({
  optimizer: z.enum(OPTIMIZERS), selectedRestart: z.number().int().nonnegative(),
  optimizerSeed: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  trainingBlocksConsumed: z.number().int().nonnegative(), trainingMatches: z.number().int().nonnegative(),
  bestPolicy: strategySchema, bestTrainingMean: z.number(), trainingCurve: z.array(curvePointSchema),
  finalists: z.array(strategySchema).min(1), restarts: z.array(restartResultSchema).min(1),
  diagnostics: z.record(z.string(), z.unknown()),
  heldOut: z.object({ mean: z.number(), matchCount: z.number().int().positive(),
    seedBlocks: z.number().int().positive(), interval95: z.object({ lower: z.number(), upper: z.number() }) })
});
export const responseOptimizerPilotSchema = z.object({
  schemaVersion: z.literal(2), experiment: z.literal('response-optimizer-pilot'), createdAt: z.string(),
  frozen: z.object({ kingdom: kingdomSchema, kingdomIdentity: z.string(), targetMixtureIdentity: z.string(),
    targetMixture: z.array(z.object({ strategy: strategySchema, weight: z.number().positive() })).min(1),
    sourceArtifact: z.string() }),
  config: z.object({ startingDraftEnabled: z.literal(false), maxActiveSlots: z.literal(8),
    trainingBudgetPerRestart: z.number().int().positive(), confirmationBlocks: z.number().int().positive(),
    restarts: z.number().int().positive(), workers: z.number().int().positive(), seed: z.number().int().nonnegative(),
    trainingScheduleSeeds: z.array(z.number().int().nonnegative()), confirmationScheduleSeed: z.number().int().nonnegative(),
    confirmationScheduleIdentity: z.string(), trainingCurveMinimumBlocks: z.number().int().positive(),
    finalRerace: z.object({ candidateCount: z.number().int().positive(),
      blocksPerCandidate: z.number().int().positive(), reservedBlocks: z.number().int().positive() }),
    optimizerConfig: z.record(z.string(), z.unknown()),
    optimizerSeeds: z.record(z.string(), z.array(z.number().int().nonnegative())) }),
  results: z.array(optimizerResultSchema).length(4)
});
export type ResponseOptimizerPilotArtifact = z.infer<typeof responseOptimizerPilotSchema>;

interface SavedEquilibrium {
  kingdom: Kingdom;
  config: { startingDraftEnabled?: unknown; maxSlots?: unknown };
  targetMixture: { strategy: Strategy; weight: number }[];
}
export interface PilotOptions {
  kingdomId: string; budget: number; confirmationBlocks: number; seed: number;
  restarts: number; workers: number; out: string;
}

function deriveSeed(seed: number, label: string, restart = 0): number {
  return Number.parseInt(stableHash(`${seed >>> 0}:${label}:${restart}`).slice(0, 8), 16) >>> 0;
}

export function parsePilotOptions(argv: readonly string[], root: string): PilotOptions {
  const values = new Map<string, string>();
  const known = new Set(['--kingdom', '--budget', '--confirmation-blocks', '--seed', '--restarts', '--workers', '--out']);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    if (!known.has(flag)) throw new Error(`Unknown option ${flag}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
    values.set(flag, value);
  }
  const kingdomId = values.get('--kingdom');
  if (!kingdomId) throw new Error('--kingdom is required.');
  const positive = (flag: string, fallback: number): number => {
    const raw = values.get(flag) ?? String(fallback); const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer.`);
    return value;
  };
  const seed = Number(values.get('--seed') ?? 1);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be a nonnegative 32-bit integer.');
  return { kingdomId, budget: positive('--budget', DEFAULT_BUDGET),
    confirmationBlocks: positive('--confirmation-blocks', DEFAULT_CONFIRMATION_BLOCKS), seed,
    restarts: positive('--restarts', 1), workers: positive('--workers', 10),
    out: values.get('--out') ?? path.join(root, '.experiments', 'response-optimizer-pilot',
      `${kingdomId}-seed-${seed}-budget-${values.get('--budget') ?? DEFAULT_BUDGET}.json`) };
}

function sourcePath(root: string, kingdomId: string): string {
  return path.join(root, '.experiments', 'deep-beam-suite', 'deep-beam-v1', 'results', `${kingdomId}.json`);
}

export function loadFrozenEquilibrium(root: string, kingdomId: string): SavedEquilibrium {
  const file = sourcePath(root, kingdomId);
  const evidence = deepBeamSuite.resultEvidence(root, kingdomId);
  if (!evidence.valid) throw new Error(`${file} failed deep-beam validation: ${evidence.reason}.`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedEquilibrium;
  if (saved.kingdom.id !== kingdomId || saved.config.startingDraftEnabled !== false || saved.config.maxSlots !== 8) {
    throw new Error(`${file} is not the required draft-off eight-slot frozen equilibrium.`);
  }
  if (!saved.targetMixture?.length || saved.targetMixture.some((entry) => !(entry.weight > 0))) {
    throw new Error(`${file} has no positive frozen target mixture.`);
  }
  return saved;
}

function beamLanes(kingdomId: string): BeamLaneDomain[] {
  return STRATIFIED_BEAM_LANES.flatMap((lane): BeamLaneDomain[] => {
    const grammar = laneGrammar(kingdomId, lane.id);
    if (!grammar) return [];
    return [{ ...lane, domain: new ResponsePolicyDomain(kingdomId, {
      maxActiveSlots: 8, ...(grammar.purchaseIds ? { purchaseIds: grammar.purchaseIds } : {}),
      ...(grammar.floorIds ? { floorIds: grammar.floorIds } : {})
    }) }];
  });
}

async function optimize(
  name: ResponseOptimizerName, objective: BudgetedResponseObjective,
  domain: ResponsePolicyDomain, lanes: readonly BeamLaneDomain[], seed: number,
  searchBudget: number
): Promise<ResponseOptimizerResult> {
  if (name === 'stratified-beam') {
    const config = OPTIMIZER_CONFIG[name];
    return runStratifiedBeam(objective, { lanes, stageBlocks: config.stageBlocks,
      earlyStopDelta: config.earlyStopDelta, earlyStopPatience: config.earlyStopPatience,
      searchBudget });
  }
  if (name === 'uniform-random-racing') {
    return runUniformRandomRacing(objective, domain, seed, { ...OPTIMIZER_CONFIG[name], searchBudget });
  }
  if (name === 'discrete-cem') {
    return runDiscreteCem(objective, domain, seed, { ...OPTIMIZER_CONFIG[name], searchBudget });
  }
  return runUctMcts(objective, domain, seed, { ...OPTIMIZER_CONFIG[name], searchBudget });
}

function reraceConfig(budget: number): { candidateCount: number; blocksPerCandidate: number; reservedBlocks: number } {
  if (budget >= FINAL_RERACE.reservedBlocks * 2) return FINAL_RERACE;
  const reservedBlocks = Math.max(1, Math.floor(budget / 2));
  const candidateCount = Math.min(FINAL_RERACE.candidateCount, reservedBlocks);
  const blocksPerCandidate = Math.max(1, Math.floor(reservedBlocks / candidateCount));
  return { candidateCount, blocksPerCandidate, reservedBlocks: candidateCount * blocksPerCandidate };
}

export async function runPilot(options: PilotOptions, root: string): Promise<ResponseOptimizerPilotArtifact> {
  const saved = loadFrozenEquilibrium(root, options.kingdomId);
  registerKingdom(saved.kingdom);
  const domain = new ResponsePolicyDomain(options.kingdomId, { maxActiveSlots: 8 });
  const lanes = beamLanes(options.kingdomId);
  const runner = new WorkerPairingRunner(options.workers,
    new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom: saved.kingdom }, ['--import', 'tsx']);
  const weights = Object.fromEntries(saved.targetMixture.map((entry) => [entry.strategy.id, entry.weight]));
  const opponents = new Map(saved.targetMixture.map((entry) => [entry.strategy.id, entry.strategy]));
  const trainingScheduleSeeds = Array.from({ length: options.restarts }, (_unused, restart) =>
    deriveSeed(options.seed, 'training-schedule', restart));
  const confirmationScheduleSeed = deriveSeed(options.seed, 'confirmation-schedule');
  const confirmationRandom = new SeededRandom(confirmationScheduleSeed);
  const confirmationSeeds = Array.from({ length: options.confirmationBlocks }, () =>
    confirmationRandom.nextInt(0x7fffffff) + 1);
  const confirmationSchedule = mixtureSchedule(weights, confirmationSeeds, confirmationScheduleSeed ^ 0x77c011f1);
  const optimizerSeeds = Object.fromEntries(OPTIMIZERS.map((name) => [name,
    Array.from({ length: options.restarts }, (_unused, restart) => deriveSeed(options.seed, name, restart))]));
  const outputResults: z.infer<typeof optimizerResultSchema>[] = [];
  const finalRerace = reraceConfig(options.budget);
  const searchBudget = options.budget - finalRerace.reservedBlocks;
  if (searchBudget < 1) throw new Error('The training budget must leave at least one search block before reracing.');
  try {
    for (const name of OPTIMIZERS) {
      const started = Date.now();
      const restartResults: ResponseOptimizerResult[] = [];
      for (let restart = 0; restart < options.restarts; restart += 1) {
        const objective = new BudgetedResponseObjective({ kingdomId: options.kingdomId,
          opponents: saved.targetMixture, budget: options.budget,
          scheduleSeed: trainingScheduleSeeds[restart]!, runner,
          turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER, actionCapPerTurn: ACTION_CAP_PER_TURN,
          startingDraftEnabled: false });
        const search = await optimize(name, objective, domain, lanes,
          optimizerSeeds[name]![restart]!, searchBudget);
        restartResults.push(await runFinalTrainingRerace(objective, search, finalRerace));
      }
      const selected = [...restartResults].sort((left, right) => right.trainingMean - left.trainingMean
        || left.policy.id.localeCompare(right.policy.id))[0]!;
      domain.decode(selected.policy);
      const heldOut = (await evaluateCandidates([selected.policy], opponents, confirmationSchedule, runner, {
        kingdomId: options.kingdomId, turnLimitPerPlayer: TURN_LIMIT_PER_PLAYER,
        actionCapPerTurn: ACTION_CAP_PER_TURN, startingDraftEnabled: false
      }))[0]!;
      const interval95 = percentileBootstrapMean(heldOut.blockScores, deriveSeed(options.seed, 'confirmation-bootstrap'));
      const selectedRestart = restartResults.indexOf(selected);
      outputResults.push({ optimizer: name, selectedRestart,
        optimizerSeed: optimizerSeeds[name]![selectedRestart]!, elapsedMs: Date.now() - started,
        trainingBlocksConsumed: selected.candidateBlocks, trainingMatches: selected.matches,
        bestPolicy: selected.policy, bestTrainingMean: selected.trainingMean,
        trainingCurve: selected.curve, finalists: selected.finalists,
        restarts: restartResults.map((entry, restart) => ({ restart,
          optimizerSeed: optimizerSeeds[name]![restart]!,
          trainingScheduleSeed: trainingScheduleSeeds[restart]!, candidateBlocks: entry.candidateBlocks,
          matches: entry.matches, bestPolicy: entry.policy, bestTrainingMean: entry.trainingMean,
          curve: entry.curve, finalists: entry.finalists, diagnostics: entry.diagnostics
        })), diagnostics: selected.diagnostics,
        heldOut: { mean: heldOut.mean, matchCount: heldOut.matches,
          seedBlocks: heldOut.blockScores.length, interval95 } });
      const latest = outputResults.at(-1)!;
      console.log(`${name}: ${(latest.heldOut.mean * 100).toFixed(2)}% `
        + `[${(latest.heldOut.interval95.lower * 100).toFixed(2)}, ${(latest.heldOut.interval95.upper * 100).toFixed(2)}] `
        + `${latest.trainingBlocksConsumed} blocks`);
    }
  } finally {
    await runner.close();
  }
  const fingerprint = rulesFingerprint(options.kingdomId, TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false);
  const targetMixtureIdentity = stableHash(JSON.stringify(saved.targetMixture.map((entry) => ({
    policy: canonicalStrategy(entry.strategy), weight: entry.weight
  }))));
  const artifact = {
    schemaVersion: 2 as const, experiment: 'response-optimizer-pilot' as const,
    createdAt: new Date().toISOString(),
    frozen: { kingdom: saved.kingdom, kingdomIdentity: fingerprint.hash, targetMixtureIdentity,
      targetMixture: saved.targetMixture, sourceArtifact: path.relative(root, sourcePath(root, options.kingdomId)) },
    config: { startingDraftEnabled: false as const, maxActiveSlots: 8 as const,
      trainingBudgetPerRestart: options.budget, confirmationBlocks: options.confirmationBlocks,
      restarts: options.restarts, workers: options.workers, seed: options.seed, trainingScheduleSeeds,
      confirmationScheduleSeed,
      confirmationScheduleIdentity: stableHash(JSON.stringify(confirmationSchedule.blocks)),
      trainingCurveMinimumBlocks: TRAINING_CURVE_MINIMUM_BLOCKS,
      finalRerace, optimizerConfig: OPTIMIZER_CONFIG, optimizerSeeds },
    results: outputResults
  };
  return responseOptimizerPilotSchema.parse(artifact);
}

export async function main(argv: readonly string[], root: string): Promise<number> {
  const options = parsePilotOptions(argv, root);
  const artifact = await runPilot(options, root);
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(artifact, null, 2)}\n`);
  console.table(artifact.results.map((entry) => ({ optimizer: entry.optimizer,
    trainingBlocks: entry.trainingBlocksConsumed, trainingMatches: entry.trainingMatches,
    heldOut: `${(entry.heldOut.mean * 100).toFixed(2)}%`,
    ci95: `${(entry.heldOut.interval95.lower * 100).toFixed(2)}–${(entry.heldOut.interval95.upper * 100).toFixed(2)}%`,
    policy: entry.bestPolicy.id, seconds: (entry.elapsedMs / 1_000).toFixed(1) })));
  console.log(`written: ${options.out}`);
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try { process.exitCode = await main(process.argv.slice(2), process.cwd()); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
