import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, TREASURE_IDS, VARIABLE_ACTION_IDS, registerKingdom, resetKingdoms
} from '../../src/game';
import { BALANCE_SUITE_MANIFEST, balanceSuite } from '../../src/sim/balanceSuite';
import {
  DEEP_BEAM_CONFIG, DEEP_BEAM_KINGDOMS, DEEP_BEAM_SUITE_VERSION,
  FROZEN_DEEP_BEAM_SOURCE_MANIFEST, deepBeamSuite
} from '../../src/sim/deepBeamSuite';
import { ACTION_CAP_PER_TURN, TURN_LIMIT_PER_PLAYER } from '../../src/sim/experimentConfig';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { STRATIFIED_BEAM_LANES } from '../../src/sim/stratifiedBeam';

afterEach(() => { resetKingdoms(); });

function completeResult(kingdomId: string): Record<string, unknown> {
  const input = deepBeamSuite.createInput(kingdomId);
  return {
    schemaVersion: 1,
    experiment: 'draft-off-diverse-beam-double-oracle',
    suiteVersion: DEEP_BEAM_SUITE_VERSION,
    kingdom: input.kingdom,
    rulesFingerprint: input.rulesFingerprint,
    config: {
      startingDraftEnabled: false,
      workers: 10,
      iterations: 3,
      maxSlots: 8,
      lanes: STRATIFIED_BEAM_LANES.map((lane) => ({ ...lane })),
      admissionsPerLane: 1,
      stageSeeds: [1, 2, 4],
      confirmationSeeds: 12,
      matrixSeeds: 8,
      earlyStopDelta: 0.002,
      earlyStopPatience: 2,
      sweep: false
    },
    elapsedMs: 330_000,
    iterations: [{}],
    matrix: {
      protocol: matrixProtocol(kingdomId, Array.from({ length: 8 }, (_value, index) => 40_000 + index),
        TURN_LIMIT_PER_PLAYER, ACTION_CAP_PER_TURN, false),
      strategies: [{ id: 'one' }, { id: 'two' }],
      cells: [{ complete: true }],
      complete: true
    },
    equilibrium: {},
    targetMixture: [],
    independentSweep: null
  };
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

describe('deep-beam suite design', () => {
  it('reuses the exact 100 balanced card sets at 50 health without fixed market cards', () => {
    expect(DEEP_BEAM_KINGDOMS).toHaveLength(100);
    const frozenBytes = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/sim/deep-beam-balance-suite-v3.json'));
    expect(createHash('sha256').update(frozenBytes).digest('hex'))
      .toBe('4e7c9c889fc40b7d52532b756f17121a247d91497ac0e49f9acd7a150a0972a6');
    const fixed = new Set([...TREASURE_IDS, ...ALWAYS_AVAILABLE_ACTION_IDS]);
    const eligible = new Set(VARIABLE_ACTION_IDS);
    const appearances = new Map(VARIABLE_ACTION_IDS.map((id) => [id, 0]));
    const pairCounts = new Map<string, number>();
    let largestOverlap = 0;

    for (let index = 0; index < DEEP_BEAM_KINGDOMS.length; index += 1) {
      const kingdom = DEEP_BEAM_KINGDOMS[index]!;
      const source = FROZEN_DEEP_BEAM_SOURCE_MANIFEST.kingdoms[index]!;
      const cards = kingdom.actionPiles.map((pile) => pile.cardId);
      expect(kingdom.startingHealth, kingdom.id).toBe(50);
      expect(cards).toEqual(source.actionPiles.map((pile) => pile.cardId));
      expect(cards).toHaveLength(10);
      expect(new Set(cards).size).toBe(10);
      expect(cards.every((card) => eligible.has(card))).toBe(true);
      expect(cards.some((card) => fixed.has(card))).toBe(false);
      for (const card of cards) appearances.set(card, appearances.get(card)! + 1);
      for (let left = 0; left < cards.length; left += 1) {
        for (let right = left + 1; right < cards.length; right += 1) {
          const key = [cards[left]!, cards[right]!].sort().join('|');
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
      for (let previous = 0; previous < index; previous += 1) {
        const prior = new Set(DEEP_BEAM_KINGDOMS[previous]!.actionPiles.map((pile) => pile.cardId));
        largestOverlap = Math.max(largestOverlap, cards.filter((card) => prior.has(card)).length);
      }
    }

    expect(new Set(DEEP_BEAM_KINGDOMS.map((kingdom) => kingdom.actionPiles
      .map((pile) => pile.cardId).sort().join('|'))).size).toBe(100);
    expect([...appearances.values()]).toEqual(Array(40).fill(25));
    const pairs = [...pairCounts.values()];
    const mean = pairs.reduce((sum, count) => sum + count, 0) / pairs.length;
    const deviation = Math.sqrt(pairs.reduce((sum, count) => sum + (count - mean) ** 2, 0) / pairs.length);
    expect(Math.min(...pairs)).toBe(3);
    expect(Math.max(...pairs)).toBe(9);
    expect(deviation).toBeCloseTo(0.9835, 4);
    expect(largestOverlap).toBe(6);
    expect(BALANCE_SUITE_MANIFEST.kingdoms).toHaveLength(160);
    balanceSuite.register();
    expect(() => deepBeamSuite.register()).not.toThrow();
    const frozenBalanceRow = FROZEN_DEEP_BEAM_SOURCE_MANIFEST.kingdoms[0]!;
    expect(() => registerKingdom({ id: frozenBalanceRow.id, name: frozenBalanceRow.name,
      startingHealth: frozenBalanceRow.startingHealth, actionPiles: frozenBalanceRow.actionPiles }))
      .toThrow(/already registered with different content/iu);
  });

  it('pins the frozen Kingdom 009 cards and draft-off rules fingerprint', () => {
    const input = deepBeamSuite.createInput('deep-beam-tuning-009');
    expect(input.kingdom.actionPiles.map((pile) => pile.cardId)).toEqual([
      'channel', 'improvise', 'longshot', 'precisionShot', 'reclaim', 'reforge', 'salvageShot',
      'scour', 'sharpen', 'strike'
    ]);
    expect(input.rulesFingerprint.hash).toBe('6fb50a6edb4');
  });

  it('creates explicit draft-off inputs with the exact standard beam config', () => {
    const input = deepBeamSuite.createInput(DEEP_BEAM_KINGDOMS[0]!.id);
    expect(DEEP_BEAM_CONFIG).toEqual({ workers: 10, iterations: 3, maxSlots: 8,
      lanes: [
        { id: 'unrestricted', width: 24, finalists: 4 },
        { id: 'mage', width: 16, finalists: 2 },
        { id: 'melee', width: 16, finalists: 2 },
        { id: 'ranged', width: 16, finalists: 2 }
      ],
      admissionsPerLane: 1 });
    expect(input).toMatchObject({ schemaVersion: 1, suiteVersion: DEEP_BEAM_SUITE_VERSION,
      startingDraftEnabled: false, beamConfig: DEEP_BEAM_CONFIG,
      kingdom: { startingHealth: 50 } });
    expect(input.rulesFingerprint.rules.startingDraftEnabled).toBe(false);
    expect(input.rulesFingerprint.rules.kingdom.startingHealth).toBe(50);
  });
});

describe('deep-beam suite resume boundary', () => {
  it('skips only a valid result and reruns stale, malformed, partial, and failed artifacts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-deep-beam-'));
    const ids = DEEP_BEAM_KINGDOMS.slice(0, 6).map((kingdom) => kingdom.id);
    writeJson(deepBeamSuite.resultPath(root, ids[0]!), completeResult(ids[0]!));
    const stale = completeResult(ids[1]!); stale.suiteVersion = 'deep-beam-old';
    writeJson(deepBeamSuite.resultPath(root, ids[1]!), stale);
    fs.mkdirSync(path.dirname(deepBeamSuite.resultPath(root, ids[2]!)), { recursive: true });
    fs.writeFileSync(deepBeamSuite.resultPath(root, ids[2]!), '{broken');
    const partial = completeResult(ids[3]!);
    (partial.matrix as { complete: boolean }).complete = false;
    writeJson(deepBeamSuite.resultPath(root, ids[3]!), partial);
    writeJson(deepBeamSuite.resultPath(root, ids[4]!), { status: 'failed' });
    const wrongConfig = completeResult(ids[5]!);
    ((wrongConfig.config as { lanes: { width: number }[] }).lanes[1]!).width = 15;
    writeJson(deepBeamSuite.resultPath(root, ids[5]!), wrongConfig);

    const called: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const result = await deepBeamSuite.runBatch({ root, kingdomIds: ids }, async (request) => {
      called.push(request.kingdomId);
      expect(request.config).toEqual(DEEP_BEAM_CONFIG);
      const input = JSON.parse(fs.readFileSync(request.inputPath, 'utf8')) as { startingDraftEnabled: boolean };
      expect(input.startingDraftEnabled).toBe(false);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      writeJson(request.resultPath, completeResult(request.kingdomId));
      active -= 1;
    });

    expect(result).toEqual({ skipped: [ids[0]], completed: [...ids.slice(1)].sort(),
      failed: [], interrupted: false });
    expect(called).toEqual(ids.slice(1));
    expect(maximumActive).toBe(1);
    expect(deepBeamSuite.status(root).complete).toBe(6);
    const status = JSON.parse(fs.readFileSync(path.join(root, '.experiments/deep-beam-suite',
      DEEP_BEAM_SUITE_VERSION, 'status.json'), 'utf8')) as Record<string, unknown>;
    expect(status).toMatchObject(result);
    expect(fs.readdirSync(path.dirname(deepBeamSuite.resultPath(root, ids[0]!)))
      .some((file) => file.includes('.tmp-'))).toBe(false);
  });

  it('continues after a failed kingdom and records a non-complete status', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-deep-beam-failure-'));
    const ids = DEEP_BEAM_KINGDOMS.slice(0, 2).map((kingdom) => kingdom.id);
    const result = await deepBeamSuite.runBatch({ root, kingdomIds: ids }, async (request) => {
      if (request.kingdomId === ids[0]) throw new Error('fake failure');
      writeJson(request.resultPath, completeResult(request.kingdomId));
    });
    expect(result.failed).toEqual([{ kingdomId: ids[0], error: 'fake failure' }]);
    expect(result.completed).toEqual([ids[1]]);
  });
});
