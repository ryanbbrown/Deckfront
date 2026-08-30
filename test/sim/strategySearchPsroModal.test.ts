import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveSourceImageIdentity, deriveStrategySearch } from '../../src/sim/strategySearchCampaign';
import { deriveTrackedStrategySearchSourceImage } from '../../scripts/strategy_search_source';
import {
  executePsroModalOperation, psroDownloadTimeoutMs, psroLaunchTimeoutMs, psroStatusTimeoutMs
} from '../../scripts/strategy_search_psro_modal';
import { validateConsolidatedManifest } from '../../scripts/generate_rust_strategy_search_balance_report';
import {
  abandonPsroLaunch, adoptPsroLease, buildPsroBatchReport, comparePsroScientificFiles,
  createPsroExecutionState, createPsroModalPlanSummary, derivePsroModalPlan,
  parsePsroModalRequest, pendingPsroAttempts, psroAttemptBoundUsd, psroLedgerTotalUsd,
  PSRO_INPUT_RELATIVES, PSRO_MODAL_READINESS_RESERVATION_USD, recordPsroAttemptResult,
  reservePsroRun, selectPsroDownloadFiles, selectPsroLaunches, validatePsroModalAuthorizationToken
} from '../../src/sim/strategySearchPsroModal';
import type { PsroModalRequest } from '../../src/sim/strategySearchPsroModal';

const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
function temporary(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-psro-modal-')); roots.push(root); return root; }
const source = (scientific = 'rules') => deriveSourceImageIdentity({ files: [
  { path: 'rules.ts', content: scientific }, { path: 'runtime.ts', content: 'runtime' }],
scientificPaths: ['rules.ts'] });
const request = (changes: Partial<PsroModalRequest> = {}): PsroModalRequest => ({
  kingdomIds: ['balance-tuning-090'], workerCores: 16, maxActiveCpus: 16,
  maxWallSecondsPerKingdom: 7200, maxCostUsd: 5, ...changes
});
function inputs(requestValue = request(), sourceValue = source()) {
  const scientific = deriveStrategySearch({ request: { kingdomIds: requestValue.kingdomIds,
    maxActiveCpus: requestValue.maxActiveCpus }, sourceImage: sourceValue });
  return Object.fromEntries(scientific.kingdoms.map((kingdom, kingdomIndex) => [kingdom.evidenceId,
    Object.fromEntries(PSRO_INPUT_RELATIVES.map((relative, index) => [relative,
      (kingdomIndex * 10 + index).toString(16).padStart(64, '0')]))]));
}
function plan(requestValue = request(), sourceValue = source(), inputValue = inputs(requestValue, sourceValue)) {
  return derivePsroModalPlan({ request: requestValue, sourceImage: sourceValue, inputSha256: inputValue });
}

describe('Modal PSRO operator safety', () => {
  it('scales launch, status, and download timeouts with work size', () => {
    expect(psroLaunchTimeoutMs(0)).toBe(300_000);
    expect(psroLaunchTimeoutMs(8)).toBe(340_000);
    expect(psroLaunchTimeoutMs(130)).toBe(950_000);
    expect(psroStatusTimeoutMs(0)).toBe(120_000);
    expect(psroStatusTimeoutMs(130)).toBe(250_000);
    expect(psroDownloadTimeoutMs(0)).toBe(600_000);
    expect(psroDownloadTimeoutMs(130)).toBe(1_900_000);
  });

  function diskFixture() {
    const root = temporary(), requestFile = path.join(root, 'request.json'), requestValue = request();
    fs.writeFileSync(requestFile, JSON.stringify(requestValue));
    const sourceImage = deriveTrackedStrategySearchSourceImage(process.cwd());
    const scientific = deriveStrategySearch({ request: { kingdomIds: requestValue.kingdomIds,
      maxActiveCpus: requestValue.maxActiveCpus }, sourceImage });
    for (const kingdom of scientific.kingdoms) for (const relative of PSRO_INPUT_RELATIVES) {
      const file = path.join(root, kingdom.kingdomId, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relative);
    }
    return { root, requestFile };
  }

  it('plan makes no adapter or Modal call', async () => {
    const fixture = diskFixture();
    const adapter = new Proxy({}, { get: () => () => { throw new Error('adapter called'); } });
    const summary = await executePsroModalOperation({ operation: 'plan', ...fixture,
      adapter: adapter as never });
    expect(summary.paidExecution).toBe(false);
  });

  it('run refuses a missing token before any adapter call', async () => {
    const fixture = diskFixture();
    const adapter = new Proxy({}, { get: () => () => { throw new Error('adapter called'); } });
    await expect(executePsroModalOperation({ operation: 'run', ...fixture,
      adapter: adapter as never })).rejects.toThrow(/exact authorization token/u);
  });
});

describe('Modal PSRO request and plan', () => {
  it('requires every field and rejects extra, duplicate, unknown, and unsafe values', () => {
    const valid = request();
    for (const key of Object.keys(valid)) {
      const held = { ...valid } as Record<string, unknown>; delete held[key];
      expect(() => parsePsroModalRequest(held)).toThrow();
    }
    expect(() => parsePsroModalRequest({ ...valid, paidDefault: true })).toThrow();
    expect(() => parsePsroModalRequest({ ...valid, kingdomIds: ['balance-tuning-090', 'balance-tuning-090'] })).toThrow();
    expect(() => parsePsroModalRequest({ ...valid, kingdomIds: ['not-registered'] })).toThrow();
    expect(() => parsePsroModalRequest({ ...valid, maxActiveCpus: 15 })).toThrow();
    expect(() => parsePsroModalRequest({ ...valid, maxWallSecondsPerKingdom: 299 })).toThrow();
    expect(() => parsePsroModalRequest({ ...valid, maxWallSecondsPerKingdom: 21_601 })).toThrow();
    expect(() => parsePsroModalRequest({ ...valid, maxCostUsd: 100.01 })).toThrow();
  });

  it('pins slots, timeout, attempt bounds, and readiness reservation', () => {
    expect(psroAttemptBoundUsd(request())).toBeCloseTo(1.6642752, 10);
    expect(psroAttemptBoundUsd(request({ workerCores: 32, maxActiveCpus: 70 }))).toBeCloseTo(3.1985472, 10);
    const parsed = plan(request({ maxActiveCpus: 35 }));
    expect(PSRO_MODAL_READINESS_RESERVATION_USD).toBeCloseTo(0.0078996, 10);
    const summary = createPsroModalPlanSummary(parsed);
    expect(summary).toMatchObject({ slots: 2, unusedCpuCapacity: 3,
      timeouts: { maximumWallSecondsPerKingdom: 7200, functionTimeoutSeconds: 7260 } });
    expect(summary.costGuard.attemptBoundUsd).toBeCloseTo(1.6642752, 10);
    expect(summary.costGuard.launchBoundUsd).toBeCloseTo(
      1.6642752 + PSRO_MODAL_READINESS_RESERVATION_USD, 10);
  });

  it('binds execution identity only to scientific inputs, order, and worker cores', () => {
    const base = plan(), baseInputs = inputs();
    expect(plan(request({ maxActiveCpus: 32, maxWallSecondsPerKingdom: 8000, maxCostUsd: 6 })).executionId)
      .toBe(base.executionId);
    const deploymentOnly = deriveSourceImageIdentity({ files: [
      { path: 'rules.ts', content: 'rules' }, { path: 'runtime.ts', content: 'changed runtime' }],
    scientificPaths: ['rules.ts'] });
    expect(plan(request(), deploymentOnly, baseInputs).executionId).toBe(base.executionId);
    expect(plan(request({ workerCores: 17, maxActiveCpus: 17 })).executionId).not.toBe(base.executionId);
    expect(plan(request(), source('changed rules')).executionId).not.toBe(base.executionId);
    const changedInputs = structuredClone(baseInputs), evidenceId = Object.keys(changedInputs)[0]!;
    changedInputs[evidenceId]!['matrix/matrix.hgm'] = 'f'.repeat(64);
    expect(plan(request(), source(), changedInputs).executionId).not.toBe(base.executionId);
    const two = request({ kingdomIds: ['balance-tuning-005', 'balance-tuning-090'], maxActiveCpus: 32, maxCostUsd: 5 });
    const reversed = { ...two, kingdomIds: [...two.kingdomIds].reverse() };
    expect(plan(two).executionId).not.toBe(plan(reversed).executionId);
  });

  it('binds authorization to every request field, deployment digest, and input hash', () => {
    const base = plan();
    expect(validatePsroModalAuthorizationToken(base.authorizationToken, base)).toBe(true);
    expect(validatePsroModalAuthorizationToken('', base)).toBe(false);
    for (const changed of [request({ maxActiveCpus: 17 }), request({ maxWallSecondsPerKingdom: 7201 }),
      request({ maxCostUsd: 6 }), request({ workerCores: 15 })]) {
      expect(plan(changed).authorizationToken).not.toBe(base.authorizationToken);
    }
    const deploymentOnly = deriveSourceImageIdentity({ files: [
      { path: 'rules.ts', content: 'rules' }, { path: 'runtime.ts', content: 'changed runtime' }],
    scientificPaths: ['rules.ts'] });
    expect(plan(request(), deploymentOnly, inputs()).authorizationToken).not.toBe(base.authorizationToken);
    const changedInputs = inputs(), evidenceId = Object.keys(changedInputs)[0]!;
    changedInputs[evidenceId]!['matrix/pairs.hgm'] = 'e'.repeat(64);
    expect(plan(request(), source(), changedInputs).authorizationToken).not.toBe(base.authorizationToken);
  });
});

describe('Modal PSRO ledger and state transitions', () => {
  it('keeps unmeasured attempts at their full bound across relaunches and reserves each run', () => {
    const parsed = plan(), state = createPsroExecutionState(parsed.executionId);
    reservePsroRun(state, { runId: 'run-one', deploymentDigest: parsed.sourceImage.digest, maxCostUsd: 5, now: 1 });
    const [first] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'launch-one', now: 2 });
    expect(first).toBeDefined(); recordPsroAttemptResult(first!, { status: 'failed' });
    reservePsroRun(state, { runId: 'run-two', deploymentDigest: parsed.sourceImage.digest, maxCostUsd: 5, now: 3 });
    const [second] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'launch-two', now: 4 });
    expect(second).toBeDefined();
    expect(psroLedgerTotalUsd(state)).toBeCloseTo(2 * parsed.costGuard.attemptBoundUsd
      + 2 * PSRO_MODAL_READINESS_RESERVATION_USD, 10);
    recordPsroAttemptResult(second!, { status: 'complete', measuredCostUsd: 0.2 });
    expect(psroLedgerTotalUsd(state)).toBeCloseTo(parsed.costGuard.attemptBoundUsd + 0.2
      + 2 * PSRO_MODAL_READINESS_RESERVATION_USD, 10);
  });

  it('refuses a spawn that exceeds the execution cost limit', () => {
    const parsed = plan(request({ maxCostUsd: 1.673 })), state = createPsroExecutionState(parsed.executionId);
    reservePsroRun(state, { runId: 'one', deploymentDigest: parsed.sourceImage.digest, maxCostUsd: 1.673 });
    const [attempt] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'one' });
    recordPsroAttemptResult(attempt!, { status: 'failed' });
    expect(() => selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'two' })).toThrow(/ledger would exceed/u);
  });

  it('never respawns pending or complete work and relaunches failed work within slots', () => {
    const requested = request({ kingdomIds: ['balance-tuning-005', 'balance-tuning-090'], maxActiveCpus: 16,
      maxCostUsd: 5 }), parsed = plan(requested), state = createPsroExecutionState(parsed.executionId);
    const [first] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'first' });
    first!.callId = 'fc-first'; first!.status = 'pending';
    expect(selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'blocked' })).toEqual([]);
    recordPsroAttemptResult(first!, { status: 'complete', measuredCostUsd: 0.1 });
    const [second] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'second' });
    expect(second!.kingdomId).toBe('balance-tuning-090');
    recordPsroAttemptResult(second!, { status: 'failed' });
    const [retry] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'retry' });
    expect(retry!.kingdomId).toBe('balance-tuning-090');
    expect(pendingPsroAttempts(state)).toHaveLength(0);
  });

  it('does not relaunch an unknown attempt until it is adopted or abandoned', () => {
    const parsed = plan(), state = createPsroExecutionState(parsed.executionId);
    const [unknown] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'unknown' });
    expect(selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'blocked' })).toEqual([]);
    expect(unknown!.status).toBe('unknown');
    adoptPsroLease(state, { launchId: 'unknown', callId: 'fc-adopted' });
    expect(unknown).toMatchObject({ status: 'pending', callId: 'fc-adopted' });
    recordPsroAttemptResult(unknown!, { status: 'failed' });
    const [another] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'another' });
    another!.status = 'unknown'; abandonPsroLaunch(state, 'another');
    expect(selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'after-abandon' })[0]!.launchId).toBe('after-abandon');
  });

  it('refuses another deployment while a call is pending', () => {
    const parsed = plan(), state = createPsroExecutionState(parsed.executionId);
    const [attempt] = selectPsroLaunches({ state, plan: parsed, deploymentDigest: parsed.sourceImage.digest,
      launchId: () => 'pending' });
    attempt!.status = 'pending'; attempt!.callId = 'fc';
    expect(() => selectPsroLaunches({ state, plan: parsed, deploymentDigest: 'f'.repeat(64),
      launchId: () => 'new' })).toThrow(/different deployment digest/u);
  });
});

describe('Modal PSRO downloads and reports', () => {
  it('selects all deliverables except the three operational files', () => {
    expect(selectPsroDownloadFiles(['search-0001/screen-0008.hpl', 'checkpoint.hpc', 'run-report.json',
      'lease.json', 'nested/progress.json', 'job-report.json'])).toEqual([
      'checkpoint.hpc', 'run-report.json', 'search-0001/screen-0008.hpl']);
  });

  it('byte-compares present, missing, identical, and differing scientific files', () => {
    const root = temporary(), left = path.join(root, 'left'), right = path.join(root, 'right');
    fs.mkdirSync(left); fs.mkdirSync(right);
    fs.writeFileSync(path.join(left, 'checkpoint.hpc'), 'same'); fs.writeFileSync(path.join(right, 'checkpoint.hpc'), 'same');
    fs.writeFileSync(path.join(left, 'decisions.hpd'), 'left'); fs.writeFileSync(path.join(right, 'decisions.hpd'), 'right');
    fs.writeFileSync(path.join(left, 'admission-0001.hpa'), 'only-left');
    expect(comparePsroScientificFiles(left, right).map((entry) => [entry.path, entry.identical])).toEqual([
      ['admission-0001.hpa', false], ['checkpoint.hpc', true], ['decisions.hpd', false]]);
  });

  it('rebuilds the routine PSRO report from every kingdom under the root', () => {
    const root = temporary();
    for (const [kingdomId, admissions] of [['balance-tuning-090', 2], ['balance-tuning-005', 0]] as const) {
      const directory = path.join(root, kingdomId, 'psro'); fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'run-report.json'), JSON.stringify({ searches: 3,
        admissions, finalMatrixSize: 50 + admissions }));
    }
    const report = buildPsroBatchReport(root);
    expect(report).toMatchObject({ protocol: 'routine-psro-batch-report-v1', confirmedQueueCap: 100,
      stoppingRule: 'two-consecutive-clean-full-searches', allValid: true, missingKingdomIds: [] });
    expect(report.kingdoms.map((entry) => entry.kingdomId)).toEqual(['balance-tuning-005', 'balance-tuning-090']);
    expect(report.kingdoms.every((entry) => entry.cleanFinalSearches === 2)).toBe(true);
    fs.writeFileSync(path.join(root, 'psro-batch-report.json'), JSON.stringify(report));
    expect(() => validateConsolidatedManifest(root,
      ['balance-tuning-005', 'balance-tuning-090'])).not.toThrow();
  });
});
