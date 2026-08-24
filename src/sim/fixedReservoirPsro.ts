import { kingdomOf } from '../game';
import { solveEquilibrium } from './equilibrium';
import type { EquilibriumResult } from './equilibrium';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from './experimentConfig';
import type { MovementAwareGoldfishScore } from './goldfish';
import { compareMovementAwareGoldfishScores } from './goldfish';
import { evaluateCandidates, mixtureSchedule, percentileBootstrapMean } from './mixtureEvaluation';
import type { BootstrapInterval, CandidateEvaluation } from './mixtureEvaluation';
import { createMatrixCellCache, matrixProtocol, PayoffMatrix } from './payoffMatrix';
import type { MatrixSnapshot } from './payoffMatrix';
import type { PairingRunner } from './pairingRunner';
import { RandomPsroSeedLedger } from './randomPsro';
import { rulesFingerprint } from './rulesFingerprint';
import type { RulesFingerprint } from './rulesFingerprint';
import { canonicalStrategy, stableHash } from './strategy';
import type { Strategy } from './strategy';

export const FIXED_RESERVOIR_VERSION = 'fixed-reservoir-psro-v1';
export const FIXED_RESERVOIR_EVALUATION_SEED = 7_100_009;
export const FIXED_RESERVOIR_CONFIG = Object.freeze({
  generatedCount: 500_000, goldfishCount: 18_000, randomCount: 2_000,
  initialStrategies: 50, raceBlocks: Object.freeze([1, 2, 4, 8] as const),
  finalists: 8, confirmationBlocks: 400, matrixBlocks: 25, cleanScansRequired: 2,
  safetyCap: 32, admissionLowerBound: 0.5, chunkSize: 1_000
});

export interface ReservoirEntry {
  strategy: Strategy;
  source: 'goldfish' | 'random';
  goldfishRank: number;
  score: Pick<MovementAwareGoldfishScore, 'worstCompletions' | 'totalCompletions' |
    'worstPenalizedTurnsTo50' | 'totalPenalizedTurnsTo50' | 'worstDamageArea' | 'totalDamageArea'>;
}
export interface FixedReservoirPoolArtifact {
  schemaVersion: 1;
  experiment: 'fixed-reservoir-pool';
  version: typeof FIXED_RESERVOIR_VERSION;
  kingdomId: string;
  poolSeed: number;
  goldfishSeeds: number[];
  generatedCount: number;
  generatedIds: string[];
  generatedHash: string;
  reservoirHash: string;
  reservoir: ReservoirEntry[];
  elapsedMs: number;
}
export interface ReservoirConfirmedCandidate {
  strategy: Strategy; mean: number; interval95: BootstrapInterval; blocks: number; matches: number;
}
export interface ReservoirRound {
  round: number; scannedCount: number; targetWeights: Record<string, number>;
  raceSeeds: number[]; confirmationSeeds: number[]; finalists: ReservoirConfirmedCandidate[];
  admittedStrategyIds: string[]; cleanStreak: number; equilibriumAfter: EquilibriumResult;
}
export interface FixedReservoirPsroArtifact {
  schemaVersion: 1;
  experiment: 'fixed-reservoir-psro';
  version: typeof FIXED_RESERVOIR_VERSION;
  kingdomId: string; poolSeed: number; evaluationSeed: number; rulesFingerprint: RulesFingerprint;
  poolHash: string; reservoirHash: string; reservoir: ReservoirEntry[];
  status: 'converged' | 'incomplete'; stopReason: 'two-clean-full-scans' | 'safety-cap';
  rounds: ReservoirRound[]; matrix: MatrixSnapshot; equilibrium: EquilibriumResult;
  seedNamespaces: Record<string, number[]>; elapsedMs: number;
}

function seededRank(id: string, seed: number): number {
  return Number.parseInt(stableHash(`reservoir-tail:${seed}:${id}`).slice(0, 8), 16) >>> 0;
}
export function selectFixedReservoir(
  scores: readonly MovementAwareGoldfishScore[], goldfishCount: number, randomCount: number, tailSeed: number
): ReservoirEntry[] {
  if (goldfishCount < 1 || randomCount < 1 || scores.length < goldfishCount + randomCount) {
    throw new Error('Fixed reservoir needs two non-empty disjoint cohorts.');
  }
  const rankedAll = [...scores].sort(compareMovementAwareGoldfishScores);
  const heldIds = new Set<string>();
  const ranked = rankedAll.filter((entry) => {
    if (heldIds.has(entry.strategy.id)) return false;
    heldIds.add(entry.strategy.id); return true;
  });
  if (ranked.length < goldfishCount + randomCount) throw new Error('Strategy-id collisions exhausted the reservoir.');
  const top = ranked.slice(0, goldfishCount);
  const topIds = new Set(top.map((entry) => entry.strategy.id));
  const rankById = new Map(ranked.map((entry, index) => [entry.strategy.id, index + 1]));
  const tail = ranked.filter((entry) => !topIds.has(entry.strategy.id)).sort((left, right) =>
    seededRank(left.strategy.id, tailSeed) - seededRank(right.strategy.id, tailSeed)
      || left.strategy.id.localeCompare(right.strategy.id)).slice(0, randomCount);
  const map = (entry: MovementAwareGoldfishScore, source: ReservoirEntry['source']): ReservoirEntry => ({
    strategy: entry.strategy, source, goldfishRank: rankById.get(entry.strategy.id)!,
    score: { worstCompletions: entry.worstCompletions, totalCompletions: entry.totalCompletions,
      worstPenalizedTurnsTo50: entry.worstPenalizedTurnsTo50,
      totalPenalizedTurnsTo50: entry.totalPenalizedTurnsTo50,
      worstDamageArea: entry.worstDamageArea, totalDamageArea: entry.totalDamageArea }
  });
  return [...top.map((entry) => map(entry, 'goldfish')), ...tail.map((entry) => map(entry, 'random'))];
}
export function reservoirHash(entries: readonly ReservoirEntry[]): string {
  return stableHash(entries.map((entry) => `${entry.source}:${canonicalStrategy(entry.strategy)}`).join('\n'));
}
export function generatedHash(ids: readonly string[]): string { return stableHash(ids.join('\n')); }

export function validateFixedReservoirPool(value: unknown, expected?: { poolSeed?: number; generatedCount?: number;
  goldfishCount?: number; randomCount?: number }): value is FixedReservoirPoolArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<FixedReservoirPoolArtifact>;
  if (artifact.schemaVersion !== 1 || artifact.experiment !== 'fixed-reservoir-pool'
    || artifact.version !== FIXED_RESERVOIR_VERSION || !Array.isArray(artifact.generatedIds)
    || !Array.isArray(artifact.reservoir) || artifact.generatedIds.length !== artifact.generatedCount
    || generatedHash(artifact.generatedIds) !== artifact.generatedHash
    || reservoirHash(artifact.reservoir) !== artifact.reservoirHash) return false;
  if (expected?.poolSeed !== undefined && artifact.poolSeed !== expected.poolSeed) return false;
  if (expected?.generatedCount !== undefined && artifact.generatedCount !== expected.generatedCount) return false;
  const generated = new Set(artifact.generatedIds);
  const reservoirIds = artifact.reservoir.map((entry) => entry.strategy.id);
  if (new Set(reservoirIds).size !== reservoirIds.length || reservoirIds.some((id) => !generated.has(id))) return false;
  const goldfish = artifact.reservoir.filter((entry) => entry.source === 'goldfish');
  const random = artifact.reservoir.filter((entry) => entry.source === 'random');
  if (expected?.goldfishCount !== undefined && goldfish.length !== expected.goldfishCount) return false;
  if (expected?.randomCount !== undefined && random.length !== expected.randomCount) return false;
  if (goldfish.some((entry, index) => entry.goldfishRank !== index + 1)) return false;
  return artifact.reservoir.every((entry) => canonicalStrategy(entry.strategy).length > 0);
}

export function remainingReservoirStrategies(entries: readonly ReservoirEntry[], activeIds: ReadonlySet<string>): Strategy[] {
  return entries.filter((entry) => !activeIds.has(entry.strategy.id)).map((entry) => entry.strategy);
}

export function nextCleanStreak(previous: number, admitted: number): { streak: number; converged: boolean } {
  const streak = admitted ? 0 : previous + 1;
  return { streak, converged: streak >= FIXED_RESERVOIR_CONFIG.cleanScansRequired };
}
export function globalRaceSurvivors<T extends { strategy: Strategy; mean: number }>(
  chunks: readonly (readonly T[])[], keep: number
): T[] {
  return chunks.flat().sort((left, right) => right.mean - left.mean
    || left.strategy.id.localeCompare(right.strategy.id)).slice(0, keep);
}
function weightedStrategies(snapshot: MatrixSnapshot, equilibrium: EquilibriumResult): {strategy:Strategy;weight:number}[] {
  return snapshot.strategies.flatMap((strategy) => {
    const weight = equilibrium.weights[strategy.id] ?? 0;
    return weight > 0 ? [{strategy,weight}] : [];
  });
}
function solve(snapshot: MatrixSnapshot): EquilibriumResult {
  if (!snapshot.complete) throw new Error('Fixed reservoir matrix is incomplete.');
  return solveEquilibrium(snapshot.strategies.map((strategy) => strategy.id), snapshot.centeredPayoffs);
}
async function evaluateChunks(candidates: readonly Strategy[], opponents: ReadonlyMap<string,Strategy>,
  weights: Record<string,number>, seeds: readonly number[], samplingSeed: number,
  runner: PairingRunner, kingdomId: string, chunkSize: number): Promise<CandidateEvaluation[]> {
  const schedule = mixtureSchedule(weights, seeds, samplingSeed);
  const chunks: CandidateEvaluation[][] = [];
  for (let index=0; index<candidates.length; index+=chunkSize) {
    chunks.push(await evaluateCandidates(candidates.slice(index,index+chunkSize), opponents, schedule, runner, {
      kingdomId, turnLimitPerPlayer:TURN_LIMIT_PER_PLAYER, actionCapPerTurn:ACTION_CAP_PER_TURN,
      startingDraftEnabled:false
    }));
  }
  return globalRaceSurvivors(chunks, candidates.length);
}
export async function scanFixedReservoir(input: { candidates: readonly Strategy[]; snapshot: MatrixSnapshot;
  equilibrium: EquilibriumResult; runner: PairingRunner; kingdomId: string; raceSeeds: readonly number[];
  confirmationSeeds: readonly number[]; samplingSeeds: readonly number[]; bootstrapSeeds: readonly number[];
  raceBlocks?: readonly number[]; finalists?: number; chunkSize?: number }): Promise<ReservoirConfirmedCandidate[]> {
  const raceBlocks=input.raceBlocks??FIXED_RESERVOIR_CONFIG.raceBlocks;
  const opponentsWeighted=weightedStrategies(input.snapshot,input.equilibrium);
  const opponents=new Map(opponentsWeighted.map((entry)=>[entry.strategy.id,entry.strategy]));
  const weights=Object.fromEntries(opponentsWeighted.map((entry)=>[entry.strategy.id,entry.weight]));
  let cursor=0; let field=[...input.candidates];
  for (let round=0; round<raceBlocks.length && field.length; round+=1) {
    const count=raceBlocks[round]!; const seeds=input.raceSeeds.slice(cursor,cursor+count); cursor+=count;
    const evaluations=await evaluateChunks(field,opponents,weights,seeds,input.samplingSeeds[round]!,input.runner,
      input.kingdomId,input.chunkSize??FIXED_RESERVOIR_CONFIG.chunkSize);
    const keep=evaluations.length<=3?1:Math.max(3,Math.ceil(evaluations.length/3));
    field=evaluations.slice(0,keep).map((entry)=>entry.strategy);
  }
  const finalists=field.slice(0,input.finalists??FIXED_RESERVOIR_CONFIG.finalists);
  if (!finalists.length) return [];
  const schedule=mixtureSchedule(weights,input.confirmationSeeds,input.samplingSeeds.at(-1)!);
  const evidence=await evaluateCandidates(finalists,opponents,schedule,input.runner,{
    kingdomId:input.kingdomId,turnLimitPerPlayer:TURN_LIMIT_PER_PLAYER,actionCapPerTurn:ACTION_CAP_PER_TURN,
    startingDraftEnabled:false
  });
  return evidence.map((entry,index)=>({strategy:entry.strategy,mean:entry.mean,
    interval95:percentileBootstrapMean(entry.blockScores,input.bootstrapSeeds[index]!),
    blocks:entry.blockScores.length,matches:entry.matches})).sort((a,b)=>b.mean-a.mean||a.strategy.id.localeCompare(b.strategy.id));
}

export async function runFixedReservoirPsro(pool: FixedReservoirPoolArtifact, runner: PairingRunner,
  now=Date.now): Promise<FixedReservoirPsroArtifact> {
  if (!validateFixedReservoirPool(pool,{poolSeed:pool.poolSeed,generatedCount:FIXED_RESERVOIR_CONFIG.generatedCount,
    goldfishCount:FIXED_RESERVOIR_CONFIG.goldfishCount,randomCount:FIXED_RESERVOIR_CONFIG.randomCount})) {
    throw new Error('Fixed reservoir pool is invalid.');
  }
  const started=now(); kingdomOf(pool.kingdomId);
  const ledger=new RandomPsroSeedLedger(FIXED_RESERVOIR_EVALUATION_SEED);
  const matrixSeeds=ledger.reserve('matrix',FIXED_RESERVOIR_CONFIG.matrixBlocks);
  const matrix=new PayoffMatrix(matrixProtocol(pool.kingdomId,matrixSeeds,TURN_LIMIT_PER_PLAYER,ACTION_CAP_PER_TURN,false),
    runner,createMatrixCellCache());
  const initial=pool.reservoir.filter((entry)=>entry.source==='goldfish').slice(0,FIXED_RESERVOIR_CONFIG.initialStrategies);
  for (const entry of initial) matrix.addStrategy(entry.strategy);
  await matrix.fillAll(false);
  let snapshot=matrix.snapshot(); let equilibrium=solve(snapshot); let cleanStreak=0; let converged=false;
  const rounds:ReservoirRound[]=[];
  for (let round=0;round<FIXED_RESERVOIR_CONFIG.safetyCap;round+=1) {
    const active=new Set(snapshot.strategies.map((strategy)=>strategy.id));
    const candidates=remainingReservoirStrategies(pool.reservoir,active);
    const raceSeeds=ledger.reserve(`round:${round}:race`,FIXED_RESERVOIR_CONFIG.raceBlocks.reduce((a,b)=>a+b,0));
    const confirmationSeeds=ledger.reserve(`round:${round}:confirmation`,FIXED_RESERVOIR_CONFIG.confirmationBlocks);
    const samplingSeeds=ledger.reserve(`round:${round}:sampling`,FIXED_RESERVOIR_CONFIG.raceBlocks.length+1);
    const bootstrapSeeds=ledger.reserve(`round:${round}:bootstrap`,FIXED_RESERVOIR_CONFIG.finalists);
    const targetWeights={...equilibrium.weights};
    const finalists=await scanFixedReservoir({candidates,snapshot,equilibrium,runner,kingdomId:pool.kingdomId,
      raceSeeds,confirmationSeeds,samplingSeeds,bootstrapSeeds});
    const admitted=finalists.filter((entry)=>entry.interval95.lower>FIXED_RESERVOIR_CONFIG.admissionLowerBound);
    for (const entry of admitted) matrix.addStrategy(entry.strategy);
    if (admitted.length) { await matrix.fillAll(false); snapshot=matrix.snapshot(); equilibrium=solve(snapshot); }
    const state=nextCleanStreak(cleanStreak,admitted.length); cleanStreak=state.streak; converged=state.converged;
    rounds.push({round,scannedCount:candidates.length,targetWeights,raceSeeds:[...raceSeeds],
      confirmationSeeds:[...confirmationSeeds],finalists,admittedStrategyIds:admitted.map((entry)=>entry.strategy.id),
      cleanStreak,equilibriumAfter:equilibrium});
    if (converged) break;
  }
  ledger.validate(); snapshot=matrix.snapshot(); equilibrium=solve(snapshot);
  return {schemaVersion:1,experiment:'fixed-reservoir-psro',version:FIXED_RESERVOIR_VERSION,
    kingdomId:pool.kingdomId,poolSeed:pool.poolSeed,evaluationSeed:FIXED_RESERVOIR_EVALUATION_SEED,
    rulesFingerprint:rulesFingerprint(pool.kingdomId,TURN_LIMIT_PER_PLAYER,ACTION_CAP_PER_TURN,false),
    poolHash:pool.generatedHash,reservoirHash:pool.reservoirHash,reservoir:pool.reservoir,
    status:converged?'converged':'incomplete',stopReason:converged?'two-clean-full-scans':'safety-cap',
    rounds,matrix:snapshot,equilibrium,seedNamespaces:ledger.namespaces,elapsedMs:now()-started};
}

export function validateFixedReservoirPsroArtifact(value: unknown, pool: FixedReservoirPoolArtifact): boolean {
  if (!value||typeof value!=='object') return false;
  const artifact=value as Partial<FixedReservoirPsroArtifact>;
  if (artifact.schemaVersion!==1||artifact.experiment!=='fixed-reservoir-psro'||artifact.version!==FIXED_RESERVOIR_VERSION
    ||artifact.poolSeed!==pool.poolSeed||artifact.evaluationSeed!==FIXED_RESERVOIR_EVALUATION_SEED
    ||artifact.poolHash!==pool.generatedHash||artifact.reservoirHash!==pool.reservoirHash
    ||!Array.isArray(artifact.rounds)||!artifact.matrix||!artifact.equilibrium) return false;
  const ids=new Set(pool.reservoir.map((entry)=>entry.strategy.id));
  if (artifact.matrix.strategies.some((strategy)=>!ids.has(strategy.id))||!artifact.matrix.complete) return false;
  let streak=0;
  for (const [index,round] of artifact.rounds.entries()) {
    if (round.round!==index||round.scannedCount!==pool.reservoir.length-(FIXED_RESERVOIR_CONFIG.initialStrategies
      + artifact.rounds.slice(0,index).reduce((sum,entry)=>sum+entry.admittedStrategyIds.length,0))) return false;
    const expected=round.finalists.filter((entry)=>entry.interval95.lower>0.5).map((entry)=>entry.strategy.id);
    if (expected.join('|')!==round.admittedStrategyIds.join('|')) return false;
    streak=round.admittedStrategyIds.length?0:streak+1;
    if (round.cleanStreak!==streak) return false;
  }
  const converged=streak>=FIXED_RESERVOIR_CONFIG.cleanScansRequired;
  return artifact.status===(converged?'converged':'incomplete')
    && artifact.stopReason===(converged?'two-clean-full-scans':'safety-cap');
}

export function supportEntries(artifact: FixedReservoirPsroArtifact): {strategy:Strategy;weight:number}[] {
  return artifact.matrix.strategies.flatMap((strategy)=>{
    const weight=artifact.equilibrium.weights[strategy.id]??0;
    return weight>1e-6?[{strategy,weight}]:[];
  }).sort((a,b)=>b.weight-a.weight||a.strategy.id.localeCompare(b.strategy.id));
}
