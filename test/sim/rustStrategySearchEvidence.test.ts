import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRustStrategySearchKingdomEvidence } from '../../src/sim/rustStrategySearchEvidence';
import { createEvidenceFixture } from '../fixtures/rust-strategy-search-balance/fixture';

const roots: string[] = [];
function temporary(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-rust-balance-')); roots.push(root); return root; }
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const options = (fixture: ReturnType<typeof createEvidenceFixture>) => ({ binary: fixture.binary,
  goldfishReadOptions: { keep: 4, topKeep: 4 } });

describe('Rust strategy-search evidence adapter', () => {
  it('uses structural checks only and selects initial HGM after no admissions', () => {
    const fixture = createEvidenceFixture(temporary(), 0);
    const evidence = loadRustStrategySearchKingdomEvidence(fixture.paths, options(fixture));
    expect(evidence.adapterVerification.mode).toBe('structural-crc-source-links');
    expect(evidence.finalMatrixSource).toBe('initial-matrix');
    expect(evidence.completion).toMatchObject({ admissionCount: 0, matrixGeneration: 0, cleanSearchCount: 2,
      finalStrategyNumbers: [0, 1], finalWeights: [0.75, 0.25] });
    expect(evidence.matrix.weights).toEqual([0.75, 0.25]);
    expect(evidence.sourceFiles.map((file) => file.path)).toContain('matrix/matrix.hgm');
    expect(evidence.sourceFiles.map((file) => file.path)).toContain('matrix/self-play-v1.hst');
    expect(evidence.selfPlay.map((row) => ({ number: row.strategyNumber, sides: row.totalPlayerSides })))
      .toEqual([{ number: 0, sides: 500 }, { number: 1, sides: 500 }]);
  });

  it('selects expanded HGM after admission and preserves stored witness bits', () => {
    const fixture = createEvidenceFixture(temporary(), 1);
    const evidence = loadRustStrategySearchKingdomEvidence(fixture.paths, options(fixture));
    expect(evidence.finalMatrixSource).toBe('psro-expanded-matrix');
    expect(evidence.completion.finalStrategyNumbers).toEqual([0, 1, 2]);
    expect(evidence.matrix.weights).toEqual([0.2, 0.3, 0.5]);
    expect(evidence.sourceFiles.map((file) => file.path)).toContain('psro/matrix.hgm');
    expect(evidence.sourceFiles.map((file) => file.path)).toContain('psro/self-play-v1.hst');
  });

  it('stops on structural Goldfish failure before it reads missing HST evidence', () => {
    const fixture = createEvidenceFixture(temporary(), 0);
    fs.rmSync(path.join(fixture.paths.initialMatrixDir, 'self-play-v1.hst'));
    const top = fs.readFileSync(fixture.paths.topFile); top[64] = top[64]! ^ 1; fs.writeFileSync(fixture.paths.topFile, top);
    expect(() => loadRustStrategySearchKingdomEvidence(fixture.paths, options(fixture)))
      .toThrow(/row CRC-32 differs/u);
  });

  it('rejects a partial final matrix set', () => {
    const partial = createEvidenceFixture(temporary(), 0);
    fs.copyFileSync(path.join(partial.paths.initialMatrixDir, 'pairs.hgm'), path.join(partial.paths.psroDir, 'pairs.hgm'));
    expect(() => loadRustStrategySearchKingdomEvidence(partial.paths, options(partial)))
      .toThrow(/HGM presence differs/u);
  });

  it('rejects corrupt CRC data and semantic corruption with a recomputed CRC', () => {
    const corruptCrc = createEvidenceFixture(temporary(), 0), purchaseFile = path.join(corruptCrc.paths.initialMatrixDir, 'purchases.hgm');
    const purchaseBytes = fs.readFileSync(purchaseFile); purchaseBytes[64 + 8] = purchaseBytes[64 + 8]! ^ 1;
    fs.writeFileSync(purchaseFile, purchaseBytes);
    expect(() => loadRustStrategySearchKingdomEvidence(corruptCrc.paths, options(corruptCrc)))
      .toThrow(/HGM header, length, source, or CRC differs/u);

    const semantic = createEvidenceFixture(temporary(), 0), pairFile = path.join(semantic.paths.initialMatrixDir, 'pairs.hgm');
    const pairBytes = fs.readFileSync(pairFile); pairBytes[64 + 8] = 5;
    pairBytes.writeUInt32LE(crc32(pairBytes.subarray(64)) >>> 0, 24); fs.writeFileSync(pairFile, pairBytes);
    expect(() => loadRustStrategySearchKingdomEvidence(semantic.paths, options(semantic)))
      .toThrow(/pair order or point byte differs/u);
  });

  it('rejects corrupt or wrong-source same-strategy telemetry', () => {
    const corrupt = createEvidenceFixture(temporary(), 0), file = path.join(corrupt.paths.initialMatrixDir, 'self-play-v1.hst');
    const bytes = fs.readFileSync(file); bytes[128 + 8] = bytes[128 + 8]! ^ 1; fs.writeFileSync(file, bytes);
    expect(() => loadRustStrategySearchKingdomEvidence(corrupt.paths, options(corrupt)))
      .toThrow(/HST length or CRC differs/u);

    const wrongSource = createEvidenceFixture(temporary(), 1), expanded = path.join(wrongSource.paths.psroDir, 'self-play-v1.hst');
    const sourceBytes = fs.readFileSync(expanded); sourceBytes.writeUInt32LE(sourceBytes.readUInt32LE(44) + 1, 44);
    fs.writeFileSync(expanded, sourceBytes);
    expect(() => loadRustStrategySearchKingdomEvidence(wrongSource.paths, options(wrongSource)))
      .toThrow(/HST header or source differs/u);
  });

  it('rejects a final matrix weight that differs from the checkpoint', () => {
    const fixture = createEvidenceFixture(temporary(), 1), file = path.join(fixture.paths.psroDir, 'matrix.hgm');
    const bytes = fs.readFileSync(file), rowBytes = bytes.readUInt32LE(8); bytes.writeDoubleLE(0.4, 64 + 4 + 3 * 8);
    bytes.writeDoubleLE(0.1, 64 + rowBytes + 4 + 3 * 8); bytes.writeUInt32LE(crc32(bytes.subarray(64)) >>> 0, 24); fs.writeFileSync(file, bytes);
    expect(() => loadRustStrategySearchKingdomEvidence(fixture.paths, options(fixture)))
      .toThrow(/does not preserve the checkpoint witness/u);
  });
});
