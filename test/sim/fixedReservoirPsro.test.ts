import { describe, expect, it } from 'vitest';
import {
  FIXED_RESERVOIR_EVALUATION_SEED, globalRaceSurvivors, nextCleanStreak,
  remainingReservoirStrategies, reservoirHash, selectFixedReservoir, validateFixedReservoirPool,
  validateFixedReservoirPsroArtifact
} from '../../src/sim/fixedReservoirPsro';
import type { FixedReservoirPoolArtifact, ReservoirEntry } from '../../src/sim/fixedReservoirPsro';
import type { MovementAwareGoldfishScore } from '../../src/sim/goldfish';
import { generatedProvenance } from '../../src/sim/nativeStrategySearch';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import {
  FIXED_RESERVOIR_KINGDOMS, crossPlayMatrix, cumulativeFamilyCoverage, cumulativeMaterialCoverage,
  summarizeFiveRunCards, summarizeRunFamilies, suiteUnitActions
} from '../../src/sim/fixedReservoirSuite';
import type { RunAcquisitionEvidence } from '../../src/sim/fixedReservoirSuite';

function strategy(index:number):Strategy{return identify({id:'',startingBuild:[],buyPlan:fixedBuyPlan([
  {kind:'buy',cardId:index%2?'strike':'precisionShot',desiredCount:index+1},
  {kind:'buy',cardId:'gold',desiredCount:INFINITE_COUNT}
])});}
function score(index:number):MovementAwareGoldfishScore{return {strategy:strategy(index),profiles:[],
  worstCompletions:index,totalCompletions:index,worstPenalizedTurnsTo50:100-index,
  totalPenalizedTurnsTo50:300-index,worstDamageArea:index,totalDamageArea:index,totalMoneySpent:index};}

describe('fixed reservoir PSRO',()=>{
  it('selects exact disjoint goldfish and random-tail cohorts deterministically',()=>{
    const scores=Array.from({length:30},(_u,index)=>score(index));
    const first=selectFixedReservoir(scores,18,2,1);const second=selectFixedReservoir([...scores].reverse(),18,2,1);
    expect(first.map((entry)=>entry.strategy.id)).toEqual(second.map((entry)=>entry.strategy.id));
    expect(first.filter((entry)=>entry.source==='goldfish')).toHaveLength(18);
    expect(first.filter((entry)=>entry.source==='random')).toHaveLength(2);
    expect(new Set(first.map((entry)=>entry.strategy.id))).toHaveProperty('size',20);
    expect(first.slice(0,18).map((entry)=>entry.goldfishRank)).toEqual(Array.from({length:18},(_u,index)=>index+1));
  });

  it('keeps global finalists across chunk boundaries',()=>{
    const evaluations=(values:number[])=>values.map((mean,index)=>({strategy:strategy(index+Math.round(mean*100)),mean}));
    const result=globalRaceSurvivors([evaluations([0.3,0.9]),evaluations([0.8,0.1]),evaluations([0.7])],3);
    expect(result.map((entry)=>entry.mean)).toEqual([0.9,0.8,0.7]);
  });

  it('rescans every non-admitted reservoir strategy after the active matrix changes',()=>{
    const entries=Array.from({length:5},(_u,index):ReservoirEntry=>({strategy:strategy(index),source:'goldfish',goldfishRank:index+1,score:{
      worstCompletions:1,totalCompletions:3,worstPenalizedTurnsTo50:30,totalPenalizedTurnsTo50:90,worstDamageArea:1,totalDamageArea:3}}));
    const first=remainingReservoirStrategies(entries,new Set([entries[0]!.strategy.id]));
    const second=remainingReservoirStrategies(entries,new Set([entries[0]!.strategy.id,entries[2]!.strategy.id]));
    expect(first.map((held)=>held.id)).toContain(entries[4]!.strategy.id);
    expect(second.map((held)=>held.id)).toContain(entries[4]!.strategy.id);
    expect(second.map((held)=>held.id)).not.toContain(entries[2]!.strategy.id);
  });

  it('requires a fresh second clean scan and resets after admission',()=>{
    expect(nextCleanStreak(0,0)).toEqual({streak:1,converged:false});
    expect(nextCleanStreak(1,2)).toEqual({streak:0,converged:false});
    expect(nextCleanStreak(0,0)).toEqual({streak:1,converged:false});
    expect(nextCleanStreak(1,0)).toEqual({streak:2,converged:true});
  });

  it('validates pool provenance and keeps evaluation seed independent of pool seed',()=>{
    const reservoir=selectFixedReservoir(Array.from({length:8},(_u,index)=>score(index)),3,2,7);
    const provenance=generatedProvenance(Array.from({length:8},(_u,index)=>strategy(index)));
    const artifact:FixedReservoirPoolArtifact={schemaVersion:2,experiment:'fixed-reservoir-pool',version:'fixed-reservoir-psro-v2',
      kingdomId:'fixture',poolSeed:7,goldfishSeeds:[10,11],generatedCount:8,
      generatedHash:provenance.generatedIdDigest,canonicalProvenanceDigest:provenance.canonicalProvenanceDigest,
      duplicateCanonicalCount:0,displayIdCollisionCount:0,scoringProtocol:'fixture-v1',
      shardProvenance:[{shardId:'0',startPosition:0,endPosition:8,
        candidateDigest:provenance.canonicalProvenanceDigest,scoreDigest:'123456789'}],
      reservoirHash:reservoirHash(reservoir),reservoir,elapsedMs:1};
    expect(validateFixedReservoirPool(artifact,{kingdomId:'fixture',poolSeed:7,generatedCount:8,
      goldfishCount:3,randomCount:2,goldfishSeeds:[10,11]})).toBe(true);
    expect(validateFixedReservoirPool({...artifact,generatedHash:'bad'})).toBe(false);
    expect(validateFixedReservoirPool(artifact,{kingdomId:'other'})).toBe(false);
    expect(validateFixedReservoirPool(artifact,{goldfishSeeds:[10,12]})).toBe(false);
    expect(FIXED_RESERVOIR_EVALUATION_SEED).toBe(7_100_009);
    expect(artifact.poolSeed).not.toBe(FIXED_RESERVOIR_EVALUATION_SEED);
    const copiedRun={schemaVersion:1,experiment:'fixed-reservoir-psro',version:'fixed-reservoir-psro-v1',
      kingdomId:'other',poolSeed:7,evaluationSeed:7_100_009,poolHash:artifact.generatedHash,
      reservoirHash:artifact.reservoirHash,rounds:[],matrix:null,equilibrium:null,seedNamespaces:{}};
    expect(validateFixedReservoirPsroArtifact(copiedRun,artifact)).toBe(false);
    expect(validateFixedReservoirPsroArtifact({...copiedRun,kingdomId:'fixture'},artifact,{evaluationSeed:7_100_001}))
      .toBe(false);
  });

  it('keeps pool seeds separate from one fixed evaluation seed per kingdom',()=>{
    expect(FIXED_RESERVOIR_KINGDOMS).toEqual([
      {kingdomId:'deep-beam-tuning-001',evaluationSeed:7_100_001},
      {kingdomId:'deep-beam-tuning-009',evaluationSeed:7_100_009}
    ]);
    expect(new Set(FIXED_RESERVOIR_KINGDOMS.map((entry)=>entry.evaluationSeed)).size).toBe(2);
  });

  it('resumes only the missing or invalid part of a suite unit',()=>{
    expect(suiteUnitActions({pool:'complete',run:'complete'})).toEqual(['skip']);
    expect(suiteUnitActions({pool:'complete',run:'invalid'})).toEqual(['run-psro']);
    expect(suiteUnitActions({pool:'missing',run:'missing'})).toEqual(['build-pool','run-psro']);
    expect(suiteUnitActions({pool:'invalid',run:'complete'})).toEqual(['build-pool','run-psro']);
  });

  it('aggregates weighted acquisitions and mixed damage families across five runs',()=>{
    const run=(poolSeed:number,ranged:number):RunAcquisitionEvidence=>({poolSeed,support:[
      {strategyId:`mixed-${poolSeed}`,weight:0.6,archetype:'Melee + Ranged',
        acquisitionRates:{strike:2,precisionShot:ranged},damageAmounts:{Melee:2,Ranged:ranged,Mage:0}},
      {strategyId:`mage-${poolSeed}`,weight:0.4,archetype:'Mage',
        acquisitionRates:{fireball:1},damageAmounts:{Melee:0,Ranged:0,Mage:1}}
    ]});
    const runs=[1,2,3,4,5].map((seed)=>run(seed,seed===5?0:1));
    const families=summarizeRunFamilies(runs[0]!);
    expect(families.archetypes).toEqual({'Melee + Ranged':0.6,Mage:0.4});
    expect(families.continuous.Melee).toBeCloseTo(6/11);
    expect(families.continuous.Ranged).toBeCloseTo(3/11);
    expect(families.continuous.Mage).toBeCloseTo(2/11);
    expect(cumulativeFamilyCoverage(runs.map(summarizeRunFamilies)).at(-1)!.families)
      .toEqual(['Melee','Ranged','Mage']);
    const cards=summarizeFiveRunCards(runs,['strike','precisionShot','fireball']);
    expect(cards.find((card)=>card.cardId==='strike')).toMatchObject({mean:1.2,minimum:1.2,maximum:1.2,materialRuns:5});
    expect(cards.find((card)=>card.cardId==='precisionShot')).toMatchObject({mean:0.48,minimum:0,maximum:0.6,materialRuns:4});
    expect(cumulativeMaterialCoverage(cards).map((entry)=>entry.cards.length)).toEqual([3,3,3,3,3]);
  });

  it('constructs every requested ordered cross-play cell',()=>{
    const interval95={lower:0.4,upper:0.6};
    const cells=[
      {rowSeed:1,columnSeed:1,score:0.5,interval95},
      {rowSeed:1,columnSeed:2,score:0.4,interval95},
      {rowSeed:2,columnSeed:1,score:0.6,interval95},
      {rowSeed:2,columnSeed:2,score:0.5,interval95}
    ];
    expect(crossPlayMatrix(cells,[1,2]).map((row)=>row.map((cell)=>cell.score)))
      .toEqual([[0.5,0.4],[0.6,0.5]]);
    expect(()=>crossPlayMatrix(cells.slice(1),[1,2])).toThrow('Missing cross-play cell 1/1');
  });
});
