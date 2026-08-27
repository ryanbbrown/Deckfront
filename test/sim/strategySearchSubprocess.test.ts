import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyAggregate } from '../../src/sim/pairing';
import { matrixProtocol } from '../../src/sim/payoffMatrix';
import { candidateIndexAt, createOrderedCandidateSpace,
  orderedGoldfishCardIds } from '../../src/sim/orderedGoldfishBenchmark';
import { canonicalStrategy } from '../../src/sim/strategy';
import { createParallelPsroCheckpoint, startParallelPsro } from '../../src/sim/strategySearchParallelPsro';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import { createStrategySearchMatrixManifest } from '../../src/sim/strategySearchMatrix';
import { createRawPsroScoreChunk, createThresholdRacingProtocol } from '../../src/sim/thresholdRacingPsro';

const kingdomId = 'balance-tuning-005', evidenceId = 'a'.repeat(64);
const entries = ['goldfish', 'matrix-manifest', 'matrix', 'psro', 'validator',
  'psro-score-receipt-validator'] as const;
const execute = (entry: typeof entries[number], args: string[]) => spawnSync(process.execPath,
  ['--import', 'tsx', 'scripts/strategy_search_subprocess.ts', '--entry', entry,
    '--kingdom', kingdomId, '--', ...args], { encoding: 'utf8', timeout: 10_000 });

describe('deployment-only strategy-search subprocess bootstrap', () => {
  it('starts Goldfish normally with an authoritative balance kingdom', () => {
    const result = execute('goldfish', ['readiness', '--evidence-id', evidenceId, '--kingdom', kingdomId]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ready: true, kingdomId, candidateCount: 12_972_960 });
  });

  it('starts Matrix-manifest normally after wrapper registration', () => {
    const result = execute('matrix-manifest', ['--evidence-id', evidenceId, '--kingdom', kingdomId,
      '--reservoir', '/missing/reservoir.hgf', '--reservoir-sha256', 'b'.repeat(64),
      '--seed-namespace', 'fixture', '--out', '/missing/manifest.json']);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('ENOENT');
    expect(result.stderr).not.toContain('Unknown kingdom');
  });

  it('starts Matrix normally through manifest validation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-matrix-wrapper-'));
    try {
      strategySearchKingdom(kingdomId);
      const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
      const manifest = createStrategySearchMatrixManifest({ source: { kingdomId, evidenceId,
        reservoirIdentityHash: 'b'.repeat(64), reservoirContentHash: 'c'.repeat(64),
        matrixSeedNamespace: 'fixture' }, strategies: Array.from({ length: 50 }, (_unused, index) =>
        space.candidateAt(candidateIndexAt(index, space.candidateCount))) });
      const file = path.join(root, 'manifest.json'); fs.writeFileSync(file, JSON.stringify(manifest));
      const result = execute('matrix', ['--manifest', file, '--out', path.join(root, 'out'),
        '--control', path.join(root, 'control'), '--workers', '1', '--jobs-per-batch', '1',
        '--runtime-chunk-size', '125', '--shutdown-at-ms', '1']);
      expect(result.status).not.toBe(0); expect(result.stderr).toContain('Matrix execution input is invalid.');
      expect(result.stderr).not.toContain('Unknown kingdom');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('starts PSRO normally through config validation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-wrapper-'));
    try {
      const config = { evidenceId, kingdomId, runId: 'fixture', reservoirPath: path.join(root, 'missing.hgf'),
        reservoirSha256: 'b'.repeat(64), matrixEvidencePath: path.join(root, 'missing.json'),
        matrixSha256: 'c'.repeat(64), outputRoot: path.join(root, 'out'), controlRoot: path.join(root, 'control'),
        workers: 1, protocolInput: {} };
      const file = path.join(root, 'config.json'); fs.writeFileSync(file, JSON.stringify(config));
      const result = execute('psro', ['--config', file, '--shutdown-at-ms', String(Date.now() + 10_000)]);
      expect(result.status).not.toBe(0); expect(result.stderr).toContain('ENOENT');
      expect(result.stderr).not.toContain('Unknown kingdom');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('starts artifact validation normally after wrapper registration', () => {
    const result = execute('validator', ['--stage', 'fixture', '--file', '/not-used',
      '--evidence-id', evidenceId, '--kingdom', kingdomId, '--evidence-root', '/not-used']);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('does not use validation');
    expect(result.stderr).not.toContain('Unknown kingdom');
  });

  it('validates a PSRO receipt against the current sealed look through the deployment wrapper', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-receipt-'));
    try {
      strategySearchKingdom(kingdomId);
      const space = createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId));
      const candidates = Array.from({ length: 52 }, (_unused, index) => {
        const strategy = space.candidateAt(candidateIndexAt(index, space.candidateCount));
        return { goldfishRank: index + 1, strategyId: strategy.id,
          canonicalStrategy: canonicalStrategy(strategy), strategy };
      });
      const strategies = candidates.slice(0, 50).map((candidate) => candidate.strategy);
      const matrix = { protocol: matrixProtocol(kingdomId,
        Array.from({ length: 75 }, (_unused, index) => index + 1), 30, 200, false),
        strategies, cells: [], complete: true,
        centeredPayoffs: strategies.map(() => strategies.map(() => 0)) };
      const protocol = createThresholdRacingProtocol({ experimentName: 'receipt-fixture', runId: 'main', kingdomId,
        reservoirCount: candidates.length, sourceIdentityHash: 'b'.repeat(64), checkpointNamespace: evidenceId,
        matrixSeedNamespace: 'matrix-fixture', screenSeedNamespace: 'screen-fixture',
        confirmationSeedNamespace: 'confirmation-fixture', queueRetestSeedNamespace: 'retest-fixture' });
      const transition = startParallelPsro(createParallelPsroCheckpoint({ protocol, matrix, candidates }));
      expect(transition.kind).toBe('score');
      if (transition.kind !== 'score') throw new Error('Fixture transition is not a score look.');
      const task = transition.tasks[0]!, byId = new Map(candidates.map((candidate) => [candidate.strategyId, candidate]));
      const field = transition.look.candidateIds.slice(task.candidateStart, task.candidateEnd)
        .map((id) => byId.get(id)!);
      const chunk = createRawPsroScoreChunk({ protocol, raceKind: transition.look.raceKind,
        lookId: transition.look.lookId, lookDepth: transition.look.lookDepth, familySize: transition.look.familySize,
        alpha: transition.look.alpha, candidates: field.map((candidate) => ({ identity: candidate,
          strategy: candidate.strategy })), candidateStart: task.candidateStart,
        fullSchedule: transition.look.fullSchedule, suffixSchedule: transition.look.suffixSchedule,
        scheduleStart: transition.look.scheduleStart, rows: field.map((candidate) => ({ strategy: candidate.strategy,
          mean: 0.5, blockScores: transition.look.suffixSchedule.blocks.map(() => 0.5), interval: null,
          matches: transition.look.suffixSchedule.blocks.length * 2, telemetry: emptyAggregate() })) });
      const transitionFile = path.join(root, 'transition.json'), taskFile = path.join(root, 'task.json'),
        chunkFile = path.join(root, 'chunk.json'), output = path.join(root, 'validation.json');
      fs.writeFileSync(transitionFile, JSON.stringify(transition));
      fs.writeFileSync(taskFile, JSON.stringify({ candidateEnd: task.candidateEnd,
        candidateStart: task.candidateStart, expectedTaskMs: task.expectedTaskMs, taskIndex: task.taskIndex }));
      fs.writeFileSync(chunkFile, JSON.stringify(chunk));
      const args = ['--out', output, '--transition', transitionFile, '--task', taskFile, '--chunk', chunkFile];
      const valid = execute('psro-score-receipt-validator', args);
      expect(valid.status, valid.stderr).toBe(0);
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({ valid: true });
      fs.writeFileSync(transitionFile, JSON.stringify({ ...transition,
        look: { ...transition.look, lookId: `${transition.look.lookId}.stale` } }));
      const stale = execute('psro-score-receipt-validator', args);
      expect(stale.status, stale.stderr).toBe(0);
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({ valid: false });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps every detached Modal command behind the wrapper', () => {
    const source = fs.readFileSync('modal/native_strategy_search.py', 'utf8');
    const wrapper = fs.readFileSync('scripts/strategy_search_subprocess.ts', 'utf8');
    expect(source).toContain('scripts/strategy_search_subprocess.ts');
    expect(source).toContain('_strategy_search_subprocess_command(entry');
    for (const entry of [...entries, 'matrix-score', 'matrix-reduce', 'parallel-psro']) {
      expect(wrapper).toMatch(new RegExp(`(?:^|\\s)(?:'${entry}'|${entry}):`, 'm'));
    }
    for (const direct of ['scripts/strategy_search_goldfish.ts', 'scripts/strategy_search_campaign_matrix_manifest.ts',
      'scripts/strategy_search_campaign_matrix.ts', 'scripts/strategy_search_campaign_psro.ts',
      'scripts/strategy_search_validate_artifact.ts']) expect(source).not.toContain(`"${direct}"`);
  });
});
