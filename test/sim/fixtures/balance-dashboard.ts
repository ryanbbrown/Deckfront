import type { DashboardRun } from '../../../scripts/write_balance_dashboard';
import type { Strategy } from '../../../src/sim/strategy';
import type { PairRecord, TelemetryAggregate } from '../../../src/sim/types';

export const ids = [
  'sg-f90c7fc368',
  'sg-1d34f7047f',
  'sg-d3bb76c65e',
  'sg-2074b62b77',
  'sg-d74afb8868',
  'sg-c439dc0c6d'
] as const;

const plans: Omit<Strategy, 'id'>[] = [
  {
    startingBuild: ['aim', 'volley'],
    buyAgenda: [{ cardId: 'volley', desiredCount: 3 }, { cardId: 'footwork', desiredCount: 2 }],
    repeatPurchase: 'footwork'
  },
  {
    startingBuild: ['footwork', 'heavyBlow'],
    buyAgenda: [
      { cardId: 'heavyBlow', desiredCount: 4 },
      { cardId: 'feint', desiredCount: 2 },
      { cardId: 'footwork', desiredCount: 2 }
    ],
    repeatPurchase: 'footwork'
  },
  {
    startingBuild: ['arcBolt', 'channel'],
    buyAgenda: [{ cardId: 'arcBolt', desiredCount: 3 }],
    repeatPurchase: 'channel'
  },
  {
    startingBuild: ['steadyShot', 'steadyShot'],
    buyAgenda: [{ cardId: 'steadyShot', desiredCount: 4 }, { cardId: 'footwork', desiredCount: 2 }],
    repeatPurchase: 'footwork'
  },
  {
    startingBuild: ['drive', 'footwork'],
    buyAgenda: [{ cardId: 'drive', desiredCount: 3 }, { cardId: 'feint', desiredCount: 2 }],
    repeatPurchase: 'footwork'
  },
  {
    startingBuild: ['muster', 'stipend'],
    buyAgenda: [{ cardId: 'muster', desiredCount: 3 }, { cardId: 'stipend', desiredCount: 2 }],
    repeatPurchase: 'steadyShot'
  }
];

function pair(wins: number, draws = 0, losses = 10 - wins - draws, aborted = 0): PairRecord {
  return { played: wins + draws + losses, wins, draws, losses, aborted };
}

function telemetry(): TelemetryAggregate {
  return {
    acquisitionsByStrategy: Object.fromEntries(ids.map((id, index) => [id,
      index < 3 ? { volley: 30 } : { heavyBlow: 30 }])),
    damageByCard: { volley: 600, heavyBlow: 300, mysteryAttack: 100 },
    playsByCard: { volley: 120, heavyBlow: 50, mysteryAttack: 20 },
    deadDraws: { range: 1, mana: 2, setup: 3, total: 4 },
    turnsToWin: { total: 720, count: 90 },
    byOrientation: {
      firstOchre: {
        normal: pair(6, 2, 2),
        swapped: pair(7, 0, 3)
      },
      firstIndigo: {
        normal: pair(2, 2, 6),
        swapped: pair(3, 0, 7)
      }
    }
  };
}

export function makeDashboardRun(kingdomId = 'current-duel'): DashboardRun {
  const strategies = ids.map((id, index) => ({
    id,
    seed: index === 0 ? 'also-final' : index === 5 ? 'melee' : null,
    source: index < 5 ? 'final' : 'seed',
    strategy: {
      id,
      startingBuild: [...plans[index]!.startingBuild],
      buyAgenda: plans[index]!.buyAgenda.map((entry) => ({ ...entry })),
      repeatPurchase: plans[index]!.repeatPurchase
    }
  }));
  const pairs = Object.fromEntries(ids.map((rowId, rowIndex) => [rowId,
    Object.fromEntries(ids.filter((columnId) => columnId !== rowId).map((columnId) => {
      const columnIndex = ids.indexOf(columnId);
      return [columnId, pair(rowIndex < columnIndex ? 6 : 4)];
    }))]));
  const finalIds = ids.slice(0, 5);
  return {
    run: {
      kingdomId,
      kingdomName: kingdomId,
      mode: 'full',
      seed: 1,
      limits: {
        candidates: 100,
        leaders: 5,
        generations: 32,
        sharedSeeds: 25,
        deadlineMinutes: 420,
        stateLimit: 20_000,
        workers: 10,
        turnLimitPerPlayer: 30,
        actionCapPerTurn: 200
      },
      stopReason: 'generations',
      error: null,
      generationsRun: 32,
      evolutionMatches: 100,
      evolutionAborted: 0,
      tournamentMatches: 100,
      tournamentAborted: 0,
      tournamentComplete: true,
      blockers: [],
      finalLeaderIds: finalIds,
      kingdom: [
        ['copper', 0],
        ['aim', 3], ['volley', 5], ['footwork', 2], ['heavyBlow', 6], ['feint', 3],
        ['arcBolt', 4], ['channel', 3], ['steadyShot', 4], ['drive', 4], ['muster', 4],
        ['stipend', 3]
      ].map(([id, cost]) => ({ id: String(id), name: String(id), cost: Number(cost) })),
      calibration: kingdomId === 'rigged-melee' ? {
        passed: false,
        topStrategyId: ids[2],
        topStrategyCopies: 0,
        leadersWhoAcquired: 2,
        leaderCount: 5
      } : null
    },
    generations: Array.from({ length: 32 }, (_, index) => ({
      generation: index + 1,
      partial: false,
      leaders: (index === 0 ? ids.slice(1, 6) : finalIds).map((strategyId, rank) => ({
        strategyId,
        score: 1 - rank / 10,
        completedPairings: 5,
        completedGames: 500,
        abortedGames: 0
      }))
    })),
    strategies,
    telemetry: { evolution: telemetry(), tournament: telemetry() },
    tournament: {
      entrants: [...ids],
      pairs,
      ranking: [ids[2], ids[0], ids[1], ids[3], ids[4], ids[5]].map((strategyId, index) => ({
        strategyId,
        score: 0.8 - index / 10,
        completedPairings: 5,
        completedGames: 50,
        abortedGames: 0
      })),
      partial: false,
      pairsPlayed: 15,
      pairsExpected: 15,
      matches: 100,
      calibration: {}
    }
  };
}

export function makeFiveDashboardRuns(): DashboardRun[] {
  return ['current-duel', 'three-way-open', 'three-way-engine', 'range-rich-mixed', 'rigged-melee']
    .map(makeDashboardRun);
}
