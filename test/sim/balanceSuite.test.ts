import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, VARIABLE_ACTION_IDS, findKingdom, resetKingdoms } from '../../src/game';
import {
  BALANCE_SUITE_MANIFEST, BALANCE_SUITE_SPEC, balanceSuite, generateBalanceSuite,
  measureBalanceSuiteDesign
} from '../../src/sim/balanceSuite';
import { rulesFingerprint } from '../../src/sim/rulesFingerprint';

afterEach(() => { resetKingdoms(); });

describe('balance-suite design', () => {
  it('measures a small design from literal hand-counted values', () => {
    expect(measureBalanceSuiteDesign([['a', 'b'], ['a', 'c'], ['b', 'c']], ['a', 'b', 'c']))
      .toEqual({ cardCountMinimum: 2, cardCountMaximum: 2, pairCountMinimum: 1,
        pairCountMaximum: 1, pairCountStandardDeviation: 0, largestOverlap: 1 });
  });

  it('regenerates the committed manifest byte-for-byte from fixed seeds', () => {
    const first = `${JSON.stringify(generateBalanceSuite(BALANCE_SUITE_SPEC), null, 2)}\n`;
    const second = `${JSON.stringify(generateBalanceSuite(BALANCE_SUITE_SPEC), null, 2)}\n`;
    const committed = fs.readFileSync(path.resolve(import.meta.dirname,
      '../../src/sim/balance-suite-manifest.json'), 'utf8');
    expect(first).toBe(second);
    expect(first).toBe(committed);
  });

  it('satisfies split balance, pile, damage, identity, and overlap constraints', () => {
    expect(BALANCE_SUITE_MANIFEST.kingdoms).toHaveLength(100);
    expect(BALANCE_SUITE_MANIFEST.eligibleCardIds).toEqual([...VARIABLE_ACTION_IDS].sort());
    expect(BALANCE_SUITE_MANIFEST.splits.map((split) => [split.name, split.size]))
      .toEqual([['tuning', 80], ['validation', 20]]);
    const eligible = new Set(BALANCE_SUITE_MANIFEST.eligibleCardIds);
    const sets = new Set<string>();
    for (const kingdom of BALANCE_SUITE_MANIFEST.kingdoms) {
      const ids = kingdom.actionPiles.map((pile) => pile.cardId);
      expect(kingdom.startingHealth, kingdom.id).toBe(40);
      expect(ids, kingdom.id).toHaveLength(10);
      expect(new Set(ids).size, kingdom.id).toBe(10);
      expect(ids.every((id) => eligible.has(id)), kingdom.id).toBe(true);
      expect(kingdom.actionPiles.every((pile) => pile.count === 10), kingdom.id).toBe(true);
      expect(ids.some((id) => ['melee', 'drive', 'flurry', 'ranged', 'volley', 'spell']
        .includes(CARDS[id]!.mechanic)), kingdom.id).toBe(true);
      const key = [...ids].sort().join('|');
      expect(sets.has(key), kingdom.id).toBe(false); sets.add(key);
    }
    const rows = BALANCE_SUITE_MANIFEST.kingdoms.map((kingdom) => new Set(kingdom.actionPiles.map((pile) => pile.cardId)));
    let largest = 0;
    for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
      largest = Math.max(largest, [...rows[left]!].filter((card) => rows[right]!.has(card)).length);
    }
    expect(largest).toBeLessThanOrEqual(8);
    for (const split of BALANCE_SUITE_MANIFEST.splits) {
      expect(split.design.cardCountMaximum - split.design.cardCountMinimum).toBeLessThanOrEqual(1);
      expect(split.design.largestOverlap).toBeLessThanOrEqual(8);
    }
  });

  it('registers generated kingdoms only when the simulator asks for them', () => {
    const id = BALANCE_SUITE_MANIFEST.kingdoms[0]!.id;
    expect(findKingdom(id)).toBeNull();
    balanceSuite.register();
    expect(findKingdom(id)).toMatchObject({ id, startingHealth: 40 });
    resetKingdoms();
    expect(findKingdom(id)).toBeNull();
  });
});

describe('balance-suite batch resume', () => {
  function writeRun(root: string, kingdomId: string,
    kind: 'valid' | 'stale' | 'invalid' | 'partial' | 'aborted'): void {
    balanceSuite.register();
    const directory = balanceSuite.runDirectory(root, kingdomId);
    fs.mkdirSync(directory, { recursive: true });
    const fingerprint = rulesFingerprint(kingdomId).hash;
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ schemaVersion: 5,
      rulesFingerprint: { hash: kind === 'stale' ? 'old' : fingerprint }, valid: kind !== 'invalid',
      mode: 'full', kingdomId, matches: 4, aborted: kind === 'aborted' ? 1 : 0, elapsedMs: 2 }));
    fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify({
      protocol: { rulesFingerprint: fingerprint }, complete: kind !== 'partial', equilibrium: {},
      strategies: [{ id: 'one' }, { id: 'two' }], cells: [{ complete: kind !== 'partial' }]
    }));
  }

  it('keeps a current run and reruns stale, invalid, partial, and aborted runs through its adapter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-suite-batch-'));
    const ids = BALANCE_SUITE_MANIFEST.kingdoms.slice(0, 5).map((kingdom) => kingdom.id);
    writeRun(root, ids[0]!, 'valid'); writeRun(root, ids[1]!, 'stale');
    writeRun(root, ids[2]!, 'invalid'); writeRun(root, ids[3]!, 'partial');
    writeRun(root, ids[4]!, 'aborted');
    const called: string[] = [];
    let active = 0, maximumActive = 0;
    const result = await balanceSuite.runBatch({ root, kingdomIds: ids }, async (request) => {
      called.push(request.kingdomId);
      expect(request.workers).toBe(4);
      active += 1; maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      writeRun(root, request.kingdomId, 'valid'); active -= 1;
    });
    expect(result).toEqual({ skipped: [ids[0]], completed: [...ids.slice(1)].sort(), failed: [] });
    expect(called.sort()).toEqual([...ids.slice(1)].sort());
    expect(maximumActive).toBe(2);
    const status = JSON.parse(fs.readFileSync(path.join(root, '.experiments/balance-suite',
      BALANCE_SUITE_MANIFEST.suiteVersion, 'status.json'), 'utf8'));
    expect(status).toMatchObject(result);
  });
});
