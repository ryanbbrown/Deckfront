import { describe, expect, it } from 'vitest';
import {
  FIXED_RESERVOIR_EVALUATION_SEED, generatedHash, globalRaceSurvivors, nextCleanStreak,
  remainingReservoirStrategies, reservoirHash, selectFixedReservoir, validateFixedReservoirPool
} from '../../src/sim/fixedReservoirPsro';
import type { FixedReservoirPoolArtifact, ReservoirEntry } from '../../src/sim/fixedReservoirPsro';
import type { MovementAwareGoldfishScore } from '../../src/sim/goldfish';
import { INFINITE_COUNT, fixedBuyPlan, identify } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';

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
    const generatedIds=Array.from({length:8},(_u,index)=>strategy(index).id);
    const artifact:FixedReservoirPoolArtifact={schemaVersion:1,experiment:'fixed-reservoir-pool',version:'fixed-reservoir-psro-v1',
      kingdomId:'fixture',poolSeed:7,goldfishSeeds:[10,11],generatedCount:8,generatedIds,
      generatedHash:generatedHash(generatedIds),reservoirHash:reservoirHash(reservoir),reservoir,elapsedMs:1};
    expect(validateFixedReservoirPool(artifact,{poolSeed:7,generatedCount:8,goldfishCount:3,randomCount:2})).toBe(true);
    expect(validateFixedReservoirPool({...artifact,generatedHash:'bad'})).toBe(false);
    expect(FIXED_RESERVOIR_EVALUATION_SEED).toBe(7_100_009);
    expect(artifact.poolSeed).not.toBe(FIXED_RESERVOIR_EVALUATION_SEED);
  });
});
