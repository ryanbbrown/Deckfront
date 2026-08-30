import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms, resolveCardInKingdom } from '../../src/game';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { diagnosticStrategies } from '../../src/sim/baselines';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { runMatch } from '../../src/sim/match';
import { randomUniqueStrategies } from '../../src/sim/randomStrategy';
import { runSimulationMatch } from '../../src/sim/simulationKernel';
import type { Strategy } from '../../src/sim/strategy';

afterEach(() => { resetKingdoms(); });

describe('the compact simulation kernel', () => {
  it.each(CURATED_KINGDOM_IDS)('matches the immutable engine in %s', (kingdomId) => {
    const strategies = [...diagnosticStrategies(kingdomId), ...randomUniqueStrategies(kingdomId, 91, 3).strategies];
    for (const seed of [3, 17]) {
      for (const ochre of strategies) for (const indigo of strategies) {
        const swapSides = seed === 17;
        const shared = {
          kingdomId, seed, firstPlayerId: seed === 3 ? 'ochre' as const : 'indigo' as const,
          swapSides, turnLimitPerPlayer: 30, actionCapPerTurn: 200
        };
        const product = runMatch({
          ...shared,
          agents: { ochre: tacticalAgent(ochre), indigo: tacticalAgent(indigo) }
        });
        const compact = runSimulationMatch({
          ...shared,
          strategies: { ochre, indigo }
        });
        expect(compact, `${kingdomId} ${ochre.id} vs ${indigo.id} seed ${seed}`).toEqual(product);
        expect(runSimulationMatch({ ...shared, strategies: { ochre, indigo } })).toEqual(compact);
      }
    }
  });

  it('matches the immutable engine for Repelling Shot movement', () => {
    registerKingdom({
      id: 'repelling-parity', name: 'Repelling parity', startingHealth: 40,
      actionPiles: [
        { cardId: 'repellingShot', count: 10 }, { cardId: 'volley', count: 10 },
        { cardId: 'heavyBlow', count: 10 }, { cardId: 'footwork', count: 10 }
      ]
    });
    const ranged: Strategy = {
      id: 'repelling', startingBuild: ['repellingShot', 'repellingShot', 'volley'],
      buyAgenda: [{ cardId: 'repellingShot', desiredCount: 5 }, { cardId: 'volley', desiredCount: 3 }],
      repeatPurchase: 'repellingShot'
    };
    const melee: Strategy = {
      id: 'melee', startingBuild: ['heavyBlow', 'heavyBlow'],
      buyAgenda: [{ cardId: 'heavyBlow', desiredCount: 4 }, { cardId: 'footwork', desiredCount: 3 }],
      repeatPurchase: 'footwork'
    };
    for (const seed of [2, 7, 19]) {
      const shared = {
        kingdomId: 'repelling-parity', seed, firstPlayerId: seed === 7 ? 'indigo' as const : 'ochre' as const,
        swapSides: seed === 19, turnLimitPerPlayer: 30, actionCapPerTurn: 200
      };
      const product = runMatch({
        ...shared, agents: { ochre: tacticalAgent(ranged), indigo: tacticalAgent(melee) }
      });
      const compact = runSimulationMatch({ ...shared, strategies: { ochre: ranged, indigo: melee } });
      expect(compact, `seed ${seed}`).toEqual(product);
      expect(compact.telemetry.playsByCard.ochre.repellingShot).toBeGreaterThan(0);
    }
  });

  it('matches Reclaim when the recovered action can be played in the same turn', () => {
    registerKingdom({ id:'reclaim-parity', name:'Reclaim parity', startingHealth:40, actionPiles:[
      'reclaim','muster','pepperingShot','adapt','footwork','drive','repellingShot','heavyBlow','aim','volley'
    ].map((cardId) => ({ cardId, count:10 })) });
    const recovery: Strategy = { id:'recovery', startingBuild:['reclaim','muster','pepperingShot'],
      buyAgenda:[{ cardId:'reclaim', desiredCount:4 },{ cardId:'pepperingShot', desiredCount:5 }], repeatPurchase:'muster' };
    const movement: Strategy = { id:'movement', startingBuild:['footwork','adapt','repellingShot'],
      buyAgenda:[{ cardId:'adapt', desiredCount:4 },{ cardId:'repellingShot', desiredCount:5 }], repeatPurchase:'footwork' };
    let reclaimPlays = 0; let recoveredActionPlays = 0;
    for (const seed of [1,2,3,4,5,6,7,8]) {
      const shared = { kingdomId:'reclaim-parity', seed, firstPlayerId:'ochre' as const, swapSides:false,
        turnLimitPerPlayer:15, actionCapPerTurn:200 };
      const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(recovery), indigo:tacticalAgent(movement) } });
      const compact = runSimulationMatch({ ...shared, strategies:{ ochre:recovery, indigo:movement } });
      expect(compact, `seed ${seed}`).toEqual(product);
      reclaimPlays += compact.telemetry.playsByCard.ochre.reclaim ?? 0;
      recoveredActionPlays += compact.telemetry.playsByCard.ochre.pepperingShot ?? 0;
    }
    expect(reclaimPlays).toBeGreaterThan(0); expect(recoveredActionPlays).toBeGreaterThan(reclaimPlays);
  });

  it('matches movement-counter draws after active Drive and Repelling Shot fallback movement', () => {
    registerKingdom({ id:'movement-counter-parity', name:'Movement counter parity', startingHealth:60, actionPiles:[
      'adapt','footwork','drive','repellingShot','pepperingShot','heavyBlow','muster','stipend','aim','volley'
    ].map((cardId) => ({ cardId, count:10 })) });
    const close: Strategy = { id:'close-movement', startingBuild:['footwork','drive','adapt'],
      buyAgenda:[{ cardId:'drive', desiredCount:5 },{ cardId:'adapt', desiredCount:5 }], repeatPurchase:'footwork' };
    const ranged: Strategy = { id:'ranged-movement', startingBuild:['repellingShot','adapt','footwork'],
      buyAgenda:[{ cardId:'repellingShot', desiredCount:5 },{ cardId:'adapt', desiredCount:5 }], repeatPurchase:'footwork' };
    const totals = { drive:0, repellingShot:0, adapt:0 };
    for (const seed of [9,10,11,12,13,14,15,16]) {
      const shared = { kingdomId:'movement-counter-parity', seed, firstPlayerId:'ochre' as const,
        swapSides:seed % 2 === 0, turnLimitPerPlayer:18, actionCapPerTurn:200 };
      const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(close), indigo:tacticalAgent(ranged) } });
      const compact = runSimulationMatch({ ...shared, strategies:{ ochre:close, indigo:ranged } });
      expect(compact, `seed ${seed}`).toEqual(product);
      totals.drive += compact.telemetry.playsByCard.ochre.drive ?? 0;
      totals.repellingShot += compact.telemetry.playsByCard.indigo.repellingShot ?? 0;
      totals.adapt += (compact.telemetry.playsByCard.ochre.adapt ?? 0) + (compact.telemetry.playsByCard.indigo.adapt ?? 0);
    }
    expect(totals.drive).toBeGreaterThan(0); expect(totals.repellingShot).toBeGreaterThan(0); expect(totals.adapt).toBeGreaterThan(0);
  });

  it('matches Salvage Shot when the pilot selects a later higher-cost Ranged card', () => {
    registerKingdom({
      id: 'salvage-target-parity', name: 'Salvage target parity', startingHealth: 60,
      actionPiles: [
        { cardId: 'salvageShot', count: 10 }, { cardId: 'pepperingShot', count: 10 },
        { cardId: 'longshot', count: 10 }
      ]
    });
    const active: Strategy = {
      id: 'salvage', startingBuild: ['salvageShot', 'pepperingShot', 'longshot'],
      buyAgenda: [{ cardId: 'salvageShot', desiredCount: 10 }], repeatPurchase: 'salvageShot'
    };
    const passive: Strategy = {
      id: 'passive', startingBuild: [], buyAgenda: [], repeatPurchase: 'gold'
    };
    let salvagePlays = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const shared = {
        kingdomId: 'salvage-target-parity', seed, firstPlayerId: 'ochre' as const,
        swapSides: false, turnLimitPerPlayer: 8, actionCapPerTurn: 200
      };
      const product = runMatch({
        ...shared, agents: { ochre: tacticalAgent(active), indigo: tacticalAgent(passive) }
      });
      const compact = runSimulationMatch({ ...shared, strategies: { ochre: active, indigo: passive } });
      expect(compact, `seed ${seed}`).toEqual(product);
      salvagePlays += product.telemetry.playsByCard.ochre.salvageShot ?? 0;
    }
    expect(salvagePlays).toBeGreaterThan(0);
  });

  it('matches resolved Feint and Aim bonus overrides', () => {
    registerKingdom({ id:'sim-bonus-overrides', name:'Simulator bonus overrides', startingHealth:60,
      actionPiles:['footwork','feint','strike','aim','steadyShot'].map((cardId) => ({ cardId, count:10 })),
      overrides:{ feint:{ values:{ bonus:3 } }, aim:{ values:{ bonus:5 } } } });
    const melee: Strategy = { id:'override-melee', startingBuild:['footwork','feint','strike'],
      buyAgenda:[{ cardId:'feint', desiredCount:4 },{ cardId:'strike', desiredCount:5 }], repeatPurchase:'footwork' };
    const ranged: Strategy = { id:'override-ranged', startingBuild:['aim','steadyShot'],
      buyAgenda:[{ cardId:'aim', desiredCount:4 },{ cardId:'steadyShot', desiredCount:5 }], repeatPurchase:'aim' };
    for (const seed of [3,8,13]) {
      const shared = { kingdomId:'sim-bonus-overrides', seed, firstPlayerId:'ochre' as const,
        swapSides:false, turnLimitPerPlayer:20, actionCapPerTurn:200 };
      expect(runSimulationMatch({ ...shared, strategies:{ ochre:melee, indigo:ranged } }))
        .toEqual(runMatch({ ...shared, agents:{ ochre:tacticalAgent(melee), indigo:tacticalAgent(ranged) } }));
    }
  });

  it('matches draft-off Scrap damage from a kingdom override', () => {
    registerKingdom({
      id: 'scrap-override-parity', name: 'Scrap override parity', startingHealth: 40,
      actionPiles: [{ cardId: 'cull', count: 10 }],
      overrides: { scrap: { cost: 5, values: { damage: 7 } } }
    });
    expect(resolveCardInKingdom('scrap-override-parity', 'scrap')).toMatchObject({
      cost: 5, values: { damage: 7 }
    });
    const passive: Strategy = { id: 'scrap-passive', startingBuild: [], buyAgenda: [], repeatPurchase: 'gold' };
    const shared = {
      kingdomId: 'scrap-override-parity', seed: 1, firstPlayerId: 'ochre' as const,
      swapSides: false, turnLimitPerPlayer: 1, actionCapPerTurn: 100, startingDraftEnabled: false
    };
    const product = runMatch({
      ...shared, agents: { ochre: tacticalAgent(passive), indigo: tacticalAgent(passive) }
    });
    const compact = runSimulationMatch({ ...shared, strategies: { ochre: passive, indigo: passive } });

    expect(compact).toEqual(product);
    expect(compact.telemetry.damageByCard).toEqual({ ochre: { scrap: 7 }, indigo: { scrap: 7 } });
  });

  it('caps carried mana at 3 before the kernel spends it on a later turn', () => {
    registerKingdom({
      id: 'kernel-mana-cap', name: 'Kernel mana cap', startingHealth: 100,
      actionPiles: [{ cardId: 'channel', count: 10 }, { cardId: 'discharge', count: 10 }],
      overrides: {
        channel: { cost: 0, values: { mana: 4, draw: 0 } },
        discharge: { cost: 0, values: { perMana: 1 } }
      }
    });
    const active: Strategy = {
      id: 'kernel-mana-active',
      startingBuild: ['channel', 'discharge', ...Array<string>(8).fill('copper')],
      buyAgenda: [], repeatPurchase: 'gold'
    };
    const passive: Strategy = { id: 'kernel-mana-passive', startingBuild: [], buyAgenda: [], repeatPurchase: 'gold' };
    const result = runSimulationMatch({
      kingdomId: 'kernel-mana-cap', seed: 25, firstPlayerId: 'ochre', swapSides: false,
      turnLimitPerPlayer: 5, actionCapPerTurn: 100, strategies: { ochre: active, indigo: passive }
    });

    expect(result.telemetry.playsByCard.ochre).toMatchObject({ channel: 1, discharge: 1 });
    expect(result.telemetry.damageByCard.ochre.discharge).toBe(3);
    expect(result.telemetry.finalHealth.indigo).toBe(97);
  });

  it('matches every controlled new mechanic and deterministic target order', () => {
    registerKingdom({ id:'controlled-mechanics', name:'Controlled mechanics', startingHealth:80, actionPiles:[
      'footwork','bullRush','strike','salvageShot','steadyShot','discipline','scour','sharpen','longshot',
      'improvise','openingStrike','rally','leyStep','adapt','feint','aim','channel','discharge','regroup'
    ].map((cardId) => ({ cardId, count:10 })) });
    const passive: Strategy = { id:'passive', startingBuild:[], buyAgenda:[], repeatPurchase:'gold' };
    const cases: Array<{ mechanic:string; build:string[]; played:string }> = [
      { mechanic:'Bull Rush', build:['footwork','bullRush','strike'], played:'bullRush' },
      { mechanic:'Salvage Shot', build:['salvageShot','steadyShot'], played:'salvageShot' },
      { mechanic:'Discipline', build:['discipline'], played:'discipline' },
      { mechanic:'Scour', build:['scour'], played:'scour' },
      { mechanic:'Sharpen', build:['sharpen'], played:'sharpen' },
      { mechanic:'Longshot', build:['longshot'], played:'longshot' },
      { mechanic:'Improvise', build:['improvise'], played:'improvise' },
      { mechanic:'Opening Strike', build:['footwork','openingStrike'], played:'openingStrike' },
      { mechanic:'Rally', build:['footwork','rally'], played:'rally' },
      { mechanic:'Ley Step Far mana', build:['leyStep','adapt'], played:'leyStep' },
      { mechanic:'Feint', build:['footwork','feint','strike'], played:'feint' },
      { mechanic:'Aim', build:['aim','steadyShot'], played:'aim' },
      { mechanic:'Discharge', build:['channel','discharge'], played:'discharge' },
      { mechanic:'Regroup', build:['regroup'], played:'regroup' }
    ];
    for (const entry of cases) {
      const plan: Strategy = { id:`controlled-${entry.played}`, startingBuild:entry.build,
        buyAgenda:[{ cardId:entry.played, desiredCount:4 }], repeatPurchase:entry.played };
      let plays = 0;
      for (const seed of [2,7]) {
        const shared = { kingdomId:'controlled-mechanics', seed, firstPlayerId:'ochre' as const,
          swapSides:false, turnLimitPerPlayer:20, actionCapPerTurn:200 };
        const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(plan), indigo:tacticalAgent(passive) } });
        const compact = runSimulationMatch({ ...shared, strategies:{ ochre:plan, indigo:passive } });
        expect(compact, `${entry.mechanic} seed ${seed}`).toEqual(product);
        plays += compact.telemetry.playsByCard.ochre[entry.played] ?? 0;
      }
      expect(plays, entry.mechanic).toBeGreaterThan(0);
    }
  });

  it('matches empty-hand Regroup without creating a discard continuation', () => {
    registerKingdom({ id:'empty-regroup', name:'Empty Regroup', startingHealth:80,
      actionPiles:[{ cardId:'regroup', count:10 }], overrides:{ regroup:{ cost:0, values:{ draw:0 } } } });
    const regroup: Strategy = { id:'empty-regroup-plan', startingBuild:Array<string>(5).fill('regroup'),
      buyAgenda:[], repeatPurchase:'regroup' };
    const passive: Strategy = { id:'empty-regroup-passive', startingBuild:[], buyAgenda:[], repeatPurchase:'gold' };
    const shared = { kingdomId:'empty-regroup', seed:125, firstPlayerId:'ochre' as const,
      swapSides:false, turnLimitPerPlayer:2, actionCapPerTurn:20 };
    const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(regroup), indigo:tacticalAgent(passive) } });
    const compact = runSimulationMatch({ ...shared, strategies:{ ochre:regroup, indigo:passive } });
    expect(compact).toEqual(product);
    expect(compact.telemetry.playsByCard.ochre.regroup).toBe(3);
  });

  it('keeps lethal Discharge mana cleanup and event identity exact', () => {
    registerKingdom({ id:'lethal-discharge', name:'Lethal Discharge', startingHealth:10,
      actionPiles:['channel','discharge'].map((cardId) => ({ cardId, count:10 })),
      overrides:{ discharge:{ values:{ perMana:20 } } } });
    const lethal: Strategy = { id:'lethal', startingBuild:['channel','discharge'],
      buyAgenda:[{ cardId:'channel', desiredCount:4 },{ cardId:'discharge', desiredCount:4 }], repeatPurchase:'channel' };
    const passive: Strategy = { id:'passive-lethal', startingBuild:[], buyAgenda:[], repeatPurchase:'gold' };
    let victories = 0;
    for (const seed of [1,2,3,4,5,6]) {
      const shared = { kingdomId:'lethal-discharge', seed, firstPlayerId:'ochre' as const,
        swapSides:false, turnLimitPerPlayer:10, actionCapPerTurn:200 };
      const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(lethal), indigo:tacticalAgent(passive) } });
      const compact = runSimulationMatch({ ...shared, strategies:{ ochre:lethal, indigo:passive } });
      expect(compact, `seed ${seed}`).toEqual(product);
      if (compact.outcome === 'ochre') victories += 1;
    }
    expect(victories).toBeGreaterThan(0);
  });

  it('does not charge pending continuations against a low action cap', () => {
    registerKingdom({ id:'continuation-cap', name:'Continuation cap', startingHealth:80,
      actionPiles:[{ cardId:'regroup', count:10 }] });
    const regroup: Strategy = { id:'regroup-cap', startingBuild:['regroup'], buyAgenda:[], repeatPurchase:'gold' };
    const passive: Strategy = { id:'passive-cap', startingBuild:[], buyAgenda:[], repeatPurchase:'gold' };
    let plays = 0;
    for (const seed of [1,2,3,4,5,6]) {
      const shared = { kingdomId:'continuation-cap', seed, firstPlayerId:'ochre' as const,
        swapSides:false, turnLimitPerPlayer:5, actionCapPerTurn:3 };
      const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(regroup), indigo:tacticalAgent(passive) } });
      const compact = runSimulationMatch({ ...shared, strategies:{ ochre:regroup, indigo:passive } });
      expect(compact, `seed ${seed}`).toEqual(product);
      plays += compact.telemetry.playsByCard.ochre.regroup ?? 0;
    }
    expect(plays).toBeGreaterThan(0);
  });

  it('matches combo counters, Reforge, and draft-off setup against the immutable engine', () => {
    registerKingdom({ id:'combo-parity', name:'Combo parity', startingHealth:40, actionPiles:[
      'cull','channel','attune','cascade','discharge','overload','flurry','precisionShot','reforge','footwork'
    ].map((cardId) => ({ cardId, count:10 })) });
    const combo: Strategy = { id:'combo', startingBuild:['channel','attune','cascade'],
      buyAgenda:[{ cardId:'discharge', desiredCount:4 },{ cardId:'overload', desiredCount:4 },{ cardId:'attune', desiredCount:4 }], repeatPurchase:'channel' };
    const engine: Strategy = { id:'engine', startingBuild:['reforge','cull','footwork'],
      buyAgenda:[{ cardId:'reforge', desiredCount:4 },{ cardId:'flurry', desiredCount:4 },{ cardId:'precisionShot', desiredCount:4 }], repeatPurchase:'footwork' };
    for (const startingDraftEnabled of [true,false]) for (const seed of [5,13]) {
      const shared = { kingdomId:'combo-parity', seed, firstPlayerId:'ochre' as const, swapSides:false,
        turnLimitPerPlayer:12, actionCapPerTurn:200, startingDraftEnabled };
      const product = runMatch({ ...shared, agents:{ ochre:tacticalAgent(combo), indigo:tacticalAgent(engine) } });
      const compact = runSimulationMatch({ ...shared, strategies:{ ochre:combo, indigo:engine } });
      expect(compact, `draft ${startingDraftEnabled} seed ${seed}`).toEqual(product);
      expect(compact.config.startingDraftEnabled).toBe(startingDraftEnabled);
      if (!startingDraftEnabled) expect(compact.telemetry.startingBuild).toEqual({ ochre:[], indigo:[] });
    }
  });

});
