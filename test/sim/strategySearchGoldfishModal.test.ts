import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveSourceImageIdentity, deriveStrategySearch } from '../../src/sim/strategySearchCampaign';
import {
  createGoldfishModalLaunchBundle, createGoldfishModalPlanSummary, deriveGoldfishModalRequest,
  GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND, GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND,
  goldfishKingdomOneTimeoutSeconds, parseGoldfishModalRequest,
  validateGoldfishModalAuthorizationToken
} from '../../src/sim/strategySearchGoldfishModal';
import {
  createGoldfishOperatorReport, executeGoldfishModalOperation, measureGoldfishPostDownloadValidations
} from '../../scripts/strategy_search_goldfish_modal';
import type { GoldfishModalOperatorAdapter } from '../../scripts/strategy_search_goldfish_modal';

const kingdomId = 'balance-tuning-005';
function source() {
  return deriveSourceImageIdentity({ files: [{ path: 'runtime', content: 'one' }],
    expectedPaths: ['runtime'] });
}
function request(workerCores = 32, maxActiveCpus = 512) {
  return { kingdomIds: [kingdomId], workerCores, maxActiveCpus,
    maxWallSeconds: 3600, maxCostUsd: 100 };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-modal-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'strategy-search-scientific-files.json'),
    '["package.json","strategy-search-scientific-files.json"]\n');
  fs.writeFileSync(path.join(root, 'strategy-search-image-files.json'),
    '["package.json","strategy-search-image-files.json","strategy-search-scientific-files.json"]\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const requestFile = path.join(root, 'request.json');
  fs.writeFileSync(requestFile, `${JSON.stringify(request())}\n`);
  return { root, requestFile };
}

const shapes = [
  { cores: 16, containers: 32, timeout: 1113, cost: 1.201972 },
  { cores: 32, containers: 16, timeout: 707, cost: 1.595977 },
  { cores: 64, containers: 8, timeout: 504, cost: 2.416435 }
] as const;

describe('Goldfish-only Modal operator', () => {
  it('accepts only explicit bounded paid inputs', () => {
    expect(parseGoldfishModalRequest(request(16))).toEqual(request(16));
    expect(parseGoldfishModalRequest(request(64))).toEqual(request(64));
    for (const value of [
      { ...request(), extra: true },
      { ...request(), kingdomIds: [] },
      { ...request(), kingdomIds: [kingdomId, kingdomId] },
      { ...request(), workerCores: 15 },
      { ...request(), workerCores: 65 },
      { ...request(), workerCores: 16, maxActiveCpus: 15 },
      { ...request(), maxWallSeconds: 299 },
      { ...request(), maxWallSeconds: 21_601 },
      { ...request(), maxCostUsd: 100.01 }
    ]) expect(() => parseGoldfishModalRequest(value)).toThrow();
  });

  it('plans two kingdom tasks at each supported resource shape', () => {
    for (const shape of shapes) {
      const parsed = deriveGoldfishModalRequest({ request: request(shape.cores), sourceImage: source() });
      const plan = createGoldfishModalPlanSummary(parsed);
      expect(plan.resourceShape).toEqual({ workerCoresPerContainer: shape.cores,
        maxActiveCpus: 512, maxKingdomContainers: shape.containers,
        maxScheduledCpus: 512, unusedCpuCapacity: 0, kingdomMemoryMiB: 8192 });
      expect(plan.taskCounts).toEqual({ kingdomOne: 1, kingdomTwo: 1, total: 2 });
      expect(plan.taskCount).toBe(2);
      expect(plan.timeouts).toEqual({ maximumScientificWallSeconds: 3600,
        kingdomOneTaskSeconds: shape.timeout, kingdomTwoTaskSeconds: 300 });
      expect(plan.worstCaseModalComputeUsd).toBe(shape.cost);
      expect(parsed.partitions).toEqual({});
    }
    expect(shapes.map((shape) => goldfishKingdomOneTimeoutSeconds(shape.cores)))
      .toEqual([1113, 707, 504]);
  });

  it('creates the exact two-task dependency chain for each kingdom', () => {
    for (const shape of shapes) {
      const parsed = deriveGoldfishModalRequest({ request: request(shape.cores), sourceImage: source() });
      const bundle = createGoldfishModalLaunchBundle(parsed);
      const [one, two] = bundle.tasks;
      expect(bundle.partitions).toEqual({});
      expect(bundle.jobs).toHaveLength(2);
      expect(bundle.jobs.map((job) => ({ taskId: job.taskId, stage: job.stage, range: job.range,
        cpus: job.cpus, status: job.status, dependencies: job.dependencyTaskIds }))).toEqual([
        { taskId: one!.taskId, stage: 'goldfish-one-reduce', range: null,
          cpus: shape.cores, status: 'ready', dependencies: [] },
        { taskId: two!.taskId, stage: 'goldfish-two-reduce', range: null,
          cpus: shape.cores, status: 'blocked', dependencies: [one!.taskId] }
      ]);
      expect(one).toEqual({ taskId: one!.taskId, kingdomId, evidenceId: parsed.kingdoms[0]!.evidenceId,
        stage: 'goldfish-one-reduce', range: null, cpu: shape.cores, memoryMiB: 8192,
        timeoutSeconds: shape.timeout, dependencyTaskIds: [],
        artifactPath: `evidence/${parsed.kingdoms[0]!.evidenceId}/goldfish/top-500000.hgf` });
      expect(two).toEqual({ taskId: two!.taskId, kingdomId, evidenceId: parsed.kingdoms[0]!.evidenceId,
        stage: 'goldfish-two-reduce', range: null, cpu: shape.cores, memoryMiB: 8192,
        timeoutSeconds: 300, dependencyTaskIds: [one!.taskId],
        artifactPath: `evidence/${parsed.kingdoms[0]!.evidenceId}/goldfish/reservoir.hgf` });
      expect(bundle.controller.maxReducerMemoryMiB).toBe(shape.containers * 8192);
      expect(bundle.controller).toMatchObject({ route: 'goldfish-only-v2', goldfishWorkerCores: shape.cores,
        goldfishKingdomMemoryMiB: 8192, goldfishKingdomOneTimeoutSeconds: shape.timeout,
        goldfishKingdomTwoTimeoutSeconds: 300 });
    }
  });

  it('uses current Modal rates and rejects a request below each exact calculated bound', () => {
    expect(GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND).toBe(0.0000131);
    expect(GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND).toBe(0.00000222);
    for (const shape of shapes) {
      expect(() => deriveGoldfishModalRequest({ request: {
        ...request(shape.cores), maxCostUsd: shape.cost - 0.000001
      }, sourceImage: source() })).toThrow(shape.cost.toFixed(6));
    }
  });

  it('keeps evidence IDs stable and changes execution IDs across worker shapes', () => {
    const parsed = shapes.map((shape) => deriveGoldfishModalRequest({
      request: request(shape.cores), sourceImage: source() }));
    const scientific = deriveStrategySearch({ request: { kingdomIds: [kingdomId], maxActiveCpus: 512 },
      sourceImage: source() });
    expect(new Set(parsed.map((entry) => entry.kingdoms[0]!.evidenceId))).toEqual(
      new Set([scientific.kingdoms[0]!.evidenceId]));
    expect(new Set(parsed.map((entry) => entry.campaignExecutionId))).toHaveLength(3);
    for (const entry of parsed) {
      const bundle = createGoldfishModalLaunchBundle(entry);
      expect(JSON.stringify(bundle)).not.toMatch(/matrix|psro/i);
    }
  });

  it('binds authorization to worker cores', () => {
    const sixteen = deriveGoldfishModalRequest({ request: request(16), sourceImage: source() });
    const sixtyFour = deriveGoldfishModalRequest({ request: request(64), sourceImage: source() });
    expect(validateGoldfishModalAuthorizationToken(sixteen.authorizationToken, sixteen)).toBe(true);
    expect(validateGoldfishModalAuthorizationToken(sixteen.authorizationToken, sixtyFour)).toBe(false);
    expect(sixteen.authorizationToken).not.toBe(sixtyFour.authorizationToken);
  });

  it('downloads and verifies only the two final Goldfish files', () => {
    const parsed = deriveGoldfishModalRequest({ request: request(), sourceImage: source() });
    const bundle = createGoldfishModalLaunchBundle(parsed);
    const destinationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-goldfish-download-'));
    try {
      const evidenceRoot = path.join(destinationRoot, 'evidence', parsed.kingdoms[0]!.evidenceId);
      for (const relative of ['goldfish/top-500000.hgf', 'goldfish/reservoir.hgf']) {
        const file = path.join(evidenceRoot, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, relative);
      }
      let calls = 0, clock = 0;
      const result = measureGoldfishPostDownloadValidations({ bundle, destinationRoot },
        () => { calls += 1; return Buffer.alloc(0); }, () => clock++);
      expect(result.error).toBeUndefined();
      expect(calls).toBe(2);
      expect(result.metrics.artifacts.map((entry) => entry.stage)).toEqual([
        'goldfish-one-reduce', 'goldfish-two-reduce']);
      expect(JSON.stringify(result.metrics)).not.toMatch(/matrix|psro/i);
    } finally {
      fs.rmSync(destinationRoot, { recursive: true, force: true });
    }
  });

  it('reports only the two v2 scientific stages', () => {
    const report = createGoldfishOperatorReport({ report: {
      stageWallMs: { 'goldfish-one': 100, 'goldfish-one-reduce': 20,
        'goldfish-two': 50, 'goldfish-two-reduce': 10 },
      clientOperations: { downloads: { wallMs: 25 } }
    }, preflightStateWallMs: 3, imageBuildAndDeployWallMs: 400,
    startupReadinessAndCanaryWallMs: 80, executionPreparationWallMs: 5,
    controllerCommandWallMs: 225, postDownloadValidation: { bytes: 30, wallMs: 7, artifacts: [] },
    totalOperatorWallMs: 720 });
    expect(report.route).toBe('goldfish-only-v2');
    expect(report.scientificStageWallMs).toEqual({
      'goldfish-one-reduce': 20, 'goldfish-two-reduce': 10 });
    expect(report.operatorWallMs).toEqual({ preflightState: 3, imageBuildAndDeploy: 400,
      startupReadinessAndCanary: 80, executionPreparation: 5, scientificController: 200,
      finalDownload: 25, postDownloadVerification: 7, total: 720 });
  });

  it('plans without an adapter call and requires the exact token before paid work', async () => {
    const held = fixture();
    let calls = 0;
    const verificationModes: boolean[] = [];
    const adapter: GoldfishModalOperatorAdapter = { run(input) {
      calls += 1; verificationModes.push(input.deepVerify); return { complete: true };
    } };
    try {
      const plan = await executeGoldfishModalOperation({ operation: 'plan', requestFile: held.requestFile,
        root: held.root, adapter });
      expect(plan).toMatchObject({ route: 'goldfish-only-v2', paidExecution: false,
        kingdomCount: 1, taskCount: 2 });
      expect(calls).toBe(0);
      await expect(executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        root: held.root, adapter })).rejects.toThrow('exact authorization token');
      await expect(executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: 'wrong', root: held.root, adapter })).rejects.toThrow('exact authorization token');
      const result = await executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: String(plan.authorizationToken), root: held.root, adapter });
      expect(result.outcome).toEqual({ complete: true });
      await executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: String(plan.authorizationToken), root: held.root, adapter, deepVerify: true });
      expect(calls).toBe(2);
      expect(verificationModes).toEqual([false, true]);
    } finally {
      fs.rmSync(held.root, { recursive: true, force: true });
    }
  });
});
