import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import rawSmoke from '../../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import crossKingdomGolden from '../fixtures/rust-strategy-search-balance/cross-kingdom-golden.json' with { type: 'json' };
import { buildRustBalanceAnalysis, stringifyRustBalanceAnalysis } from '../../src/sim/rustStrategySearchBalance';
import type { RustStrategySearchSourceProvenanceV1 } from '../../src/sim/rustStrategySearchBalance';
import { loadRustStrategySearchKingdomEvidence } from '../../src/sim/rustStrategySearchEvidence';
import { loadSourceProvenance, parseCli, renderRustBalanceReport } from '../../scripts/generate_rust_strategy_search_balance_report';
import { createEvidenceFixture } from '../fixtures/rust-strategy-search-balance/fixture';

const roots: string[] = [];
function temporary(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-rust-analysis-')); roots.push(root); return root; }
function repositoryTemporary(): string {
  fs.mkdirSync(path.join(process.cwd(), '.data'), { recursive: true });
  const root = fs.mkdtempSync(path.join(process.cwd(), '.data', 'rust-analysis-test-')); roots.push(root); return root;
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function provenance(ids: string[]): RustStrategySearchSourceProvenanceV1 {
  const commit = '1'.repeat(40), binary = '2'.repeat(64);
  return { schemaVersion: 1, protocol: 'rust-strategy-search-source-provenance-v1', kingdomIds: ids,
    scientificImplementationCommits: { goldfish: commit, matrix: commit, psro: commit },
    currentReleaseBinaries: { matrixSha256: binary, psroSha256: binary }, executions: ids.flatMap((_id, index) => index ? [] : [
      { ordinal: 1, stage: 'goldfish' as const, coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'goldfish.json', sha256: '3'.repeat(64) }, binarySha256UnavailableReason: 'Historical worker hash was not preserved.' },
      { ordinal: 2, stage: 'matrix' as const, coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'matrix.json', sha256: '4'.repeat(64) }, binarySha256: binary },
      { ordinal: 3, stage: 'psro' as const, coveredKingdomIds: ids, gitCommit: commit,
        report: { path: 'psro.json', sha256: '5'.repeat(64) }, binarySha256: binary }
    ]) };
}
function evidence(root: string, admissions: 0 | 1 = 0) {
  const fixture = createEvidenceFixture(root, admissions);
  return loadRustStrategySearchKingdomEvidence(fixture.paths, { binary: fixture.binary,
    runNativeCommand: fixture.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } });
}

describe('Rust strategy-search balance analysis', () => {
  it('uses the stored witness for support, effective size, classifications, and full ranges', () => {
    const held = evidence(temporary()), analysis = buildRustBalanceAnalysis([held], provenance([held.kingdomId]));
    const kingdom = analysis.kingdoms[0]!;
    expect(kingdom.equilibrium.selectedWitness.map((row) => row.weight)).toEqual([0.75, 0.25]);
    expect(kingdom.equilibrium).toMatchObject({ supportSize: 2, effectiveSize: 1.6, maximumAdvantage: 0 });
    expect(kingdom.strategies.map((row) => row.archetype)).toEqual(['Mage', 'Melee']);
    expect(kingdom.strategies.map((row) => row.feasibleWeightRange)).toEqual([
      { minimum: 0, maximum: 1 }, { minimum: 0, maximum: 1 }
    ]);
    expect(kingdom.archetypes.map((row) => ({ archetype: row.archetype, selected: row.selectedShare,
      minimum: row.minimumFeasibleShare, maximum: row.maximumFeasibleShare }))).toEqual([
      { archetype: 'Mage', selected: 0.75, minimum: 0, maximum: 1 },
      { archetype: 'Melee', selected: 0.25, minimum: 0, maximum: 1 }
    ]);
  });

  it('uses off-diagonal player-game denominators and keeps point byte 2 ambiguous', () => {
    const held = evidence(temporary()), kingdom = buildRustBalanceAnalysis([held], provenance([held.kingdomId])).kingdoms[0]!;
    expect(kingdom.strategies[0]!.playerGames).toBe(250);
    expect(kingdom.strategies[0]!.purchases.find((row) => row.cardId === 'cascade')).toEqual({
      cardId: 'cascade', copies: 100, copiesPerPlayerGame: 0.4
    });
    expect(kingdom.pairedScoreEvidence.byteCounts).toEqual([0, 0, 125, 0, 0]);
    expect(kingdom.pairedScoreEvidence.byteTwoShare).toBe(1);
    expect(kingdom.evidenceLimits.diagonalSelfPlay).toEqual({ available: false,
      matrixPayoff: 'fixed-50-percent', purchases: 'absent', familyDamage: 'absent' });
    expect(kingdom.evidenceLimits.pairedPointByteTwo.exactWinDrawLossAvailable).toBe(false);
  });

  it('equal-weights kingdoms instead of pooling their strategy counts', () => {
    const first = evidence(temporary(), 0), second = { ...evidence(temporary(), 1),
      kingdomId: 'balance-tuning-007', kingdomName: 'Balance Tuning 007' };
    const analysis = buildRustBalanceAnalysis([first, second], provenance([first.kingdomId, second.kingdomId]));
    expect(analysis.crossKingdom.supportSize.values).toEqual([
      { kingdomId: 'balance-tuning-005', value: 2 }, { kingdomId: 'balance-tuning-007', value: 3 }
    ]);
    expect(analysis.crossKingdom.supportSize.mean).toBe(2.5);
    const mage = analysis.crossKingdom.archetypes.find((row) => row.archetype === 'Mage')!;
    expect(mage.selectedShare).toBeCloseTo((0.75 + 0.2) / 2, 12);
    expect(analysis.crossKingdom.cards.find((row) => row.cardId === 'copper')).toMatchObject({
      offeredKingdomCount: 2, positiveUsageKingdomCount: 0, totalCopies: 0
    });
    expect(analysis.crossKingdom).toEqual(crossKingdomGolden);
  });

  it('produces deterministic versioned JSON and useful HTML with explicit limits', () => {
    const held = evidence(temporary()), analysis = buildRustBalanceAnalysis([held], provenance([held.kingdomId]));
    const json = stringifyRustBalanceAnalysis(analysis), html = renderRustBalanceReport(analysis);
    expect(json).toBe(stringifyRustBalanceAnalysis(analysis));
    expect(JSON.parse(json)).toEqual(analysis);
    expect(html).toContain('Archetype shares and full feasible ranges');
    expect(html).toContain('Card offering and acquisition usage');
    expect(html).toContain('Diagonal self-play telemetry is absent');
    expect(html).toContain('Exact W/D/L and first-player evidence are not available');
    expect(html).toContain('Outliers to inspect');
    expect(html).not.toMatch(/win rate|draw rate/iu);
    const embedded = html.match(/<script id="rust-balance-analysis" type="application\/json">([\s\S]+)<\/script>/u)?.[1];
    expect(JSON.parse(embedded!)).toEqual(analysis);
  });

  it('validates ordered execution provenance without inventing a historical Goldfish binary hash', () => {
    const root = repositoryTemporary(), binary = path.join(root, 'hexdeck-goldfish'); fs.writeFileSync(binary, 'release');
    const binaryHash = hash('release'), ids = (rawSmoke as { selectedKingdomIds: string[] }).selectedKingdomIds;
    const reports = ['goldfish', 'matrix', 'psro'].map((stage) => { const file = path.join(root, `${stage}.json`);
      fs.writeFileSync(file, JSON.stringify({ stage, kingdoms: ids }));
      return { file: path.relative(process.cwd(), file), sha256: hash(fs.readFileSync(file)) }; });
    const value = { schemaVersion: 1, protocol: 'rust-strategy-search-source-provenance-v1', kingdomIds: ids,
      scientificImplementationCommits: { goldfish: '1'.repeat(40), matrix: '2'.repeat(40), psro: '3'.repeat(40) },
      currentReleaseBinaries: { matrixSha256: binaryHash, psroSha256: binaryHash }, executions: [
        { ordinal: 1, stage: 'goldfish', coveredKingdomIds: ids.slice(0, 10), gitCommit: '4'.repeat(40),
          report: { path: reports[0]!.file, sha256: reports[0]!.sha256 }, binarySha256UnavailableReason: 'Modal worker hash was not preserved.' },
        { ordinal: 2, stage: 'goldfish', coveredKingdomIds: ids.slice(10), deploymentDigest: '5'.repeat(64),
          report: { path: reports[0]!.file, sha256: reports[0]!.sha256 }, binarySha256UnavailableReason: 'Modal worker hash was not preserved.' },
        { ordinal: 3, stage: 'matrix', coveredKingdomIds: ids, gitCommit: '2'.repeat(40),
          report: { path: reports[1]!.file, sha256: reports[1]!.sha256 }, binarySha256: binaryHash },
        { ordinal: 4, stage: 'psro', coveredKingdomIds: ids, sourceDigest: '6'.repeat(64),
          report: { path: reports[2]!.file, sha256: reports[2]!.sha256 }, binarySha256: binaryHash }
      ] };
    const file = path.join(root, 'source-provenance-v1.json'); fs.writeFileSync(file, JSON.stringify(value));
    const parsed = loadSourceProvenance(file, binary, root);
    expect(parsed.executions[0]!.binarySha256UnavailableReason).toContain('not preserved');
    expect(parsed.verifierBinarySha256).toBe(binaryHash);
    value.executions[2]!.binarySha256 = '7'.repeat(64); fs.writeFileSync(file, JSON.stringify(value));
    expect(() => loadSourceProvenance(file, binary, root)).toThrow(/matrix execution binary hash/u);
  });

  it('pins exact default output paths', () => {
    expect(parseCli([])).toEqual({ root: '.data/strategy-search-30', binary: 'rust/target/release/hexdeck-goldfish',
      provenance: '.data/strategy-search-30/source-provenance-v1.json',
      json: '.data/strategy-search-30/rust-balance-analysis-v1.json',
      html: '.html/strategy-search-30-rust-balance-v1.html' });
  });
});
