import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import type { GameState } from '../../src/game';
import { tacticalAgent } from '../../src/sim/tacticalAgent';
import { diagnosticLabels, diagnosticStrategies } from '../../src/sim/baselines';
import { CURATED_KINGDOM_IDS } from '../../src/sim/kingdoms';
import { runMatch } from '../../src/sim/match';
import { randomUniqueStrategies } from '../../src/sim/randomStrategy';
import { runSimulationMatch } from '../../src/sim/simulationKernel';
import { INFINITE_COUNT, fixedBuyPlan } from '../../src/sim/strategy';
import type { Strategy } from '../../src/sim/strategy';
import type { MatchResult } from '../../src/sim/types';

function matchScore(outcome: MatchResult['outcome']): Record<'ochre' | 'indigo', number> {
  if (outcome === 'ochre') return { ochre: 1, indigo: 0 };
  if (outcome === 'indigo') return { ochre: 0, indigo: 1 };
  return { ochre: 0.5, indigo: 0.5 };
}

function acquisitions(result: MatchResult): Record<'ochre' | 'indigo', Record<string, number>> {
  return Object.fromEntries((['ochre', 'indigo'] as const).map((playerId) => {
    const counts = { ...result.telemetry.purchasesByCard[playerId] };
    for (const cardId of result.telemetry.startingBuild[playerId]) counts[cardId] = (counts[cardId] ?? 0) + 1;
    return [playerId, counts];
  })) as Record<'ochre' | 'indigo', Record<string, number>>;
}

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

  it('matches exact mana cap and expiration traces in deterministic local games', () => {
    registerKingdom({ id: 'mana-lifetime-parity', name: 'Mana lifetime parity', startingHealth: 99,
      actionPiles: [{ cardId: 'starfire', count: 10 }] });
    const passive: Strategy = { id: 'mana-passive', startingBuild: [], buyPlan: fixedBuyPlan([]) };
    const run = (strategy: Strategy, seed: number, turnLimitPerPlayer: number) => {
      const endMana: number[] = [];
      const shared = { kingdomId: 'mana-lifetime-parity', seed, firstPlayerId: 'ochre' as const,
        swapSides: false, turnLimitPerPlayer, actionCapPerTurn: 200 };
      const product = runMatch({ ...shared,
        agents: { ochre: tacticalAgent(strategy), indigo: tacticalAgent(passive) } }, (state) => {
        const latest = state.events.at(-1);
        if (latest?.type === 'turn' && latest.playerId === 'indigo') endMana.push(state.players.ochre.mana);
      });
      const compact = runSimulationMatch({ ...shared, strategies: { ochre: strategy, indigo: passive } });
      expect(compact, `seed ${seed}`).toEqual(product);
      return { endMana, plays: compact.telemetry.playsByCard.ochre };
    };

    const capped: Strategy = { id: 'mana-cap', startingBuild: Array<string>(5).fill('focus'),
      buyPlan: fixedBuyPlan([]) };
    expect(run(capped, 14, 1)).toEqual({ endMana: [2], plays: { focus: 4 } });

    const expiring: Strategy = { id: 'mana-expiration', startingBuild: ['focus', 'focus', 'starfire'],
      buyPlan: fixedBuyPlan([]) };
    for (const seed of [3, 5, 8]) {
      const evidence = run(expiring, seed, 2);
      expect(evidence.endMana).toEqual([2, 0]);
      expect(evidence.plays).toEqual({ focus: 2 });
    }
  });

  it.each([
    ['three-way-open', 'melee', 'melee', 1],
    ['three-way-open', 'melee', 'mage', 1],
    ['three-way-open', 'mage', 'tempo', 3]
  ] as const)('matches the side-reflected production game for %s %s versus %s seed %i', (
    kingdomId, ochreLabel, indigoLabel, seed
  ) => {
    const strategies = diagnosticStrategies(kingdomId);
    const labels = diagnosticLabels(kingdomId);
    const find = (label: string): Strategy => strategies.find((entry) => labels.get(entry.id) === label)!;
    const shared = {
      kingdomId, seed, firstPlayerId: 'ochre' as const, turnLimitPerPlayer: 30, actionCapPerTurn: 200,
      strategies: { ochre: find(ochreLabel), indigo: find(indigoLabel) }
    };
    const normal = runSimulationMatch({ ...shared, swapSides: false });
    const reflected = runSimulationMatch({ ...shared, swapSides: true });

    expect(reflected.outcome).toBe(normal.outcome);
    expect(matchScore(reflected.outcome)).toEqual(matchScore(normal.outcome));
    expect(acquisitions(reflected)).toEqual(acquisitions(normal));
    expect(reflected.telemetry).toEqual(normal.telemetry);
    expect({ reason: reflected.reason, turns: reflected.turns })
      .toEqual({ reason: normal.reason, turns: normal.turns });
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
      buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'repellingShot', desiredCount: 5 },
        { kind: 'stop', threshold: 4 }, { kind: 'buy', cardId: 'volley', desiredCount: 3 },
        { kind: 'buy', cardId: 'repellingShot', desiredCount: INFINITE_COUNT }])
    };
    const melee: Strategy = {
      id: 'melee', startingBuild: ['heavyBlow', 'heavyBlow'],
      buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'heavyBlow', desiredCount: 4 },
        { kind: 'buy', cardId: 'footwork', desiredCount: 3 },
        { kind: 'buy', cardId: 'footwork', desiredCount: INFINITE_COUNT }])
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
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'reclaim', desiredCount:4 },{ kind:'buy' as const, cardId:'pepperingShot', desiredCount:5 },{ kind:'buy' as const, cardId:'muster', desiredCount:INFINITE_COUNT }]) };
    const movement: Strategy = { id:'movement', startingBuild:['footwork','adapt','repellingShot'],
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'adapt', desiredCount:4 },{ kind:'buy' as const, cardId:'repellingShot', desiredCount:5 },{ kind:'buy' as const, cardId:'footwork', desiredCount:INFINITE_COUNT }]) };
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
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'drive', desiredCount:5 },{ kind:'buy' as const, cardId:'adapt', desiredCount:5 },{ kind:'buy' as const, cardId:'footwork', desiredCount:INFINITE_COUNT }]) };
    const ranged: Strategy = { id:'ranged-movement', startingBuild:['repellingShot','adapt','footwork'],
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'repellingShot', desiredCount:5 },{ kind:'buy' as const, cardId:'adapt', desiredCount:5 },{ kind:'buy' as const, cardId:'footwork', desiredCount:INFINITE_COUNT }]) };
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
      buyPlan: fixedBuyPlan([
        { kind: 'buy', cardId: 'salvageShot', desiredCount: INFINITE_COUNT }
      ])
    };
    const passive: Strategy = {
      id: 'passive', startingBuild: [],
      buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }])
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
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'feint', desiredCount:4 },{ kind:'buy' as const, cardId:'strike', desiredCount:5 },{ kind:'buy' as const, cardId:'footwork', desiredCount:INFINITE_COUNT }]) };
    const ranged: Strategy = { id:'override-ranged', startingBuild:['aim','steadyShot'],
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'aim', desiredCount:4 },{ kind:'buy' as const, cardId:'steadyShot', desiredCount:5 },{ kind:'buy' as const, cardId:'aim', desiredCount:INFINITE_COUNT }]) };
    for (const seed of [3,8,13]) {
      const shared = { kingdomId:'sim-bonus-overrides', seed, firstPlayerId:'ochre' as const,
        swapSides:false, turnLimitPerPlayer:20, actionCapPerTurn:200 };
      expect(runSimulationMatch({ ...shared, strategies:{ ochre:melee, indigo:ranged } }))
        .toEqual(runMatch({ ...shared, agents:{ ochre:tacticalAgent(melee), indigo:tacticalAgent(ranged) } }));
    }
  });

  it('matches every controlled new mechanic and deterministic target order', () => {
    registerKingdom({ id:'controlled-mechanics', name:'Controlled mechanics', startingHealth:80, actionPiles:[
      'footwork','bullRush','strike','salvageShot','steadyShot','discipline','scour','sharpen','longshot',
      'improvise','openingStrike','rally','leyStep','adapt','feint','aim','channel','discharge','regroup'
    ].map((cardId) => ({ cardId, count:10 })) });
    const passive: Strategy = { id:'passive', startingBuild:[], buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'gold', desiredCount:INFINITE_COUNT }]) };
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
        buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:entry.played, desiredCount:4 },{ kind:'buy' as const, cardId:entry.played, desiredCount:INFINITE_COUNT }]) };
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
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'regroup', desiredCount:INFINITE_COUNT }]) };
    const passive: Strategy = { id:'empty-regroup-passive', startingBuild:[], buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'gold', desiredCount:INFINITE_COUNT }]) };
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
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'channel', desiredCount:4 },{ kind:'buy' as const, cardId:'discharge', desiredCount:4 },{ kind:'buy' as const, cardId:'channel', desiredCount:INFINITE_COUNT }]) };
    const passive: Strategy = { id:'passive-lethal', startingBuild:[], buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'gold', desiredCount:INFINITE_COUNT }]) };
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
    const regroup: Strategy = { id:'regroup-cap', startingBuild:['regroup'], buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'gold', desiredCount:INFINITE_COUNT }]) };
    const passive: Strategy = { id:'passive-cap', startingBuild:[], buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'gold', desiredCount:INFINITE_COUNT }]) };
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

  it('does not count a Reforge gain as progress toward a finite purchase slot', () => {
    registerKingdom({
      id: 'reforge-purchase-parity', name: 'Reforge purchase parity', startingHealth: 80,
      actionPiles: [{ cardId: 'reforge', count: 10 }, { cardId: 'adapt', count: 10 }],
      overrides: { reforge: { cost: 0 }, adapt: { cost: 3 } }
    });
    const active: Strategy = {
      id: 'reforge-buyer', startingBuild: Array<string>(5).fill('reforge'),
      buyPlan: fixedBuyPlan([
        { kind: 'buy', cardId: 'adapt', desiredCount: 1 },
        { kind: 'buy', cardId: 'silver', desiredCount: INFINITE_COUNT }
      ])
    };
    const passive: Strategy = {
      id: 'passive', startingBuild: [],
      buyPlan: fixedBuyPlan([{ kind: 'buy', cardId: 'gold', desiredCount: INFINITE_COUNT }])
    };
    const shared = {
      kingdomId: 'reforge-purchase-parity', seed: 4, firstPlayerId: 'ochre' as const,
      swapSides: false, turnLimitPerPlayer: 4, actionCapPerTurn: 200,
      strategies: { ochre: active, indigo: passive }
    };
    let finalState: GameState | null = null;
    const product = runMatch({
      ...shared, agents: { ochre: tacticalAgent(active), indigo: tacticalAgent(passive) }
    }, (state) => { finalState = state; });
    expect(product.telemetry.playsByCard.ochre.reforge).toBeGreaterThan(0);
    expect(product.telemetry.purchasesByCard.ochre.adapt).toBeGreaterThan(0);
    const events = (finalState as GameState | null)?.events ?? [];
    const gained = events.findIndex((event) =>
      event.type === 'gain' && event.playerId === 'ochre' && event.detail.definitionId === 'adapt');
    const purchased = events.findIndex((event) =>
      event.type === 'purchase' && event.playerId === 'ochre' && event.detail.definitionId === 'adapt');
    expect(gained).toBeGreaterThanOrEqual(0);
    expect(purchased).toBeGreaterThan(gained);
    expect(runSimulationMatch(shared)).toEqual(product);
  });

  it('matches combo counters, Reforge, and draft-off setup against the immutable engine', () => {
    registerKingdom({ id:'combo-parity', name:'Combo parity', startingHealth:40, actionPiles:[
      'cull','channel','attune','cascade','discharge','overload','flurry','precisionShot','reforge','footwork'
    ].map((cardId) => ({ cardId, count:10 })) });
    const combo: Strategy = { id:'combo', startingBuild:['channel','attune','cascade'],
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'discharge', desiredCount:4 },{ kind:'buy' as const, cardId:'overload', desiredCount:4 },{ kind:'buy' as const, cardId:'attune', desiredCount:4 },{ kind:'buy' as const, cardId:'channel', desiredCount:INFINITE_COUNT }]) };
    const engine: Strategy = { id:'engine', startingBuild:['reforge','cull','footwork'],
      buyPlan:fixedBuyPlan([{ kind:'buy' as const, cardId:'reforge', desiredCount:4 },{ kind:'buy' as const, cardId:'flurry', desiredCount:4 },{ kind:'buy' as const, cardId:'precisionShot', desiredCount:4 },{ kind:'buy' as const, cardId:'footwork', desiredCount:INFINITE_COUNT }]) };
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
