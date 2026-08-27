import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Kingdom } from '../game';
import type { CandidateEvaluation, MixtureSchedule } from './mixtureEvaluation';
import { nativeCompetitiveModalInput, NATIVE_COMPETITIVE_SCORER_VERSION } from './nativeCompetitiveProtocol';
import type { CompetitiveKernelConfig } from './nativeCompetitiveProtocol';
import { GAMES_PER_SEED, emptyAggregate } from './pairing';
import type { PairingRunner } from './pairingRunner';
import { canonicalStrategy } from './strategy';
import type { Strategy } from './strategy';

const ARTIFACT_MAGIC = Buffer.from('HPS1');
const COMPLETE_HEADER_KEYS = Object.freeze([
  'buildVersion', 'candidateCount', 'digest', 'inputHash', 'lookId', 'requestedCpu',
  'ruleFingerprint', 'runId', 'scheduleCount', 'schemaVersion', 'scoreCount', 'scorerVersion', 'threads'
].sort());

export const MODAL_COMPETITIVE_RESOURCES = Object.freeze({
  cpu: 4,
  memoryGib: 4,
  threads: 4,
  maxContainers: 16,
  timeoutSeconds: 180,
  maxCostUsd: 2,
  targetBlocks: 65_536
});

export interface CompetitiveArtifactExpectation {
  buildVersion: string;
  candidateCount: number;
  inputHash: string;
  lookId: string;
  ruleFingerprint: string;
  scheduleCount: number;
  requestedCpu?: number;
  threads?: number;
}

export interface CompetitiveCompleteArtifact {
  digest: string;
  runId: string;
  scoreBytes: Uint8Array;
  played: Uint8Array;
}

export type ModalCommandRunner = (command: string, args: readonly string[]) => Promise<void>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0).map(([key, held]) =>
    `${JSON.stringify(key)}:${canonicalJson(held)}`).join(',')}}`;
  return JSON.stringify(value);
}

function exact(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

export function readCompetitiveCompleteArtifact(
  file: string, expected: CompetitiveArtifactExpectation
): CompetitiveCompleteArtifact {
  const raw = fs.readFileSync(file);
  if (raw.length < 8 || !raw.subarray(0, 4).equals(ARTIFACT_MAGIC)) {
    throw new Error(`Competitive Modal artifact has invalid magic: ${file}.`);
  }
  const headerLength = raw.readUInt32BE(4);
  if (headerLength < 2 || 8 + headerLength > raw.length) {
    throw new Error(`Competitive Modal artifact has an invalid header length: ${file}.`);
  }
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(raw.subarray(8, 8 + headerLength).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error(`Competitive Modal artifact has invalid header JSON: ${file}.`);
  }
  if (!exact(Object.keys(header).sort(), COMPLETE_HEADER_KEYS)) {
    throw new Error(`Competitive Modal artifact has an unexpected header: ${file}.`);
  }
  const scoreCount = header.scoreCount;
  const payload = raw.subarray(8 + headerLength);
  if (!Number.isSafeInteger(scoreCount) || scoreCount !== expected.candidateCount * expected.scheduleCount
    || payload.length !== Number(scoreCount) * 2) {
    throw new Error(`Competitive Modal artifact has invalid dimensions: ${file}.`);
  }
  const heldDigest = header.digest;
  const digestHeader = { ...header };
  delete digestHeader.digest;
  const digest = createHash('sha256').update(canonicalJson(digestHeader)).update(payload).digest('hex');
  const expectedCpu = expected.requestedCpu ?? MODAL_COMPETITIVE_RESOURCES.cpu;
  const expectedThreads = expected.threads ?? MODAL_COMPETITIVE_RESOURCES.threads;
  if (header.schemaVersion !== 1 || header.lookId !== expected.lookId
    || header.inputHash !== expected.inputHash || header.candidateCount !== expected.candidateCount
    || header.scheduleCount !== expected.scheduleCount
    || header.scorerVersion !== NATIVE_COMPETITIVE_SCORER_VERSION
    || header.buildVersion !== expected.buildVersion || header.ruleFingerprint !== expected.ruleFingerprint
    || header.requestedCpu !== expectedCpu || header.threads !== expectedThreads
    || typeof header.runId !== 'string' || !/^competitive-[0-9A-Za-z._-]+$/.test(header.runId)
    || heldDigest !== digest) {
    throw new Error(`Competitive Modal artifact failed provenance or digest validation: ${file}.`);
  }
  const scores = payload.subarray(0, Number(scoreCount));
  const played = payload.subarray(Number(scoreCount));
  if (scores.some((score) => score > 4) || played.some((count) => count !== GAMES_PER_SEED)) {
    throw new Error(`Competitive Modal artifact contains invalid score evidence: ${file}.`);
  }
  return { digest, runId: header.runId, scoreBytes: Uint8Array.from(scores), played: Uint8Array.from(played) };
}

export function runModalCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'inherit' });
    child.once('error', (error) => reject(new Error(`Cannot start Modal CLI ${command}: ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Modal competitive look exited ${signal ? `by ${signal}` : `with code ${code}`}.`));
    });
  });
}

export class ModalCompetitiveEvaluator {
  constructor(
    private readonly kingdom: Kingdom,
    private readonly residentStrategies: readonly Strategy[],
    private readonly config: CompetitiveKernelConfig,
    private readonly artifactRoot: string,
    private readonly buildVersion: string,
    private readonly commandRunner: ModalCommandRunner = runModalCommand,
    private readonly modalCommand = process.env.HEXDECK_MODAL_BIN ?? 'modal'
  ) {}

  async evaluate(
    candidates: readonly Strategy[], opponents: ReadonlyMap<string, Strategy>, schedule: MixtureSchedule,
    _runner: PairingRunner, options: {
      kingdomId: string; turnLimitPerPlayer: number; actionCapPerTurn: number;
      startingDraftEnabled?: boolean; scoreOnly?: boolean; lookId?: string;
    }
  ): Promise<CandidateEvaluation[]> {
    if (options.scoreOnly !== true || options.kingdomId !== this.config.kingdomId
      || options.turnLimitPerPlayer !== this.config.turnLimitPerPlayer
      || options.actionCapPerTurn !== this.config.actionCapPerTurn
      || (options.startingDraftEnabled ?? true) !== this.config.startingDraftEnabled
      || !options.lookId) {
      throw new Error('Modal competitive evaluation config or look ID is invalid.');
    }
    for (const block of schedule.blocks) {
      const opponent = opponents.get(block.opponentId);
      const resident = this.residentStrategies.find((strategy) => strategy.id === block.opponentId);
      if (!opponent || !resident || canonicalStrategy(opponent) !== canonicalStrategy(resident)) {
        throw new Error(`Mixture opponent ${block.opponentId} is not the resident strategy.`);
      }
    }
    const input = nativeCompetitiveModalInput(this.kingdom, candidates, this.residentStrategies,
      schedule, this.config, MODAL_COMPETITIVE_RESOURCES.threads, MODAL_COMPETITIVE_RESOURCES.cpu,
      options.lookId);
    const lookRoot = path.join(this.artifactRoot, options.lookId);
    const inputFile = path.join(lookRoot, 'input.json');
    const completeFile = path.join(lookRoot, 'complete.hps');
    const serialized = `${JSON.stringify(input, null, 2)}\n`;
    if (fs.existsSync(inputFile)) {
      let held: unknown;
      try { held = JSON.parse(fs.readFileSync(inputFile, 'utf8')); } catch {
        throw new Error(`Existing Modal competitive input is corrupt: ${inputFile}.`);
      }
      if (!exact(held, input)) throw new Error(`Existing Modal competitive input changed: ${inputFile}.`);
    } else writeAtomic(inputFile, serialized);
    const expectation = { buildVersion: this.buildVersion, candidateCount: candidates.length,
      inputHash: input.inputHash, lookId: options.lookId,
      ruleFingerprint: input.loadRequest.payload.ruleFingerprint, scheduleCount: schedule.blocks.length };
    let artifact: CompetitiveCompleteArtifact;
    if (fs.existsSync(completeFile)) artifact = readCompetitiveCompleteArtifact(completeFile, expectation);
    else {
      await this.commandRunner(this.modalCommand, ['run', 'modal/native_strategy_search.py::run_competitive',
        '--input-file', inputFile, '--output-file', completeFile, '--build-version', this.buildVersion,
        '--cpu', String(MODAL_COMPETITIVE_RESOURCES.cpu), '--memory-gib', String(MODAL_COMPETITIVE_RESOURCES.memoryGib),
        '--threads', String(MODAL_COMPETITIVE_RESOURCES.threads),
        '--max-containers', String(MODAL_COMPETITIVE_RESOURCES.maxContainers),
        '--timeout-seconds', String(MODAL_COMPETITIVE_RESOURCES.timeoutSeconds),
        '--max-cost-usd', String(MODAL_COMPETITIVE_RESOURCES.maxCostUsd),
        '--target-blocks', String(MODAL_COMPETITIVE_RESOURCES.targetBlocks)]);
      if (!fs.existsSync(completeFile)) throw new Error(`Modal did not write ${completeFile}.`);
      artifact = readCompetitiveCompleteArtifact(completeFile, expectation);
    }
    return candidates.map((strategy, candidateIndex): CandidateEvaluation => {
      const start = candidateIndex * schedule.blocks.length;
      const scoreBytes = artifact.scoreBytes.subarray(start, start + schedule.blocks.length);
      const blockScores = Array.from(scoreBytes, (score) => score / 4);
      return { strategy, mean: blockScores.reduce((sum, score) => sum + score, 0) / blockScores.length,
        blockScores, interval: null, matches: blockScores.length * GAMES_PER_SEED,
        telemetry: emptyAggregate() };
    });
  }
}
