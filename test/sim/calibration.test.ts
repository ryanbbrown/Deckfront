import { describe, expect, it } from 'vitest';
import { checkRiggedMelee } from '../../src/sim/calibration';
import type { CalibrationInput } from '../../src/sim/calibration';

function leaders(count: number): CalibrationInput['finalLeaders'] {
  return Array.from({ length: count }, (_, index) => ({ strategyId: `leader-${index}`, rank: index + 1 }));
}
/** `acquired` names the leader indexes that ended up owning at least one Heavy Blow. */
function input(count: number, acquired: readonly number[]): CalibrationInput {
  const acquisitions: Record<string, Record<string, number>> = {};
  for (const index of acquired) acquisitions[`leader-${index}`] = { heavyBlow: 2, footwork: 4 };
  return { finalLeaders: leaders(count), acquisitionsByStrategy: acquisitions };
}

describe('the rigged-melee calibration check', () => {
  it('passes when the top leader acquired Heavy Blow, whatever the rest did', () => {
    const result = checkRiggedMelee(input(10, [0]));
    expect(result).toEqual({
      passed: true, topStrategyId: 'leader-0', topStrategyCopies: 2, leadersWhoAcquired: 1, leaderCount: 10
    });
  });

  it('passes on exactly 80 percent and fails on 79, when the top leader did not acquire one', () => {
    const eighty = checkRiggedMelee(input(10, [1, 2, 3, 4, 5, 6, 7, 8]));
    expect(eighty).toMatchObject({ passed: true, topStrategyCopies: 0, leadersWhoAcquired: 8, leaderCount: 10 });

    // 79 percent, exactly: 79 of 100 leaders, none of them the top one.
    const seventyNine = checkRiggedMelee(input(100, Array.from({ length: 79 }, (_, index) => index + 1)));
    expect(seventyNine).toMatchObject({ passed: false, topStrategyCopies: 0, leadersWhoAcquired: 79, leaderCount: 100 });
  });

  it('needs all three of a three-leader smoke run, because the threshold is integer arithmetic', () => {
    expect(checkRiggedMelee(input(3, [0, 1, 2])).passed).toBe(true);
    expect(checkRiggedMelee(input(3, [1, 2])).passed).toBe(false);
    expect(checkRiggedMelee(input(3, [1, 2])).leadersWhoAcquired).toBe(2);
  });

  it('throws on an empty leader list rather than passing vacuously', () => {
    expect(() => checkRiggedMelee({ finalLeaders: [], acquisitionsByStrategy: {} }))
      .toThrow('needs at least one final leader');
  });

  it('breaks a tie for top on the strategy id, which is the canonical-form hash', () => {
    const tied: CalibrationInput = {
      finalLeaders: [{ strategyId: 'bbb', rank: 1 }, { strategyId: 'aaa', rank: 1 }],
      acquisitionsByStrategy: { aaa: { heavyBlow: 1 } }
    };
    expect(checkRiggedMelee(tied)).toMatchObject({ passed: true, topStrategyId: 'aaa', topStrategyCopies: 1 });
    const reversed: CalibrationInput = { ...tied, finalLeaders: [...tied.finalLeaders].reverse() };
    expect(checkRiggedMelee(reversed).topStrategyId).toBe('aaa');
  });

  it('reads acquisitions, not agendas, and counts a starting-build copy', () => {
    // An agenda naming Heavy Blow proves nothing: only the acquisition map is read.
    const agendaOnly: CalibrationInput = {
      finalLeaders: [{ strategyId: 'planner', rank: 1 }],
      acquisitionsByStrategy: { planner: { footwork: 6, silver: 3 } }
    };
    expect(checkRiggedMelee(agendaOnly)).toMatchObject({ passed: false, topStrategyCopies: 0, leadersWhoAcquired: 0 });

    // Heavy Blow costs 3 here, so a leader can start with three copies and buy none. That is the
    // behaviour the gate exists to confirm, so it must count.
    const builtNotBought: CalibrationInput = {
      finalLeaders: [{ strategyId: 'opener', rank: 1 }],
      acquisitionsByStrategy: { opener: { heavyBlow: 3 } }
    };
    expect(checkRiggedMelee(builtNotBought)).toMatchObject({ passed: true, topStrategyCopies: 3 });
  });
});
