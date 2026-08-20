import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { challengerAudit } from '../../scripts/challenger_audit';
import type { ArtifactSet } from '../../scripts/generate_balance_report';
import { balanceSuite } from '../../src/sim/balanceSuite';
import { emptyAggregate } from '../../src/sim/pairing';
import type { PairingOutcome } from '../../src/sim/pairing';
import type { PairingJob, PairingRunner } from '../../src/sim/pairingRunner';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { rulesFingerprint } from '../../src/sim/rulesFingerprint';
import { canonicalStrategy, identify } from '../../src/sim/strategy';

const SAMPLE = [
  'balance-tuning-005', 'balance-tuning-007', 'balance-tuning-015', 'balance-tuning-016',
  'balance-tuning-037', 'balance-tuning-044', 'balance-tuning-047', 'balance-tuning-058',
  'balance-tuning-067', 'balance-tuning-069'
];

function sourceArtifact(kingdomId = 'balance-tuning-005'): ArtifactSet {
  balanceSuite.register();
  const repeatPurchase = balanceSuite.findKingdom(kingdomId)!.actionPiles[0]!.cardId;
  const only = identify({ id: '', startingBuild: [], buyAgenda: [], repeatPurchase });
  const protocol = matrixProtocol(kingdomId, [101], 30, 200);
  return {
    run: {
      schemaVersion: 4, rulesFingerprint: rulesFingerprint(kingdomId), valid: true, kingdomId,
      kingdomName: kingdomId, mode: 'full', seed: 77,
      limits: { restarts: 1, iterations: 1, unionIterations: 1, seeds: 1,
        turnLimitPerPlayer: 30, actionCapPerTurn: 200 },
      finishedAt: '2026-08-20T12:00:00.000Z', elapsedMs: 1, stopReason: 'response-exhausted',
      matches: 0, aborted: 0
    },
    matrix: {
      protocol, strategies: [only], cells: [], complete: true, centeredPayoffs: [[0]],
      equilibrium: { strategyIds: [only.id], weights: { [only.id]: 1 } }
    },
    strategies: [only]
  };
}

function outcome(job: PairingJob, score: number): PairingOutcome {
  const telemetry = emptyAggregate();
  telemetry.byOrientation.firstOchre.normal.played = 4;
  return {
    record: { played: 4, wins: 2, draws: 0, losses: 2, aborted: 0 },
    candidateScore: score * 4, opponentScore: (1 - score) * 4, telemetry, matches: 4,
    seedBlocks: 1, stopReason: 'maximum', candidateMean: score, opponentMean: 1 - score,
    blocks: [{ seed: job.options.seeds[0]!, score, played: 4, aborted: 0 }], aborts: []
  };
}

class RecordingRunner implements PairingRunner {
  readonly batches: PairingJob[][] = [];
  async run(jobs: readonly PairingJob[]) {
    this.batches.push([...jobs]);
    const scheduleSize = this.batches.length === 1 ? challengerAudit.config.screenBlocks
      : challengerAudit.config.confirmationBlocks;
    return { submitted: jobs.length, outcomes: jobs.map((job, index) => {
      const candidateIndex = Math.floor(index / scheduleSize);
      const score = this.batches.length === 1 ? 0.45 + (candidateIndex % 100) / 1_000 : 0.51;
      return outcome(job, score);
    }) };
  }
  async close(): Promise<void> {}
}

function challenger(id: string, screeningMean: number, confirmedMean: number,
  lower: number, upper: number) {
  const strategy = identify({ id: '', startingBuild: [], buyAgenda: [], repeatPurchase: id });
  return { strategy, screeningMean, confirmedMean, interval: { lower, upper }, drawRate: 0,
    matches: 100, admitted: confirmedMean >= 0.52 && lower > 0.5 };
}

describe('final-lottery challenger audit', () => {
  it('selects the fixed ten existing tuning kingdoms in a fresh process', () => {
    const selected = challengerAudit.selectSample();
    expect(selected).toEqual(SAMPLE);
    expect(new Set(selected).size).toBe(10);
    expect(selected.every((id) => balanceSuite.manifest.kingdoms.some((entry) =>
      entry.id === id && entry.split === 'tuning'))).toBe(true);
    const script = "import {challengerAudit} from './scripts/challenger_audit.ts';process.stdout.write(JSON.stringify(challengerAudit.selectSample()))";
    const fresh = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
    expect(JSON.parse(fresh)).toEqual(SAMPLE);
  });

  it('rejects overlap with an original seed namespace', () => {
    expect(() => challengerAudit.assertSafeSeeds({ matrix: [41] }, {
      candidate: [1], screen: [2, 41], screenSampling: [3], confirmation: [4],
      confirmationSampling: [5], bootstrap: [6]
    })).toThrow('41');
  });

  it('uses confirmed evidence for admission and records the strongest challenger', () => {
    const falseScreenLeader = challenger('gold', 0.99, 0.51, 0.505, 0.52);
    const admitted = challenger('silver', 0.40, 0.53, 0.51, 0.55);
    expect(challengerAudit.assess([falseScreenLeader, admitted])).toMatchObject({
      lotteryPassed: false, bestChallenger: admitted, admittedChallenger: admitted
    });
    expect(challengerAudit.assess([falseScreenLeader])).toMatchObject({
      lotteryPassed: true, bestChallenger: falseScreenLeader, admittedChallenger: null
    });
  });

  it('screens 3,000 unique candidates on shared blocks and confirms 20 on independent blocks', async () => {
    const artifact = sourceArtifact();
    const runner = new RecordingRunner();
    const audited = await challengerAudit.evaluateLottery(artifact, runner, () => 1_800_000_000_000);
    expect(audited.generation).toMatchObject({ requested: 3_000, actual: 3_000, shortfall: 0 });
    expect(audited.screening).toMatchObject({ candidates: 3_000, matches: 60_000 });
    expect(audited.confirmation).toMatchObject({ candidates: 20, matches: 2_000 });
    expect(runner.batches.map((batch) => batch.length)).toEqual([15_000, 500]);
    const screen = runner.batches[0]!;
    const screenIds = Array.from({ length: 3_000 }, (_entry, index) => screen[index * 5]!.candidate);
    expect(new Set(screenIds.map(canonicalStrategy)).size).toBe(3_000);
    const sharedScreenSeeds = screen.slice(0, 5).map((job) => job.options.seeds[0]);
    expect(screen.slice(5, 10).map((job) => job.options.seeds[0])).toEqual(sharedScreenSeeds);
    const confirmation = runner.batches[1]!;
    const sharedConfirmationSeeds = confirmation.slice(0, 25).map((job) => job.options.seeds[0]);
    expect(confirmation.slice(25, 50).map((job) => job.options.seeds[0])).toEqual(sharedConfirmationSeeds);
    expect(sharedConfirmationSeeds.some((seed) => sharedScreenSeeds.includes(seed))).toBe(false);
    expect(confirmation.every((job) => screenIds.some((candidate) => candidate.id === job.candidate.id))).toBe(true);

    const json = challengerAudit.serialize(audited);
    const markdown = challengerAudit.renderResult(audited);
    expect(challengerAudit.serialize(audited)).toBe(json);
    expect(challengerAudit.renderResult(JSON.parse(json))).toBe(markdown);
    expect(markdown).toContain('Lottery result:');
  }, 30_000);

  it('resumes only a complete result with the current source and protocol', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-audit-resume-'));
    const artifact = sourceArtifact();
    const audited = await challengerAudit.evaluateLottery(artifact, new RecordingRunner(), () => 1_800_000_000_000);
    let evaluations = 0;
    const adapters = {
      loadSource: () => artifact,
      createRunner: () => new RecordingRunner(),
      evaluateLottery: async () => { evaluations += 1; return audited; }
    };
    expect((await challengerAudit.run({ root, kingdomId: artifact.run.kingdomId }, adapters)).completed)
      .toEqual([artifact.run.kingdomId]);
    expect((await challengerAudit.run({ root, kingdomId: artifact.run.kingdomId }, adapters)).skipped)
      .toEqual([artifact.run.kingdomId]);
    expect(evaluations).toBe(1);
    const file = path.join(challengerAudit.resultDirectory(root, artifact.run.kingdomId), 'result.json');
    const stale = JSON.parse(fs.readFileSync(file, 'utf8'));
    stale.protocol.protocolHash = 'stale';
    fs.writeFileSync(file, JSON.stringify(stale));
    expect((await challengerAudit.run({ root, kingdomId: artifact.run.kingdomId }, adapters)).completed)
      .toEqual([artifact.run.kingdomId]);
    expect(evaluations).toBe(2);
  }, 30_000);

  it('fails an unsupported source schema and does not report a lottery pass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-audit-schema-'));
    const kingdomId = 'balance-tuning-005';
    const directory = balanceSuite.runDirectory(root, kingdomId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ schemaVersion: 3 }));
    const batch = await challengerAudit.run({ root, kingdomId });
    expect(batch.failed).toHaveLength(1);
    expect(batch.passed).toEqual([]);
    const result = JSON.parse(fs.readFileSync(path.join(challengerAudit.resultDirectory(root, kingdomId),
      'result.json'), 'utf8'));
    expect(result).toMatchObject({ complete: false, lotteryPassed: false });
    expect(result.error).toContain('schemaVersion');
  });
});
