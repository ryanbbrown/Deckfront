import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import rawSmoke from '../../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import { buildRustBalanceAnalysis, stringifyRustBalanceAnalysis } from '../../src/sim/rustStrategySearchBalance';
import type { RustStrategySearchSourceProvenanceV2 } from '../../src/sim/rustStrategySearchBalance';
import { loadRustStrategySearchKingdomEvidence } from '../../src/sim/rustStrategySearchEvidence';
import { loadSourceProvenance, parseCli, renderRustBalanceReport } from '../../scripts/generate_rust_strategy_search_balance_report';
import { parseSelfPlayBackfillCli } from '../../scripts/backfill_rust_strategy_search_self_play';
import { createEvidenceFixture } from '../fixtures/rust-strategy-search-balance/fixture';

const roots: string[] = [];
function temporary(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-rust-analysis-')); roots.push(root); return root; }
function repositoryTemporary(): string {
  fs.mkdirSync(path.join(process.cwd(), '.data'), { recursive: true });
  const root = fs.mkdtempSync(path.join(process.cwd(), '.data', 'rust-analysis-test-')); roots.push(root); return root;
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function provenance(ids: string[]): RustStrategySearchSourceProvenanceV2 {
  const commit = '1'.repeat(40), binary = '2'.repeat(64);
  return { schemaVersion: 2, protocol: 'rust-strategy-search-source-provenance-v2', kingdomIds: ids,
    scientificImplementationCommits: { goldfish: commit, matrix: commit, psro: commit, selfPlayTelemetry: commit },
    currentVerifierAndBackfillBinarySha256: binary, executions: [
      { ordinal: 1, stage: 'goldfish', coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'goldfish.json', sha256: '3'.repeat(64) }, binarySha256UnavailableReason: 'Historical worker hash was not preserved.' },
      { ordinal: 2, stage: 'matrix', coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'matrix.json', sha256: '4'.repeat(64) }, binarySha256: '6'.repeat(64) },
      { ordinal: 3, stage: 'psro', coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'psro.json', sha256: '5'.repeat(64) }, binarySha256: '6'.repeat(64) },
      { ordinal: 4, stage: 'self-play-telemetry', coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'self-play.json', sha256: '7'.repeat(64) }, binarySha256: binary }
    ] };
}
function evidence(root: string, admissions: 0 | 1 = 0) {
  const fixture = createEvidenceFixture(root, admissions);
  return loadRustStrategySearchKingdomEvidence(fixture.paths, { binary: fixture.binary,
    goldfishReadOptions: { keep: 4, topKeep: 4 } });
}

describe('Rust strategy-search balance analysis', () => {
  it('uses equilibrium opponents for classification and keeps full equilibrium ranges', () => {
    const held = evidence(temporary()), analysis = buildRustBalanceAnalysis([held], provenance([held.kingdomId]));
    const kingdom = analysis.kingdoms[0]!;
    expect(kingdom.equilibrium.selectedWitness.map((row) => row.weight)).toEqual([0.75, 0.25]);
    expect(kingdom.equilibrium).toMatchObject({ supportSize: 2, effectiveSize: 1.6, maximumAdvantage: 0 });
    expect(kingdom.strategies.map((row) => row.archetype)).toEqual(['Mage', 'Melee']);
    expect(kingdom.strategies[0]!.equilibriumOpponentAcquisitions.find((row) => row.cardId === 'cascade')
      ?.copiesPerPlayerSide).toBeCloseTo(0.265, 12);
    expect(kingdom.strategies[1]!.equilibriumOpponentAcquisitions.find((row) => row.cardId === 'flurry')
      ?.copiesPerPlayerSide).toBeCloseTo(0.359, 12);
    expect(kingdom.strategies.map((row) => row.feasibleWeightRange)).toEqual([
      { minimum: 0, maximum: 1 }, { minimum: 0, maximum: 1 }
    ]);
  });

  it('normalizes both diagonal positions by 500 and applies both equilibrium weights', () => {
    const held = evidence(temporary()), kingdom = buildRustBalanceAnalysis([held], provenance([held.kingdomId])).kingdoms[0]!;
    const cascade = kingdom.cards.find((row) => row.cardId === 'cascade')!;
    const flurry = kingdom.cards.find((row) => row.cardId === 'flurry')!;
    expect(cascade.expectedAcquiredCopiesPerPlayerSide).toBeCloseTo(0.75 * (0.75 * 110 / 500 + 0.25 * 100 / 250), 12);
    expect(flurry.expectedAcquiredCopiesPerPlayerSide).toBeCloseTo(0.25 * (0.75 * 101 / 250 + 0.25 * 112 / 500), 12);
    expect(cascade).toMatchObject({ equilibriumAcquisitionRate: 0.75, equilibriumSelectionRate: 0.75 });
    expect(cascade.equilibriumMeanOwnedCopies).toBeCloseTo(cascade.expectedAcquiredCopiesPerPlayerSide, 12);
    expect(kingdom.auditTelemetry).toMatchObject({ basis: 'unweighted full-Matrix observed counts' });
    expect(kingdom.auditTelemetry.strategies[0]!.diagonal).toMatchObject({ playerSides: 500,
      firstPlayerSides: 250, secondPlayerSides: 250 });
    expect(kingdom.evidenceLimits.matrixDiagonal).toEqual({ payoff: 'fixed-50-percent',
      sameStrategyTelemetry: 'available-separate-from-payoff', playerSidesPerStrategy: 500 });
    expect(kingdom.pairedScoreEvidence.byteTwoShare).toBe(1);
  });

  it('uses only diagonal telemetry for a singleton equilibrium', () => {
    const held = evidence(temporary()); held.matrix.weights = [1, 0]; held.completion.finalWeights = [1, 0];
    const kingdom = buildRustBalanceAnalysis([held], provenance([held.kingdomId])).kingdoms[0]!;
    expect(kingdom.equilibrium.supportSize).toBe(1);
    expect(kingdom.cards.find((row) => row.cardId === 'cascade')?.expectedAcquiredCopiesPerPlayerSide).toBeCloseTo(110 / 500, 12);
    expect(kingdom.cards.find((row) => row.cardId === 'flurry')?.expectedAcquiredCopiesPerPlayerSide).toBe(0);
    expect(kingdom.familyDamage.every((row) => Number.isFinite(row.expectedDamagePerPlayerSide))).toBe(true);
  });

  it('equal-weights kingdoms instead of pooling their strategy counts', () => {
    const first = evidence(temporary(), 0), second = { ...evidence(temporary(), 1),
      kingdomId: 'balance-tuning-007', kingdomName: 'Balance Tuning 007' };
    const analysis = buildRustBalanceAnalysis([first, second], provenance([first.kingdomId, second.kingdomId]));
    expect(analysis.crossKingdom.supportSize.values).toEqual([
      { kingdomId: 'balance-tuning-005', value: 2 }, { kingdomId: 'balance-tuning-007', value: 3 }
    ]);
    expect(analysis.crossKingdom.supportSize.mean).toBe(2.5);
    expect(analysis.crossKingdom.cards.find((row) => row.cardId === 'copper')).toMatchObject({
      offeredKingdomCount: 2, positiveUsageKingdomCount: 0,
      meanExpectedAcquiredCopiesPerPlayerSide: 0
    });
  });

  it('produces deterministic v2 JSON and useful HTML with audit-only raw telemetry', () => {
    const held = evidence(temporary()), analysis = buildRustBalanceAnalysis([held], provenance([held.kingdomId]));
    const json = stringifyRustBalanceAnalysis(analysis), html = renderRustBalanceReport(analysis);
    expect(json).toBe(stringifyRustBalanceAnalysis(analysis));
    expect(JSON.parse(json)).toEqual(analysis);
    expect(analysis).toMatchObject({ schemaVersion: 2, protocol: 'rust-strategy-search-balance-v2' });
    expect(html).toContain('both the acting strategy and opponent use the stored equilibrium weights');
    expect(html).toContain('Same-strategy purchases and family damage are available');
    expect(html).toContain('Unweighted full-Matrix observed counts (audit only)');
    expect(html).not.toMatch(/uniform off-diagonal|Diagonal self-play telemetry is absent|win rate|draw rate/iu);
    const embedded = html.match(/<script id="rust-balance-analysis" type="application\/json">([\s\S]+)<\/script>/u)?.[1];
    expect(JSON.parse(embedded!)).toEqual(analysis);
  });

  it('preserves historical execution hashes and binds the local telemetry execution to the current binary', () => {
    const root = repositoryTemporary(), binary = path.join(root, 'hexdeck-goldfish'); fs.writeFileSync(binary, 'release');
    const binaryHash = hash('release'), oldBinary = '8'.repeat(64);
    const ids = (rawSmoke as { selectedKingdomIds: string[] }).selectedKingdomIds;
    const stages = ['goldfish', 'matrix', 'psro', 'self-play'] as const;
    const reports = stages.map((stage) => { const file = path.join(root, `${stage}.json`);
      fs.writeFileSync(file, JSON.stringify({ stage, kingdoms: ids }));
      return { file: path.relative(process.cwd(), file), sha256: hash(fs.readFileSync(file)) }; });
    const value = { schemaVersion: 2, protocol: 'rust-strategy-search-source-provenance-v2', kingdomIds: ids,
      scientificImplementationCommits: { goldfish: '1'.repeat(40), matrix: '2'.repeat(40), psro: '3'.repeat(40),
        selfPlayTelemetry: '4'.repeat(40) }, currentVerifierAndBackfillBinarySha256: binaryHash, executions: [
        { ordinal: 1, stage: 'goldfish', coveredKingdomIds: ids, gitCommit: '1'.repeat(40),
          report: { path: reports[0]!.file, sha256: reports[0]!.sha256 }, binarySha256UnavailableReason: 'Historical worker hash was not preserved.' },
        { ordinal: 2, stage: 'matrix', coveredKingdomIds: ids, gitCommit: '2'.repeat(40),
          report: { path: reports[1]!.file, sha256: reports[1]!.sha256 }, binarySha256: oldBinary },
        { ordinal: 3, stage: 'psro', coveredKingdomIds: ids, sourceDigest: '6'.repeat(64),
          report: { path: reports[2]!.file, sha256: reports[2]!.sha256 }, binarySha256: oldBinary },
        { ordinal: 4, stage: 'self-play-telemetry', coveredKingdomIds: ids, gitCommit: '4'.repeat(40),
          report: { path: reports[3]!.file, sha256: reports[3]!.sha256 }, binarySha256: binaryHash }
      ] };
    const file = path.join(root, 'source-provenance-v2.json'); fs.writeFileSync(file, JSON.stringify(value));
    const parsed = loadSourceProvenance(file, binary, root);
    expect(parsed.executions[1]!.binarySha256).toBe(oldBinary);
    expect(parsed.currentVerifierAndBackfillBinarySha256).toBe(binaryHash);
    value.executions[3]!.binarySha256 = '7'.repeat(64); fs.writeFileSync(file, JSON.stringify(value));
    expect(() => loadSourceProvenance(file, binary, root)).toThrow(/telemetry execution binary hash/u);
  });

  it('pins exact v2 default output paths', () => {
    expect(parseSelfPlayBackfillCli([])).toEqual({ root: '.data/strategy-search-30',
      binary: 'rust/target/release/hexdeck-goldfish', threads: 10,
      report: '.data/strategy-search-30/self-play-backfill-v1.json' });
    expect(parseCli([])).toEqual({ root: '.data/strategy-search-30', binary: 'rust/target/release/hexdeck-goldfish',
      provenance: '.data/strategy-search-30/source-provenance-v2.json',
      json: '.data/strategy-search-30/rust-balance-analysis-v2.json',
      html: '.html/strategy-search-30-rust-balance-v2.html' });
  });
});
