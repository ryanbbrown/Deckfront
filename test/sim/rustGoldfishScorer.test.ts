import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerKingdom, resetKingdoms } from '../../src/game';
import { RustGoldfishScorer } from '../../src/sim/rustGoldfishScorer';
import { fixedBuyPlan, identify } from '../../src/sim/strategy';

afterEach(() => resetKingdoms());

describe('RustGoldfishScorer process lifecycle', () => {
  it('rejects scoring and late cleanup promptly after signal termination', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexdeck-fake-native-'));
    const executable = path.join(directory, 'signal-native');
    fs.writeFileSync(executable, `#!/usr/bin/env node
process.stdin.once('data', () => process.kill(process.pid, 'SIGTERM'));
process.stdin.resume();
`);
    fs.chmodSync(executable, 0o755);
    registerKingdom({ id: 'signal-fixture', name: 'Signal fixture', startingHealth: 50,
      actionPiles: [{ cardId: 'precisionShot', count: 10 }] });
    const strategy = identify({ id: '', startingBuild: [], buyPlan: fixedBuyPlan([]) });
    const scorer = new RustGoldfishScorer(1, 1, executable);
    try {
      await expect(scorer.score({ id: 'signal-fixture', name: 'Signal fixture', startingHealth: 50,
        actionPiles: [{ cardId: 'precisionShot', count: 10 }] }, [strategy], {
        kingdomId: 'signal-fixture', seeds: [1], turnLimit: 1, actionCapPerTurn: 1
      }, 1, 'compact')).rejects.toThrow('signal SIGTERM');
      await expect(scorer.close()).rejects.toThrow('signal SIGTERM');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 2_000);
});
