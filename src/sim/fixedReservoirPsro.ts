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
import { compareUtf16 } from './utf16';

export const FIXED_RESERVOIR_VERSION = 'fixed-reservoir-psro-v2';
export const FIXED_RESERVOIR_EVALUATION_SEED = 7_100_009;
export interface FixedReservoirProtocol {
  generatedCount: number; goldfishCount: number; randomCount: number; initialStrategies: number;
  raceBlocks: readonly number[]; finalists: number; confirmationBlocks: number; matrixBlocks: number;
  cleanScansRequired: number; safetyCap: number; admissionLowerBound: number; chunkSize: number;
}
export const FIXED_RESERVOIR_CONFIG: Readonly<FixedReservoirProtocol> = Object.freeze({
  generatedCount: 500_000, goldfishCount: 18_000, randomCount: 2_000,
  initialStrategies: 50, raceBlocks: Object.freeze([1, 2, 4, 8] as const),
  finalists: 8, confirmationBlocks: 400, matrixBlocks: 25, cleanScansRequired: 2,
  safetyCap: 32, admissionLowerBound: 0.5, chunkSize: 1_000
});
export interface FixedReservoirRunOptions { evaluationSeed?: number; protocol?: FixedReservoirProtocol }
function runOptions(options: FixedReservoirRunOptions = {}): { evaluationSeed: number; protocol: FixedReservoirProtocol } {
  return { evaluationSeed: options.evaluationSeed ?? FIXED_RESERVOIR_EVALUATION_SEED,
    protocol: options.protocol ?? FIXED_RESERVOIR_CONFIG };
}

export interface ReservoirEntry {
  strategy: Strategy;
  source: 'goldfish' | 'random';
  goldfishRank: number;
  score: Pick<MovementAwareGoldfishScore, 'worstCompletions' | 'totalCompletions' |
    'worstPenalizedTurnsTo50' | 'totalPenalizedTurnsTo50' | 'worstDamageArea' | 'totalDamageArea'>;
}
export interface FixedReservoirPoolArtifact {
  schemaVersion: 2;
  experiment: 'fixed-reservoir-pool';
  version: typeof FIXED_RESERVOIR_VERSION;
  kingdomId: string;
  poolSeed: number;
  goldfishSeeds: number[];
  generatedCount: number;
  generatedHash: string;
  canonicalProvenanceDigest: string;
  duplicateCanonicalCount: number;
  displayIdCollisionCount: number;
  scoringProtocol: string;
  shardProvenance: Array<{ shardId: string; startPosition: number; endPosition: number;
    candidateDigest: string; scoreDigest: string }>;
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
  const tail = ranked.filter((entry) => !topIds.has(entry.strategy.id))
    .map((entry) => ({ entry, rank: seededRank(entry.strategy.id, tailSeed) }))
    .sort((left, right) => left.rank - right.rank
      || compareUtf16(left.entry.strategy.id, right.entry.strategy.id)
      || compareUtf16(canonicalStrategy(left.entry.strategy), canonicalStrategy(right.entry.strategy)))
    .slice(0, randomCount).map((entry) => entry.entry);
  const map = (entry: MovementAwareGoldfishScore, source: ReservoirEntry['source']): ReservoirEntry => ({
    strategy: entry.strategy, source, goldfishRank: rankById.get(entry.strategy.id)!,
    score: { worstCompletions: entry.worstCompletions, totalCompletions: entry.totalCompletions,
      worstPenalizedTurnsTo50: entry.worstPenalizedTurnsTo50,
      totalPenalizedTurnsTo50: entry.totalPenalizedTurnsTo50,
      worstDamageArea: entry.worstDamageArea, totalDamageArea: entry.totalDamageArea }
  });
  return [...top.map((entry) => map(entry, 'goldfish')), ...tail.map((entry) => map(entry, 'random'))];
}
function reservoirEntryEvidence(entry: ReservoirEntry): string {
  return [entry.source, entry.goldfishRank, entry.score.worstCompletions,
    entry.score.totalCompletions, entry.score.worstPenalizedTurnsTo50,
    entry.score.totalPenalizedTurnsTo50, entry.score.worstDamageArea,
    entry.score.totalDamageArea, canonicalStrategy(entry.strategy)].join('\t');
}

export function reservoirHash(entries: readonly ReservoirEntry[]): string {
  return stableHash(entries.map(reservoirEntryEvidence).join('\n'));
}
export interface FixedReservoirPoolExpectation {
  kingdomId?: string; poolSeed?: number; generatedCount?: number; goldfishCount?: number;
  randomCount?: number; goldfishSeeds?: readonly number[];
}
export function validateFixedReservoirPool(
  value: unknown, expected: FixedReservoirPoolExpectation = {}
): value is FixedReservoirPoolArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<FixedReservoirPoolArtifact>;
  if (artifact.schemaVersion !== 2 || artifact.experiment !== 'fixed-reservoir-pool'
    || artifact.version !== FIXED_RESERVOIR_VERSION || !Array.isArray(artifact.reservoir)
    || !Array.isArray(artifact.shardProvenance) || !Number.isSafeInteger(artifact.generatedCount)
    || artifact.generatedCount! < artifact.reservoir.length
    || typeof artifact.generatedHash !== 'string' || !/^[0-9a-f]{9,}$/.test(artifact.generatedHash)
    || typeof artifact.canonicalProvenanceDigest !== 'string'
      || !/^[0-9a-f]{9,}$/.test(artifact.canonicalProvenanceDigest)
    || !Number.isSafeInteger(artifact.duplicateCanonicalCount) || artifact.duplicateCanonicalCount! < 0
    || !Number.isSafeInteger(artifact.displayIdCollisionCount) || artifact.displayIdCollisionCount! < 0
    || typeof artifact.scoringProtocol !== 'string' || artifact.scoringProtocol.length === 0
    || reservoirHash(artifact.reservoir) !== artifact.reservoirHash) return false;
  if (expected.kingdomId !== undefined && artifact.kingdomId !== expected.kingdomId) return false;
  if (expected.poolSeed !== undefined && artifact.poolSeed !== expected.poolSeed) return false;
  if (expected.generatedCount !== undefined && artifact.generatedCount !== expected.generatedCount) return false;
  if (expected.goldfishSeeds !== undefined
    && artifact.goldfishSeeds?.join('|') !== expected.goldfishSeeds.join('|')) return false;
  const reservoirIds = artifact.reservoir.map((entry) => entry.strategy.id);
  if (new Set(reservoirIds).size !== reservoirIds.length) return false;
  const canonical = artifact.reservoir.map((entry) => canonicalStrategy(entry.strategy));
  if (new Set(canonical).size !== canonical.length) return false;
  const shards = [...artifact.shardProvenance].sort((left, right) => left.startPosition - right.startPosition);
  if ((artifact.generatedCount! > 0 && shards.length === 0)
    || (shards.length && (shards[0]!.startPosition !== 0
    || shards.at(-1)!.endPosition !== artifact.generatedCount
    || shards.some((entry, index) => entry.endPosition < entry.startPosition
      || (index > 0 && shards[index - 1]!.endPosition !== entry.startPosition)
      || !/^[0-9a-f]{9,}$/.test(entry.candidateDigest)
      || !/^[0-9a-f]{9,}$/.test(entry.scoreDigest))))) return false;
  if (shards.length === 1 && shards[0]!.candidateDigest !== artifact.canonicalProvenanceDigest) return false;
  const goldfish = artifact.reservoir.filter((entry) => entry.source === 'goldfish');
  const random = artifact.reservoir.filter((entry) => entry.source === 'random');
  if (expected.goldfishCount !== undefined && goldfish.length !== expected.goldfishCount) return false;
  if (expected.randomCount !== undefined && random.length !== expected.randomCount) return false;
  if (goldfish.some((entry, index) => entry.goldfishRank !== index + 1)) return false;
  return artifact.reservoir.every((entry) => (entry.source === 'goldfish' || entry.source === 'random')
    && Number.isSafeInteger(entry.goldfishRank) && entry.goldfishRank > 0
    && entry.goldfishRank <= artifact.generatedCount!
    && Object.values(entry.score).every(Number.isFinite)
    && canonicalStrategy(entry.strategy).length > 0);
}

export function remainingReservoirStrategies(entries: readonly ReservoirEntry[], activeIds: ReadonlySet<string>): Strategy[] {
  return entries.filter((entry) => !activeIds.has(entry.strategy.id)).map((entry) => entry.strategy);
}

export function nextCleanStreak(
  previous: number, admitted: number, cleanScansRequired = FIXED_RESERVOIR_CONFIG.cleanScansRequired
): { streak: number; converged: boolean } {
  const streak = admitted ? 0 : previous + 1;
  return { streak, converged: streak >= cleanScansRequired };
}
export function globalRaceSurvivors<T extends { strategy: Strategy; mean: number }>(
  chunks: readonly (readonly T[])[], keep: number
): T[] {
  return chunks.flat().sort((left, right) => right.mean - left.mean
    || compareUtf16(left.strategy.id, right.strategy.id)
    || compareUtf16(canonicalStrategy(left.strategy), canonicalStrategy(right.strategy))).slice(0, keep);
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
  runner: PairingRunner, kingdomId: string, chunkSize: number, scoreOnly: boolean): Promise<CandidateEvaluation[]> {
  const schedule = mixtureSchedule(weights, seeds, samplingSeed);
  const chunks: CandidateEvaluation[][] = [];
  for (let index=0; index<candidates.length; index+=chunkSize) {
    chunks.push(await evaluateCandidates(candidates.slice(index,index+chunkSize), opponents, schedule, runner, {
      kingdomId, turnLimitPerPlayer:TURN_LIMIT_PER_PLAYER, actionCapPerTurn:ACTION_CAP_PER_TURN,
      startingDraftEnabled:false, scoreOnly
    }));
  }
  return globalRaceSurvivors(chunks, candidates.length);
}
export async function scanFixedReservoir(input: { candidates: readonly Strategy[]; snapshot: MatrixSnapshot;
  equilibrium: EquilibriumResult; runner: PairingRunner; kingdomId: string; raceSeeds: readonly number[];
  confirmationSeeds: readonly number[]; samplingSeeds: readonly number[]; bootstrapSeeds: readonly number[];
  raceBlocks?: readonly number[]; finalists?: number; chunkSize?: number;
  scoreOnly?: boolean }): Promise<ReservoirConfirmedCandidate[]> {
  const raceBlocks=input.raceBlocks??FIXED_RESERVOIR_CONFIG.raceBlocks;
  const opponentsWeighted=weightedStrategies(input.snapshot,input.equilibrium);
  const opponents=new Map(opponentsWeighted.map((entry)=>[entry.strategy.id,entry.strategy]));
  const weights=Object.fromEntries(opponentsWeighted.map((entry)=>[entry.strategy.id,entry.weight]));
  let cursor=0; let field=[...input.candidates];
  for (let round=0; round<raceBlocks.length && field.length; round+=1) {
    const count=raceBlocks[round]!; const seeds=input.raceSeeds.slice(cursor,cursor+count); cursor+=count;
    const evaluations=await evaluateChunks(field,opponents,weights,seeds,input.samplingSeeds[round]!,input.runner,
      input.kingdomId,input.chunkSize??FIXED_RESERVOIR_CONFIG.chunkSize,input.scoreOnly??true);
    const keep=evaluations.length<=3?1:Math.max(3,Math.ceil(evaluations.length/3));
    field=evaluations.slice(0,keep).map((entry)=>entry.strategy);
  }
  const finalists=field.slice(0,input.finalists??FIXED_RESERVOIR_CONFIG.finalists);
  if (!finalists.length) return [];
  const schedule=mixtureSchedule(weights,input.confirmationSeeds,input.samplingSeeds.at(-1)!);
  const evidence=await evaluateCandidates(finalists,opponents,schedule,input.runner,{
    kingdomId:input.kingdomId,turnLimitPerPlayer:TURN_LIMIT_PER_PLAYER,actionCapPerTurn:ACTION_CAP_PER_TURN,
    startingDraftEnabled:false,scoreOnly:input.scoreOnly??true
  });
  return evidence.map((entry,index)=>({strategy:entry.strategy,mean:entry.mean,
    interval95:percentileBootstrapMean(entry.blockScores,input.bootstrapSeeds[index]!),
    blocks:entry.blockScores.length,matches:entry.matches})).sort((a,b)=>b.mean-a.mean
      || compareUtf16(a.strategy.id,b.strategy.id)
      || compareUtf16(canonicalStrategy(a.strategy),canonicalStrategy(b.strategy)));
}

export async function runFixedReservoirPsro(
  pool: FixedReservoirPoolArtifact, runner: PairingRunner, options: FixedReservoirRunOptions = {}, now=Date.now
): Promise<FixedReservoirPsroArtifact> {
  const { evaluationSeed, protocol } = runOptions(options);
  if (!validateFixedReservoirPool(pool,{kingdomId:pool.kingdomId,poolSeed:pool.poolSeed,
    generatedCount:protocol.generatedCount,goldfishCount:protocol.goldfishCount,randomCount:protocol.randomCount})) {
    throw new Error('Fixed reservoir pool is invalid.');
  }
  const started=now(); kingdomOf(pool.kingdomId);
  const ledger=new RandomPsroSeedLedger(evaluationSeed);
  const matrixSeeds=ledger.reserve('matrix',protocol.matrixBlocks);
  const matrix=new PayoffMatrix(matrixProtocol(pool.kingdomId,matrixSeeds,TURN_LIMIT_PER_PLAYER,ACTION_CAP_PER_TURN,false),
    runner,createMatrixCellCache());
  const initial=pool.reservoir.filter((entry)=>entry.source==='goldfish').slice(0,protocol.initialStrategies);
  for (const entry of initial) matrix.addStrategy(entry.strategy);
  await matrix.fillAll(false);
  let snapshot=matrix.snapshot(); let equilibrium=solve(snapshot); let cleanStreak=0; let converged=false;
  const rounds:ReservoirRound[]=[];
  for (let round=0;round<protocol.safetyCap;round+=1) {
    const active=new Set(snapshot.strategies.map((strategy)=>strategy.id));
    const candidates=remainingReservoirStrategies(pool.reservoir,active);
    const raceSeeds=ledger.reserve(`round:${round}:race`,protocol.raceBlocks.reduce((a,b)=>a+b,0));
    const confirmationSeeds=ledger.reserve(`round:${round}:confirmation`,protocol.confirmationBlocks);
    const samplingSeeds=ledger.reserve(`round:${round}:sampling`,protocol.raceBlocks.length+1);
    const bootstrapSeeds=ledger.reserve(`round:${round}:bootstrap`,protocol.finalists);
    const targetWeights={...equilibrium.weights};
    const finalists=await scanFixedReservoir({candidates,snapshot,equilibrium,runner,kingdomId:pool.kingdomId,
      raceSeeds,confirmationSeeds,samplingSeeds,bootstrapSeeds,raceBlocks:protocol.raceBlocks,
      finalists:protocol.finalists,chunkSize:protocol.chunkSize});
    const admitted=finalists.filter((entry)=>entry.interval95.lower>protocol.admissionLowerBound);
    for (const entry of admitted) matrix.addStrategy(entry.strategy);
    if (admitted.length) { await matrix.fillAll(false); snapshot=matrix.snapshot(); equilibrium=solve(snapshot); }
    const state=nextCleanStreak(cleanStreak,admitted.length,protocol.cleanScansRequired);
    cleanStreak=state.streak; converged=state.converged;
    rounds.push({round,scannedCount:candidates.length,targetWeights,raceSeeds:[...raceSeeds],
      confirmationSeeds:[...confirmationSeeds],finalists,admittedStrategyIds:admitted.map((entry)=>entry.strategy.id),
      cleanStreak,equilibriumAfter:equilibrium});
    if (converged) break;
  }
  ledger.validate(); snapshot=matrix.snapshot(); equilibrium=solve(snapshot);
  return {schemaVersion:1,experiment:'fixed-reservoir-psro',version:FIXED_RESERVOIR_VERSION,
    kingdomId:pool.kingdomId,poolSeed:pool.poolSeed,evaluationSeed,
    rulesFingerprint:rulesFingerprint(pool.kingdomId,TURN_LIMIT_PER_PLAYER,ACTION_CAP_PER_TURN,false),
    poolHash:pool.generatedHash,reservoirHash:pool.reservoirHash,reservoir:pool.reservoir,
    status:converged?'converged':'incomplete',stopReason:converged?'two-clean-full-scans':'safety-cap',
    rounds,matrix:snapshot,equilibrium,seedNamespaces:ledger.namespaces,elapsedMs:now()-started};
}

function near(left:number,right:number,tolerance=1e-6):boolean{return Math.abs(left-right)<=tolerance;}
function sameEquilibrium(left:EquilibriumResult,right:EquilibriumResult):boolean{
  if(!near(left.value,right.value)||left.strategyIds.join('|')!==right.strategyIds.join('|'))return false;
  return left.strategyIds.every((id)=>near(left.weights[id]??0,right.weights[id]??0,1e-5));
}
function subgame(matrix:MatrixSnapshot,ids:readonly string[]):EquilibriumResult{
  const indexes=ids.map((id)=>matrix.strategies.findIndex((strategy)=>strategy.id===id));
  if(indexes.some((index)=>index<0))throw new Error('Missing subgame strategy.');
  return solveEquilibrium([...ids],indexes.map((row)=>indexes.map((column)=>matrix.centeredPayoffs[row]![column]!)));
}
export function validateFixedReservoirPsroArtifact(
  value: unknown, pool: FixedReservoirPoolArtifact, options: FixedReservoirRunOptions = {}
): boolean {
  try {
    const { evaluationSeed, protocol } = runOptions(options);
    if (!value||typeof value!=='object') return false;
    const artifact=value as Partial<FixedReservoirPsroArtifact>;
    if (artifact.schemaVersion!==1||artifact.experiment!=='fixed-reservoir-psro'||artifact.version!==FIXED_RESERVOIR_VERSION
      ||artifact.kingdomId!==pool.kingdomId||artifact.poolSeed!==pool.poolSeed||artifact.evaluationSeed!==evaluationSeed
      ||artifact.poolHash!==pool.generatedHash||artifact.reservoirHash!==pool.reservoirHash
      ||JSON.stringify(artifact.rulesFingerprint)!==JSON.stringify(
        rulesFingerprint(pool.kingdomId,TURN_LIMIT_PER_PLAYER,ACTION_CAP_PER_TURN,false))
      ||!Array.isArray(artifact.rounds)||!artifact.matrix||!artifact.equilibrium||!artifact.seedNamespaces) return false;
    const matrix=artifact.matrix;const ids=new Set(pool.reservoir.map((entry)=>entry.strategy.id));
    if(matrix.strategies.some((strategy)=>!ids.has(strategy.id))||!matrix.complete
      ||matrix.cells.length!==matrix.strategies.length*(matrix.strategies.length-1)/2) return false;
    const matrixSeeds=artifact.seedNamespaces.matrix;
    if(!matrixSeeds||matrixSeeds.length!==protocol.matrixBlocks)return false;
    const matrixIndex=new Map(matrix.strategies.map((strategy,index)=>[strategy.id,index]));
    for(const cell of matrix.cells){const row=matrixIndex.get(cell.rowId),column=matrixIndex.get(cell.columnId);
      if(row===undefined||column===undefined||!cell.complete||cell.blocks.length!==matrixSeeds.length
        ||cell.blocks.some((block,index)=>block.seed!==matrixSeeds[index]||block.played!==4||block.aborted!==0))return false;
      const played=cell.blocks.reduce((sum,block)=>sum+block.played,0);
      const centered=2*cell.blocks.reduce((sum,block)=>sum+block.score*block.played,0)/played-1;
      if(!near(centered,cell.centeredPayoff)||!near(matrix.centeredPayoffs[row]![column]!,centered))return false;
    }
    const ledger=new RandomPsroSeedLedger(evaluationSeed);
    ledger.reserve('matrix',protocol.matrixBlocks);
    let active=pool.reservoir.filter((entry)=>entry.source==='goldfish').slice(0,protocol.initialStrategies)
      .map((entry)=>entry.strategy.id).sort();
    let streak=0;
    for (const [index,round] of artifact.rounds.entries()) {
      const race=ledger.reserve(`round:${index}:race`,protocol.raceBlocks.reduce((a,b)=>a+b,0));
      const confirmation=ledger.reserve(`round:${index}:confirmation`,protocol.confirmationBlocks);
      ledger.reserve(`round:${index}:sampling`,protocol.raceBlocks.length+1);
      ledger.reserve(`round:${index}:bootstrap`,protocol.finalists);
      const before=subgame(matrix,active);
      if(round.round!==index||round.scannedCount!==pool.reservoir.length-active.length
        ||round.raceSeeds.join('|')!==race.join('|')||round.confirmationSeeds.join('|')!==confirmation.join('|')
        ||!sameEquilibrium({...before,weights:round.targetWeights},before)) return false;
      const expected=round.finalists.filter((entry)=>entry.interval95.lower>protocol.admissionLowerBound)
        .map((entry)=>entry.strategy.id);
      if(expected.join('|')!==round.admittedStrategyIds.join('|')||expected.some((id)=>active.includes(id)))return false;
      active=[...active,...expected].sort();const after=subgame(matrix,active);
      if(!sameEquilibrium(round.equilibriumAfter,after))return false;
      streak=expected.length?0:streak+1;if(round.cleanStreak!==streak)return false;
    }
    ledger.validate();
    if(JSON.stringify(ledger.namespaces)!==JSON.stringify(artifact.seedNamespaces)
      ||active.join('|')!==matrix.strategies.map((strategy)=>strategy.id).sort().join('|'))return false;
    const final=subgame(matrix,active);if(!sameEquilibrium(artifact.equilibrium,final))return false;
    const converged=streak>=protocol.cleanScansRequired;
    return artifact.status===(converged?'converged':'incomplete')
      && artifact.stopReason===(converged?'two-clean-full-scans':'safety-cap');
  } catch { return false; }
}

export function supportEntries(
  artifact: Pick<FixedReservoirPsroArtifact, 'matrix' | 'equilibrium'>
): {strategy:Strategy;weight:number}[] {
  return artifact.matrix.strategies.flatMap((strategy)=>{
    const weight=artifact.equilibrium.weights[strategy.id]??0;
    return weight>1e-6?[{strategy,weight}]:[];
  }).sort((a,b)=>b.weight-a.weight||compareUtf16(a.strategy.id,b.strategy.id)
    ||compareUtf16(canonicalStrategy(a.strategy),canonicalStrategy(b.strategy)));
}
