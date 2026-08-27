import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deriveStrategySearch } from '../../src/sim/strategySearchCampaign';
import { createStrategySearchLaunchBundle } from '../../src/sim/strategySearchCampaignOperator';
import {
  deriveTrackedStrategySearchSourceImage, executeStrategySearchOperation, streamProcess
} from '../../scripts/strategy_search_campaign';
import type {
  StrategySearchOperatorAdapter, StrategySearchRemoteStatus
} from '../../scripts/strategy_search_campaign';

function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-search-operator-'));
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'strategy-search-image-files.json'), '["package.json","strategy-search-image-files.json"]\n');
  execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const requestFile = path.join(root, 'request.json'); fs.writeFileSync(requestFile,
    '{"kingdomIds":["deep-beam-tuning-007"],"maxActiveCpus":400}\n');
  const parsed = deriveStrategySearch({ request: JSON.parse(fs.readFileSync(requestFile, 'utf8')),
    sourceImage: deriveTrackedStrategySearchSourceImage(root) });
  return { root, requestFile, parsed }; }
describe('strategy-search operator', () => {
  it('plans without remote work and binds the exact ordered request', async () => { const held = fixture(); let calls = 0;
    const adapter: StrategySearchOperatorAdapter = { status() { calls += 1; throw new Error('not called'); },
      run() { calls += 1; throw new Error('not called'); } };
    try { const plan = await executeStrategySearchOperation({ operation: 'plan', requestFile: held.requestFile,
      root: held.root, adapter });
      expect(plan).toMatchObject({ schemaVersion: 2, kingdomCount: 1, maxActiveCpus: 400,
        workspaceBudgetVerification: 'not-performed' });
      expect(plan.authorizationToken).toBe(held.parsed.authorizationToken); expect(calls).toBe(0);
    } finally { fs.rmSync(held.root, { recursive: true, force: true }); } });

  it('uses status as a read-only seam and never puts run authorization behind status deployment', async () => {
    const held = fixture();
    let runs = 0, statuses = 0; const status: StrategySearchRemoteStatus = { exists: false,
      campaignExecutionId: held.parsed.campaignExecutionId, status: 'missing', phase: 'missing' };
    const adapter: StrategySearchOperatorAdapter = { status() { statuses += 1; return status; },
      run() { runs += 1; return { complete: true }; } };
    try { expect(await executeStrategySearchOperation({ operation: 'status', requestFile: held.requestFile,
      root: held.root, adapter })).toMatchObject({ exists: false, status: 'missing' });
      expect(runs).toBe(0); expect(statuses).toBe(1);
      await expect(executeStrategySearchOperation({ operation: 'run', requestFile: held.requestFile,
        root: held.root, adapter })).rejects.toThrow('exact authorization');
      await expect(executeStrategySearchOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: 'strategy-search-v2.wrong', root: held.root, adapter })).rejects.toThrow('exact authorization');
      expect(await executeStrategySearchOperation({ operation: 'run', requestFile: held.requestFile,
        authorizationToken: held.parsed.authorizationToken, root: held.root, adapter })).toMatchObject({
          campaignExecutionId: held.parsed.campaignExecutionId });
      expect(runs).toBe(1); expect(statuses).toBe(1);
    } finally { fs.rmSync(held.root, { recursive: true, force: true }); } });

  it('deploys and verifies a versioned compute app before it starts the acceptance clock', () => {
    const source = fs.readFileSync('scripts/strategy_search_campaign.ts', 'utf8');
    const preflightState = source.indexOf("phase: 'strategy-search-preflight-state'");
    const deploy = source.indexOf("phase: 'strategy-search-compute-deploy'");
    const readiness = source.indexOf("phase: 'strategy-search-compute-readiness'");
    const prepare = source.indexOf("phase: 'strategy-search-execution-prepare'");
    const clock = source.indexOf('strategy-search-acceptance-clock-started');
    const run = source.indexOf("phase: 'strategy-search-deployed-run'");
    expect(preflightState).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(preflightState);
    expect(readiness).toBeGreaterThan(deploy);
    expect(prepare).toBeGreaterThan(readiness);
    expect(clock).toBeGreaterThan(prepare);
    expect(run).toBeGreaterThan(clock);
    expect(source).toContain("args: ['deploy', '--name'");
    expect(source).toContain('modal/strategy_search_runtime.py::run_deployed_entry');
    expect(source).toContain('spawn(input.executable, input.args');
    expect(source).toContain("child.stdout.on('data'");
    expect(source).toContain('process.stdout.write(chunk)');
    expect(source).not.toContain("execFileSync('modal'");
    expect(source).not.toContain('native_strategy_search.py::strategy_search_run_entry');
  });

  it('streams child progress before the final result resolves', async () => {
    const chunks: string[] = [];
    let markFirstSeen: () => void = () => undefined;
    const firstSeen = new Promise<void>((resolve) => { markFirstSeen = resolve; });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      const text = chunk.toString(); chunks.push(text); if (text.includes('first')) markFirstSeen(); return true;
    }) as typeof process.stdout.write);
    try {
      let resolved = false;
      const pending = streamProcess({ executable: process.execPath, phase: 'stream-fixture', timeoutMs: 1000,
        args: ['-e', "process.stdout.write('first\\n');setTimeout(()=>process.stdout.write('final\\n'),100)"]
      }).then((output) => { resolved = true; return output; });
      await firstSeen;
      expect(chunks.join('')).toContain('first');
      expect(resolved).toBe(false);
      expect(await pending).toContain('final');
    } finally { write.mockRestore(); }
  });

  it('creates hundreds of pinned K007 Goldfish jobs without putting capacity in evidence identity', () => {
    const held = fixture();
    try { const bundle = createStrategySearchLaunchBundle(held.parsed), stageOne = bundle.jobs.filter((job) => job.stage === 'goldfish-one');
      expect(stageOne.length).toBeGreaterThan(100);
      expect(bundle.partitions[`${held.parsed.kingdoms[0]!.evidenceId}:goldfish-one`]?.jobs).toHaveLength(stageOne.length);
      expect(bundle.jobs.filter((job) => job.stage === 'goldfish-two')).toHaveLength(1);
      expect(bundle.jobs.find((job) => job.stage === 'goldfish-two')).toMatchObject({ cpus: 10,
        range: { start: 0, end: 500_000 } });
      expect(JSON.stringify(held.parsed.kingdoms[0])).not.toContain('maxActiveCpus');
      expect(JSON.stringify(held.parsed.kingdoms[0])).not.toContain('worker');
      expect(bundle.tasks.every((task) => task.artifactPath.startsWith(`evidence/${task.evidenceId}/`))).toBe(true);
    } finally { fs.rmSync(held.root, { recursive: true, force: true }); }
  });
});
