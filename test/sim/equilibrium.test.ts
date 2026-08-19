import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { solveEquilibrium } from '../../src/sim/equilibrium';

describe('maximum-support equilibrium', () => {
  it('solves dominant, cyclic, degenerate, and dominated literal matrices', () => {
    const dominant = solveEquilibrium(['a', 'b'], [[0, 1], [-1, 0]]);
    expect(dominant.weights).toEqual({ a: 1, b: 0 });
    expect(dominant.maximumEquilibriumWeight.b).toBeLessThan(1e-6);

    const rps = solveEquilibrium(['rock', 'paper', 'scissors'], [
      [0, -1, 1], [1, 0, -1], [-1, 1, 0]
    ]);
    expect(Object.values(rps.weights)).toEqual([1 / 3, 1 / 3, 1 / 3]);

    const identical = solveEquilibrium(['a', 'b', 'c'], [[0, 0, 1], [0, 0, 1], [-1, -1, 0]]);
    expect(identical.weights.a).toBeCloseTo(0.5);
    expect(identical.weights.b).toBeCloseTo(0.5);
    expect(identical.weights.c).toBe(0);

    const weak = solveEquilibrium(['a', 'b', 'c'], [[0, 0, 1], [0, 0, 0], [-1, 0, 0]]);
    expect(weak.maximumEquilibriumWeight.b).toBeGreaterThan(0.99);
  });

  it('lets a counter restore an old zero-weight strategy', () => {
    expect(solveEquilibrium(['a', 'b'], [[0, 1], [-1, 0]]).weights.b).toBe(0);
    const expanded = solveEquilibrium(['a', 'b', 'c'], [[0, 1, -1], [-1, 0, 1], [1, -1, 0]]);
    expect(expanded.weights.b).toBeCloseTo(1 / 3);
  });

  it('keeps an admitted discovery in the matrix even when its global weight is zero', () => {
    const solved = solveEquilibrium(['rock', 'paper', 'scissors', 'niche'], [
      [0, -1, 1, 1], [1, 0, -1, 1], [-1, 1, 0, 1], [-1, -1, -1, 0]
    ]);
    expect(solved.strategyIds).toContain('niche');
    expect(solved.weights.niche).toBe(0);
    expect(solved.maximumEquilibriumWeight.niche).toBeLessThan(1e-6);
  });

  it('is stable under input order and in a separate process', () => {
    const first = solveEquilibrium(['b', 'c', 'a'], [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]);
    const second = solveEquilibrium(['a', 'b', 'c'], [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]);
    expect(first).toEqual(second);
    const script = `import {solveEquilibrium} from './src/sim/equilibrium.ts';process.stdout.write(JSON.stringify(solveEquilibrium(['a','b','c'],[[0,-1,1],[1,0,-1],[-1,1,0]])))`;
    const external = execFileSync(process.execPath, ['--import', 'tsx', '--eval', script], { encoding: 'utf8' });
    expect(external).toBe(JSON.stringify(second));
  });
});
