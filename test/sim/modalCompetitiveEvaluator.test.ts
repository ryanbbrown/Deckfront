import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { strategySearchKingdom } from '../../src/sim/strategySearchKingdoms';
import { mixtureSchedule } from '../../src/sim/mixtureEvaluation';
import { ModalCompetitiveEvaluator } from '../../src/sim/modalCompetitiveEvaluator';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';

const kingdom = strategySearchKingdom('balance-tuning-001');
const config = { kingdomId: kingdom.id, turnLimitPerPlayer: 30,
  actionCapPerTurn: 200, startingDraftEnabled: false };
const runner = { async run() { throw new Error('Modal adapter owns score evaluation.'); }, async close() {} };

interface TestModalInput {
  lookId: string;
  inputHash: string;
  candidateCount: number;
  schedule: Array<{ seed: number }>;
  loadRequest: { payload: { ruleFingerprint: string } };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0).map(([key, held]) =>
    `${JSON.stringify(key)}:${canonicalJson(held)}`).join(',')}}`;
  return JSON.stringify(value);
}

function writeComplete(file: string, input: TestModalInput, scores: readonly number[]): void {
  const played = Buffer.alloc(scores.length, 2);
  const payload = Buffer.concat([Buffer.from(scores), played]);
  const header: Record<string, unknown> = { schemaVersion: 1,
    runId: 'competitive-build-fixture', lookId: input.lookId, inputHash: input.inputHash,
    candidateCount: input.candidateCount, scheduleCount: input.schedule.length,
    scorerVersion: 'native-competitive-v1', buildVersion: 'build-fixture',
    ruleFingerprint: input.loadRequest.payload.ruleFingerprint, requestedCpu: 4, threads: 4,
    scoreCount: scores.length };
  header.digest = createHash('sha256').update(canonicalJson(header)).update(payload).digest('hex');
  const encoded = Buffer.from(canonicalJson(header));
  const raw = Buffer.alloc(8 + encoded.length + payload.length);
  raw.write('HPS1'); raw.writeUInt32BE(encoded.length, 4); encoded.copy(raw, 8); payload.copy(raw, 8 + encoded.length);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, raw);
}

function strategy(cardId: string) {
  return identify({ id: '', startingBuild: [],
    buyPlan: fixedBuyPlan([{ kind: 'buy', cardId, desiredCount: 2 }]) });
}

beforeEach(() => registerKingdom(kingdom));
afterEach(() => resetKingdoms());

describe('Modal competitive evaluator', () => {
  it('submits one exact look and restores candidate-major schedule order', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-modal-adapter-'));
    const resident = [strategy('focus'), strategy('step'), strategy('strike')];
    const candidates = [resident[2]!, resident[0]!];
    const opponents = new Map([[resident[1]!.id, resident[1]!]]);
    const schedule = mixtureSchedule({ [resident[1]!.id]: 1 }, [101, 102, 103], 9);
    const calls: string[][] = [];
    const command = async (_name: string, args: readonly string[]) => {
      calls.push([...args]);
      const inputFile = args[args.indexOf('--input-file') + 1]!;
      const outputFile = args[args.indexOf('--output-file') + 1]!;
      const input = JSON.parse(fs.readFileSync(inputFile, 'utf8')) as TestModalInput;
      expect(input.candidateCount).toBe(2);
      expect(input.schedule.map((block: { seed: number }) => block.seed)).toEqual([101, 102, 103]);
      writeComplete(outputFile, input, [4, 3, 2, 1, 0, 4]);
    };
    const evaluator = new ModalCompetitiveEvaluator(kingdom, resident, config, root,
      'build-fixture', command, 'modal-fixture');
    const rows = await evaluator.evaluate(candidates, opponents, schedule, runner as never,
      { ...config, scoreOnly: true, lookId: 'run-1.scan-1.screen.blocks-8' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 2)).toEqual(['run', 'modal/native_strategy_search.py::run_competitive']);
    expect(rows.map((row) => row.blockScores)).toEqual([[1, 0.75, 0.5], [0.25, 0, 1]]);
    expect(rows.map((row) => row.matches)).toEqual([6, 6]);
  });

  it('resumes from a valid local complete artifact without another Modal command', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-modal-resume-'));
    const resident = [strategy('focus'), strategy('step')];
    const candidates = [resident[0]!];
    const opponents = new Map([[resident[1]!.id, resident[1]!]]);
    const schedule = mixtureSchedule({ [resident[1]!.id]: 1 }, [201, 202], 7);
    let calls = 0;
    const command = async (_name: string, args: readonly string[]) => {
      calls += 1;
      const input = JSON.parse(fs.readFileSync(args[args.indexOf('--input-file') + 1]!, 'utf8'));
      writeComplete(args[args.indexOf('--output-file') + 1]!, input, [4, 0]);
    };
    const options = { ...config, scoreOnly: true as const, lookId: 'resume-look' };
    const first = new ModalCompetitiveEvaluator(kingdom, resident, config, root,
      'build-fixture', command);
    await first.evaluate(candidates, opponents, schedule, runner as never, options);
    const second = new ModalCompetitiveEvaluator(kingdom, resident, config, root,
      'build-fixture', async () => { throw new Error('must not launch'); });
    const rows = await second.evaluate(candidates, opponents, schedule, runner as never, options);
    expect(calls).toBe(1);
    expect(rows[0]!.blockScores).toEqual([1, 0]);
  });

  it('rejects corrupt complete evidence instead of replacing it with paid work', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-modal-corrupt-'));
    const resident = [strategy('focus'), strategy('step')];
    const opponents = new Map([[resident[1]!.id, resident[1]!]]);
    const schedule = mixtureSchedule({ [resident[1]!.id]: 1 }, [301], 5);
    const options = { ...config, scoreOnly: true as const, lookId: 'corrupt-look' };
    const first = new ModalCompetitiveEvaluator(kingdom, resident, config, root, 'build-fixture',
      async (_name, args) => {
        const input = JSON.parse(fs.readFileSync(args[args.indexOf('--input-file') + 1]!, 'utf8'));
        writeComplete(args[args.indexOf('--output-file') + 1]!, input, [2]);
      });
    await first.evaluate([resident[0]!], opponents, schedule, runner as never, options);
    const artifact = path.join(root, 'corrupt-look', 'complete.hps');
    const raw = fs.readFileSync(artifact);
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    fs.writeFileSync(artifact, raw);
    const resumed = new ModalCompetitiveEvaluator(kingdom, resident, config, root, 'build-fixture',
      async () => { throw new Error('must not launch'); });
    await expect(resumed.evaluate([resident[0]!], opponents, schedule, runner as never, options))
      .rejects.toThrow('digest validation');
  });

  it('rejects changed input under an existing look ID', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-modal-input-'));
    const resident = [strategy('focus'), strategy('step')];
    const opponents = new Map([[resident[1]!.id, resident[1]!]]);
    const firstSchedule = mixtureSchedule({ [resident[1]!.id]: 1 }, [401], 5);
    const options = { ...config, scoreOnly: true as const, lookId: 'fixed-look' };
    const evaluator = new ModalCompetitiveEvaluator(kingdom, resident, config, root, 'build-fixture',
      async (_name, args) => {
        const input = JSON.parse(fs.readFileSync(args[args.indexOf('--input-file') + 1]!, 'utf8'));
        writeComplete(args[args.indexOf('--output-file') + 1]!, input, [2]);
      });
    await evaluator.evaluate([resident[0]!], opponents, firstSchedule, runner as never, options);
    const changedSchedule = mixtureSchedule({ [resident[1]!.id]: 1 }, [402], 5);
    await expect(evaluator.evaluate([resident[0]!], opponents, changedSchedule, runner as never, options))
      .rejects.toThrow('input changed');
  });
});
