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

describe('Rust strategy-search evidence adapter', () => {
  it('requires native verification first and selects initial HGM after no admissions', () => {
    const fixture = createEvidenceFixture(temporary(), 0);
    const evidence = loadRustStrategySearchKingdomEvidence(fixture.paths, { binary: fixture.binary,
      runNativeCommand: fixture.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } });
    expect(fixture.commands.map((command) => command[0])).toEqual(['verify', 'verify', 'matrix-verify', 'psro-verify']);
    expect(fixture.commands[1]).toEqual(['verify', '--kingdom', 'balance-tuning-005', '--kind', 'reservoir',
      '--file', fixture.paths.reservoirFile, '--top', fixture.paths.topFile]);
    expect(evidence.finalMatrixSource).toBe('initial-matrix');
    expect(evidence.completion).toMatchObject({ admissionCount: 0, matrixGeneration: 0, cleanSearchCount: 2,
      finalStrategyNumbers: [0, 1], finalWeights: [0.75, 0.25] });
    expect(evidence.matrix.weights).toEqual([0.75, 0.25]);
    expect(evidence.sourceFiles.map((file) => file.path)).toContain('matrix/matrix.hgm');
  });

  it('selects expanded HGM after admission and preserves stored witness bits', () => {
    const fixture = createEvidenceFixture(temporary(), 1);
    const evidence = loadRustStrategySearchKingdomEvidence(fixture.paths, { binary: fixture.binary,
      runNativeCommand: fixture.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } });
    expect(evidence.finalMatrixSource).toBe('psro-expanded-matrix');
    expect(evidence.completion.finalStrategyNumbers).toEqual([0, 1, 2]);
    expect(evidence.matrix.weights).toEqual([0.2, 0.3, 0.5]);
    expect(evidence.sourceFiles.map((file) => file.path)).toContain('psro/matrix.hgm');
  });

  it('stops on native failure before it reads missing evidence', () => {
    const fixture = createEvidenceFixture(temporary(), 0); fs.rmSync(fixture.paths.topFile);
    const calls: string[] = [];
    expect(() => loadRustStrategySearchKingdomEvidence(fixture.paths, { binary: fixture.binary,
      runNativeCommand: (_binary, args) => { calls.push(args[0]!); return { status: 1, signal: null, stdout: '', stderr: 'bad CRC' }; },
      goldfishReadOptions: { keep: 4, topKeep: 4 } })).toThrow(/native verify failed: bad CRC/u);
    expect(calls).toEqual(['verify']);
  });

  it('rejects malformed verifier output and a partial final matrix set', () => {
    const malformed = createEvidenceFixture(temporary(), 0);
    expect(() => loadRustStrategySearchKingdomEvidence(malformed.paths, { binary: malformed.binary,
      runNativeCommand: () => ({ status: 0, signal: null, stdout: 'not json', stderr: '' }),
      goldfishReadOptions: { keep: 4, topKeep: 4 } })).toThrow(/did not return a JSON summary/u);

    const partial = createEvidenceFixture(temporary(), 0);
    fs.copyFileSync(path.join(partial.paths.initialMatrixDir, 'pairs.hgm'), path.join(partial.paths.psroDir, 'pairs.hgm'));
    expect(() => loadRustStrategySearchKingdomEvidence(partial.paths, { binary: partial.binary,
      runNativeCommand: partial.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } }))
      .toThrow(/HGM presence differs/u);
  });

  it('rejects corrupt CRC data and semantic corruption with a recomputed CRC', () => {
    const corruptCrc = createEvidenceFixture(temporary(), 0), purchaseFile = path.join(corruptCrc.paths.initialMatrixDir, 'purchases.hgm');
    const purchaseBytes = fs.readFileSync(purchaseFile); purchaseBytes[64 + 8] = purchaseBytes[64 + 8]! ^ 1;
    fs.writeFileSync(purchaseFile, purchaseBytes);
    expect(() => loadRustStrategySearchKingdomEvidence(corruptCrc.paths, { binary: corruptCrc.binary,
      runNativeCommand: corruptCrc.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } }))
      .toThrow(/HGM header, length, source, or CRC differs/u);

    const semantic = createEvidenceFixture(temporary(), 0), pairFile = path.join(semantic.paths.initialMatrixDir, 'pairs.hgm');
    const pairBytes = fs.readFileSync(pairFile); pairBytes[64 + 8] = 5;
    pairBytes.writeUInt32LE(crc32(pairBytes.subarray(64)) >>> 0, 24); fs.writeFileSync(pairFile, pairBytes);
    expect(() => loadRustStrategySearchKingdomEvidence(semantic.paths, { binary: semantic.binary,
      runNativeCommand: semantic.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } }))
      .toThrow(/pair order or point byte differs/u);
  });

  it('rejects a final matrix weight that differs from the checkpoint', () => {
    const fixture = createEvidenceFixture(temporary(), 1), file = path.join(fixture.paths.psroDir, 'matrix.hgm');
    const bytes = fs.readFileSync(file), rowBytes = bytes.readUInt32LE(8); bytes.writeDoubleLE(0.4, 64 + 4 + 3 * 8);
    bytes.writeDoubleLE(0.1, 64 + rowBytes + 4 + 3 * 8); bytes.writeUInt32LE(crc32(bytes.subarray(64)) >>> 0, 24); fs.writeFileSync(file, bytes);
    expect(() => loadRustStrategySearchKingdomEvidence(fixture.paths, { binary: fixture.binary,
      runNativeCommand: fixture.runNativeCommand, goldfishReadOptions: { keep: 4, topKeep: 4 } }))
      .toThrow(/does not preserve the checkpoint witness/u);
  });
});
