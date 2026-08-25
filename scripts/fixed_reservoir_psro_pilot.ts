import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { SeededRandom, registerKingdom } from '../src/game';
import type { Kingdom } from '../src/game';
import { classifyStrategyDamage } from './generate_balance_corpus';
import { rankingDigest } from '../src/sim/goldfish';
import type { MovementAwareGoldfishScore, GoldfishConfig } from '../src/sim/goldfish';
import { generatedProvenance } from '../src/sim/nativeStrategySearch';
import { percentileBootstrapMean } from '../src/sim/mixtureEvaluation';
import type { PairingJob } from '../src/sim/pairingRunner';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { RandomPsroSeedLedger, stoplessRandomDomain } from '../src/sim/randomPsro';
import { RANDOM_PSRO_KINGDOMS } from '../src/sim/randomPsroSuite';
import {
  FIXED_RESERVOIR_CONFIG, FIXED_RESERVOIR_VERSION, reservoirHash,
  runFixedReservoirPsro, scanFixedReservoir, selectFixedReservoir, supportEntries,
  validateFixedReservoirPool, validateFixedReservoirPsroArtifact
} from '../src/sim/fixedReservoirPsro';
import type {
  FixedReservoirPoolArtifact, FixedReservoirPsroArtifact, ReservoirConfirmedCandidate
} from '../src/sim/fixedReservoirPsro';
import { canonicalStrategy, formatSlot } from '../src/sim/strategy';
import type { Strategy } from '../src/sim/strategy';
import type { TelemetryAggregate } from '../src/sim/types';
import { headToHead } from './headToHead';

type WorkerScore=Omit<MovementAwareGoldfishScore,'strategy'>;
interface WorkerReply {id:number;scores?:WorkerScore[];error?:string;stack?:string}
const ROOT=path.join('.experiments',FIXED_RESERVOIR_VERSION);
const GOLDFISH_SEEDS=Object.freeze([5_200_000,5_200_001,5_200_002,5_200_003]);
const workers=10;
function writeAtomic(file:string,value:unknown):void { fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.tmp-${process.pid}`;fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`);fs.renameSync(temp,file); }
function poolPath(seed:number):string{return path.join(ROOT,`pool-${seed}.json`)}
function runPath(seed:number):string{return path.join(ROOT,`run-${seed}.json`)}
function plan(strategy:Strategy):string{return strategy.buyPlan.filter((slot)=>slot.kind!=='inactive').map(formatSlot).join(' → ')}
function generate(kingdomId:string,count:number,seed:number){
  const domain=stoplessRandomDomain(kingdomId),random=new SeededRandom(seed),seen=new Set<string>(),ids=new Map<string,string>();
  const strategies:Strategy[]=[];let duplicateCanonicalCount=0,displayIdCollisionCount=0;
  while(strategies.length<count){const strategy=domain.randomComplete(random),key=canonicalStrategy(strategy);
    if(seen.has(key)){duplicateCanonicalCount+=1;continue}seen.add(key);const held=ids.get(strategy.id);
    if(held!==undefined&&held!==key)displayIdCollisionCount+=1;else ids.set(strategy.id,key);strategies.push(strategy)}
  return{strategies,duplicateCanonicalCount,displayIdCollisionCount};
}
async function scoreInWorkers(strategies:readonly Strategy[],config:GoldfishConfig,kingdom:Kingdom):Promise<MovementAwareGoldfishScore[]>{
  const pool=Array.from({length:workers},()=>new Worker(new URL('../src/server/goldfishWorker.ts',import.meta.url),
    {workerData:{kingdom},execArgv:['--import','tsx']}));
  try {const partitions=pool.map((_worker,index)=>strategies.slice(Math.floor(strategies.length*index/workers),Math.floor(strategies.length*(index+1)/workers)));
    return (await Promise.all(pool.map((worker,index)=>new Promise<MovementAwareGoldfishScore[]>((resolve,reject)=>{
      worker.once('error',reject);worker.once('message',(reply:WorkerReply)=>{if(reply.error||!reply.scores){reject(new Error(reply.stack??reply.error));return;}
        resolve(reply.scores.map((score,scoreIndex)=>({...score,strategy:partitions[index]![scoreIndex]!})))});
      worker.postMessage({id:index,strategies:partitions[index],config,mode:'movement-aware'});
    })))).flat();
  } finally {await Promise.all(pool.map((worker)=>worker.terminate()));}
}
async function buildPool(kingdom:Kingdom,poolSeed:number):Promise<FixedReservoirPoolArtifact>{
  const file=poolPath(poolSeed);if(fs.existsSync(file)){const held=JSON.parse(fs.readFileSync(file,'utf8'));
    if(validateFixedReservoirPool(held,{poolSeed,generatedCount:FIXED_RESERVOIR_CONFIG.generatedCount,
      goldfishCount:FIXED_RESERVOIR_CONFIG.goldfishCount,randomCount:FIXED_RESERVOIR_CONFIG.randomCount})) return held;}
  const started=Date.now();console.log(`pool ${poolSeed}: generating ${FIXED_RESERVOIR_CONFIG.generatedCount}`);
  const generation=generate(kingdom.id,FIXED_RESERVOIR_CONFIG.generatedCount,poolSeed),generated=generation.strategies;
  console.log(`pool ${poolSeed}: goldfishing`);
  const scores=await scoreInWorkers(generated,{kingdomId:kingdom.id,seeds:GOLDFISH_SEEDS,turnLimit:30,actionCapPerTurn:200},kingdom);
  const reservoir=selectFixedReservoir(scores,FIXED_RESERVOIR_CONFIG.goldfishCount,FIXED_RESERVOIR_CONFIG.randomCount,poolSeed);
  const provenance=generatedProvenance(generated,generation.duplicateCanonicalCount,generation.displayIdCollisionCount);
  const artifact:FixedReservoirPoolArtifact={schemaVersion:2,experiment:'fixed-reservoir-pool',version:FIXED_RESERVOIR_VERSION,
    kingdomId:kingdom.id,poolSeed,goldfishSeeds:[...GOLDFISH_SEEDS],generatedCount:generated.length,
    generatedHash:provenance.generatedIdDigest,canonicalProvenanceDigest:provenance.canonicalProvenanceDigest,
    duplicateCanonicalCount:provenance.duplicateCanonicalCount,displayIdCollisionCount:provenance.displayIdCollisionCount,
    scoringProtocol:'typescript-movement-aware-v1',shardProvenance:[{shardId:'local-0',startPosition:0,
      endPosition:generated.length,candidateDigest:provenance.canonicalProvenanceDigest,scoreDigest:rankingDigest(scores)}],
    reservoirHash:reservoirHash(reservoir),reservoir,elapsedMs:Date.now()-started};
  writeAtomic(file,artifact);console.log(`pool ${poolSeed}: ${(artifact.elapsedMs/1000).toFixed(1)}s`);return artifact;
}
async function runPool(kingdom:Kingdom,pool:FixedReservoirPoolArtifact):Promise<FixedReservoirPsroArtifact>{
  const file=runPath(pool.poolSeed);if(fs.existsSync(file)){const held=JSON.parse(fs.readFileSync(file,'utf8'));
    if(validateFixedReservoirPsroArtifact(held,pool)) return held;}
  const runner=new WorkerPairingRunner(workers,new URL('../src/server/aiWorker.ts',import.meta.url),{kingdom},['--import','tsx']);
  try {const artifact=await runFixedReservoirPsro(pool,runner);writeAtomic(file,artifact);
    console.log(`run ${pool.poolSeed}: ${artifact.status}, ${artifact.rounds.length} rounds, ${(artifact.elapsedMs/1000).toFixed(1)}s`);return artifact;}
  finally {await runner.close();}
}
function games(telemetry:TelemetryAggregate):number{return Object.values(telemetry.byOrientation).reduce((total,pair)=>total+pair.normal.played+pair.swapped.played,0)}
function cellTelemetry(artifact:FixedReservoirPsroArtifact,left:string,right:string):TelemetryAggregate{
  const cell=artifact.matrix.cells.find((candidate)=>(candidate.rowId===left&&candidate.columnId===right)||(candidate.rowId===right&&candidate.columnId===left));
  if(!cell)throw new Error(`Missing cell ${left}/${right}`);return cell.telemetry;}
async function familyDistribution(artifact:FixedReservoirPsroArtifact,runner:WorkerPairingRunner):Promise<Record<string,number>>{
  const support=supportEntries(artifact);const jobs:PairingJob[]=support.map((entry,index)=>({candidate:entry.strategy,opponent:entry.strategy,
    options:{kingdomId:artifact.kingdomId,seeds:Array.from({length:25},(_u,i)=>5_600_000+index*100+i),turnLimitPerPlayer:50,
      actionCapPerTurn:200,startingDraftEnabled:false,allowEarlyStop:false}}));
  const batch=await runner.run(jobs);const self=new Map(support.map((entry,index)=>[entry.strategy.id,batch.outcomes[index]!.telemetry]));
  const distribution:Record<string,number>={};
  for(const entry of support){const totals:Record<string,number>={};let weightedGames=0;
    for(const opponent of support){const mirror=entry.strategy.id===opponent.strategy.id;
      const telemetry=mirror?self.get(entry.strategy.id)!:cellTelemetry(artifact,entry.strategy.id,opponent.strategy.id);const divisor=mirror?2:1;
      weightedGames+=games(telemetry)*opponent.weight;
      for(const [cardId,amount] of Object.entries(telemetry.acquisitionsByStrategy[entry.strategy.id]??{})) totals[cardId]=(totals[cardId]??0)+amount/divisor*opponent.weight;}
    const rates=Object.fromEntries(Object.entries(totals).map(([id,amount])=>[id,amount/weightedGames]));
    const archetype=classifyStrategyDamage({startingBuild:entry.strategy.startingBuild,acquisitionRates:rates});
    distribution[archetype]=(distribution[archetype]??0)+entry.weight;}
  return distribution;
}
async function crossAttack(source:FixedReservoirPsroArtifact,target:FixedReservoirPsroArtifact,runner:WorkerPairingRunner):Promise<ReservoirConfirmedCandidate|null>{
  const ledger=new RandomPsroSeedLedger(9_100_009);const active=new Set(target.matrix.strategies.map((strategy)=>strategy.id));
  const candidates=source.reservoir.filter((entry)=>!active.has(entry.strategy.id)).map((entry)=>entry.strategy);
  const finalists=await scanFixedReservoir({candidates,snapshot:target.matrix,equilibrium:target.equilibrium,runner,kingdomId:target.kingdomId,
    raceSeeds:ledger.reserve('cross:race',15),confirmationSeeds:ledger.reserve('cross:confirmation',400),
    samplingSeeds:ledger.reserve('cross:sampling',5),bootstrapSeeds:ledger.reserve('cross:bootstrap',8)});
  return finalists.sort((a,b)=>b.interval95.lower-a.interval95.lower||b.mean-a.mean)[0]??null;
}
async function compare(kingdom:Kingdom,left:FixedReservoirPsroArtifact,right:FixedReservoirPsroArtifact):Promise<unknown>{
  const runner=new WorkerPairingRunner(workers,new URL('../src/server/aiWorker.ts',import.meta.url),{kingdom},['--import','tsx']);
  try {const seeds=Array.from({length:400},(_u,i)=>5_400_000+i);const leftSupport=supportEntries(left),rightSupport=supportEntries(right);
    const leftRows=await headToHead(runner,kingdom.id,leftSupport.map((e)=>e.strategy),rightSupport,seeds,10,undefined,{startingDraftEnabled:false});
    const rightRows=await headToHead(runner,kingdom.id,rightSupport.map((e)=>e.strategy),leftSupport,seeds,10,undefined,{startingDraftEnabled:false});
    const summarize=(rows:Awaited<ReturnType<typeof headToHead>>,support:typeof leftSupport,seed:number)=>{const blocks=seeds.map((_v,index)=>rows.reduce((sum,row,rowIndex)=>sum+row.blockScores[index]!*support[rowIndex]!.weight,0));
      return {score:blocks.reduce((a,b)=>a+b,0)/blocks.length,interval95:percentileBootstrapMean(blocks,seed),supports:rows.map((row,index)=>({id:row.strategy.id,weight:support[index]!.weight,score:row.mean,interval95:percentileBootstrapMean(row.blockScores,seed+index+1)}))};};
    const leftAttack=await crossAttack(left,right,runner);
    const rightAttack=await crossAttack(right,left,runner);
    const leftFamilies=await familyDistribution(left,runner);
    const rightFamilies=await familyDistribution(right,runner);
    const leftIds=new Set(left.reservoir.map((e)=>e.strategy.id));const overlap=right.reservoir.filter((e)=>leftIds.has(e.strategy.id)).length;
    return {version:FIXED_RESERVOIR_VERSION,overlap,reservoirSize:left.reservoir.length,
      left:{poolSeed:left.poolSeed,status:left.status,rounds:left.rounds.length,matrix:left.matrix.strategies.length,runtimeMs:left.elapsedMs,
        families:leftFamilies,support:leftSupport.map((e)=>({id:e.strategy.id,weight:e.weight,plan:plan(e.strategy)})),
        vsRight:summarize(leftRows,leftSupport,5_500_001),reservoirVsRight:leftAttack},
      right:{poolSeed:right.poolSeed,status:right.status,rounds:right.rounds.length,matrix:right.matrix.strategies.length,runtimeMs:right.elapsedMs,
        families:rightFamilies,support:rightSupport.map((e)=>({id:e.strategy.id,weight:e.weight,plan:plan(e.strategy)})),
        vsLeft:summarize(rightRows,rightSupport,5_500_101),reservoirVsLeft:rightAttack}};
  } finally {await runner.close();}
}

const kingdom=RANDOM_PSRO_KINGDOMS.find((entry)=>entry.id==='deep-beam-tuning-009');if(!kingdom)throw new Error('Kingdom 009 missing');registerKingdom(kingdom);
const pools=[] as FixedReservoirPoolArtifact[];const runs=[] as FixedReservoirPsroArtifact[];
for(const seed of [1,2]){const pool=await buildPool(kingdom,seed);pools.push(pool);runs.push(await runPool(kingdom,pool));}
const result=await compare(kingdom,runs[0]!,runs[1]!);writeAtomic(path.join(ROOT,'comparison.json'),result);
console.log(JSON.stringify(result,null,2));
