import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkerPairingRunner } from '../src/sim/pairingRunner';
import { GAMES_PER_SEED } from '../src/sim/pairing';
import { evaluateCandidates } from '../src/sim/mixtureEvaluation';
import { readGoldfishReservoir } from '../src/sim/goldfishReservoir';
import { createStrategySearchPsroArtifact } from '../src/sim/strategySearchPsro';
import {
  createParallelAdmissionRowChunk, createParallelPsroCheckpoint, createParallelPsroScoreTaskChunk,
  matrixSnapshotFromStrategySearchArtifact, partitionParallelPsroLook, reduceParallelAdmissionRow,
  reduceParallelPsroLook, startParallelPsro
} from '../src/sim/strategySearchParallelPsro';
import type {
  ParallelAdmissionRowDescriptor, ParallelAdmissionRowChunk, ParallelPsroLookDescriptor,
  ParallelPsroScoreTaskChunk, ParallelPsroScoreTaskDescriptor, ParallelPsroSemanticCheckpoint
} from '../src/sim/strategySearchParallelPsro';
import { createThresholdRacingProtocol, scheduleSlice } from '../src/sim/thresholdRacingPsro';
import {
  validateStrategySearchMatrixArtifact, validateStrategySearchMatrixArtifactIdentity,
  validateStrategySearchMatrixManifest
} from '../src/sim/strategySearchMatrix';
import type { StrategySearchMatrixArtifact } from '../src/sim/strategySearchMatrix';
import { strategySearchKingdom } from '../src/sim/strategySearchKingdoms';
import { canonicalStrategy } from '../src/sim/strategy';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function option(name: string): string { const index = process.argv.indexOf(`--${name}`), value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`--${name} is required.`); return value; }
function integer(name: string, minimum = 0): number { const value = Number(option(name));
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`--${name} is invalid.`); return value; }
function optionalInteger(name: string): number | undefined {
  return process.argv.includes(`--${name}`) ? integer(name, 1) : undefined;
}
function read<T>(name: string): T { return JSON.parse(fs.readFileSync(path.resolve(option(name)), 'utf8')) as T; }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, file); }
function fileHash(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const mode = option('mode'), output = path.resolve(option('out'));
if (mode === 'init') {
  const evidenceId = option('evidence-id'), kingdomId = option('kingdom'), reservoirFile = path.resolve(option('reservoir')),
    matrixFile = path.resolve(option('matrix'));
  strategySearchKingdom(kingdomId);
  const topFile = path.join(path.dirname(reservoirFile), 'top-500000.hgf');
  const reservoir = readGoldfishReservoir(reservoirFile, kingdomId, { top: topFile });
  const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8')) as StrategySearchMatrixArtifact;
  if (!validateStrategySearchMatrixManifest(matrix.manifest) || matrix.source.evidenceId !== evidenceId
    || !validateStrategySearchMatrixArtifactIdentity(matrix, matrix.manifest)
    || !validateStrategySearchMatrixArtifact(matrix, matrix.manifest)) throw new Error('Parallel PSRO source is invalid.');
  const reservoirSha256 = fileHash(reservoirFile), topSha256 = fileHash(topFile), matrixSha256 = fileHash(matrixFile);
  const sourceIdentityHash = hash({ evidenceId, reservoirSha256, topSha256,
    matrixSha256, matrixEvidenceHash: matrix.evidenceHash });
  const protocol = createThresholdRacingProtocol({ experimentName: `strategy-search-${evidenceId}`,
    runId: 'main', kingdomId, reservoirCount: reservoir.records.length, sourceIdentityHash,
    checkpointNamespace: evidenceId, matrixSeedNamespace: 'strategy-search-matrix-v2',
    screenSeedNamespace: 'strategy-search-psro-screen-v2',
    confirmationSeedNamespace: 'strategy-search-psro-confirmation-v2',
    queueRetestSeedNamespace: 'strategy-search-psro-queue-retest-v2' });
  const checkpoint = createParallelPsroCheckpoint({ protocol, seedSourceHash: reservoirSha256,
    matrix: matrixSnapshotFromStrategySearchArtifact(matrix),
    candidates: reservoir.records.map((entry) => ({ goldfishRank: entry.rank, strategyId: entry.strategy.id,
      canonicalStrategy: entry.canonicalStrategy, strategy: entry.strategy })) });
  const targetTasks = optionalInteger('target-tasks');
  writeAtomic(output, startParallelPsro(checkpoint, targetTasks === undefined ? {} : { targetTasks }));
} else if (mode === 'score') {
  const checkpoint = read<ParallelPsroSemanticCheckpoint>('checkpoint'), look = read<ParallelPsroLookDescriptor>('look'),
    task = read<ParallelPsroScoreTaskDescriptor>('task'), workers = integer('workers', 1);
  const candidates = new Map(checkpoint.candidates.map((candidate) => [candidate.strategyId, candidate]));
  const field = look.candidateIds.slice(task.candidateStart, task.candidateEnd).map((id) => candidates.get(id)!);
  if (!field.length || field.some((candidate, index) => candidate.canonicalStrategy
    !== look.candidateCanonicals[task.candidateStart + index])) throw new Error('Parallel PSRO score task is stale.');
  const opponentIds = Object.keys(look.fullSchedule.targetWeights), opponents = new Map(opponentIds.map((id) => {
    const strategy = checkpoint.matrix.strategies.find((entry) => entry.id === id);
    if (!strategy) throw new Error('Parallel PSRO score opponent is missing.'); return [id, strategy];
  }));
  const kingdom = strategySearchKingdom(checkpoint.protocol.kingdomId);
  const runner = new WorkerPairingRunner(workers, new URL('../src/server/aiWorker.ts', import.meta.url),
    { kingdom }, ['--import', 'tsx']);
  try {
    const suffixSchedule = scheduleSlice(look.fullSchedule, task.scheduleStart, task.scheduleEnd);
    const rows = await evaluateCandidates(field.map((candidate) => candidate.strategy), opponents,
      suffixSchedule, runner, { kingdomId: checkpoint.protocol.kingdomId, turnLimitPerPlayer: 30,
        actionCapPerTurn: 200, startingDraftEnabled: false, scoreOnly: false });
    writeAtomic(output, createParallelPsroScoreTaskChunk({ checkpoint, look, task, rows }));
  } finally { await runner.close(); }
} else if (mode === 'reduce-score') {
  const checkpoint = read<ParallelPsroSemanticCheckpoint>('checkpoint'), look = read<ParallelPsroLookDescriptor>('look'),
    files = read<string[]>('chunks'), targetTasks = optionalInteger('target-tasks'),
    taskOptions = targetTasks === undefined ? {} : { targetTasks },
    tasks = partitionParallelPsroLook(look, taskOptions);
  const chunks: ParallelPsroScoreTaskChunk[] = files.map((file) =>
    JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as ParallelPsroScoreTaskChunk);
  writeAtomic(output, reduceParallelPsroLook({ checkpoint, look, tasks, chunks,
    ...(targetTasks === undefined ? {} : { targetTasks }) }));
} else if (mode === 'admission-score') {
  const checkpoint = read<ParallelPsroSemanticCheckpoint>('checkpoint'), row = read<ParallelAdmissionRowDescriptor>('row'),
    taskIndex = integer('task-index'), workers = integer('workers', 1), task = row.tasks[taskIndex];
  if (!task) throw new Error('Admission-row task does not exist.');
  const selected = checkpoint.candidates.find((candidate) => candidate.strategyId === row.candidateId);
  if (!selected || selected.canonicalStrategy !== row.candidateCanonical) throw new Error('Admission candidate is stale.');
  const kingdom = strategySearchKingdom(checkpoint.protocol.kingdomId), runner = new WorkerPairingRunner(workers,
    new URL('../src/server/aiWorker.ts', import.meta.url), { kingdom }, ['--import', 'tsx']);
  try {
    const opponents = row.opponentIds.slice(task.opponentStart, task.opponentEnd).map((id) => {
      const opponent = checkpoint.matrix.strategies.find((strategy) => strategy.id === id);
      if (!opponent) throw new Error('Admission opponent is missing.'); return opponent;
    });
    const result = await runner.run(opponents.map((opponent) => ({ candidate: selected.strategy, opponent,
      options: { kingdomId: checkpoint.protocol.kingdomId, seeds: row.seeds, turnLimitPerPlayer: 30,
        actionCapPerTurn: 200, startingDraftEnabled: false, allowEarlyStop: false } })));
    const cells = result.outcomes.map((outcome, index) => {
      if (!outcome || outcome.record.aborted || outcome.blocks.length !== row.seeds.length
        || outcome.matches !== row.seeds.length * GAMES_PER_SEED) throw new Error('Admission-row result is invalid.');
      return { opponentId: opponents[index]!.id, scores: outcome.blocks.map((block) => block.score),
        played: outcome.blocks.map((block) => block.played), telemetry: outcome.telemetry };
    });
    writeAtomic(output, createParallelAdmissionRowChunk({ row, taskIndex, cells }));
  } finally { await runner.close(); }
} else if (mode === 'admission-reduce') {
  const checkpoint = read<ParallelPsroSemanticCheckpoint>('checkpoint'), row = read<ParallelAdmissionRowDescriptor>('row'),
    files = read<string[]>('chunks');
  const chunks = files.map((file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as ParallelAdmissionRowChunk);
  const targetTasks = optionalInteger('target-tasks');
  writeAtomic(output, reduceParallelAdmissionRow({ checkpoint, row, chunks,
    ...(targetTasks === undefined ? {} : { targetTasks }) }));
} else if (mode === 'finalize') {
  const transition = read<{ checkpoint: ParallelPsroSemanticCheckpoint }>('transition'), checkpoint = transition.checkpoint;
  if (checkpoint.status !== 'complete') throw new Error('Cannot finalize incomplete PSRO evidence.');
  const matrix = read<StrategySearchMatrixArtifact>('matrix');
  const { candidates, looks, ...semanticCheckpoint } = checkpoint;
  writeAtomic(output, createStrategySearchPsroArtifact({ evidenceId: checkpoint.protocol.checkpointNamespace,
    matrixEvidenceHash: matrix.evidenceHash, candidateIds: candidates.map((candidate) => candidate.strategyId),
    rawLooks: looks, checkpoint: semanticCheckpoint, finalStatus: 'complete' }));
} else throw new Error(`Unknown parallel PSRO mode ${mode}.`);
void canonicalStrategy;
