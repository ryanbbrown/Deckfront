import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveSourceImageIdentity, deriveStrategySearch } from '../../src/sim/strategySearchCampaign';
import {
  createGoldfishModalLaunchBundle, createGoldfishModalPlanSummary, deriveGoldfishModalRequest,
  GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND, GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND,
  parseGoldfishModalRequest, validateGoldfishModalAuthorizationToken
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
function request(workerCores = 4, maxActiveCpus = 64) {
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

describe('Goldfish-only Modal operator', () => {
  it('accepts only explicit bounded paid inputs', () => {
    expect(parseGoldfishModalRequest(request())).toEqual(request());
    expect(parseGoldfishModalRequest(request(16, 640))).toEqual(request(16, 640));
    for (const value of [
      { ...request(), extra: true },
      { kingdomIds: [], workerCores: 4, maxActiveCpus: 64, maxWallSeconds: 3600, maxCostUsd: 100 },
      { ...request(), kingdomIds: [kingdomId, kingdomId] },
      { ...request(), workerCores: 65 },
      { ...request(), workerCores: 16, maxActiveCpus: 8 },
      { ...request(), workerCores: 1, maxActiveCpus: 3 },
      { ...request(), maxWallSeconds: 299 },
      { ...request(), maxWallSeconds: 21_601 },
      { ...request(), maxCostUsd: 100.01 }
    ]) expect(() => parseGoldfishModalRequest(value)).toThrow();
  });

  it('plans exact 16x4, 4x16, and 1x64 score fleets and complete task counts', () => {
    const expected = [
      { cores: 4, containers: 16, scoreOne: 121, scoreTwo: 14, total: 137, cost: 5.611193 },
      { cores: 16, containers: 4, scoreOne: 31, scoreTwo: 4, total: 37, cost: 5.216813 },
      { cores: 64, containers: 1, scoreOne: 8, scoreTwo: 1, total: 11, cost: 5.203406 }
    ];
    for (const held of expected) {
      const parsed = deriveGoldfishModalRequest({ request: request(held.cores), sourceImage: source() });
      const plan = createGoldfishModalPlanSummary(parsed);
      expect(plan.resourceShape).toMatchObject({ workerCoresPerContainer: held.cores,
        maxActiveCpus: 64, maxScoreContainers: held.containers,
        maxScheduledScoreCpus: 64, unusedCpuCapacity: 0 });
      expect(plan.taskCounts).toEqual({ scoreOne: held.scoreOne, reduceOne: 1,
        scoreTwo: held.scoreTwo, reduceTwo: 1, total: held.total });
      expect(plan.taskCount).toBe(held.total);
      expect(plan.worstCaseModalComputeUsd).toBe(held.cost);
      for (const partition of Object.values(parsed.partitions)) {
        expect(partition.jobs[0]!.start).toBe(0);
        expect(partition.jobs.at(-1)!.end).toBe(partition.total);
        expect(partition.jobs.every((range, index) => index === 0
          || partition.jobs[index - 1]!.end === range.start)).toBe(true);
      }
    }
  });

  it('allows at most two reducers within the active CPU budget', () => {
    const parsed = deriveGoldfishModalRequest({ request: {
      ...request(16, 256),
      kingdomIds: ['balance-tuning-005', 'balance-tuning-007', 'balance-tuning-009', 'balance-tuning-010']
    }, sourceImage: source() });
    expect(parsed.resourceShape.maxConcurrentReducers).toBe(2);
    expect(createGoldfishModalLaunchBundle(parsed).controller.maxReducerMemoryMiB).toBe(16_384);
  });

  it('uses the current Modal list rates and rejects a request below the calculated bound', () => {
    expect(GOLDFISH_MODAL_CPU_USD_PER_CORE_SECOND).toBe(0.0000131);
    expect(GOLDFISH_MODAL_MEMORY_USD_PER_GIB_SECOND).toBe(0.00000222);
    expect(() => deriveGoldfishModalRequest({ request: { ...request(), maxCostUsd: 5.5 },
      sourceImage: source() })).toThrow('5.611193');
  });

  it('keeps scientific evidence identity stable across worker shapes and emits no downstream work', () => {
    const four = deriveGoldfishModalRequest({ request: request(4), sourceImage: source() });
    const sixtyFour = deriveGoldfishModalRequest({ request: request(64), sourceImage: source() });
    const scientific = deriveStrategySearch({ request: { kingdomIds: [kingdomId], maxActiveCpus: 64 },
      sourceImage: source() });
    expect(four.kingdoms[0]!.evidenceId).toBe(sixtyFour.kingdoms[0]!.evidenceId);
    expect(four.kingdoms[0]!.evidenceId).toBe(scientific.kingdoms[0]!.evidenceId);
    expect(four.campaignExecutionId).not.toBe(sixtyFour.campaignExecutionId);
    const bundle = createGoldfishModalLaunchBundle(four);
    expect(bundle.controller.route).toBe('goldfish-only-v1');
    expect(bundle.tasks.every((task) => task.stage.startsWith('goldfish-'))).toBe(true);
    expect(JSON.stringify(bundle)).not.toMatch(/matrix|psro/i);
    expect(bundle.tasks[0]).toMatchObject({ kingdomId, cpu: 4, memoryMiB: 4096,
      timeoutSeconds: 180, artifactPath: expect.stringContaining('/tasks/goldfish-one/') });
  });

  it('binds authorization to every paid input', () => {
    const four = deriveGoldfishModalRequest({ request: request(4), sourceImage: source() });
    const sixteen = deriveGoldfishModalRequest({ request: request(16), sourceImage: source() });
    expect(validateGoldfishModalAuthorizationToken(four.authorizationToken, four)).toBe(true);
    expect(validateGoldfishModalAuthorizationToken(four.authorizationToken, sixteen)).toBe(false);
    expect(four.authorizationToken).not.toBe(sixteen.authorizationToken);
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

  it('keeps deployment and startup wall time outside scientific stage wall time', () => {
    const report = createGoldfishOperatorReport({ report: {
      stageWallMs: { 'goldfish-one': 100, 'goldfish-one-reduce': 20,
        'goldfish-two': 50, 'goldfish-two-reduce': 10 },
      clientOperations: { downloads: { wallMs: 25 } }
    }, preflightStateWallMs: 3, imageBuildAndDeployWallMs: 400,
    startupReadinessAndCanaryWallMs: 80, executionPreparationWallMs: 5,
    controllerCommandWallMs: 225, postDownloadValidation: { bytes: 30, wallMs: 7, artifacts: [] },
    totalOperatorWallMs: 720 });
    expect(report.scientificStageWallMs).toEqual({ 'goldfish-one': 100,
      'goldfish-one-reduce': 20, 'goldfish-two': 50, 'goldfish-two-reduce': 10 });
    expect(report.operatorWallMs).toEqual({ preflightState: 3, imageBuildAndDeploy: 400,
      startupReadinessAndCanary: 80, executionPreparation: 5, scientificController: 200,
      finalDownload: 25, postDownloadVerification: 7, total: 720 });
  });

  it('plans without an adapter call and requires the exact token before paid work', async () => {
    const held = fixture();
    let calls = 0;
    const adapter: GoldfishModalOperatorAdapter = { run() { calls += 1; return { complete: true }; } };
    try {
      const plan = await executeGoldfishModalOperation({ operation: 'plan', requestFile: held.requestFile,
        root: held.root, adapter });
      expect(plan).toMatchObject({ route: 'goldfish-only-v1', paidExecution: false,
        kingdomCount: 1, taskCount: 137 });
      expect(calls).toBe(0);
      await expect(executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        root: held.root, adapter })).rejects.toThrow('exact authorization token');
      await expect(executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: 'wrong', root: held.root, adapter })).rejects.toThrow('exact authorization token');
      const result = await executeGoldfishModalOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: String(plan.authorizationToken), root: held.root, adapter });
      expect(result.outcome).toEqual({ complete: true });
      expect(calls).toBe(1);
    } finally {
      fs.rmSync(held.root, { recursive: true, force: true });
    }
  });
});
