import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  runThresholdRacingCampaign
} from './successive_halving_double_oracle_pilot';
import type { ThresholdRacingSource } from './successive_halving_double_oracle_pilot';
import {
  validateOrderedCalibrationSourceForCounts
} from '../src/sim/initialMatrixCalibration';
import type { CalibrationSourceIdentity } from '../src/sim/responseOracleCalibration';
import {
  strategySearchMatrixChunkPath, strategySearchMatrixJobs,
  validateStrategySearchMatrixChunk, validateStrategySearchMatrixManifest,
  validateStrategySearchMatrixP75Source
} from '../src/sim/strategySearchMatrix';
import type {
  StrategySearchMatrixChunk, StrategySearchMatrixManifest, StrategySearchMatrixP75Source
} from '../src/sim/strategySearchMatrix';
import { matrixProtocol, payoffMatrixPairKey } from '../src/sim/payoffMatrix';
import type { MatrixCell, MatrixSnapshot } from '../src/sim/payoffMatrix';
import { reconstructMatrixCache } from '../src/sim/fixedReservoirConsistency';
import { GAMES_PER_SEED, emptyAggregate, mergeAggregate } from '../src/sim/pairing';
import { compareUtf16 } from '../src/sim/utf16';
import {
  createCampaignPsroClosure, createCampaignStageControlMarker, validateCampaignPsroStage
} from '../src/sim/strategySearchStages';
import {
  createThresholdRacingProtocol, thresholdRacingProtocolHash, validateRawPsroLookArtifact,
  validateRawPsroScoreChunk, validateThresholdRacingProtocol
} from '../src/sim/thresholdRacingPsro';
import type {
  RawPsroLookArtifact, RawPsroScoreChunk
} from '../src/sim/thresholdRacingPsro';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';

interface Config {
  stageId: string; kingdomId: string; runId: string; rankedPath: string; reservoirPath: string;
  matrixRoot: string; outputRoot: string; controlRoot: string; workers: number;
  protocolInput: { experimentName: string; protocolVersion: string; checkpointNamespace: string;
    screenDepths: number[]; confirmationLooks: number[] }; execution: 'local';
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`), value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value;
}
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
function sha256File(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file);
}
function rejectSymlinks(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Campaign PSRO path contains a symlink: ${file}`);
    if (entry.isDirectory()) rejectSymlinks(file);
  }
}
function files(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = []; const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Campaign PSRO output contains a symlink: ${file}`);
      if (entry.isDirectory()) visit(file); else result.push(file);
    }
  }; visit(root); return result;
}
function initialMatrix(manifest: StrategySearchMatrixManifest, p75: StrategySearchMatrixP75Source,
  chunks: readonly StrategySearchMatrixChunk[]): MatrixSnapshot {
  const protocol = matrixProtocol(manifest.source.kingdomId, manifest.seeds.slice(0, 75), 30, 200, false);
  const bySlot = new Map(chunks.map((chunk) => [chunk.slot, chunk])); const cells: MatrixCell[] = [];
  for (let row = 0; row < manifest.strategyCount; row += 1) for (let column = row + 1;
    column < manifest.strategyCount; column += 1) {
    const jobs = strategySearchMatrixJobs(manifest).filter((job) => job.rowIndex === row
      && job.columnIndex === column && job.startSeedIndex < 75);
    const records = jobs.flatMap((job) => bySlot.get(job.slot)?.records ?? []);
    if (records.length !== 75) throw new Error(`Campaign PSRO P75 cell ${row}:${column} is incomplete.`);
    const rowStrategy = manifest.strategies[row]!, columnStrategy = manifest.strategies[column]!;
    const originalScores = records.map((record) => record.payoffScore!);
    const [first, second, scores] = rowStrategy.id < columnStrategy.id
      ? [rowStrategy, columnStrategy, originalScores]
      : [columnStrategy, rowStrategy, originalScores.map((score) => 1 - score)];
    const telemetry = emptyAggregate(); records.forEach((record) => mergeAggregate(telemetry, record.telemetry));
    cells.push({ rowId: first.id, columnId: second.id, key: payoffMatrixPairKey(protocol, first, second),
      blocks: scores.map((score, index) => ({ seed: protocol.seeds[index]!, score,
        played: GAMES_PER_SEED, aborted: 0 })), complete: true,
      centeredPayoff: 2 * scores.reduce((sum, score) => sum + score, 0) / scores.length - 1,
      matches: scores.length * GAMES_PER_SEED, telemetry });
  }
  cells.sort((left, right) => compareUtf16(left.rowId, right.rowId)
    || compareUtf16(left.columnId, right.columnId));
  const snapshot: MatrixSnapshot = { protocol, strategies: manifest.strategies, cells, complete: true,
    centeredPayoffs: p75.centeredPayoffs };
  reconstructMatrixCache(snapshot); return snapshot;
}

const campaignRoot = path.resolve(option('campaign-root'));
function confined(file: string): string {
  const resolved = path.resolve(file);
  if (resolved === campaignRoot || !resolved.startsWith(`${campaignRoot}${path.sep}`)) {
    throw new Error(`Campaign PSRO path escapes its root: ${file}`);
  }
  return resolved;
}
const configFile = confined(option('config'));
const config = readJson<Config>(configFile), shutdownAtMs = Number(option('shutdown-at-ms'));
config.rankedPath = confined(config.rankedPath); config.reservoirPath = confined(config.reservoirPath);
config.matrixRoot = confined(config.matrixRoot); config.outputRoot = confined(config.outputRoot);
config.controlRoot = confined(config.controlRoot);
if (!/^[0-9a-f]{64}$/.test(config.stageId) || !config.runId || !Number.isSafeInteger(config.workers)
  || config.workers < 1 || config.execution !== 'local' || !Number.isSafeInteger(shutdownAtMs)
  || config.outputRoot === config.controlRoot || config.outputRoot.startsWith(`${config.controlRoot}${path.sep}`)
  || config.controlRoot.startsWith(`${config.outputRoot}${path.sep}`)
  || shutdownAtMs <= Date.now() || !config.protocolInput?.experimentName
  || !config.protocolInput.protocolVersion || !config.protocolInput.checkpointNamespace) {
  throw new Error('Campaign PSRO stage configuration is invalid.');
}
strategySearchKingdom(config.kingdomId);
for (const file of [config.rankedPath, config.reservoirPath]) if (!fs.existsSync(file)) {
  throw new Error(`Campaign PSRO source is missing: ${file}`);
}
const ranked = readJson<unknown>(config.rankedPath), reservoir = readJson<unknown>(config.reservoirPath);
const rankedSha256 = sha256File(config.rankedPath), reservoirSha256 = sha256File(config.reservoirPath);
const ordered = validateOrderedCalibrationSourceForCounts({ kingdomId: config.kingdomId, ranked, reservoir,
  rankedSha256, reservoirSha256 }, { retainedCount: 500_000, reservoirCount: 20_000, strategyCount: 50 });
const manifest = readJson<unknown>(path.join(config.matrixRoot, 'manifest.json'));
if (!validateStrategySearchMatrixManifest(manifest) || manifest.source.kingdomId !== config.kingdomId
  || manifest.source.rankedSha256 !== rankedSha256 || manifest.source.reservoirSha256 !== reservoirSha256
  || JSON.stringify(manifest.strategies) !== JSON.stringify(ordered.strategies)) {
  throw new Error('Campaign PSRO Matrix source is stale or invalid.');
}
const jobs = strategySearchMatrixJobs(manifest).filter((job) => job.startSeedIndex < 75);
const chunks = jobs.map((job) => {
  const file = path.join(config.matrixRoot, strategySearchMatrixChunkPath(job)), value = readJson<unknown>(file);
  if (!validateStrategySearchMatrixChunk(value, manifest, job)) throw new Error(`Campaign PSRO Matrix chunk is invalid: ${file}`);
  return value;
});
const p75 = readJson<unknown>(path.join(config.matrixRoot, 'p75.json'));
if (!validateStrategySearchMatrixP75Source(p75, manifest, chunks)) throw new Error('Campaign PSRO P75 source is invalid.');
const sourceIdentity: CalibrationSourceIdentity = { kingdomId: config.kingdomId,
  rankedPath: config.rankedPath, reservoirPath: config.reservoirPath,
  p75ManifestPath: path.join(config.matrixRoot, 'manifest.json'),
  p75ReportPath: path.join(config.matrixRoot, 'p75.json'), rankedSha256, reservoirSha256,
  p75ManifestSha256: sha256File(path.join(config.matrixRoot, 'manifest.json')),
  p75ReportSha256: sha256File(path.join(config.matrixRoot, 'p75.json')),
  p75ManifestHash: manifest.evidenceHash, reservoirRunId: ordered.source.runId,
  reservoirVersion: ordered.source.productVersion, rulesFingerprint: ordered.source.ruleFingerprint };
const protocol = createThresholdRacingProtocol({ ...config.protocolInput, runId: config.runId,
  kingdomId: config.kingdomId, reservoirCount: 20_000, sourceIdentityHash: hash(sourceIdentity) });
if (!validateThresholdRacingProtocol(protocol)) throw new Error('Campaign PSRO protocol is invalid.');
const source: ThresholdRacingSource = { entry: { kingdomId: config.kingdomId, ranked: config.rankedPath,
  reservoir: config.reservoirPath, p75Root: config.matrixRoot }, source: sourceIdentity,
  reservoir: reservoir as ThresholdRacingSource['reservoir'], initialMatrix: initialMatrix(manifest, p75, chunks),
  kingdomId: config.kingdomId, experimentName: protocol.experimentName,
  protocolVersion: protocol.protocolVersion, rawProtocol: protocol,
  onRawCheckpoint(event) { process.stdout.write(`${JSON.stringify(event)}\n`); }, deadlineMs: shutdownAtMs,
  terminalOnUnresolved: true };
fs.mkdirSync(config.outputRoot, { recursive: true }); fs.mkdirSync(config.controlRoot, { recursive: true });
rejectSymlinks(config.outputRoot); rejectSymlinks(config.controlRoot);
writeAtomic(path.join(config.outputRoot, 'protocol.json'), protocol);
try {
  if (Date.now() >= shutdownAtMs) throw new Error('campaign-psro-shutdown-margin');
  const checkpoint = await runThresholdRacingCampaign(config.outputRoot, source, config.workers,
    config.runId, config.execution);
  const runRoot = path.join(config.outputRoot, `run-${config.runId}`), rawRoot = path.join(runRoot, 'raw');
  const rawChunks = files(path.join(rawRoot, 'chunks')).filter((file) => file.endsWith('.json'))
    .map((file) => readJson<RawPsroScoreChunk>(file));
  const looks = files(path.join(rawRoot, 'looks')).filter((file) => file.endsWith('.json'))
    .map((file) => readJson<RawPsroLookArtifact>(file));
  const status = checkpoint.status === 'complete' ? 'complete' as const : 'terminal-incomplete' as const;
  const reason = status === 'complete' ? null : 'fixed-protocol-look-cap-unresolved';
  const checkpointFile = path.join(runRoot, 'checkpoint.json'), reportFile = path.join(runRoot, 'report.json');
  const checkpointSha256 = sha256File(checkpointFile), reportSha256 = sha256File(reportFile);
  const closure = createCampaignPsroClosure({ stageId: config.stageId,
    protocolHash: thresholdRacingProtocolHash(protocol), sourceHash: protocol.sourceIdentityHash,
    status, cleanScans: checkpoint.cleanScans, admissions: checkpoint.admissions.length,
    matrixHash: hash(checkpoint.matrix), checkpointHash: checkpointSha256, reportHash: reportSha256, reason });
  const closureFile = path.join(runRoot, 'closure.json'); writeAtomic(closureFile, closure);
  const artifactHashes: Record<string, string> = {
    'output/protocol.json': sha256File(path.join(config.outputRoot, 'protocol.json')),
    [`output/run-${protocol.runId}/closure.json`]: sha256File(closureFile),
    [`output/run-${protocol.runId}/checkpoint.json`]: checkpointSha256,
    [`output/run-${protocol.runId}/report.json`]: reportSha256 };
  for (const chunk of rawChunks) {
    const relative = `run-${protocol.runId}/raw/chunks/${chunk.lookId}`
      + `/${chunk.candidateStart}-${chunk.candidateEnd}.json`;
    artifactHashes[`output/${relative}`] = sha256File(path.join(config.outputRoot, relative));
  }
  for (const look of looks) {
    const relative = `run-${protocol.runId}/raw/looks/${look.lookId}.json`;
    artifactHashes[`output/${relative}`] = sha256File(path.join(config.outputRoot, relative));
  }
  const marker = createCampaignStageControlMarker({ stage: 'psro', stageId: config.stageId,
    status, artifactHashes, ...(reason ? { reason } : {}) });
  if (!validateCampaignPsroStage({ stageId: config.stageId, protocol,
    chunks: rawChunks, looks, checkpoint, report: readJson<unknown>(reportFile), checkpointSha256,
    reportSha256, closure, fileHashes: artifactHashes, marker })) {
    throw new Error('Campaign PSRO deep validation failed.');
  }
  writeAtomic(path.join(config.controlRoot, `${status}.json`), marker);
  process.stdout.write(`${JSON.stringify({ type: 'strategy-search-stage-stop', stage: 'psro',
    status, markerHash: marker.markerHash })}\n`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const artifactHashes: Record<string, string> = {
    'output/protocol.json': sha256File(path.join(config.outputRoot, 'protocol.json'))
  };
  const partialRoot = path.join(config.outputRoot, `run-${protocol.runId}`, 'raw');
  for (const file of files(path.join(partialRoot, 'chunks')).filter((entry) => entry.endsWith('.json'))) {
    try {
      const chunk = readJson<RawPsroScoreChunk>(file);
      if (validateRawPsroScoreChunk(chunk, protocol)) {
        artifactHashes[`output/${path.relative(config.outputRoot, file).split(path.sep).join('/')}`]
          = sha256File(file);
      }
    } catch { /* Invalid raw bytes remain on disk but cannot enter the marker. */ }
  }
  for (const file of files(path.join(partialRoot, 'looks')).filter((entry) => entry.endsWith('.json'))) {
    try {
      const look = readJson<RawPsroLookArtifact>(file);
      if (validateRawPsroLookArtifact(look, protocol)) {
        artifactHashes[`output/${path.relative(config.outputRoot, file).split(path.sep).join('/')}`]
          = sha256File(file);
      }
    } catch { /* Invalid raw bytes remain on disk but cannot enter the marker. */ }
  }
  const marker = createCampaignStageControlMarker({ stage: 'psro', stageId: config.stageId,
    status: 'incomplete', artifactHashes, reason });
  writeAtomic(path.join(config.controlRoot, 'incomplete.json'), marker);
  process.stdout.write(`${JSON.stringify({ type: 'strategy-search-stage-stop', stage: 'psro',
    status: 'incomplete', markerHash: marker.markerHash })}\n`);
  process.exitCode = 2;
}
